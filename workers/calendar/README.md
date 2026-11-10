# calendar worker

Rebuilds the site once a day so live Google data reaches the published pages.

## What it does

One cron trigger, `0 0 * * *` (daily, midnight UTC), whose entire job is to POST
a Cloudflare Pages **deploy hook**. That starts a normal Pages build of `main`.

There is no `fetch` handler. The worker is not reachable over HTTP.

The hook URL is read from the **`DEPLOY_HOOK_URL` secret**, never from this
repository. A missing secret, or a hook that answers anything other than 2xx
(which is what a rotated or revoked hook does), throws — the only signal a cron
has, and the reason the handler rethrows rather than swallowing. The URL itself
is never logged.

## Why it exists

Two pages are built from live remote data _at build time_:

- the events page reads Annie's Google Calendar,
- the reviews gallery reads a Google Drive folder.

Nothing about adding a calendar event or dropping a photo into Drive touches this
repository, so no push happens and Pages has no reason to rebuild. Without a
periodic nudge, Annie's changes would never appear — and the events page would go
stale in a second way, because `src/_data/calendar.js` splits future from past
against `new Date()` at build time. An event that has been and gone stays listed
as upcoming until something rebuilds the site.

This worker is that nudge. A daily cadence means a change is live within 24
hours; when that is too slow, retry the deployment from the Cloudflare dashboard
(the path Annie is given in
[`docs/managing-gallery-photos.md`](../../docs/managing-gallery-photos.md)).

> Historically this worker was built to _receive_ a Google Calendar
> `events.watch` webhook and rebuild on demand. That channel expired and was not
> renewed — Calendar push channels are short-lived and need re-registering — so
> it was reduced to a cron. Nothing in the codebase still registers a webhook.

## Deploying

```bash
cd workers/calendar
npm install
npx wrangler secret put DEPLOY_HOOK_URL   # first deploy, and after any rotation
npx wrangler deploy
```

**Nothing takes effect until this worker is deployed.** It deploys separately
from the site, and merging a change to the repository does not deploy it.

### The deploy hook is a credential — two things only you can do

A Pages deploy hook carries no auth beyond being unguessable: **anyone who has
the URL can start unlimited production builds.** This URL, UUID and all, was
hard-coded in `src/index.js` in a **public repository**, so it must be treated
as leaked. Removing it from the file does not remove it from the repository's
git history, which is why rotation is the only real fix.

1. **Rotate the hook.** Cloudflare dashboard → the Pages project → _Settings_ →
   _Builds & deployments_ → _Deploy hooks_: delete the existing hook and create
   a new one. Copy the new URL.
2. **Set it as a secret on this worker**, then redeploy:

   ```bash
   cd workers/calendar
   npx wrangler secret put DEPLOY_HOOK_URL   # paste the new URL
   npx wrangler deploy
   ```

Until both are done the daily rebuild does not run: with no secret bound the
cron throws immediately, loudly, in the worker's logs. Nothing else on the site
breaks — it just stops picking up Annie's changes, as described below.

The secret is set with `wrangler secret put`, not in `wrangler.jsonc`; there is
nothing to add to the configuration file, and the URL must not be committed.

## If it stops

Nothing breaks and nothing looks wrong — the site simply stops picking up
Annie's calendar and Drive changes, and past events keep showing as upcoming.
The only signal is the site quietly going stale, so check here first when Annie
reports that an update "hasn't appeared". Cron invocations are visible in the
Cloudflare dashboard (`observability` is enabled).

## Known cruft

- `@octokit/core` is a declared dependency and is not used.
- This worker has **no tests**. It had only the generated Hello World scaffold,
  which called a `worker.fetch()` that does not exist here; it has been deleted
  rather than left to look like coverage. There is no `npm test`.
