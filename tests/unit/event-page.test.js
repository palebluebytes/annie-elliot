import test from "node:test";
import assert from "node:assert/strict";

import { buildEvents } from "../../src/_lib/event-page.js";

// What this SITE does with a normalised calendar: the order the events page
// renders them in, the zone it falls back to, and the split into upcoming and
// past around a given instant.
//
// Plain objects in, plain objects out, with the clock passed as an argument —
// no `globalThis.fetch` and no `process.env`. Which calendar the events came
// from is `src/_data/calendar.js`'s business and is tested in
// tests/unit/calendar.test.js; the formatting and the partition have their own
// direct tests in tests/unit/event-display.test.js.

// A normalised timed event, as `@palebluebytes/cms/calendar/google` returns it.
// `kind: "instant"` because the string carries an offset.
function event(summary, start, extra = {}) {
	return {
		id: `id-${summary}`,
		summary,
		description: `${summary} description`,
		location: "Somewhere",
		kind: "instant",
		isMultiDay: false,
		start,
		end: start,
		timeZone: "Europe/London",
		...extra,
	};
}

const NOW = new Date("2050-01-01T00:00:00Z");
const options = { fallbackTimeZone: "Europe/London" };

test("events partition into future and past around the given instant", () => {
	const { futureEvents, pastEvents } = buildEvents(
		[
			event("Long ago", "2019-03-04T19:00:00+00:00"),
			event("Far off", "2099-03-04T19:00:00+00:00"),
		],
		NOW,
		options,
	);

	assert.deepEqual(
		futureEvents.map((e) => e.summary),
		["Far off"],
	);
	assert.deepEqual(
		pastEvents.map((e) => e.summary),
		["Long ago"],
	);
});

test("events are ordered by start, whatever order the calendar returned them in", () => {
	// ISO strings sort as dates, which is why the sort happens while `start` is
	// still ISO — before formatForDisplay turns it into "Wednesday, 4 March".
	const { futureEvents } = buildEvents(
		[
			event("Third", "2099-05-04T19:00:00+00:00"),
			event("First", "2099-03-04T19:00:00+00:00"),
			event("Second", "2099-04-04T19:00:00+00:00"),
		],
		NOW,
		options,
	);

	assert.deepEqual(
		futureEvents.map((e) => e.summary),
		["First", "Second", "Third"],
	);
});

test("sorting leaves the caller's array alone", () => {
	const events = [
		event("Third", "2099-05-04T19:00:00+00:00"),
		event("First", "2099-03-04T19:00:00+00:00"),
	];

	buildEvents(events, NOW, options);

	assert.deepEqual(
		events.map((e) => e.summary),
		["Third", "First"],
		"the input is not re-ordered under the caller",
	);
});

test("no events is two empty sections, not a crash", () => {
	const { futureEvents, pastEvents } = buildEvents([], NOW, options);

	assert.deepEqual(futureEvents, []);
	assert.deepEqual(pastEvents, []);
});

test("a timed event with no zone of its own is formatted in the fallback zone", () => {
	// The fallback the calendar transport deliberately does not have: it returns
	// `timeZone: undefined` rather than guessing for everyone, so the guess is
	// made by the caller and arrives here as an argument.
	const { futureEvents } = buildEvents(
		[
			event("Summer evening", "2099-07-04T19:00:00+00:00", {
				timeZone: undefined,
			}),
		],
		NOW,
		options,
	);

	// 19:00Z in July is 20:00 in London.
	assert.equal(futureEvents[0].start, "Saturday, 4 July 2099 at 20:00");
});

test("the page's display fields are all present on every event", () => {
	const { futureEvents } = buildEvents(
		[event("Reading", "2099-03-04T19:00:00+00:00")],
		NOW,
		options,
	);
	const [e] = futureEvents;

	assert.equal(e.summary, "Reading");
	assert.equal(e.description, "Reading description");
	assert.equal(e.location, "Somewhere");
	assert.equal(e.start, "Wednesday, 4 March 2099 at 19:00");
	assert.equal(e.isMultiDay, false);
	// The JSON-LD's inputs — see src/_lib/structuredData.js.
	assert.equal(e.startDateTime, "2099-03-04T19:00:00+00:00");
	assert.equal(e.endDateTime, "2099-03-04T19:00:00+00:00");
});
