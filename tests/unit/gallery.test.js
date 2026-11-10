import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import gallery from "../../src/_data/gallery.js";

// The Eleventy data module, which is now SOURCE RESOLUTION and nothing else:
// which payload the photos come from, which credential reaches Google, which
// listing answers are not believable, and where a photo's bytes live.
//
// This is the suite that has to own the ambient state — `globalThis.fetch`, the
// environment, a `console` — because resolving a source is what reads it. What
// the site then DOES with the photos is `src/_lib/gallery-page.js`, called with
// plain objects in tests/unit/gallery-page.test.js: the ordering, the captions,
// the skip policy, the rows and their shares all live there now. The transport
// and normaliser are tested in `@palebluebytes/cms`, and the packer in
// tests/unit/gallery-layout.test.js.

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realGoogleKey = process.env.GOOGLE_KEY;
const realFixtureData = process.env.FIXTURE_DATA;

function restoreEnv(name, saved) {
	if (saved === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = saved;
	}
}

// Build a fake `Response` with the fields the transport reads.
function mockFetch(
	payload,
	{ ok = true, status = 200, statusText = "OK" } = {},
) {
	globalThis.fetch = async () => ({
		ok,
		status,
		statusText,
		json: async () => payload,
	});
}

// A Drive `files.list` entry with sensible defaults. Dimensions default to a
// square so cases that are not about ratios need not carry them.
function file(name, extra = {}) {
	const { width = 1000, height = 1000, rotation, ...rest } = extra;
	const id = rest.id ?? `id-${name}`;
	return {
		id,
		name,
		mimeType: rest.mimeType ?? "image/jpeg",
		description: rest.description,
		modifiedTime: rest.modifiedTime ?? "2024-01-01T00:00:00.000Z",
		// The exact string Drive returns, and what the live src is built from.
		webContentLink:
			"webContentLink" in extra
				? extra.webContentLink
				: `https://drive.google.com/uc?id=${id}&export=download`,
		imageMediaMetadata:
			"imageMediaMetadata" in extra
				? extra.imageMediaMetadata
				: { width, height, ...(rotation === undefined ? {} : { rotation }) },
	};
}

// Silence (and collect) the module's warnings.
function captureWarnings() {
	const warnings = [];
	console.warn = (msg) => warnings.push(msg);
	return warnings;
}

beforeEach(() => {
	process.env.GOOGLE_KEY = "test-key";
	// The fixture branch short-circuits the fetch entirely, so a stray
	// FIXTURE_DATA would quietly bypass every live-path assertion below — the
	// empty-listing hard fail and the webContentLink src most of all — and the
	// suite would still be green.
	delete process.env.FIXTURE_DATA;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	console.warn = realWarn;
	restoreEnv("GOOGLE_KEY", realGoogleKey);
	restoreEnv("FIXTURE_DATA", realFixtureData);
});

// ------------------------------------------------------------------- the ask

test("the site asks Drive for images only — the transport does not", async () => {
	// A stray document in the folder should not cost a listing entry. The
	// transport's base query says nothing about mimeType, so this clause has to
	// come from here.
	let requested;
	globalThis.fetch = async (request) => {
		requested = new URL(request.url);
		return {
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({ files: [file("1 - x.jpg")] }),
		};
	};

	await gallery();

	assert.match(requested.searchParams.get("q"), /mimeType contains 'image\/'/);
});

// ------------------------------------------------------------------- failures

test("throws when no API key is set", async () => {
	// The module reads GOOGLE_KEY at call time; clear it so nothing satisfies it.
	delete process.env.GOOGLE_KEY;
	mockFetch({ files: [] });

	await assert.rejects(() => gallery(), /GOOGLE_KEY/);
});

test("throws on a non-OK files.list response", async () => {
	mockFetch({}, { ok: false, status: 403, statusText: "Forbidden" });

	await assert.rejects(() => gallery(), /403/);
});

test("throws on a 200 that lists no files — a folder gone non-public looks like this", async () => {
	// Drive answers files.list on a folder the key can no longer read with
	// `200 {"files": []}`, and a key consumer cannot even ask permissions.list
	// why. Left unguarded that is a blank gallery on a green build. The guard is
	// this site's, not the transport's: `fetchPhotos` returns [] for an empty
	// folder because "empty" is legal in general, and only this site knows Annie
	// never empties hers.
	mockFetch({ files: [] });

	await assert.rejects(() => gallery(), /empty/i);
});

