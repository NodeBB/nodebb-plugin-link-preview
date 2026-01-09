/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */

'use strict';

const nconf = require.main.require('nconf');
const dns = require('dns');

const { getLinkPreview } = require('link-preview-js');
const { isURL } = require('validator');

const meta = require.main.require('./src/meta');
const cacheCreate = require.main.require('./src/cacheCreate');
const cache = cacheCreate({
	name: 'link-preview',
	max: 10000,
	ttl: 0,
});
const posts = require.main.require('./src/posts');
const postsCache = require.main.require('./src/posts/cache');
const websockets = require.main.require('./src/socket.io');

const controllers = require('./lib/controllers');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = module.exports;

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
	let hits = [];

	// Parse inline urls
	const anchorRegex = /<a [^>]+>.*?<\/a>/gi;
	let match = anchorRegex.exec(content);
	while (match !== null) {
		const { index } = match;
		const { length } = match[0];
		const before = content.slice(Math.max(0, index - 20), index);
		const after = content.slice(index + length, index + length + 20);
		const wrapped = before.trim().endsWith('<p dir="auto">') || before.trim().endsWith('<p>');
		const closed = after.trim().startsWith('</p>');

		if (!wrapped || !closed) {
			match = anchorRegex.exec(content);
			continue;
		}

		const urlMatch = match[0].match(/href=["'](.*?)["']/);
		let url = urlMatch ? decodeURI(urlMatch[1]) : '';
		const text = match[0].replace(/<[^>]+>/g, ''); // Strip tags to get text
		if (url !== text) {
			match = anchorRegex.exec(content);
			continue;
		}

		// Otherwise, process the anchor...

		if (url.startsWith('//')) { // Handle protocol-relative URLs
			url = `${nconf.get('url_parsed').protocol}${url}`;
		} else if (!url.startsWith('http')) { // Handle relative URLs
			url = `${nconf.get('url')}${url.startsWith('/') ? url : `/${url}`}`;
		}

		if (processInline) {
			const html = await handleSpecialEmbed(url);
			if (html) {
				requests.delete(url);
				hits.push({ index, length, html });
				match = anchorRegex.exec(content);
				continue;
			}
		}

		// Inline url takes precedence over attachment
		requests.set(url, {
			type: 'inline',
			index,
			length,
		});

		match = anchorRegex.exec(content);
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

			// ActivityPub attachments
			if (attachment.hasOwnProperty('mediaType') && attachment.mediaType) {
				switch (true) {
					case attachment.mediaType.startsWith('video/'): {
						cache.set(`link-preview:${url}`, {
							...attachment,
							contentType: attachment.mediaType,
							mediaType: 'video',
						});
						break;
					}

					case attachment.mediaType.startsWith('image/'): {
						cache.set(`link-preview:${url}`, {
							...attachment,
							contentType: attachment.mediaType,
							mediaType: 'image',
						});
						break;
					}
				}
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
							const { index, length } = options;
							hits.push({ index, length, html });
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
		const failures = new Set();
		let successes = [];
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
								const { index, length } = options;
								successes.push({ index, length, html });
							}
							break;
						}

						case 'attachment': {
							attachmentHtml += html;
							break;
						}
					}
				} else if (options.type === 'attachment') {
					// Preview failed, put back in placeholders
					failures.add(url);
				}
			}));

			const placeholderHtml = Array.from(failures).reduce((html, cur) => {
				html += `<p><a href="${cur}" rel="nofollow ugc">${cur}</a></p>`;
				return html;
			}, '');
			let modified = content;

			successes = successes.sort((a, b) => b.index - a.index);
			successes.forEach(({ html, index, length }) => {
				modified =
					modified.slice(0, index) +
					html +
					modified.slice(index + length);
			});
			modified += attachmentHtml ? `\n\n<div class="row mt-3">${attachmentHtml}</div>` : '';
			modified += placeholderHtml ? `\n\n<div class="row mt-3"><div class="col-12 mt-3">${placeholderHtml}</div></div>` : '';

			// bust posts cache item
			if (pid) {
				const cache = postsCache.getOrCreate();
				const cacheKey = `${String(pid)}|${type}`;
				cache.set(cacheKey, modified);

				// fire post edit event with mocked data
				if (type === 'default' && tid) {
					websockets.in(`topic_${tid}`).emit('event:post_edited', {
						post: {
							tid,
							pid,
							changed: true,
							content: modified,
						},
						topic: {},
					});
				}
			}
		});
	}

	let modified = content;

	hits = hits.sort((a, b) => b.index - a.index);
	hits.forEach(({ html, index, length }) => {
		modified =
			modified.slice(0, index) +
			html +
			modified.slice(index + length);
	});
	modified += attachmentHtml ? `\n\n<div class="row mt-3"><div class="col-12 mt-3">${attachmentHtml}</div></div>` : '';
	modified += placeholderHtml ? `\n\n<div class="row mt-3"><div class="col-12 mt-3">${placeholderHtml}</div></div>` : '';
	return modified;
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

async function handleSpecialEmbed(url) {
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
		return html;
	}

	if (embedVimeo === 'on' && hostname === 'vimeo.com') {
		const video = pathname.slice(1);
		const html = await app.renderAsync('partials/link-preview/vimeo', { video });

		return html;
	}

	if (embedTiktok === 'on' && ['tiktok.com', 'www.tiktok.com'].some(x => hostname === x)) {
		const video = pathname.split('/')[3];
		const html = await app.renderAsync('partials/link-preview/tiktok', { video });

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

plugin.filterAdminCacheGet = function (caches) {
	caches['link-preview'] = cache;
	return caches;
};

