# annieelliot.co.uk

The website for _Mr & Mrs Charles Dickens: Her Story_, a novel by Annie Elliot.

An [Eleventy](https://www.11ty.dev/) static site templated entirely in
[WebC](https://www.11ty.dev/docs/languages/webc/), deployed to Cloudflare Pages.
Every page ships a **0-byte JavaScript bundle** — the gallery lightbox, the
navigation and the layout are all CSS. Two pages are built from live Google data
at build time: the events page reads a Google Calendar, and the reviews gallery
reads a Google Drive folder.

## Quick start

The development environment is provided by [Nix](https://nixos.org/).

```bash
direnv allow      # or: nix develop
pnpm install
npm run dev       # http://localhost:8080
```

**Install with `pnpm`, not `npm`.** `pnpm-lock.yaml` is the lockfile, and it is
what pins the versions Cloudflare builds with. Running `npm install` writes a
competing `package-lock.json`; Cloudflare picks its package manager from
whichever lockfile it finds, so an accidental one silently changes what
production installs. The `npm run …` scripts are fine — it is only the install
that must be pnpm.

You need a `.env` in the repo root containing two secrets:

```
GOOGLE_KEY=...              # one key serves both Drive and Calendar
GITHUB_PACKAGES_TOKEN=...   # read:packages, to install @palebluebytes/cms
```

They fail at different moments, which is worth knowing when one bites.
**`GITHUB_PACKAGES_TOKEN` is needed before `pnpm install` will even run** — see
[Installing it needs a token](#installing-it-needs-a-token) — and it must reach
the _shell_, which is why `.envrc` exports `.env` through direnv.

**A build without `GOOGLE_KEY` fails immediately** — `calendar.js` and
`gallery.js` both throw rather than render an empty page. The test suite is the
exception: it uses fixtures and needs neither the key nor a network connection.

**Note for Nix users:** `flake.nix` provides a system-compatible Chromium, sets
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` so Playwright uses it instead of
downloading incompatible binaries, and sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
Outside Nix, Playwright will want to fetch its own browsers.

## How it's built

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Input       | `src/` — pages are top-level `.webc` files, one layout in `src/_layouts/` |
| Styling     | `design-system.css` = tokens, `page-furniture.css` = shared page rules    |
| Output      | `dist/`                                                                   |
| Components  | `src/_components/**/*.webc`, globbed by the WebC plugin                   |
| Global data | `src/_data/` — the site's identity, and source resolution only            |
| Images      | `@11ty/eleventy-img`, at build time, for local **and** remote sources     |

There are no collections. `src/sitemap.njk` uses the implicit `collections.all`.

Data flows in at build time:

- **`src/_data/calendar.js`** — resolves the source (live Google Calendar
  `events.list`, or the checked-in fixture) and hands it to
  `_lib/event-page.js`, which does the rest.
- **`src/_data/gallery.js`** — resolves the source (live Google Drive
  `files.list` for a public folder, or the checked-in fixture) and hands it to
  `_lib/gallery-page.js`, which does the rest.
- **`src/_data/site.js`** — the site's own identity: the host, the book, the
  author, the cover. One module, because it used to be nine places.
- **`src/_data/reviews.json`** — static, edited in the repo.

**Neither remote fetch is cached.** `@palebluebytes/cms` has no runtime
dependencies and calls `globalThis.fetch`, so the Drive and Calendar JSON are
fetched on every build. `.cache/` belongs to `eleventy-img`, which caches the
remote image _bytes_ — that is a different thing from the listings, and this
file used to claim otherwise.

A `_data` module may export nothing but `default` — Eleventy insists on that,
see [`AGENTS.md`](AGENTS.md) — so each one is source resolution over a package
that talks to Google and the modules in `src/_lib/` that hold what this site
decides:

| Module                               | Holds                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@palebluebytes/cms/auth`            | `apiKey()`. An `Auth` is a function from `Request` to authorised `Request`                                                                              |
| `@palebluebytes/cms/files/google`    | `listFiles` / `normalisePhotos` / `fetchPhotos` — displayed aspect ratios                                                                               |
| `@palebluebytes/cms/calendar/google` | `listEvents` / `normaliseEvents` / `fetchEvents` — ISO strings, never `Date`s                                                                           |
| `_lib/gallery-layout.js`             | `layOutRows` / `thumbnailSizes` / `parseFilename` / `SKIP_MIME`. **The one home for the gallery's geometry**, and it emits each item's finished `sizes` |
| `_lib/gallery-page.js`               | `buildGallery(photos, {mediaSrc})` — the skip, the caption, the ordering, the packing. Pure                                                             |
| `_lib/event-display.js`              | en-GB date strings, and the future/past partition around a given instant                                                                                |
| `_lib/event-page.js`                 | `buildEvents(events, now, {fallbackTimeZone})` — the sort, the formatting, the partition. Pure                                                          |
| `_lib/structuredData.js`             | `structuredDataFor` returns schema **nodes**; `jsonForScriptElement` serialises them safely                                                             |

**The three `google-*` modules that used to sit in `src/_lib/` are now that
package**, which is what they were always shaped for. It reads no environment,
formats nothing and knows no site: the key, the folder and calendar ids, the HEIC
skip, the ordering, the `"Europe/London"` fallback and the empty-folder hard fail
all stay here.

They no longer all stay in `src/_data/`, though. The two `_data` modules keep
only what resolving a source needs — the ids, the key guard, the fixture branch,
the empty-listing hard fail — and the **policy** moved to `_lib/gallery-page.js`
and `_lib/event-page.js`, which are pure and take their dependencies as
arguments. That is why neither pure module's suite stubs `globalThis.fetch`.

Two consequences of the move worth knowing. `CalendarEvent` now carries a
four-way `kind` (`"date" | "floating" | "zoned" | "instant"`) instead of an
`isAllDay` boolean, because only one of those four is an instant — Google returns
just the first and the last, and `_lib/event-display.js` throws rather than format
the other two. And the calendar window is `from`/`to`, not `timeMin`/`timeMax`.

### Installing it needs a token

`@palebluebytes/cms` is published to **GitHub Packages**, which requires
authentication to _install_ even though the repo is public. Without it the
install fails with a bare 401 that reads like the package doesn't exist.

The committed [`.npmrc`](.npmrc) points the `@palebluebytes` scope at GitHub and
reads the token from the environment, so **it holds no secret** — but the
variable has to exist in both places that install:

| Where      | How                                                                                   |
| ---------- | ------------------------------------------------------------------------------------- |
| Locally    | `GITHUB_PACKAGES_TOKEN` in `.env`, which `.envrc` exports via direnv                  |
| Cloudflare | Settings → Variables and Secrets, as a **Secret**, on **both** Production and Preview |

A `read:packages` scope is all it needs. Don't call it `GITHUB_TOKEN` — inside
GitHub Actions that name is injected automatically with a token that cannot read
another repository's packages, and the failure looks impossible.

**pnpm errors on an unset variable** in `.npmrc` rather than falling back to
`~/.npmrc`, so a missing token stops the install outright instead of 401-ing
halfway through. If `pnpm install` complains about the environment, that is what
it means — and `direnv allow` after any `.envrc` change is the usual cause.

## Testing

Everything runs through [Playwright](https://playwright.dev/) except the unit
tests, which use `node --test`.

| Command               | Covers                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`   | `src/_lib/` directly, and the two `src/_data/` modules — see below                                                      |
| `npm run test:visual` | **The whole Playwright suite** — visual, a11y, SEO, gallery, lightbox                                                   |
| `npm run test:seo`    | Title, description, Open Graph, canonical, JSON-LD                                                                      |
| `npm run test:a11y`   | `axe` against WCAG 2 A/AA over seven pages                                                                              |
| `npm run test:html`   | `html-validate` over a fixture build it makes itself — no key, no network                                               |
| `npm run test:all`    | `test:unit` → `test:seo` → `test:html`                                                                                  |
| `npm run test:update` | Rewrite the visual baselines after an intentional design change — **read the diff first**, see [`AGENTS.md`](AGENTS.md) |
| `npm run report`      | Open the Playwright HTML report, including visual diffs                                                                 |

`npm run test:visual` is named for its most expensive job but is literally
`npx playwright test`, so it runs every spec in `tests/`.

No unit suite needs `GOOGLE_KEY` or a network. No suite imports the package: its
transports and normalisers are tested there. Five of the eight suites are over
pure modules and call them directly; only `gallery.test.js` and
`calendar.test.js` stub `globalThis.fetch`, because source resolution is the one
thing they are left testing.

| Suite                                | Covers                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `tests/unit/gallery-layout.test.js`  | Filename parsing, the skip list, the row packer, and the emitted `sizes`       |
| `tests/unit/gallery-page.test.js`    | The ordering, caption refinement, HEIC skip and row decoration. Pure           |
| `tests/unit/event-display.test.js`   | en-GB formatting and the partition, against an injected clock                  |
| `tests/unit/event-page.test.js`      | The sort, the `"Europe/London"` fallback and the partition. Pure               |
| `tests/unit/structured-data.test.js` | Which schema nodes each page type gets, and that hostile event text is inert   |
| `tests/unit/viewport.test.js`        | That a Playwright project with no declared viewport throws instead of skipping |
| `tests/unit/gallery.test.js`         | Source resolution: the key guard, the empty-folder fail, the image `src`       |
| `tests/unit/calendar.test.js`        | Source resolution: the key guard, the page walk, the fixture path              |

The Playwright specs beyond the obvious two:

| Suite                   | Covers                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| `tests/images.spec.js`  | That no page offers an image candidate above the declared ladder            |
| `tests/gallery.spec.js` | The justified rows, against the DOM, with its own copy of the geometry      |
| `tests/visual.spec.js`  | One named snapshot test per page, over the list in `tests/helpers/pages.js` |

`tests/gallery.spec.js` restates `PACK_WIDTH` and `ROW_GAP` rather than
importing them, **on purpose**: it is an independent oracle, and importing them
would make it an echo of the module it checks. `tests/images.spec.js` restates
the ladder cap for the same reason.

**What is no longer tested here:** displayed aspect ratios, the caption
guarantee, the `files.list` query, recurrence expansion, the page walk, the
inclusive all-day end, and that the key reaches the request. Those moved out with
the code, and they are tested in the package — including one suite this repo
never had, which holds the Google and `.ics` providers to producing the same
events from the same calendar. What stays here is what this site decides.

> **Run `npm run test:all` before you push.** There is no CI — this is the gate.

### Fixture data

Two pages are built from live remote data: the reviews gallery reads a Google
Drive folder and the events page reads a Google Calendar. Screenshotting those
directly meant the baselines drifted whenever Annie added a photo or an event —
and the events page drifted on its own regardless, because `calendar.js` splits
future from past against `new Date()` at build time, so an event silently moved
sections as it passed.

Playwright therefore builds with `FIXTURE_DATA=1`, which swaps just the two
`fetch` calls for checked-in files:

| Fixture                                               | Stands in for                       |
| ----------------------------------------------------- | ----------------------------------- |
| `tests/fixtures/drive-files.json` + `gallery-images/` | the Drive `files.list` response     |
| `tests/fixtures/calendar-events.json`                 | the Calendar `events.list` response |

Only the fetch is swapped. Filename ordering, caption fallback, EXIF-rotation
handling, the justified-row packer, date formatting and the future/past split all
still run for real — the fixture photos carry the same eleven aspect ratios as the
live folder, so they pack into the same 3+2+3+3 rows, and the fixture events sit
in 2019 and 2099 so the partition cannot flip.

The test server runs on **port 8081 with its own `dist-test/` output**, kept
separate from `npm run dev` on 8080 so a live-data build can never be reused for a
screenshot run, and so a fixture build is never left where a deploy might find it.
A consequence worth knowing: the suite no longer needs `GOOGLE_KEY` and runs
offline.

To refresh a fixture, edit the JSON by hand — it is a trimmed copy of the API
response shape. Adding a gallery photo also needs an image in
`tests/fixtures/gallery-images/` whose real dimensions match the
`imageMediaMetadata` you declare, or the packed ratio will disagree with the file.

### HTML validation

`html-validate` lints Eleventy's build output rather than hand-written source, so
two of its stock rules are re-tuned in `.htmlvalidate.json`:

- `doctype-style` is set to `lowercase`. The layout authors `<!DOCTYPE HTML>`,
  but WebC re-serialises it as `<!doctype html>`; both are valid HTML5, and the
  source can't win that argument.
- `no-trailing-whitespace` is off. Stripping a `webc:if` element leaves its
  indentation behind on an otherwise empty line. Nobody reads `dist/`
  whitespace, and contorting the templates to satisfy the rule would cost more
  than it's worth.

`test:html` builds its own `dist-test/` first (`npm run build:fixture`) rather
than reading whatever `dist/` happens to hold. It used to point at `dist/`, which
`test:all` never builds: with no `dist/` the gate's last step just failed, and
with a **stale** `dist/` it validated markup from whenever someone last ran a
live build and went green — passing on the previous release's HTML. Building what
it validates also keeps the gate offline, like every other step in it.

To validate a real production build before a deploy, run `npm run build` and then
`npm run test:html:live`, which reads `dist/`.

`no-inline-style` stays on, with an allowlist for the CSS custom properties that
components legitimately set per instance (the gallery's `--r` / `--sum`, the nav's
`--font-size` / `--dot-color` / `--margin`). Any other inline style is still an error.

### Occasional checks

These two run against `npm run dev` on port 8080, so they need it running in
another terminal. They aren't part of the pre-push gate.

```bash
npm run test:lighthouse   # accessibility + SEO, writes lighthouse-report.html
npm run test:links        # internal broken-link crawl
```

`npm run debug` re-runs the build with `DEBUG=Eleventy*` when a template is
behaving strangely.

## Deploying

The site is a **Cloudflare Pages** project (`annie-elliot`) building from the
`main` branch. Pushing to `main` builds and publishes on its own. The build
command and `GOOGLE_KEY` live in the Cloudflare dashboard, not in this repo.

Because the events and gallery pages read live Google data **at build time**, a
change made in Calendar or Drive does not appear until the site is rebuilt.
`workers/calendar` exists to solve exactly that: a daily cron that pokes a Pages
deploy hook so those changes surface without anyone doing anything. Waiting up to
24 hours is usually fine; when it isn't, retry the deployment from the dashboard.

Never deploy `dist-test/`. It is a fixture build that looks like the real site.

### Getting changes indexed

After a change that matters for search — new copy, new Event schema, a changed
description:

1. **Google Search Console** → **URL Inspection** on the affected page →
   **Request Indexing**.
2. Resubmit `sitemap.xml` under **Sitemaps**.
3. Use **Test Live URL** to confirm the server-rendered JSON-LD and meta
   description are visible to the crawler.

## Related

- [`AGENTS.md`](AGENTS.md) — the constraints that break this project silently.
  Read it before changing the gallery, the fixtures or the image pipeline.
- [`workers/contact/`](workers/contact/) — the contact form's mail worker.
- [`workers/calendar/`](workers/calendar/) — the daily rebuild cron.
- [`docs/managing-gallery-photos.md`](docs/managing-gallery-photos.md) — written
  for Annie: adding, captioning and reordering gallery photos in Drive.
- [`docs/adding-events.md`](docs/adding-events.md) — written for Annie: adding
  book events to the calendar.