test("throws on a 200 with no files key at all", async () => {
	mockFetch({});

	await assert.rejects(() => gallery(), /empty/i);
});

// ------------------------------------------------------------------------ src

test("src is the file's webContentLink with the &v=modifiedTime cache-buster", async () => {
	mockFetch({
		files: [
			file("1 - x.jpg", {
				id: "abc123",
				modifiedTime: "2024-05-01T10:00:00.000Z",
			}),
		],
	});

	const { photos } = await gallery();
	const { src } = photos[0];

	assert.ok(src.startsWith("https://drive.google.com/uc?id=abc123"));
	assert.ok(
		src.includes(`v=${encodeURIComponent("2024-05-01T10:00:00.000Z")}`),
		"src carries the modifiedTime cache-buster",
	);
});

test("src carries no API key — eleventy-img hashes it into every filename", async () => {
	// A key in the src is a key in the name of every rendition in dist/img/, so
	// rotating it renames and re-transcodes the lot.
	mockFetch({ files: [file("1 - x.jpg")] });

	const { photos } = await gallery();

	assert.ok(!photos[0].src.includes("test-key"), "no key value in the src");
	assert.ok(!photos[0].src.includes("key="), "no key parameter at all");
});

test("throws rather than falling back to a key-bearing URL when webContentLink is missing", async () => {
	mockFetch({ files: [file("1 - x.jpg", { webContentLink: undefined })] });

	await assert.rejects(() => gallery(), /webContentLink/);
});

// -------------------------------------------------------------- the warning

test("a skipped HEIC/HEIF is warned about by name", async () => {
	// `buildGallery` returns the skipped names rather than warning itself, so it
	// is this module that owns the console — and a listing whose files are all
	// skipped is still a non-empty listing, so the hard fail above stays quiet.
	const warnings = captureWarnings();

	mockFetch({
		files: [
			file("a.heic", { mimeType: "image/heic" }),
			file("b.heif", { mimeType: "image/heif" }),
			file("1 - c.jpg", { mimeType: "image/jpeg", description: "kept" }),
		],
	});

	const { photos } = await gallery();

	assert.equal(photos.length, 1);
	assert.equal(warnings.length, 2);
	assert.ok(
		warnings.some((w) => w.includes("a.heic")),
		"warns naming a.heic",
	);
	assert.ok(
		warnings.some((w) => w.includes("b.heif")),
		"warns naming b.heif",
	);
});

// ------------------------------------------------------------------- fixtures

test("FIXTURE_DATA reads the checked-in payload through the same normaliser", async () => {
	// No network, and no faked Response — the fixture is a raw files.list body,
	// so it goes straight through normalisePhotos. The src is the only thing that
	// differs from the live path: local files, not Drive URLs.
	process.env.FIXTURE_DATA = "1";
	globalThis.fetch = async () => {
		throw new Error("the fixture path must not touch the network");
	};

	const { photos, rows } = await gallery();

	assert.ok(photos.length > 0, "the fixture folder is not empty");
	assert.ok(rows.length > 0);
	for (const photo of photos) {
		assert.match(photo.src, /^\.\/tests\/fixtures\/gallery-images\//);
		assert.ok(photo.caption.length > 0);
		assert.ok(photo.ratio > 0);
	}
});

test("the GOOGLE_KEY guard fires on the live path only — the fixture build has no key", async () => {
	// The guard sits BELOW the fixture branch, and that ordering is load-bearing
	// rather than incidental: `npm run build:fixture` and the whole Playwright
	// suite run with no GOOGLE_KEY at all (README's testing table says so). Hoist
	// the guard above the branch and nothing errors here — it breaks only on a
	// machine that has no key, which is every machine except a developer's.
	delete process.env.GOOGLE_KEY;
	process.env.FIXTURE_DATA = "1";
	globalThis.fetch = async () => {
		throw new Error("the fixture path must not touch the network");
	};

	const { photos } = await gallery();

	assert.ok(photos.length > 0, "the fixture payload loaded without a key");
});
