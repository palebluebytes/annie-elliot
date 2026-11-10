import { test } from "node:test";
import assert from "node:assert/strict";

import { isNarrow, MOSAIC_MIN_WIDTH } from "../helpers/viewport.js";

// `isNarrow` decides whether six lightbox tests and the gallery's row-fill
// assertion run at all, so a wrong answer costs coverage rather than a failure.
// It is a pure function of a Playwright project's declared viewport, so it is
// testable without a browser.

const projectWith = (use) => ({ project: { name: "Test", use } });

test("a viewport below the mosaic tier is narrow", () => {
	assert.equal(
		isNarrow(projectWith({ viewport: { width: 393, height: 851 } })),
		true,
	);
});

test("a viewport at or above the mosaic tier is not narrow", () => {
	assert.equal(
		isNarrow(
			projectWith({ viewport: { width: MOSAIC_MIN_WIDTH, height: 480 } }),
		),
		false,
	);
	assert.equal(
		isNarrow(projectWith({ viewport: { width: 1920, height: 1080 } })),
		false,
	);
});

test("a project that declares no viewport throws rather than counting as narrow", () => {
	// This is the defect the throw exists for: `?? 0` made an undeclared
	// viewport *narrow*, so `test.skip` quietly dropped every mosaic test and
	// the suite went green having asserted nothing.
	assert.throws(() => isNarrow(projectWith({})), /viewport/);
	assert.throws(() => isNarrow(projectWith({ viewport: null })), /viewport/);
	assert.throws(() => isNarrow({ project: { name: "Test" } }), /viewport/);
});
