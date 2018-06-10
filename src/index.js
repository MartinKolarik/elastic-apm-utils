const url = require('fast-url-parser');

module.exports.express = {
	middleware (apmClient, { setAddress = true, setOrigin = true } = {}) {
		if (!apmClient) {
			return (req, res, next) => next();
		}

		return (req, res, next) => {
			if (setAddress) {
				apmClient.setTag('address', req.ip);
			}

			if (setOrigin) {
				let origin = req.get('origin') || req.get('referrer');

				if (origin) {
					let parsed = url.parse(origin);
					apmClient.setTag('origin', `${parsed.protocol}//${parsed.host}`);
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
	middleware (apmClient, { prefix = '', setAddress = true, setOrigin = true, setRouteName = true } = {}) {
		if (!apmClient) {
			return async (ctx, next) => next();
		}

		return async (ctx, next) => {
			if (setAddress) {
				apmClient.setTag('address', ctx.request.ip);
			}

			if (setRouteName) {
				let matched = ctx.matched.find(r => r.name);

				if (matched) {
					apmClient.setTransactionName(`${ctx.request.method} ${prefix}${matched.name}`);
				}
			}

			if (setOrigin) {
				let origin = ctx.request.get('origin') || ctx.request.get('referrer');

				if (origin) {
					let parsed = url.parse(origin);
					apmClient.setTag('origin', `${parsed.protocol}//${parsed.host}`);
				}
			}

			return next();
		};
	},
};
