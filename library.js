'use strict';

const winston = require.main.require('winston');
const dns = require('dns');

const { getLinkPreview } = require('link-preview-js');

const cache = require.main.require('./src/cache');

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

async function process(content) {
	const anchorRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/g;
	const matches = [];
	let match;

	// eslint-disable-next-line no-cond-assign
	while ((match = anchorRegex.exec(content)) !== null) {
		matches.push(match);
	}

	const previews = await Promise.all(matches.map(async (match) => {
		const anchor = match[1];

		const cached = cache.get(`link-preview:${anchor}`);
		if (cached) {
			return await render(cached, true);
		}

		try {
			const preview = await getLinkPreview(anchor, {
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
			});

			const parsedUrl = new URL(anchor);
			preview.hostname = parsedUrl.hostname;

			cache.set(`link-preview:${anchor}`, preview);
			return await render(preview, false);
		} catch (e) {
			cache.set(`link-preview:${anchor}`, {
				url: anchor,
			});
			return false;
		}
	}));

	// Replace match with embed
	previews.forEach((preview, idx) => {
		if (preview) {
			const match = matches[idx];
			const { index } = match;
			const { length } = match[0];

			content = `${content.substring(0, index)}${preview}${content.substring(index + length)}`;
		}
	});

	return content;
}

async function render(preview, cached) {
	const { app } = require.main.require('./src/webserver');

	winston.info(`[link-preview] ${preview.url} (${preview.contentType || 'invalid'}, ${cached ? 'from cache' : 'no cache'})`);
	if (preview.contentType === 'text/html') {
		return await app.renderAsync('partials/link-preview/embed', preview);
	}

	return false;
}

plugin.onParse = async (payload) => {
	if (typeof payload === 'string') { // raw
		payload = await process(payload);
	} else if (payload && payload.postData && payload.postData.content) { // post
		payload.postData.content = await process(payload.postData.content);
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
