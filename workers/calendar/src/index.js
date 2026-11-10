export default {
	// `scheduled` returns nothing: the runtime discards a return value, so
	// handing it the hook's response body only looked like it meant something.
	// Throwing is the one signal that reaches the dashboard, so every failure
	// below rethrows.
	async scheduled(controller, env) {
		// The hook URL is a bearer credential: anyone holding it can start
		// unlimited production builds. It lives in a secret on the worker, never
		// in this repository.
		const hookUrl = env.DEPLOY_HOOK_URL;
		if (!hookUrl) {
			throw new Error(
				"DEPLOY_HOOK_URL is not set. Set it with `npx wrangler secret put DEPLOY_HOOK_URL` — see README.md.",
			);
		}

		try {
			const response = await fetch(hookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				// A rotated or revoked hook answers 401/403/404 rather than
				// failing to connect, which would otherwise look like success.
				throw new Error(
					`Deploy hook returned ${response.status} ${response.statusText}`,
				);
			}

			// Never log the URL itself. The body is the deployment record.
			console.log("Deploy triggered:", await response.text());
		} catch (error) {
			console.error("Error triggering deploy:", error);
			throw error;
		}
	},
};
