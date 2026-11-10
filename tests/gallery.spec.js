import { test, expect } from "@playwright/test";

import { isNarrow } from "./helpers/viewport.js";

// Guards for the justified-row gallery on /reviews/. Every assertion is derived
// from the rendered page rather than pinned to the eleven photos that happen to
// be in the Drive folder today — Annie owns that folder and adding, reordering or
// replacing a photo must not red the suite.
//
// Two of these assertions exist because nothing else in the suite can see what
// they check: axe passes whether or not the caption is announced once or three
// times, and `tests/visual.spec.js` force-sets every lazy image to eager before
// it screenshots, so it is blind to the loading attribute.

// The thumbnail `sizes` formula, restated independently of the template so the
// test is an oracle rather than an echo. Ticket 03 measured the eleven strings
// this produced for the gallery as it stood — e.g. symposium1 at
// `(min-width: 77.5rem) 615px, (min-width: 40rem) 54vw, 100vw` — but the strings
// themselves are NOT pinned here: Annie owns the Drive folder, and adding or
// reordering a photo re-packs the rows and legitimately changes every one of
// them. What must hold is the formula.
const PACK_WIDTH = 1160; // the container's content box at the 77.5rem cap
const ROW_GAP = 8; // the mosaic gap, matching --gap in reviews.webc

function expectedSizes({ share, rowCount }) {
	const px = Math.round(share * (PACK_WIDTH - ROW_GAP * (rowCount - 1)));
	const vw = Math.round(share * 100);
	return `(min-width: 77.5rem) ${px}px, (min-width: 40rem) ${vw}vw, 100vw`;
}

// The ladder cap these photos declare is not a gallery rule: no page may offer
// a candidate wider than its ladder, and the page that broke it was /author/,
// which this spec never visits. That guard lives in `tests/images.spec.js` and
// runs against every page.

/**
 * Force the thumbnails to load and wait for them.
 *
 * Necessary because an unloaded `<img>` lays out against the ratio in its
 * `width`/`height` attributes rather than its real bitmap — and Eleventy's dev
 * server (which is what Playwright runs against) emits those attributes in the
 * source's STORED orientation, so the two EXIF-rotated photos are declared
 * landscape there while the bytes it serves are correctly portrait. The
 * production build emits the rotated numbers and has no such gap; either way,
 * measuring a loaded image measures what the reader actually sees.
 */
async function loadGalleryImages(page) {
	await page.locator(".photo-gallery .gallery-item").first().waitFor();
	await page.evaluate(async () => {
		const imgs = [...document.querySelectorAll(".photo-gallery img")];
		for (const img of imgs) img.loading = "eager";
		await Promise.all(
			imgs.map((img) =>
				img.complete && img.naturalWidth
					? null
					: new Promise((resolve) => {
							img.addEventListener("load", resolve, { once: true });
							img.addEventListener("error", resolve, { once: true });
						}),
			),
		);
	});
}

/**
 * The accessibility subtree rooted at each element matching `selector`.
 *
 * Rebuilt from `childIds` — a flat slice of the node list is misleading, which
 * is what cost time in ticket 05. Playwright's `page.accessibility.snapshot()`
 * no longer exists in the installed version, so this goes through CDP; both
 * projects are Chromium, so there is no engine gap.
 */
async function axSubtrees(page, selector) {
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send("DOM.enable");
		await cdp.send("Accessibility.enable");

		const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
		const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
			nodeId: root.nodeId,
			selector,
		});
		const backendIds = [];
		for (const nodeId of nodeIds) {
			const { node } = await cdp.send("DOM.describeNode", { nodeId });
			backendIds.push(node.backendNodeId);
		}

		const { nodes } = await cdp.send("Accessibility.getFullAXTree");
		const byId = new Map(nodes.map((n) => [n.nodeId, n]));
		const byBackendId = new Map(nodes.map((n) => [n.backendDOMNodeId, n]));

		return backendIds.map((id) => {
			const node = byBackendId.get(id);
			return node ? collectNames(node, byId) : null;
		});
	} finally {
		await cdp.detach();
	}
}

