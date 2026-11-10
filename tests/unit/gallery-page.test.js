import test from "node:test";
import assert from "node:assert/strict";

import { buildGallery } from "../../src/_lib/gallery-page.js";

// What this SITE does with an already-normalised Drive folder: its skip policy,
// its caption refinement, its ordering, and the row decoration the mosaic reads.
//
// Everything here is a plain object in and a plain object out. No
// `globalThis.fetch`, no `process.env`, no `console` capture — the source
// resolution that needs all three lives in `src/_data/gallery.js` and is tested
// in tests/unit/gallery.test.js.

// A normalised photo, as `@palebluebytes/cms/files/google` hands it over.
// `ratio` defaults to a square so cases that are not about geometry need not
// carry dimensions.
function photo(name, extra = {}) {
	const id = extra.id ?? `id-${name}`;
	return {
		id,
		name,
		mimeType: "image/jpeg",
		caption: extra.description || name, // the package's `description || name`
		ratio: 1,
		url: `https://drive.google.com/uc?id=${id}&export=download`,
		modifiedTime: "2024-01-01T00:00:00.000Z",
		...extra,
	};
}

// The injected source resolver: the one ambient thing buildGallery would
// otherwise reach for. The real ones live in src/_data/gallery.js.
const mediaSrc = (p) => `src:${p.name}`;

// ------------------------------------------------------------------- ordering

test("orders by numeric prefix (1/2/10 numeric, not lexical; padding optional)", () => {
	const { photos } = buildGallery(
		[
			photo("10 - j.jpg", { description: "j" }),
			photo("2 - b.jpg", { description: "b" }),
			photo("1 - a.jpg", { description: "a" }),
			photo("03 - c.jpg", { description: "c" }),
		],
		{ mediaSrc },
	);

	assert.deepEqual(
		photos.map((r) => r.caption),
		["a", "b", "c", "j"],
	);
});

test("un-numbered files sort last, alphabetical by filename", () => {
	const { photos } = buildGallery(
		[
			photo("zebra.jpg", { description: "zebra" }),
			photo("1 - first.jpg", { description: "first" }),
			photo("apple.jpg", { description: "apple" }),
		],
		{ mediaSrc },
	);

	assert.deepEqual(
		photos.map((r) => r.caption),
		["first", "apple", "zebra"],
	);
});

// -------------------------------------------------------------------- caption

test("caption = description; = cleaned filename when blank; never empty", () => {
	// One never-empty field, because both <img> tags carry alt="" and the
	// figcaption is the photo's only text alternative. The transport already
	// guarantees non-empty; what this module adds is the tidied filename.
	const { photos } = buildGallery(
		[
			photo("1 - x.jpg", { description: "My caption" }),
			photo("2 - hello-world.jpg", { description: "" }),
			photo("3 - a_b.jpg"), // description undefined
		],
		{ mediaSrc },
	);

	assert.equal(photos[0].caption, "My caption");
	assert.equal(photos[1].caption, "hello world");
	assert.equal(photos[2].caption, "a b");
	for (const p of photos) {
		assert.ok(p.caption.length > 0, "caption is never empty");
	}
});

test("caption falls back to the raw filename when prefix strips the stem to empty", () => {
	// Pathological name: prefix + separator + nothing but the extension, blank
	// description. cleaned === "" here, so the caption must fall back further to
	// the package's own `description || name`.
	const { photos } = buildGallery([photo("01 - .jpg", { description: "" })], {
		mediaSrc,
	});

	assert.equal(photos[0].caption, "01 - .jpg");
});

test("the dead `alt` field is gone — caption is the single text alternative", () => {
	const { photos } = buildGallery(
		[photo("1 - x.jpg", { description: "Only field." })],
		{ mediaSrc },
	);

	assert.equal(photos[0].alt, undefined);
});

// ------------------------------------------------------------- what is shown

test("non-image MIME types are filtered out", () => {
	const { photos } = buildGallery(
		[
			photo("1 - photo.jpg", { mimeType: "image/jpeg", description: "keep" }),
			photo("doc.pdf", { mimeType: "application/pdf" }),
			photo("clip.mp4", { mimeType: "video/mp4" }),
			photo("mystery", { mimeType: undefined }),
		],
		{ mediaSrc },
	);

	assert.equal(photos.length, 1);
	assert.equal(photos[0].caption, "keep");
});

