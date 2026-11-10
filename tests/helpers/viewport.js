// The reviews gallery has one structural breakpoint, and two specs need it.
//
// Below 40rem the gallery is a single full-width column with the caption printed
// under each photo, and the lightbox is suppressed entirely. At 40rem and above
// it is a justified mosaic whose rows must add up, and the lightbox works.
//
// The CSS tier is `max-width: 39.9375rem` — one pixel short of 40rem, so it
// cannot overlap the `(min-width: 40rem)` clause in the thumbnails' `sizes`.
// That makes "narrow" exactly `width < 640`, which is what this guard tests.
export const MOSAIC_MIN_WIDTH = 640;

/**
 * True when this project's viewport is in the single-column tier.
 *
 * Throws when the project declares no viewport. This used to read
 * `(…viewport?.width ?? 0) < MOSAIC_MIN_WIDTH`, which answered *narrow* for a
 * project that never said how wide it was — and the callers answer with
 * `test.skip`, so six lightbox tests and the gallery's row-fill assertion
 * silently stopped running and the suite stayed green. A project whose width
 * this cannot know is a question, not a default.
 */
export const isNarrow = (testInfo) => {
	const width = testInfo.project.use?.viewport?.width;
	if (typeof width !== "number") {
		throw new Error(
			`Playwright project "${testInfo.project.name}" declares no viewport width, ` +
				`so it cannot be placed either side of the ${MOSAIC_MIN_WIDTH}px mosaic ` +
				`tier. Give the project an explicit \`viewport\` in playwright.config.js.`,
		);
	}
	return width < MOSAIC_MIN_WIDTH;
};
