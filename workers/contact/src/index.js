import { EmailMessage } from "cloudflare:email";
import * as MimeText from "mimetext";
const { createMimeMessage } = MimeText;

const recipient = "author.annie.elliot@gmail.com";
const sender = "info@annieelliot.co.uk";

// One fact, three uses: the origin the form is allowed to post from, the origin
// named in the CORS headers, and the base the redirect targets are resolved
// against. Eleventy emits the two landing pages with trailing slashes; without
// them every submission pays an extra redirect hop.
const siteOrigin = "https://annieelliot.co.uk";
const successUrl = new URL("/email-success/", siteOrigin).href;
const failureUrl = new URL("/email-failure/", siteOrigin).href;

// A per-IP speed bump, not authentication — see README.
const rateLimit = { requests: 5, windowSeconds: 60 };

export default {
	async fetch(request, env) {
		// The origin check comes first, so a disallowed origin cannot even
		// collect a preflight answer. A cross-origin POST and its preflight both
		// carry Origin, so nothing legitimate is lost by checking this early.
		if (!isAllowedOrigin(request)) {
			return new Response("Unauthorized", { status: 403 });
		}

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders() });
		}

		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders(),
			});
		}

		const limit = await checkRateLimit(request, env);
		if (!limit.allowed) {
			return new Response(
				"Too many messages from this address. Please wait a minute and try again.",
				{
					status: 429,
					headers: {
						...corsHeaders(),
						"Retry-After": String(limit.retryAfterSeconds),
					},
				},
			);
		}

		try {
			const formData = await request.formData();
			const data = Object.fromEntries(formData);
			await sendEmail(data, env);
			return Response.redirect(successUrl, 303);
		} catch (e) {
			console.error("Email error:", e);
			return Response.redirect(failureUrl, 303);
		}
	},
};

/**
 * True only when the request carries an `Origin` that parses to exactly the
 * site's origin.
 *
 * `Referer` is deliberately not accepted. The form posts cross-origin
 * (annieelliot.co.uk -> contact.annieelliot.co.uk), so browsers always send
 * `Origin`; `Referer` adds no reachable legitimate request and can be
 * suppressed or forged more freely.
 *
 * Comparing parsed origins rather than string prefixes is what rejects
 * `https://annieelliot.co.uk.example.com`, `https://evil.annieelliot.co.uk`,
 * `http://annieelliot.co.uk` and `https://annieelliot.co.uk:8443`.
 */
function isAllowedOrigin(request) {
	const header = request.headers.get("Origin");
	if (!header) return false;

	let origin;
	try {
		// Throws on a malformed value, and on the opaque `Origin: null` that
		// sandboxed and privacy-stripped contexts send. Both are invalid.
		origin = new URL(header).origin;
	} catch {
		return false;
	}

	return origin === siteOrigin;
}

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": siteOrigin,
		"Access-Control-Allow-Methods": "POST",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

/**
 * Per-IP rate limit, newest signal first:
 *
 * 1. `env.RATE_LIMITER`, Cloudflare's built-in Rate Limiting binding, when it
 *    is declared in `wrangler.jsonc`. Counted per colo, across isolates.
 * 2. An in-isolate window, which always applies. It needs no binding at all,
 *    but each isolate keeps its own budget, so it is the weaker of the two.
 *
 * Both must pass. A limiter that errors is logged and treated as a pass — the
 * in-isolate window still holds the floor, and a limiter outage should not take
 * the contact form down with it.
 */
async function checkRateLimit(request, env) {
	const key = request.headers.get("CF-Connecting-IP") || "unknown";

	const local = localRateLimit(key);
	if (!local.allowed) return local;

	if (env.RATE_LIMITER) {
		try {
			const { success } = await env.RATE_LIMITER.limit({ key });
			if (!success) {
				return { allowed: false, retryAfterSeconds: rateLimit.windowSeconds };
			}
		} catch (e) {
			console.error("Rate limiter unavailable:", e);
		}
	}

	return { allowed: true, retryAfterSeconds: 0 };
}

// Request timestamps per client, oldest key first. Lives for the life of the
// isolate; capped so a flood of distinct addresses cannot grow it without end.
const recentRequests = new Map();
const maxTrackedClients = 1000;

function localRateLimit(key) {
	const now = Date.now();
	const windowMs = rateLimit.windowSeconds * 1000;
	const cutoff = now - windowMs;

	pruneTrackedClients(cutoff);

	const seen = (recentRequests.get(key) || []).filter((time) => time > cutoff);

	if (seen.length >= rateLimit.requests) {
		const retryAfterMs = seen[0] + windowMs - now;
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
		};
	}

	seen.push(now);
	// Delete before setting so the Map's insertion order stays least-recently
	// seen first, which is what makes the eviction below sensible.
	recentRequests.delete(key);
	recentRequests.set(key, seen);

	return { allowed: true, retryAfterSeconds: 0 };
}

function pruneTrackedClients(cutoff) {
	for (const [key, times] of recentRequests) {
		if (times[times.length - 1] <= cutoff) recentRequests.delete(key);
	}

	// Still over the cap: drop the least recently seen until it fits.
	while (recentRequests.size >= maxTrackedClients) {
		const oldest = recentRequests.keys().next();
		if (oldest.done) break;
		recentRequests.delete(oldest.value);
	}
}

/**
 * Flattens a form field to something that cannot break out of a MIME header.
 * `name` and the sender's address are visitor-supplied and land in `From`,
 * `Subject` and `Reply-To`; a bare CR or LF in any of them would otherwise let
 * a caller append headers of its own.
 */
const headerFieldMaxLength = 200;

function headerSafe(value) {
	return String(value ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.trim()
		.slice(0, headerFieldMaxLength);
}

// Deliberately permissive — it only has to admit real addresses while refusing
// the whitespace, commas, angle brackets and quotes that carry an injection.
const emailShape = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

async function sendEmail(data, env) {
	const name = headerSafe(data.name);
	const replyTo = headerSafe(data.email);
	const usableReplyTo = emailShape.test(replyTo) ? replyTo : null;

	if (!usableReplyTo) {
		// Send anyway, but without a Reply-To — the message body still carries
		// whatever the visitor typed.
		console.error("Unusable reply address, sending without Reply-To");
	}

	const msg = createMimeMessage();
	msg.setSender({
		name: name || "Website visitor",
		addr: sender,
	});
	msg.setRecipient(recipient);
	msg.setSubject(`A message from ${usableReplyTo || name || "the website"}`);

	if (usableReplyTo) {
		try {
			if (MimeText.Mailbox) {
				msg.setHeader("Reply-To", new MimeText.Mailbox(usableReplyTo));
			} else {
				msg.setHeader("Reply-To", { addr: usableReplyTo });
			}
		} catch (e) {
			console.warn("Failed to set Reply-To header:", e);
		}
	}

	msg.addMessage({
		contentType: "text/plain",
		data: String(data.message ?? ""),
	});

	const message = new EmailMessage(sender, recipient, msg.asRaw());
	await env.EMAIL.send(message);
}
