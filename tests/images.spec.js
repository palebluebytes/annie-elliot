import { test, expect } from "@playwright/test";

import { SITE_PAGES } from "./helpers/pages.js";

// The declared ladder is the cap, on every page.
//
// `widths` in an `eleventy-image` call is that call site's statement of the
// widest rendition it can ever use. An `"auto"` entry in the list breaks that
// statement: it adds the *source's* own width as an extra rung, which is how
// /author/ came to offer a 2837w candidate of a portrait that is never laid out
// above 540 CSS px. Dropping `"auto"` from the global options in
// `eleventy.config.js` is what stops eleventy-img building source-width
// renditions — 11.8 MB of the gallery's 19.4 MB when it was measured — and
// leaves every call site overriding the global to *widen*, never to narrow.
//
// This guard used to live in `tests/gallery.spec.js` and so ran against
// /reviews/ alone: the policy was asserted on one page while the opposite
// default sat in the global config, and the page that actually violated it was
// the one page nothing checked. It belongs to every page.
//
// 1800 is the widest rung any call site declares (`src/reviews.webc`, for both
// the thumbnails and the lightbox). It is restated here rather than imported so
// this test is an independent oracle: a ladder that grows past it should turn
// this red and be a decision, not a side effect.
const SITE_MAX_CANDIDATE_WIDTH = 1800;

/** Every `w` candidate offered by every `<picture>` on the page. */
async function candidateWidths(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("picture source, picture img")]
			.flatMap((el) => (el.getAttribute("srcset") ?? "").split(","))
			.map((candidate) => parseInt(candidate.trim().split(/\s+/)[1], 10))
			.filter(Number.isFinite),
	);
}

test.describe("Responsive image candidates", () => {
	for (const { name, url } of SITE_PAGES) {
		test(`${name} offers no candidate wider than the ladder`, async ({
			page,
		}) => {
			await page.goto(url);
			const widths = await candidateWidths(page);

			// A page with no candidates would pass the cap vacuously.
			expect(widths.length, `${url} renders responsive images`).toBeGreaterThan(
				0,
			);
			expect(
				Math.max(...widths),
				`${url} widest candidate`,
			).toBeLessThanOrEqual(SITE_MAX_CANDIDATE_WIDTH);
		});
	}
});