test("HEIC/HEIF are soft-skipped, and returned by name for the caller to warn about", () => {
	// The skip is a site policy, not Google's. Naming the files is a RETURNED
	// value rather than a `console.warn` from in here: this module has no side
	// effects at all, which is what makes it callable with plain objects.
	const { photos, skipped } = buildGallery(
		[
			photo("a.heic", { mimeType: "image/heic" }),
			photo("b.heif", { mimeType: "image/heif" }),
			photo("1 - c.jpg", { mimeType: "image/jpeg", description: "kept" }),
		],
		{ mediaSrc },
	);

	assert.equal(photos.length, 1);
	assert.equal(photos[0].caption, "kept");
	assert.deepEqual(skipped, ["a.heic", "b.heif"]);
});

test("nothing is skipped when every file is showable", () => {
	const { skipped } = buildGallery([photo("1 - x.jpg")], { mediaSrc });

	assert.deepEqual(skipped, []);
});

// ------------------------------------------------------------ rows and shares

// The live gallery's exact eleven ratios, in order, as the normaliser derives
// them from the Drive dimensions (07 and 08 are EXIF-rotated, so their
// dimensions are swapped before the division).
function livePhotos() {
	return [
		["01 - Lucinda.jpg", 1200 / 1600],
		["02 - HuntingRaven.jpg", 1200 / 1600],
		["03 - Broadstairs.jpg", 4000 / 3000],
		["04 - BleakHouse.jpg", 640 / 481],
		["05 - Bournemouth.jpg", 3000 / 2000],
		["06 - Rochester.jpg", 4000 / 3000],
		["07 - Lillian.jpg", 3024 / 4032],
		["08 - GadsHill.jpg", 3024 / 4032],
		["09 - MuseumLaunch.jpg", 1200 / 1600],
		["Outside museum.jpg", 1200 / 1600],
		["symposium1.png", 1282 / 736],
	].map(([name, ratio]) => photo(name, { ratio }));
}

test("rows partition the photos in order — nothing lost, nothing duplicated", () => {
	const { photos, rows } = buildGallery(livePhotos(), { mediaSrc });

	const flattened = rows.flat();
	assert.equal(flattened.length, photos.length);
	for (const [i, item] of flattened.entries()) {
		assert.equal(
			item,
			photos[i],
			`row item ${i} IS photos[${i}] (same object)`,
		);
		assert.equal(item.index, i, "the flat index is the photo's position");
	}
});

test("share is the photo's fraction of its row, and every row's shares sum to 1", () => {
	const { rows } = buildGallery(livePhotos(), { mediaSrc });

	for (const row of rows) {
		const sum = row.reduce((s, item) => s + item.ratio, 0);
		let shareSum = 0;
		for (const item of row) {
			assert.equal(item.share, item.ratio / sum);
			assert.equal(item.rowCount, row.length);
			assert.equal(item.rowRatioSum, sum, "the row's width cap input");
			shareSum += item.share;
		}
		assert.ok(Math.abs(shareSum - 1) < 1e-12, "the row's shares sum to 1");
	}

	// The first row is 0.75 + 0.75 + 1.3333 — spot-check against ticket 03's table.
	assert.equal(rows[0][0].share.toFixed(4), "0.2647");
	assert.equal(rows[3][2].share.toFixed(4), "0.5373");
});

test("a list whose every file is skipped yields no rows rather than throwing", () => {
	// The packer's empty-input path. An empty Drive listing can no longer reach
	// it — that is a hard failure in src/_data/gallery.js — but the soft-skips
	// still get there, and HEIC-only is the realistic way.
	const { photos, rows, skipped } = buildGallery(
		[
			photo("a.heic", { mimeType: "image/heic" }),
			photo("b.heif", { mimeType: "image/heif" }),
		],
		{ mediaSrc },
	);

	assert.deepEqual(photos, []);
	assert.deepEqual(rows, []);
	assert.deepEqual(skipped, ["a.heic", "b.heif"]);
});

// --------------------------------------------------------------------- source

test("src is whatever the injected mediaSrc resolves, called once per photo", () => {
	// The resolver is chosen ONCE by the caller rather than consulted per photo:
	// in src/_data/gallery.js it used to re-read process.env.FIXTURE_DATA inside
	// this loop.
	const seen = [];
	const { photos } = buildGallery([photo("2 - b.jpg"), photo("1 - a.jpg")], {
		mediaSrc: (p) => {
			seen.push(p.name);
			return `resolved:${p.name}`;
		},
	});

	assert.deepEqual(seen, ["2 - b.jpg", "1 - a.jpg"]);
	assert.deepEqual(
		photos.map((p) => p.src),
		["resolved:1 - a.jpg", "resolved:2 - b.jpg"],
	);
});
