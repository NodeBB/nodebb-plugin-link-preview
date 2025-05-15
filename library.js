/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */

'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');
const dns = require('dns');

const { getLinkPreview } = require('link-preview-js');
const { load } = require('cheerio');
const { isURL } = require('validator');

const meta = require.main.require('./src/meta');
const cache = require.main.require('./src/cache');
const posts = require.main.require('./src/posts');
const postsCache = require.main.require('./src/posts/cache');
const websockets = require.main.require('./src/socket.io');

const controllers = require('./lib/controllers');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};

plugin.init = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/link-preview', [], controllers.renderAdminPage);
};

plugin.applyDefaults = async (data) => {
	const { plugin, values } = data;

	if (plugin === 'link-preview') {
		['embedHtml', 'embedImage', 'embedAudio', 'embedVideo'].forEach((prop) => {
			if (!values.hasOwnProperty(prop)) {
				values[prop] = 'on';
			}
		});
	}

	return data;
};

async function preview(url) {
	return getLinkPreview(url, {
		resolveDNSHost: async url => new Promise((resolve, reject) => {
			const { hostname } = new URL(url);
			dns.lookup(hostname, (err, address) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(address); // if address resolves to localhost or '127.0.0.1' library will throw an error
			});
		}),
		followRedirects: `manual`,
		handleRedirects: (baseURL, forwardedURL) => {
			const urlObj = new URL(baseURL);
			const forwardedURLObj = new URL(forwardedURL);
			if (
				forwardedURLObj.hostname === urlObj.hostname ||
				forwardedURLObj.hostname === `www.${urlObj.hostname}` ||
				`www.${forwardedURLObj.hostname}` === urlObj.hostname
			) {
				return true;
			}

			return false;
		},
	}).then((preview) => {
		// winston.verbose(`[link-preview] ${preview.url} (${preview.contentType}, cache: miss)`);
		cache.set(`link-preview:${url}`, preview);

		return preview;
	}).catch(() => {
		// winston.verbose(`[link-preview] ${url} (invalid, cache: miss)`);
		cache.set(`link-preview:${url}`, { url });
	});
}

async function process(content, { type, pid, tid, attachments }) {
	const inlineTypes = ['default', 'activitypub.article'];
	const processInline = inlineTypes.includes(type);
	const { embedHtml, embedImage, embedAudio, embedVideo } = await meta.settings.get('link-preview');
	if (![embedHtml, embedImage, embedAudio, embedVideo].some(prop => prop === 'on')) {
		return content;
	}

	const requests = new Map();
	let attachmentHtml = '';
	let placeholderHtml = '';

	// Parse inline urls
	const $ = load(content, null, false);
	for (const anchor of $('a')) {
		const $anchor = $(anchor);

		// Skip if the anchor has link text, or has text on the same line.
		let url = $anchor.attr('href');
		url = decodeURI(url);
		const text = $anchor.text();
		const hasSiblings = !!anchor.prev || !!anchor.next;
		if (hasSiblings || url !== text || anchor.parent.name !== 'p') {
			continue;
		}

		// Handle relative URLs
		if (!url.startsWith('http')) {
			url = `${nconf.get('url')}${url.startsWith('/') ? url : `/${url}`}`;
		}

		if (processInline) {
			const special = await handleSpecialEmbed(url, $anchor);
			if (special) {
				requests.delete(url);
				continue;
			}
		}

		// Inline url takes precedence over attachment
		requests.set(url, {
			type: 'inline',
			target: $anchor,
		});
	}

	// Post attachments
	if (pid && Array.isArray(attachments) && attachments.length) {
		const attachmentData = await posts.attachments.getAttachments(attachments);
		await Promise.all(attachmentData.filter(Boolean).map(async (attachment) => {
			const { url, _type } = attachment;
			const isInlineImage = new RegExp(`<img.+?src="${url}".+?>`).test(content);
			if (isInlineImage) {
				return;
			}

			const special = await handleSpecialEmbed(url);
			if (special) {
				attachmentHtml += special;
				return;
			}

			if (attachment.hasOwnProperty('mediaType') && attachment.mediaType.startsWith('video/')) { // ActivityPub
				cache.set(`link-preview:${url}`, {
					...attachment,
					contentType: attachment.mediaType,
					mediaType: 'video',
				});
			}

			const type = _type || 'attachment';
			requests.set(url, { type });
		}));
	}

	// Render cache hits immediately
	const cold = new Set();
	await Promise.all(Array.from(requests.keys()).map(async (url) => {
		const options = requests.get(url);
		const cached = cache.get(`link-preview:${url}`);
		if (cached) {
			const html = await render(cached);
			if (html) {
				switch (options.type) {
					case 'inline': {
						if (processInline) {
							const $anchor = options.target;
							$anchor.replaceWith($(html));
						}
						break;
					}

					case 'attachment': {
						attachmentHtml += html;
						break;
					}
				}
			}
		} else {
			if (options.type === 'attachment') {
				placeholderHtml += `<p><a href="${url}" rel="nofollow ugc">${url}</a></p>`;
			}
			cold.add(url);
		}
	}));

	// Start preview for cache misses, but continue for now so as to not block response
	if (cold.size) {
		const coldArr = Array.from(cold);
		Promise.all(coldArr.map(preview)).then(async (previews) => {
			await Promise.all(previews.map(async (preview, idx) => {
				if (!preview) {
					return;
				}

				const url = coldArr[idx];
				const options = requests.get(url);
				const parsedUrl = new URL(url);
				preview.hostname = parsedUrl.hostname;

				const html = await render(preview);
				if (html) {
					switch (options.type) {
						case 'inline': {
							if (processInline) {
								const $anchor = options.target;
								$anchor.replaceWith($(html));
							}
							break;
						}

						case 'attachment': {
							attachmentHtml += html;
							break;
						}
					}
				}
			}));

			let content = $.html();
			content += attachmentHtml ? `\n\n<div class="row">${attachmentHtml}</div>` : '';

			// bust posts cache item
			if (pid) {
				const cache = postsCache.getOrCreate();
				const cacheKey = `${String(pid)}|${type}`;
				cache.set(cacheKey, content);

				// fire post edit event with mocked data
				if (type === 'default' && tid) {
					websockets.in(`topic_${tid}`).emit('event:post_edited', {
						post: {
							tid,
							pid,
							changed: true,
							content,
						},
						topic: {},
					});
				}
			}
		});
	}

	content = $.html();
	content += attachmentHtml ? `\n\n<div class="row"><div class="col-12 mt-3">${attachmentHtml}</div></div>` : '';
	content += placeholderHtml ? `\n\n<div class="row"><div class="col-12 mt-3">${placeholderHtml}</div></div>` : '';
	return content;
}

