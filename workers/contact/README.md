# contact worker

Receives the site's contact form and emails it to Annie.

Deployed to **`contact.annieelliot.co.uk`** as a Cloudflare Worker, independently
of the main site.

## What it does

The form in `src/contact.webc` posts directly to this worker:

```
<form action="https://contact.annieelliot.co.uk" method="post">
```

On a valid POST it builds a MIME message with `mimetext`, sends it through the
Cloudflare Email binding, and answers with a **303 redirect** back to
`/email-success/` or `/email-failure/` on the main site. Those two URLs are
derived from the one origin constant in `src/index.js`, so the host is stated
once; the trailing slashes match what Eleventy emits, and leaving them off costs
every submission an extra redirect hop.

|            |                                              |
| ---------- | -------------------------------------------- |
| From       | `info@annieelliot.co.uk`                     |
| To         | `author.annie.elliot@gmail.com`              |
| Subject    | `A message from <the sender's address>`      |
| `Reply-To` | the sender's address, when it looks like one |

### What it rejects

| Response                     | When                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **403** `Unauthorized`       | `Origin` is missing, unparseable, or is not exactly `https://annieelliot.co.uk`  |
| **405** `Method Not Allowed` | the origin is good but the method is neither `POST` nor `OPTIONS`                |
| **429** `Too many messages…` | the rate limit below has been reached; carries a `Retry-After` header in seconds |

The origin check is the first thing the worker does, so a disallowed origin
cannot even collect a CORS preflight answer.

#### The origin check

It compares **parsed origins for equality** — `new URL(header).origin` against
the site's origin — not string prefixes. A prefix test is not an origin test:
`https://annieelliot.co.uk.example.com` starts with the allowed origin and would
have passed one. Equality on the parsed origin rejects that, and also
`https://evil.annieelliot.co.uk`, `http://annieelliot.co.uk` (wrong scheme) and
`https://annieelliot.co.uk:8443` (wrong port). An unparseable value — including
the opaque `Origin: null` that sandboxed contexts send — is treated as invalid
rather than thrown out of the handler.

`Referer` is **no longer accepted** as a substitute. The form posts cross-origin
(`annieelliot.co.uk` → `contact.annieelliot.co.uk`), and browsers always send
`Origin` on a cross-origin POST, so requiring `Origin` loses no legitimate
request. `Referer` is a full URL rather than an origin, can be stripped by a
referrer policy, and is the weaker signal of the two; accepting it only widened
what the check had to trust.

Be clear-eyed about what this buys: the CORS headers protect nothing here,
because a browser does not apply CORS to a form **navigation**. The `Origin`
header is the whole guard, and it is a guard against other people's pages
posting here — not against a direct `curl` that sets the header itself.

## Rate limiting

A **per-IP limit of 5 requests per 60 seconds**, keyed on `CF-Connecting-IP`. A
request over the limit gets **429** with `Retry-After`, and no mail is sent.

It is enforced in two places, and both must pass:

1. **`env.RATE_LIMITER`** — Cloudflare's built-in [Rate Limiting
   binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
   Counted across isolates within a colo. Used only when the binding is
   declared; see below.
2. **An in-isolate sliding window** in `src/index.js`, which always applies and
   needs no binding at all. Each isolate keeps its own budget, so it is the
   weaker half — but it means a deploy with no configuration still has a limit.

A limiter that errors is logged and treated as a pass; the in-isolate window
holds the floor, and a Rate Limiting outage should not take the contact form
down with it.

**What it actually enforces: very little.** A per-IP limit at the edge is a
speed bump, not authentication. It does not stop a determined sender — IPs are
cheap, the built-in limiter is per-colo rather than global and is explicitly
best-effort, and the in-isolate half resets whenever an isolate does. It stops
an accidental double-submit and a naive script hammering one address. It is not
a captcha and there is no captcha here.

### Turning on the Rate Limiting binding (user action)

The binding needs no external store and nothing created in the dashboard, but it
does have to be declared in `wrangler.jsonc`, which the worker code cannot do
for itself. Add:

```jsonc
"ratelimits": [
  {
    "name": "RATE_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 5, "period": 60 }
  }
]
```

`namespace_id` is any number you choose, local to this account; `period` must be
`10` or `60`. Then redeploy. Until that is added the in-isolate window is the
only limit in force.

## Why it works this way

The site ships no JavaScript, so there is no `fetch()` to post the form and
handle a JSON response. It is a plain HTML form submit, which navigates. That is
why the worker answers with a 303 to a real page rather than a status code —
`/email-success/` and `/email-failure/` are ordinary Eleventy pages that exist to
be redirect targets.

The `Reply-To` header is what makes replying work: the mail is _sent_ by
`info@annieelliot.co.uk` because Cloudflare Email Routing will only send as a
verified address, so the visitor's address has to travel in `Reply-To` instead of
`From`.

### Facts still stated on both sides of the divide

The site and the worker deploy separately, so a handful of facts are written
down twice and nothing errors when they disagree:

- **this worker's URL** — `src/contact.webc` (the form's `action`) and
  `wrangler.jsonc` (`routes[0].pattern`),
- **the site's origin** — `wrangler.jsonc`'s route host shares the registrable
  domain with the `siteOrigin` constant in `src/index.js`,
- **the two redirect paths** — the Eleventy pages that emit `/email-success/`
  and `/email-failure/`, and the constants here.

Within the worker that duplication is gone: the origin is written once and the
redirect URLs are derived from it. The site half cannot be fixed from here.

## Deploying

```bash
cd workers/contact
npm install
npx wrangler deploy
```

There are no secrets. The `send_email` binding named `EMAIL` is declared in
`wrangler.jsonc`, and both the sender and recipient addresses must be verified in
**Cloudflare → Email Routing**. The optional `RATE_LIMITER` binding is described
above.

**Nothing takes effect until this worker is deployed.** It deploys separately
from the site, and merging a change to the repository does not deploy it.

## If it stops

The contact page still renders and the form still submits — visitors get a
worker error page instead of `/email-success/`, and **the message is lost
silently**. Nothing on the main site monitors this, and no copy of the message is
stored anywhere. Worker logs are in the Cloudflare dashboard (`observability` is
enabled).

## Tests

This worker has **no tests** and there is no `npm test`. It carried only the
generated Hello World scaffold, which asserted a `"Hello World!"` response body
this worker never returns; that has been deleted rather than left to look like
coverage.

Worth covering if you add them: the origin check (especially
`https://annieelliot.co.uk.example.com`, which a prefix test lets through), the
method check, the rate limit's 429, and that a failed send still redirects to
`/email-failure/` rather than surfacing an error.
