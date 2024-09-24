import {
	APIError,
	type Context,
	type Endpoint,
	createRouter,
} from "better-call";
import type { AuthContext } from "../init";
import type { BetterAuthOptions } from "../types";
import type { UnionToIntersection } from "../types/helper";
import { csrfMiddleware } from "./middlewares/csrf";
import {
	callbackOAuth,
	forgetPassword,
	getSession,
	listSessions,
	resetPassword,
	revokeSession,
	revokeSessions,
	sendVerificationEmail,
	signInEmail,
	signInOAuth,
	signOut,
	verifyEmail,
} from "./routes";
import { getCSRFToken } from "./routes/csrf";
import { ok } from "./routes/ok";
import { signUpEmail } from "./routes/sign-up";
import { error } from "./routes/error";
import { logger } from "../utils/logger";
import { changePassword, updateUser } from "./routes/update-user";
import type { BetterAuthPlugin } from "../plugins";
import chalk from "chalk";

export function getEndpoints<
	C extends AuthContext,
	Option extends BetterAuthOptions,
>(ctx: C, options: Option) {
	const pluginEndpoints = ctx.options.plugins?.reduce(
		(acc, plugin) => {
			return {
				...acc,
				...plugin.endpoints,
			};
		},
		{} as Record<string, any>,
	);

	type PluginEndpoint = UnionToIntersection<
		Option["plugins"] extends Array<infer T>
			? T extends BetterAuthPlugin
				? T["endpoints"]
				: {}
			: {}
	>;

	const middlewares =
		ctx.options.plugins
			?.map((plugin) =>
				plugin.middlewares?.map((m) => {
					const middleware = (async (context: any) => {
						return m.middleware({
							...context,
							context: {
								...ctx,
								...context.context,
							},
						});
					}) as Endpoint;
					middleware.path = m.path;
					middleware.options = m.middleware.options;
					middleware.headers = m.middleware.headers;
					return {
						path: m.path,
						middleware,
					};
				}),
			)
			.filter((plugin) => plugin !== undefined)
			.flat() || [];

	const baseEndpoints = {
		signInOAuth,
		callbackOAuth,
		getCSRFToken,
		getSession: getSession<Option>(),
		signOut,
		signUpEmail,
		signInEmail,
		forgetPassword,
		resetPassword,
		verifyEmail,
		sendVerificationEmail,
		changePassword,
		updateUser,
		listSessions: listSessions<Option>(),
		revokeSession,
		revokeSessions,
	};
	const endpoints = {
		...baseEndpoints,
		...pluginEndpoints,
		ok,
		error,
	};
	let api: Record<string, any> = {};
	for (const [key, value] of Object.entries(endpoints)) {
		api[key] = async (context: any) => {
			// for (const plugin of ctx.options.plugins || []) {
			// 	if (plugin.hooks?.before) {
			// 		for (const hook of plugin.hooks.before) {
			// 			const match = hook.matcher({
			// 				...context,
			// 				...value,
			// 			});
			// 			if (match) {
			// 				const hookRes = await hook.handler(context);
			// 				if (hookRes && "context" in hookRes) {
			// 					context = {
			// 						...context,
			// 						...hookRes.context,
			// 						...value,
			// 					};
			// 				}
			// 			}
			// 		}
			// 	}
			// }
			if (context.path === "/user/update") {
				const res = await api[key].options.use[1](context);
				console.log(res);
			}
			/**
			 * TODO: move this to respond a json response
			 * instead of response object.
			 */
			//@ts-ignore
			const endpointRes = await value({
				...context,
				context: {
					...ctx,
					...context.context,
				},
			});
			let response = endpointRes;
			for (const plugin of ctx.options.plugins || []) {
				if (plugin.hooks?.after) {
					for (const hook of plugin.hooks.after) {
						const match = hook.matcher(context);
						if (match) {
							const obj = Object.assign(context, {
								context: {
									...ctx,
									returned: response,
								},
							});
							const hookRes = await hook.handler(obj);
							if (hookRes && "response" in hookRes) {
								response = hookRes.response as any;
							}
						}
					}
				}
			}
			return response;
		};
		api[key].path = value.path;
		api[key].method = value.method;
		api[key].options = value.options;
		api[key].headers = value.headers;
	}
	return {
		api: api as typeof endpoints & PluginEndpoint,
		middlewares,
	};
}

export const router = <C extends AuthContext, Option extends BetterAuthOptions>(
	ctx: C,
	options: Option,
) => {
	const { api, middlewares } = getEndpoints(ctx, options);
	const basePath = new URL(ctx.baseURL).pathname;

	return createRouter(api, {
		extraContext: ctx,
		basePath,
		routerMiddleware: [
			{
				path: "/**",
				middleware: csrfMiddleware,
			},
			...middlewares,
		],
		onError(e) {
			if (options.disableLog !== true) {
				if (e instanceof APIError) {
					logger.warn(e);
				} else {
					if (typeof e === "object" && e !== null && "message" in e) {
						const errorMessage = e.message as string;
						if (!errorMessage || typeof errorMessage !== "string") {
							logger.error(e);
							return;
						}
						if (errorMessage.includes("no such table")) {
							logger.error(
								`Please run ${chalk.green(
									"npx better-auth migrate",
								)} to create the tables. There are missing tables in your SQLite database.`,
							);
						} else if (
							errorMessage.includes("relation") &&
							errorMessage.includes("does not exist")
						) {
							logger.error(
								`Please run ${chalk.green(
									"npx better-auth migrate",
								)} to create the tables. There are missing tables in your PostgreSQL database.`,
							);
						} else if (
							errorMessage.includes("Table") &&
							errorMessage.includes("doesn't exist")
						) {
							logger.error(
								`Please run ${chalk.green(
									"npx better-auth migrate",
								)} to create the tables. There are missing tables in your MySQL database.`,
							);
						} else {
							logger.error(e);
						}
					} else {
						logger.error(e);
					}
				}
			}
		},
	});
};

export * from "./routes";
export * from "./middlewares";
export * from "./call";
