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

async function sendEmail(data, env) {
	// Validate email
	if (
		!data.email ||
		typeof data.email !== "string" ||
		!data.email.includes("@")
	) {
		console.error("Invalid email address:", data.email);
		// Don't set Reply-To if invalid, just send the message
	}

	const msg = createMimeMessage();
	msg.setSender({
		name: data.name,
		addr: sender,
	});
	msg.setRecipient(recipient);
	msg.setSubject(`A message from ${data.email}`);

	// Safely attempt to set Reply-To
	if (
		data.email &&
		typeof data.email === "string" &&
		data.email.includes("@")
	) {
		try {
			if (MimeText.Mailbox) {
				msg.setHeader("Reply-To", new MimeText.Mailbox(data.email));
			} else {
				msg.setHeader("Reply-To", { addr: data.email });
			}
		} catch (e) {
			console.warn("Failed to set Reply-To header:", e);
		}
	}

	msg.addMessage({
		contentType: "text/plain",
		data: data.message,
	});

	var message = new EmailMessage(sender, recipient, msg.asRaw());
	await env.EMAIL.send(message);
}
