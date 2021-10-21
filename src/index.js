const _ = require('lodash');
const url = require('fast-url-parser');
const { parseDomain, ParseResultType } = require('parse-domain');

module.exports.apm = {
	spanFilter ({ filterShorterThan } = {}) {
		return (payload) => {
			if (filterShorterThan && payload.duration < filterShorterThan) {
				return false;
			}

			return payload;
		};
	},
	transactionFilter ({ filterNotSampled = true, keepRequest = [ 'origin', 'referer', 'user-agent' ], keepResponse = [], keepSocket = [], overrideHostname } = {}) {
		return (payload) => {
			if (filterNotSampled && !payload.sampled) {
				return false;
			}

			if (!payload.context) {
				return payload;
			}

			let { request, response } = payload.context;

			if (request) {
				if (request.headers) {
					if (keepRequest.length) {
						request.headers = _.pick(request.headers, keepRequest);
					} else {
						delete request.headers;
					}
				}

				if (request.socket) {
					if (keepSocket.length) {
						request.socket = _.pick(request.socket, keepSocket);
					} else {
						delete request.socket;
					}
				}

				if (overrideHostname && request.url) {
					request.url.full = request.url.full.replace(request.url.hostname, overrideHostname);
					request.url.hostname = overrideHostname;
				}
			}

			if (response && response.headers) {
				if (keepResponse.length) {
					response.headers = _.pick(response.headers, keepResponse);
				} else {
					delete response.headers;
				}
			}

			return payload;
		};
	},
};

module.exports.express = {
	middleware (apmClient, { setAddress = true, setOrigin = true, requestSource = true } = {}) {
		if (!apmClient) {
			return (req, res, next) => next();
		}

		return (req, res, next) => {
			if (setAddress) {
				apmClient.setLabel('address', req.ip);
			}

			if (setOrigin || requestSource) {
				let origin = req.get('origin') || req.get('referrer');

				if (origin) {
					let parsed = url.parse(origin);

					if (parsed.protocol && parsed.host) {
						apmClient.setLabel('origin', `${parsed.protocol}//${parsed.host}`);

						if (requestSource) {
							let { domain, topLevelDomains, type } = parseDomain(parsed.hostname);

							if (type === ParseResultType.Listed) {
								apmClient.setLabel('requestSource', (domain ? `${domain}.` : '') + topLevelDomains.join('.'));
							}
						}
					}
				} else if (req.get('Sec-Fetch-Mode') !== 'navigate') {
					apmClient.setLabel('requestSource', req.get('User-Agent'));
				}
			}

			return next();
		};
	},
};

module.exports.koa = {
	addRoutes (router, routes, fn) {
		routes.forEach((route) => {
			router.get(route[0], route[1], fn);
		});
	},
	middleware (apmClient, { prefix = '', setAddress = true, setOrigin = true, requestSource = true, setRouteName = true } = {}) {
		if (!apmClient) {
			return async (ctx, next) => next();
		}

		return async (ctx, next) => {
			if (setAddress) {
				apmClient.setLabel('address', ctx.request.ip);
			}

			if (setRouteName) {
				let matched = ctx.matched.find(r => r.name);

				if (matched) {
					apmClient.setTransactionName(`${ctx.request.method} ${prefix}${matched.name}`);
				}
			}

			if (setOrigin || requestSource) {
				let origin = ctx.request.get('origin') || ctx.request.get('referrer');

				if (origin) {
					let parsed = url.parse(origin);

					if (parsed.protocol && parsed.host) {
						apmClient.setLabel('origin', `${parsed.protocol}//${parsed.host}`);

						if (requestSource) {
							let { domain, topLevelDomains, type } = parseDomain(parsed.hostname);

							if (type === ParseResultType.Listed) {
								apmClient.setLabel('requestSource', (domain ? `${domain}.` : '') + topLevelDomains.join('.'));
							}
						}
					}
				} else if (ctx.request.get('Sec-Fetch-Mode') !== 'navigate') {
					apmClient.setLabel('requestSource', ctx.request.get('User-Agent'));
				}
			}

			return next();
		};
	},
};
