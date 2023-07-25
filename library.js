/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */

'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');
const dns = require('dns');

const { getLinkPreview } = require('link-preview-js');
const { load } = require('cheerio');

const meta = require.main.require('./src/meta');
const cache = require.main.require('./src/cache');
const posts = require.main.require('./src/posts');
const topics = require.main.require('./src/topics');
const websockets = require.main.require('./src/socket.io');
const postsCache = require.main.require('./src/posts/cache');

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

async function process(content, opts) {
	const { embedHtml, embedImage, embedAudio, embedVideo } = await meta.settings.get('link-preview');
	if (![embedHtml, embedImage, embedAudio, embedVideo].some(prop => prop === 'on')) {
		return content;
	}

	const $ = load(content, null, false);
	for (const anchor of $('a')) {
		const $anchor = $(anchor);

		// Skip if the anchor has link text, or has text on the same line.
		let url = $anchor.attr('href');
		const text = $anchor.text();
		const hasSiblings = !!anchor.prev || !!anchor.next;
		if (hasSiblings || url !== text) {
			continue;
		}

		// Handle relative URLs
		if (!url.startsWith('http')) {
			url = `${nconf.get('url')}${url.startsWith('/') ? url : `/${url}`}`;
		}

		const special = await handleSpecialEmbed(url, $anchor);
		if (special) {
			continue;
		}

		const cached = cache.get(`link-preview:${url}`);
		if (cached) {
			const html = await render(cached);
			if (html) {
				$anchor.replaceWith($(html));
			}
			continue;
		}

		// Generate the preview, but return false for now so as to not block response
		getLinkPreview(url, {
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
		}).then(async (preview) => {
			const parsedUrl = new URL(url);
			preview.hostname = parsedUrl.hostname;

			winston.verbose(`[link-preview] ${preview.url} (${preview.contentType}, cache: miss)`);
			cache.set(`link-preview:${url}`, preview);

			const html = await render(preview);
			if (!html) {
				return;
			}

			// bust posts cache item
			if (opts.hasOwnProperty('pid') && await posts.exists(opts.pid)) {
				postsCache.del(String(opts.pid));

				// fire post edit event with mocked data
				if (opts.hasOwnProperty('tid') && await topics.exists(opts.tid)) {
					$anchor.replaceWith($(html));
					websockets.in(`topic_${opts.tid}`).emit('event:post_edited', {
						post: {
							tid: opts.tid,
							pid: opts.pid,
							changed: true,
							content: $.html(),
						},
						topic: {},
					});
				}
			}
		}).catch(() => {
			winston.verbose(`[link-preview] ${url} (invalid, cache: miss)`);
			cache.set(`link-preview:${url}`, { url });
		});
	}

	return $.html();
}

async function render(preview) {
	const { app } = require.main.require('./src/webserver');
	const { embedHtml, embedImage, embedAudio, embedVideo } = await meta.settings.get('link-preview');

	winston.verbose(`[link-preview] ${preview.url} (${preview.contentType || 'invalid'}, cache: hit)`);

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
	const { embedYoutube, embedVimeo } = await meta.settings.get('link-preview');

	if (embedYoutube === 'on' && ['youtube.com', 'www.youtube.com', 'youtu.be'].some(x => hostname === x)) {
		let video;
		if (hostname === 'youtu.be') {
			video = pathname.slice(1);
		} else {
			video = searchParams.get('v');
		}
		const html = await app.renderAsync('partials/link-preview/youtube', { video });
		$anchor.replaceWith(html);

		return true;
	}

	if (embedVimeo === 'on' && hostname === 'vimeo.com') {
		const video = pathname.slice(1);
		const html = await app.renderAsync('partials/link-preview/vimeo', { video });
		$anchor.replaceWith(html);

		return true;
	}

	return false;
}

plugin.onParse = async (payload) => {
	if (typeof payload === 'string') { // raw
		payload = await process(payload, {});
	} else if (payload && payload.postData && payload.postData.content) { // post
		payload.postData.content = await process(payload.postData.content, {
			pid: payload.postData.pid,
			tid: payload.postData.tid,
		});
	}

	return payload;
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
