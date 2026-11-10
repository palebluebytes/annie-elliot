/**
 * What the events page shows of a calendar: the order the events appear in,
 * formatted for display, split into upcoming and past.
 *
 * Pure, with both ambient things — the clock and the zone to guess — passed in
 * as arguments. `src/_data/calendar.js` keeps the source resolution that reads
 * the environment, and supplies the instant and the fallback.
 */

import { formatForDisplay, partition } from "./event-display.js";

/**
 * @param {object[]} events Normalised events, as
 *   `@palebluebytes/cms/calendar/google` returns them, in any order.
 * @param {Date} now The instant future and past are measured from.
 * @param {{fallbackTimeZone: string}} options The zone a timed event carrying
 *   none is formatted in. The package returns `undefined` rather than guessing
 *   for everyone, so the guess is the caller's — "Europe/London" here.
 * @returns {{futureEvents: object[], pastEvents: object[]}}
 */
export function buildEvents(events, now, { fallbackTimeZone }) {
	const displayed = [...events]
		// ISO strings sort as dates — one reason the package returns strings and
		// not `Date`s. Sort while `start` is still ISO, before formatting. The copy
		// keeps the sort off the caller's array.
		.sort((a, b) => a.start.localeCompare(b.start))
		.map((event) => formatForDisplay(event, { fallbackTimeZone }));

	return partition(displayed, now);
}
