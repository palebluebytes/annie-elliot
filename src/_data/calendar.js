import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { apiKey } from "@palebluebytes/cms/auth";
import {
	fetchEvents,
	normaliseEvents,
} from "@palebluebytes/cms/calendar/google";
import { buildEvents } from "../_lib/event-page.js";

dotenv.config();

// Like src/_data/gallery.js, this module exports ONLY `default` — and now by
// construction, because everything worth naming lives elsewhere: the transport
// and normaliser in the package, the formatting, the sort and the partition in
// src/_lib/. An Eleventy `_data/*.js` module with a second export is handed to
// templates as the whole module namespace, and every loop then renders
// "[object Object]".
//
// What is left here is SOURCE RESOLUTION, and only that: which payload the
// events come from, which credential reaches Google, which calendar, and the
// two things the display policy cannot know on its own — the clock and the zone
// to guess. Everything this site decides about the events themselves is
// `buildEvents`, which is pure and directly testable.

// Public calendar id — not secret. Mirrors gallery.js's hard-coded FOLDER_ID.
const CALENDAR_ID = "author.annie.elliot@gmail.com";

/**
 * Every event on the calendar, normalised. Under FIXTURE_DATA it comes from a
 * checked-in payload instead of the live calendar, so the visual baselines stop
 * drifting every time Annie adds an event (see
 * tests/fixtures/calendar-events.json).
 *
 * Only the FETCH is swapped — the fixture goes through the same normaliser the
 * live path runs, so the cancelled-event filter and the inclusive-end correction
 * are still exercised, and there is no `Response` to fake.
 *
 * The GOOGLE_KEY guard must stay BELOW the branch: the fixture build and the
 * Playwright suite run with no key at all. tests/unit/calendar.test.js asserts
 * that, because hoisting it breaks nothing on a machine that has a key.
 *
 * Unlike gallery.js this module reads FIXTURE_DATA once and has nothing to pair
 * it with — there is no media src on this side — so the read stays here rather
 * than being threaded in from the default export.
 */
async function load() {
	if (process.env.FIXTURE_DATA) {
		return normaliseEvents(
			JSON.parse(
				await readFile(
					new URL("../../tests/fixtures/calendar-events.json", import.meta.url),
					"utf8",
				),
			),
		);
	}

	// One Google API key serves both the Calendar and Drive APIs — they share a
	// Google Cloud project, so GOOGLE_KEY is the single key for both here and in
	// gallery.js. It is read HERE and passed in: the package reads no environment
	// on any runtime, deliberately.
	if (!process.env.GOOGLE_KEY) {
		throw new Error("GOOGLE_KEY not found in environment variables");
	}

	return fetchEvents({
		calendarId: CALENDAR_ID,
		auth: apiKey(process.env.GOOGLE_KEY),
	});
}

export default async function () {
	// The clock and the zone are arguments rather than things `buildEvents` reads
	// for itself: `new Date()` is site code by definition, and "Europe/London" is
	// this site's truth — the package returns `timeZone: undefined` rather than
	// guessing for everyone.
	return buildEvents(await load(), new Date(), {
		fallbackTimeZone: "Europe/London",
	});
}
