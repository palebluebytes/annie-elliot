import { test, expect } from "@playwright/test";

import { SITE_PAGES } from "./helpers/pages.js";

// One test per page, named from the declared list in ./helpers/pages.js.
//
// This was a single test that crawled the homepage's internal links and
// screenshotted everything it found in a loop. Four consequences, all of them
// quiet:
//
//   - the first failing baseline aborted every page after it, so one diff hid
//     the other six;
//   - a failure reported "dynamic site snapshot" and named no page;
//   - `retries: 1` re-ran all seven captures to retry one;
//   - and the baseline filename came from the crawled href, so renaming a nav
//     target *renamed* a baseline — a fresh capture, silently accepted, instead
//     of a failure against the committed one.
//
// The crawl also could not reach /email-success/ or /email-failure/, which had
// to be injected into its results by hand. A declared list covers them like any
// other page, and a list cannot come back empty the way a crawl can.
//
// The baseline stems are unchanged: `<name>-<project>-linux.png` for each
// `name` in SITE_PAGES.

// eleventy-img emits `loading="lazy"` on every image, so below-the-fold photos
// never decode on a plain `networkidle` wait — a full-page screenshot then
// captures empty boxes and a too-short page. Scroll the whole page to trigger the
// lazy loads, wait for every image to finish, then return to the top so the shot
// is deterministic.
async function loadLazyImages(page) {
	await page.evaluate(async () => {
		// Force every image to load up front. Tall pages (e.g. /events/) have
		// dozens of `loading="lazy"` images that would otherwise stream in during
		// Playwright's full-page capture scroll, so consecutive frames never match
		// and the shot never stabilises. Making them all eager settles the page.
		document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
			img.loading = "eager";
		});
		await new Promise((resolve) => {
			let y = 0;
			const step = () => {
				window.scrollBy(0, window.innerHeight);
				y += window.innerHeight;
				if (y < document.body.scrollHeight) {
					setTimeout(step, 100);
				} else {
					resolve();
				}
			};
			step();
		});
		window.scrollTo(0, 0);
	});
	await page.evaluate(() =>
		Promise.all(
			Array.from(document.images)
				.filter((img) => !img.complete)
				.map(
					(img) =>
						new Promise((res) => {
							img.onload = img.onerror = res;
						}),
				),
		),
	);
}

test.describe("Visual Regression Tests", () => {
	for (const { name, url } of SITE_PAGES) {
		test(`${name} page looks as committed`, async ({ page }) => {
			// /events/ and /reviews/ render tall and image-heavy, and settling the
			// lazy loads is a scroll of the whole page, so one page needs well
			// beyond the 30s default on its own.
			test.setTimeout(90_000);

			await page.goto(url);
			await page.waitForLoadState("networkidle");
			await loadLazyImages(page);

			// Some pages render very tall with many lazy images, so a full-page
			// capture needs longer than the 5s default to settle into two
			// identical frames.
			await expect(page).toHaveScreenshot(`${name}.png`, {
				fullPage: true,
				timeout: 30000,
			});
		});
	}
});
