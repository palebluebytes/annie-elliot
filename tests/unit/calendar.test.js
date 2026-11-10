import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import calendar from "../../src/_data/calendar.js";

// The Eleventy data module, which is now SOURCE RESOLUTION and nothing else:
// which payload the events come from, which credential reaches Google, and
// whether the whole listing arrives.
//
// This is the suite that has to own the ambient state — `globalThis.fetch` and
// the environment — because resolving a source is what reads it. What the site
// then DOES with the events is `src/_lib/event-page.js`, called with plain
// objects and an injected clock in tests/unit/event-page.test.js: the sort, the
// "Europe/London" fallback and the future/past split all live there now. The
// request contract and the pagination walk are tested in `@palebluebytes/cms`,
// and the formatting in tests/unit/event-display.test.js.

const realFetch = globalThis.fetch;
const realGoogleKey = process.env.GOOGLE_KEY;
const realFixtureData = process.env.FIXTURE_DATA;

function restoreEnv(name, saved) {
	if (saved === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = saved;
	}
}

// Serve the given pages in order. A page is a raw events.list body:
// `{ timeZone, items, nextPageToken }`.
function mockPages(...pages) {
	let call = 0;
	globalThis.fetch = async () => {
		const page = pages[Math.min(call++, pages.length - 1)];
		return { ok: true, status: 200, statusText: "OK", json: async () => page };
	};
}

// A timed events.list item. The dates sit in 2019 and 2099 like the fixtures
// do: this module partitions against the real `new Date()`, so a case that
// looks at a section has to be on a side that cannot flip.
function event(summary, startDateTime) {
	return {
		id: `id-${summary}`,
		status: "confirmed",
		summary,
		description: `${summary} description`,
		location: "Somewhere",
		start: { dateTime: startDateTime, timeZone: "Europe/London" },
		end: { dateTime: startDateTime, timeZone: "Europe/London" },
	};
}

beforeEach(() => {
	process.env.GOOGLE_KEY = "test-key";
	// The fixture branch short-circuits the fetch entirely; these tests are about
	// what the live branch does, so make sure a stray FIXTURE_DATA can't hide it.
	delete process.env.FIXTURE_DATA;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	restoreEnv("GOOGLE_KEY", realGoogleKey);
	restoreEnv("FIXTURE_DATA", realFixtureData);
});

// ------------------------------------------------------------------- failures

test("throws when no API key is set", async () => {
	delete process.env.GOOGLE_KEY;
	mockPages({ timeZone: "Europe/London", items: [] });

	await assert.rejects(() => calendar(), /GOOGLE_KEY/);
});

test("throws on a non-OK events.list response", async () => {
	globalThis.fetch = async () => ({
		ok: false,
		status: 403,
		statusText: "Forbidden",
		json: async () => ({}),
	});

	await assert.rejects(() => calendar(), /403/);
});

// ------------------------------------------------------------- what arrives

test("every page of the listing reaches the page, and cancelled events do not", async () => {
	mockPages(
		{
			timeZone: "Europe/London",
			items: [event("Long ago", "2019-03-04T19:00:00+00:00")],
			nextPageToken: "token-2",
		},
		{
			timeZone: "Europe/London",
			items: [
				event("Far off", "2099-03-04T19:00:00+00:00"),
				{
					...event("Cancelled", "2099-04-04T19:00:00+00:00"),
					status: "cancelled",
				},
			],
		},
	);

	const { futureEvents, pastEvents } = await calendar();

	assert.deepEqual(
		futureEvents.map((e) => e.summary),
		["Far off"],
		"the second page arrived, and its cancelled event was dropped",
	);
	assert.deepEqual(
		pastEvents.map((e) => e.summary),
		["Long ago"],
		"the first page arrived",
	);
});

test("an events.list body with no items yields empty sections, not a crash", async () => {
	mockPages({ timeZone: "Europe/London" });

	const { futureEvents, pastEvents } = await calendar();

	assert.deepEqual(futureEvents, []);
	assert.deepEqual(pastEvents, []);
});

// ------------------------------------------------------------------- fixtures

test("FIXTURE_DATA reads the checked-in payload through the same normaliser", async () => {
	// No network, and no faked Response — the fixture is a raw events.list body,
	// so it goes straight through normaliseEvents.
	process.env.FIXTURE_DATA = "1";
	globalThis.fetch = async () => {
		throw new Error("the fixture path must not touch the network");
	};

	const { futureEvents, pastEvents } = await calendar();

	// The fixtures sit in 2099 and 2019 on purpose, so the partition cannot flip
	// as real time passes.
	assert.deepEqual(
		futureEvents.map((e) => e.summary),
		["Bookshop Reading", "Literary Festival Weekend", "Library Talk"],
	);
	assert.ok(pastEvents.length > 0);

	// Google's all-day end.date is exclusive: 13th-to-17th displays as ending on
	// the 16th.
	const festival = futureEvents[1];
	assert.equal(festival.isMultiDay, true);
	assert.equal(festival.start, "Saturday, 13 June 2099");
	assert.equal(festival.end, "Tuesday, 16 June 2099");
});
