import _ from 'lodash';
// @ts-expect-error no types here
import url from 'fast-url-parser';
import { Handler } from 'express';
import KoaRouter from '@koa/router';
import { parseDomain, ParseResultType } from 'parse-domain';
import { Agent, FilterFn } from 'elastic-apm-node';
import { Middleware } from 'koa';

export const apm = {
	spanFilter ({ filterShorterThan = 0 } = {}): FilterFn {
		return (payload) => {
			if (filterShorterThan && payload['duration'] < filterShorterThan) {
				return false;
			}

			return payload;
		};
	},
	transactionFilter ({ filterNotSampled = true, keepRequest = [ 'origin', 'referer', 'user-agent' ], keepResponse = [], keepSocket = [], overrideHostname = '' } = {}): FilterFn {
		return (payload) => {
			if (filterNotSampled && !payload['sampled']) {
				return false;
			}

			if (!payload['context']) {
				return payload;
			}

			const { request, response } = payload['context'];

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

export const express = {
	middleware (apmClient: Agent, { setAddress = true, setOrigin = true, requestSource = true } = {}): Handler {
		if (!apmClient) {
			return (_req, _res, next) => next();
		}

		return (req, _res, next) => {
			if (setAddress) {
				apmClient.setLabel('address', req.ip);
			}

			if (setOrigin || requestSource) {
				const origin = req.get('origin') || req.get('referrer');

				if (origin) {
					const parsed = url.parse(origin);

					if (parsed.protocol && parsed.host) {
						apmClient.setLabel('origin', `${parsed.protocol}//${parsed.host}`);

						if (requestSource) {
							const result = parseDomain(parsed.hostname);

							if (result.type === ParseResultType.Listed) {
								apmClient.setLabel('requestSource', (result.domain ? `${result.domain}.` : '') + result.topLevelDomains.join('.'));
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

export const koa = {
	addRoutes (router: KoaRouter, routes: [ string, string? ][], ...fn: KoaRouter.Middleware[]) {
		routes.forEach((route) => {
			router.get(route[0], route[1] || route[0], ...fn);
		});
	},
	middleware (apmClient: Agent, { prefix = '', setAddress = true, setOrigin = true, requestSource = true, setRouteName = true, usePathBasedRoutes = true } = {}): Middleware {
		if (!apmClient) {
			return async (_ctx, next) => next();
		}

		return async (ctx, next) => {
			if (setAddress) {
				apmClient.setLabel('address', ctx.request.ip);
			}

			if (setRouteName) {
				const matched = ctx['matched']?.find((r: { name: string }) => r.name);

				if (matched) {
					apmClient.setTransactionName(`${ctx.request.method} ${prefix}${matched.name}`);
				} else if (usePathBasedRoutes) {
					const name = ctx.url.split('/').slice(0, 2).join('/');
					apmClient.setTransactionName(`${ctx.request.method} ${prefix}${name}`);
				}
			}

			if (setOrigin || requestSource) {
				const origin = ctx.request.get('origin') || ctx.request.get('referrer');

				if (origin) {
					const parsed = url.parse(origin);

					if (parsed.protocol && parsed.host) {
						apmClient.setLabel('origin', `${parsed.protocol}//${parsed.host}`);

						if (requestSource) {
							const result = parseDomain(parsed.hostname);

							if (result.type === ParseResultType.Listed) {
								apmClient.setLabel('requestSource', (result.domain ? `${result.domain}.` : '') + result.topLevelDomains.join('.'));
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