async function render(preview) {
	const { app } = require.main.require('./src/webserver');
	const { embedHtml, embedImage, embedAudio, embedVideo } = await meta.settings.get('link-preview');

	// winston.verbose(`[link-preview] ${preview.url} (${preview.contentType || 'invalid'}, cache: hit)`);

	if (!preview.contentType) {
		return false;
	}

	if (embedHtml && preview.contentType.startsWith('text/html')) {
		return await app.renderAsync('partials/link-preview/html', preview);
	}

	if (embedImage && preview.contentType.startsWith('image/')) {
		return await app.renderAsync('partials/link-preview/image', preview);
	}

	if (embedAudio && preview.contentType.startsWith('audio/')) {
		return await app.renderAsync('partials/link-preview/audio', preview);
	}

	if (embedVideo && preview.contentType.startsWith('video/')) {
		return await app.renderAsync('partials/link-preview/video', preview);
	}

	return false;
}

async function handleSpecialEmbed(url, $anchor) {
	const { app } = require.main.require('./src/webserver');
	const { hostname, searchParams, pathname } = new URL(url);
	const { embedYoutube, embedVimeo, embedTiktok } = await meta.settings.get('link-preview');

	if (embedYoutube === 'on' && ['youtube.com', 'www.youtube.com', 'youtu.be'].some(x => hostname === x)) {
		let video;
		let short = false;
		if (hostname === 'youtu.be') {
			video = pathname.slice(1);
		} else if (pathname.startsWith('/shorts')) {
			video = pathname.split('/')[2];
			short = true;
		} else if (pathname.startsWith('/live')) {
			video = pathname.split('/')[2];
		} else {
			video = searchParams.get('v');
		}
		const html = await app.renderAsync(short ? 'partials/link-preview/youtube-short' : 'partials/link-preview/youtube', { video });

		if ($anchor) {
			$anchor.replaceWith(html);
			return true;
		}

		return html;
	}

	if (embedVimeo === 'on' && hostname === 'vimeo.com') {
		const video = pathname.slice(1);
		const html = await app.renderAsync('partials/link-preview/vimeo', { video });

		if ($anchor) {
			$anchor.replaceWith(html);
			return true;
		}

		return html;
	}

	if (embedTiktok === 'on' && ['tiktok.com', 'www.tiktok.com'].some(x => hostname === x)) {
		const video = pathname.split('/')[3];
		const html = await app.renderAsync('partials/link-preview/tiktok', { video });

		if ($anchor) {
			$anchor.replaceWith(html);
			return true;
		}

		return html;
	}

	return false;
}

plugin.onParse = async (payload) => {
	if (typeof payload === 'string') { // raw
		const type = 'default';
		payload = await process(payload, { type });
	} else if (payload && payload.type !== 'plaintext' && payload.postData && payload.postData.content) { // post
		const { content, pid, tid, attachments } = payload.postData;
		const { type } = payload;
		payload.postData.content = await process(content, { type, pid, tid, attachments });
	}

	return payload;
};

plugin.onPost = async ({ post }) => {
	if (post.hasOwnProperty('_activitypub')) {
		return; // no attachment parsing for content from activitypub; attachments saved via notes.assert
	}

	// Only match standalone URLs on their own line
	const lines = post.content.split('\n');
	const urls = lines.filter(line => isURL(line));

	let previews = await Promise.all(urls.map(async url => await preview(url)));
	previews = previews.filter(Boolean);
	previews = previews.map(({ url, contentType: mediaType }) => ({
		type: 'inline',
		url,
		mediaType,
	})).filter(Boolean);

	posts.attachments.update(post.pid, previews);
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/link-preview',
		icon: 'fa-tint',
		name: 'Link Preview',
	});

	return header;
};

module.exports = plugin;