/** Every string the accessibility tree speaks in this subtree, node by node. */
function collectNames(node, byId, out = []) {
	out.push({
		role: node.role?.value,
		name: node.name?.value ?? "",
		ignored: node.ignored,
	});
	for (const childId of node.childIds ?? []) {
		const child = byId.get(childId);
		if (child) collectNames(child, byId, out);
	}
	return out;
}

test.describe("Reviews photo gallery (justified rows)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/reviews/");
		await page.locator(".photo-gallery .gallery-item").first().waitFor();
	});

	test("every thumbnail renders at its exact aspect ratio — nothing is cropped", async ({
		page,
	}) => {
		// The whole point of the layout: `width: 100%; height: auto` with no
		// aspect-ratio and no object-fit. Measured, not eyeballed. The prototype
		// measured 0.010% worst-case error against `--r`; 0.5% here also absorbs
		// eleventy-img's rounding of the rendition itself (a 0.75 source emits
		// 400x533 = 0.7505) and still catches any reintroduced crop.
		await loadGalleryImages(page);

		const measured = await page
			.locator(".photo-gallery .gallery-item")
			.evaluateAll((items) =>
				items.map((item) => {
					const img = item.querySelector("img");
					const box = img.getBoundingClientRect();
					return {
						declared: parseFloat(
							getComputedStyle(item).getPropertyValue("--r"),
						),
						natural: img.naturalWidth / img.naturalHeight,
						rendered: box.width / box.height,
						width: box.width,
					};
				}),
			);

		expect(measured.length).toBeGreaterThan(0);
		for (const [i, m] of measured.entries()) {
			expect(m.width, `photo ${i} has layout`).toBeGreaterThan(0);
			expect(Number.isFinite(m.declared), `photo ${i} declares --r`).toBe(true);

			// The photo is shown whole: its box is its own shape.
			expect(
				Math.abs(m.rendered - m.natural) / m.natural,
				`photo ${i}: rendered ${m.rendered} vs the bitmap's ${m.natural}`,
			).toBeLessThan(0.005);

			// …and that shape is the one the packer laid the row out against.
			expect(
				Math.abs(m.rendered - m.declared) / m.declared,
				`photo ${i}: rendered ${m.rendered} vs declared --r ${m.declared}`,
			).toBeLessThan(0.005);
		}
	});

	test("each row fills its width exactly — the rows stay flush", async ({
		page,
	}, testInfo) => {
		test.skip(
			isNarrow(testInfo),
			"below 40rem the mosaic is a single block column, so there is no row to fill",
		);

		const rows = await page.locator(".photo-gallery .row").evaluateAll((els) =>
			els.map((row) => {
				const rowWidth = row.getBoundingClientRect().width;
				const items = [...row.querySelectorAll(".gallery-item")];
				const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
				const used =
					items.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0) +
					gap * (items.length - 1);
				return { rowWidth, used, count: items.length };
			}),
		);

		expect(rows.length).toBeGreaterThan(0);
		for (const [i, row] of rows.entries()) {
			const fill = row.used / row.rowWidth;
			expect(
				fill,
				`row ${i} (${row.count} photos) fills its width`,
			).toBeGreaterThan(0.999);
			expect(fill, `row ${i} does not overflow`).toBeLessThan(1.001);
		}
	});

	test("the caption is announced exactly once per thumbnail", async ({
		page,
	}) => {
		// Ticket 05. An aria-label on the anchor does NOT suppress a descendant
		// <img> — Chrome exposes it as its own `image` node — so this used to be
		// three renderings of the same 99-310 character sentence per photo. Axe
		// has no rule for it and passes either way, which makes this assertion
		// the only thing that can catch a regression.
		const items = page.locator(".photo-gallery .gallery-item");
		const count = await items.count();
		expect(count).toBeGreaterThan(0);

		const captions = await items
			.locator("figcaption")
			.evaluateAll((els) => els.map((el) => el.textContent.trim()));
		const subtrees = await axSubtrees(page, ".photo-gallery .gallery-item");
		expect(subtrees.length).toBe(count);

		for (let i = 0; i < count; i++) {
			const caption = captions[i];
			expect(caption.length, `photo ${i} has a caption`).toBeGreaterThan(0);
			expect(
				subtrees[i],
				`photo ${i} is in the accessibility tree`,
			).toBeTruthy();

			const nodes = subtrees[i].filter((n) => !n.ignored);
			const spoken = nodes.filter((n) => n.name.includes(caption.slice(0, 40)));

			expect(
				spoken.length,
				`photo ${i}: caption spoken ${spoken.length}x — ${JSON.stringify(nodes, null, 1)}`,
			).toBe(1);

			// alt="" makes the image presentational, so it should not appear at all.
			expect(
				nodes.filter((n) => n.role === "image").length,
				`photo ${i} exposes no image node`,
			).toBe(0);

			// …and the link carries a short positional name instead.
			const link = nodes.find((n) => n.role === "link");
			expect(link?.name).toBe(`Enlarge photo ${i + 1} of ${count}`);
		}
	});

	test("every thumbnail declares the sizes its share of the row implies", async ({
		page,
	}) => {
		// `share` is not in the DOM, so it is recovered the way the browser sees
		// the layout: each item's ratio over its row's ratio sum.
		const items = await page
			.locator(".photo-gallery .row")
			.evaluateAll((rows) =>
				rows.flatMap((row) => {
					const cells = [...row.querySelectorAll(".gallery-item")];
					const sum = cells.reduce(
						(t, el) =>
							t + parseFloat(getComputedStyle(el).getPropertyValue("--r")),
						0,
					);
					return cells.map((el) => ({
						share:
							parseFloat(getComputedStyle(el).getPropertyValue("--r")) / sum,
						rowCount: cells.length,
						sizes: el.querySelector("img").getAttribute("sizes"),
					}));
				}),
			);

		expect(items.length).toBeGreaterThan(0);
		for (const [i, item] of items.entries()) {
			expect(item.sizes, `photo ${i}`).toBe(expectedSizes(item));
		}
	});

	test("the lightbox sizes on its own height, and loads lazily", async ({
		page,
	}) => {
		// /reviews/ used to pull ~5.9 MB of full-resolution photos before anyone
		// clicked a thumbnail: eleven eager lightbox images at `sizes="90vw"`.
		const imgs = await page
			.locator(".lightbox .lb-stage img")
			.evaluateAll((els) =>
				els.map((img) => ({
					loading: img.getAttribute("loading"),
					sizes: img.getAttribute("sizes"),
					fetchpriority: img.getAttribute("fetchpriority"),
				})),
			);

		expect(imgs.length).toBeGreaterThan(0);
		for (const [i, img] of imgs.entries()) {
			expect(img.loading, `lightbox ${i} is lazy`).toBe("lazy");
			expect(img.fetchpriority, `lightbox ${i} drops fetchpriority`).toBeNull();
			// Height-driven: the frame is capped at min(72rem, 100% - padding) and
			// the image is `max-height: 78vh; width: auto`.
			expect(img.sizes).toMatch(
				/^min\(72rem, 100vw - 2\.5rem, 78vh \* \d+\.\d{4}\)$/,
			);
		}
	});

	// NB: there is deliberately no "the API key never reaches the HTML" test
	// here. Eleventy's dev server defers image processing to a `/.11ty/image/`
	// endpoint whose query string carries the whole remote `src`, key and all —
	// so the served page always contains it, and a test against this server
	// could only ever fail. The production build inlines no such URL; that is
	// checked against `dist/` at build time instead.
});
