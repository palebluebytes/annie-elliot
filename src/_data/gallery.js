import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { apiKey } from "@palebluebytes/cms/auth";
import { fetchPhotos, normalisePhotos } from "@palebluebytes/cms/files/google";
import { buildGallery } from "../_lib/gallery-page.js";

dotenv.config();

// This module exports ONLY `default`, and now does so by construction: an
// Eleventy `_data/*.js` module with any other export is handed to templates as
// the whole module namespace, so `$data.gallery` silently becomes
// `{default, packRows}` and every loop renders "[object Object]". Everything
// worth naming lives elsewhere — the transport and normaliser in the package,
// the packer, the filename rules and the whole display policy in `src/_lib/` —
// and is imported here.
//
// What is left in this file is SOURCE RESOLUTION, and only that: which payload
// the photos come from, which credential reaches Google, which folder, when an
// answer is not believable, and where a photo's bytes live. Everything this
// site decides about the photos themselves is `buildGallery`, which is pure and
// directly testable.

// Public folder id — not secret (it's in every share URL). Mirrors calendar.js's
// hard-coded calendarId. Verified live in ticket 05.
const FOLDER_ID = "1yPcvB5KwY7XdKJN2jTyEmGfErgGagmFD";

/**
 * Every photo in the folder, normalised. Under FIXTURE_DATA it comes from a
 * checked-in payload instead of the live Drive folder, so the visual baselines
 * stop drifting every time Annie adds a photo (see
 * tests/fixtures/drive-files.json).
 *
 * Only the FETCH is swapped — the fixture goes through the same normaliser the
 * live path runs, so ratios, the rotation swap and the caption fallback are all
 * still exercised, and there is no `Response` to fake.
 */
async function load() {
	if (process.env.FIXTURE_DATA) {
		return normalisePhotos(
			JSON.parse(
				await readFile(
					new URL("../../tests/fixtures/drive-files.json", import.meta.url),
					"utf8",
				),
			),
		);
	}

	// One Google API key serves both the Drive (gallery) and Calendar APIs — they
	// share a Google Cloud project, so GOOGLE_KEY is the single key for both here
	// and in calendar.js. The key is read HERE and passed in: the package reads no
	// environment on any runtime, deliberately.
	if (!process.env.GOOGLE_KEY) {
		throw new Error("GOOGLE_KEY not found in environment variables");
	}

	const photos = await fetchPhotos({
		folderId: FOLDER_ID,
		auth: apiKey(process.env.GOOGLE_KEY),
		// Asking Drive for images only is this site's business, not the
		// package's — which returns every mimeType and filters none of them.
		// It saves a listing entry per stray file; the real filtering is below,
		// because the fixture payload never goes near a query.
		extraQuery: "mimeType contains 'image/'",
	});

	// `res.ok` is not enough, and neither is an empty list. Drive answers a
	// files.list against a folder this key can no longer read with
	// `200 {"files": []}` — a sharing change reads as a successful request that
	// found nothing, and the build would go green with a blank gallery. An
	// API-key consumer cannot even diagnose it: permissions.list rejects API keys
	// outright ("API keys are not supported by this API").
	//
	// A zero-length list is ambiguous in principle — Annie could have emptied the
	// folder — which is why `fetchPhotos` returns `[]` rather than throwing. Only
	// this site knows she never does, so the hard fail lives here.
	if (!photos.length) {
		throw new Error(
			`Drive gallery listing came back empty (HTTP 200). The folder ` +
				`${FOLDER_ID} is either empty or no longer shared with "Anyone with ` +
				`the link"; a 200 with no files is what a sharing change looks like.`,
		);
	}

	return photos;
}

/**
 * What eleventy-img is pointed at: `fixtureSrc` for the checked-in payload,
 * `driveSrc` for the live folder. Fixture photos are files in the repo, so they
 * resolve to a path rather than a Drive media URL — the transcode pipeline treats
 * both the same. One of the two is chosen ONCE below and injected into
 * `buildGallery`, which therefore reads no environment per photo.
 */
function fixtureSrc(photo) {
	return `./tests/fixtures/gallery-images/${photo.name}`;
}

/**
 * The live folder's src. It MUST NOT carry the API key. eleventy-img hashes the raw source string
 * into every output filename (`image.js` getHash() — identical bytes at
 * `?key=AAA` and `?key=BBB` produce different filenames), so a key in the URL is
 * a key in the name of every rendition in dist/img/, and rotating it renames and
 * re-transcodes the whole gallery.
 *
 * Drive's own `webContentLink` avoids that: it is credential-free, permanent,
 * deterministic from the file id, and serves the byte-identical original, which
 * is exactly what eleventy-img wants. It is public-link-only — it ignores an
 * Authorization header entirely — which is fine because this folder is public
 * and the API-key listing above already depends on that.
 *
 * One thing this URL does NOT do is fail when the file is unreadable: a
 * non-public id answers `200 text/html` with ~900 KB of sign-in page, and
 * eleventy-fetch throws only on `!res.ok`, so it caches that as image bytes.
 * Not guarded here, deliberately. The folder-level case — the one that would
 * otherwise go green — is caught by the empty-listing check above, and the
 * residual per-file case is already loud: sharp cannot decode HTML, so the
 * build dies (on a poisoned .cache/ entry — clear it before retrying). Catching
 * it here would mean fetching every photo's bytes ourselves at build time,
 * which is both a second download of the whole gallery and the exact traffic
 * shape that trips Google's IP-scoped anti-abuse throttle on media downloads.
 */
function driveSrc(photo) {
	if (!photo.url) {
		// Not a field-mask problem: `webContentLink` is in the package's own
		// BASE_FIELDS, always requested, and `extraFields` only adds to that. Drive
		// populates it for any file with downloadable binary content, so its
		// absence means the file has none — a Google-native Doc or a shortcut that
		// the `mimeType contains 'image/'` query should already have excluded, or
		// a file whose download the owner has restricted. Falling back to the
		// key-bearing media URL would silently reintroduce the hash hazard for one
		// photo, which is worse than stopping.
		throw new Error(
			`No webContentLink for Drive file ${photo.name} (${photo.id}) — it has ` +
				`no downloadable content (a Google-native file or a shortcut?) or ` +
				`its download is restricted. Re-upload it as a real image file.`,
		);
	}

	// Remote src: eleventy-img fetches+caches+transcodes.
	// modifiedTime = cache-buster; Drive ignores the extra parameter.
	return `${photo.url}&v=${encodeURIComponent(photo.modifiedTime)}`;
}

export default async function () {
	// Chosen once for the whole build, not re-decided per photo.
	const mediaSrc = process.env.FIXTURE_DATA ? fixtureSrc : driveSrc;

	const { photos, rows, skipped } = buildGallery(await load(), { mediaSrc });

	// The skip is `buildGallery`'s policy; saying so out loud is this module's
	// job, because a pure module cannot have a console in it.
	for (const name of skipped) {
		console.warn(`[gallery] skipping HEIC (re-export as JPEG): ${name}`);
	}

	return { photos, rows };
}
