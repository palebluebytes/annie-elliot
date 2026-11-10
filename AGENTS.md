# AGENTS.md

Constraints for this repo. Everything here shares one property: **break it and
nothing errors** — the build succeeds, the page renders, and the result is wrong.

Orientation, commands and deployment live in [`README.md`](README.md). Design
rationale lives in comments next to the code it explains; this file is only the
traps.

## The site ships no JavaScript

Every built page has a **0-byte JS bundle**. The lightbox, the navigation and the
gallery layout are CSS — `:target`, `:hover`, flexbox. This is the defining
property of the project, not an optimisation.

**Never add client-side JavaScript.** If a change seems to need it, it needs a
different design. Adding a script breaks nothing visible; it just quietly ends
the thing the site is.

## `src/_data/gallery.js` must export only `default`

An Eleventy `_data/*.js` module with any export besides `default` is handed to
templates as the **whole module namespace**. Add a second named export and
`$data.gallery` silently becomes `{ default, packRows }`, rendering
`[object Object]` instead of the gallery.

Both `_data` modules satisfy this **by construction**: everything worth naming
lives somewhere else and is imported — the Drive and Calendar transports and
their normalisers in `@palebluebytes/cms`, the row packer and the date
formatting in `src/_lib/` — so each `_data/*.js` file is one default export over
imports and there is nothing to accidentally name. Add code to `src/_lib/`
rather than a second export here.

## A `_data/*.js` function is called once per build, not once per page

Eleventy calls a function-exported global data file **once for the whole build**
and passes it the config-API global data (`eleventyConfig.addGlobalData()`), not
a page's data cascade. This project registers none, so the argument arrives as
`{ eleventy }` — `page`, `metadata` and `calendar` are all absent.

Anything that varies per page belongs in `eleventyComputed` in a `*.11tydata.js`
file: `src/src.11tydata.js` computes `structuredDataJson` this way.

Get this wrong and every page silently receives the same value. The JSON-LD did
exactly that — Book on all seven pages, Event on none — and nothing failed:
the build was green, the pages rendered, and the schema was wrong everywhere.
`tests/seo.spec.js` "Per-page structured data" is the guard.

## The book cover is an inline SVG, not an image file

`src/index.webc` draws the "coming soon" cover as inline `<svg>` markup. It is
inline on purpose: an SVG loaded through `<img src="…">` is an isolated
document that does not get the page's `@font-face` faces, so the title would
quietly render in a system font instead of Playfair.

That also means the cover is no longer the LCP _image_, and there is no
`src/index.11tydata.js` any more — it existed only to pre-run `eleventy-img` on
the cover and emit a matching `<link rel="preload">`, options duplicated across
two files. Restoring a raster cover means restoring both, and the two option
sets have to match exactly or you get a redundant transcode plus a preload the
browser never uses.

`src/static/images/book-cover.jpg` is the **same placeholder rendered to a
raster twin**, 1000×1500, and it is what `og:image`, `twitter:image` and the
`Book` JSON-LD point at (`html.webc`, `src/_lib/structuredData.js`, asserted by
`tests/seo.spec.js`). No page renders it — it exists only for social cards and
crawlers, so nothing in the build or the test suite compares it against the
inline SVG.

**Change the SVG and the JPG silently goes stale**: the site shows one cover
and every share card shows another. Re-render it by loading the `<svg>` markup
and the `.cover__placeholder` rules into a 1000×1500 page and screenshotting it
with the pinned chromium — the fonts must come from `src/static/fonts/`, or the
twin renders in a system face and no longer matches.

## Gallery geometry is duplicated across three layers

These describe the same container and must move together:

| File                         | Values                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `src/_lib/gallery-layout.js` | `PACK_WIDTH = 1160`, `ROW_GAP = 8`, `TARGET_ROW_HEIGHT = 352`                         |
| `src/reviews.webc`           | `--gap: 0.5rem`, and the `1160` / `8` in the thumbnails' `sizes` expression           |
| `tests/gallery.spec.js`      | `PACK_WIDTH = 1160`, `ROW_GAP = 8` — an independent oracle, deliberately not imported |
| `tests/helpers/viewport.js`  | `MOSAIC_MIN_WIDTH = 640`, matching the `39.9375rem` CSS tier                          |

Change one and the layout drifts from what the tests assert, or the `sizes`
attribute starts lying to the browser about how wide the image will be.

## Fixtures are two-sided

Adding a gallery photo to the fixtures needs **both**:

1. an entry in `tests/fixtures/drive-files.json`, and
2. a real image in `tests/fixtures/gallery-images/` whose **actual pixel
   dimensions match the `imageMediaMetadata` you declared**.

Declare dimensions that don't match the file and the tests pass on geometry the
real pipeline would never produce.

**The fixture events sit in 2019 and 2099 on purpose.** `calendar.js` partitions
future from past against `new Date()` at build time. Move those dates near the
present and events start migrating between sections as time passes, changing the
page under the visual baselines.

## Image `src` is relative to the working directory, not to `src/`

`src/author.webc` uses `src="assets/images/author.jpg"` → the repo-root
`assets/`, and `src/_components/header.webc` uses
`src="assets/images/separator.webp"`. Both resolve from the process CWD.

## Never deploy `dist-test/`

It is a **fixture** build — placeholder photos, events dated 2019 and 2099 — that
looks enough like the real site to be mistaken for it. Playwright writes it on
port 8081; `npm run dev` and `npm run build` use `dist/`.

## `pnpm-lock.yaml` is the only thing pinning production's dependencies

Install with **pnpm**. Cloudflare Pages picks its package manager from whichever
lockfile it finds, so an `npm install` that leaves a `package-lock.json` behind
redirects the production build onto a different resolver and a different set of
versions.

The repo ran with no root lockfile at all until 2026-08-14, and it cost a
deploy: production had been building on Eleventy 3.1.2, and one build silently
resolved 3.1.6, Playwright 1.62.1 and axe-core 4.13.0 instead. The build was
green and the site looked fine — it was simply built by software nobody had
tested against. A stale `package-lock.json` from before the Playwright migration
was also sitting in the repo; the day pnpm detection lapsed, `npm ci` read it
and the build died.

Chromium is pinned by `flake.nix`, not by Playwright, so the visual baselines
survive a Playwright bump. They would not survive a Nix chromium bump.

## `sharp`'s install script is ignored on purpose

`package.json` carries `pnpm.ignoredBuiltDependencies: ["sharp"]`, which is what
stops pnpm 10 warning `Ignored build scripts: sharp` on every install. It is a
decision, not a silencer.

`sharp`'s only lifecycle script is `install: node install/check`, and that script
is a **fallback that compiles from source via node-gyp**. It has nothing to do
here: the prebuilt `@img/sharp-linux-x64` arrives as an optional dependency and
is what actually does the work. Approving the script instead — `pnpm
approve-builds`, or `onlyBuiltDependencies` — would invite a source build on any
machine whose heuristics decide the prebuilt is unsuitable, inside a Nix shell
and a Cloudflare builder that have no business compiling libvips.

If a platform ever genuinely lacks a prebuilt binary, this fails **loudly** at
`require` time with "Could not load the sharp module", not silently. That is the
signal to revisit this, and the fix then is the optional dependency, not the
script.

## There is no CI

`npm run test:all` before pushing is the only gate, and pushing to `main`
deploys. Nothing will catch a regression for you.

If the visual baselines fail, **read the diff before updating them**. Running
`npm run test:update` to make red turn green is how a real regression gets
committed as the new expected appearance.
