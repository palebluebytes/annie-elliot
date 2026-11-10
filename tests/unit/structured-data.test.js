import test from "node:test";
import assert from "node:assert/strict";

import {
	jsonForScriptElement,
	structuredDataFor,
} from "../../src/_lib/structuredData.js";

/**
 * A deliberately distinctive `site`, so an assertion on one of these values can
 * only pass if the module read its argument. The real identity lives in
 * `src/_data/site.js`; this module must not know it.
 */
const site = {
	url: "https://example.test",
	name: "Test Site Name",
	description: "The site-wide fallback description.",
	keywords: ["one", "two"],
	bookTitle: "A Book & Its Title",
	coverImage: "/images/cover.jpg",
	author: {
		name: "Test Author",
		bio: "Test Author writes test books.",
	},
};

const typesOf = (nodes) => nodes.map((node) => node["@type"]);

test("the home page gets Person, Book and WebSite, and no Event", () => {
	const nodes = structuredDataFor(
		{ pageType: "book" },
		{ futureEvents: [{ summary: "Reading", startDateTime: "2099-01-01" }] },
		site,
	);

	assert.ok(Array.isArray(nodes), "the interface returns data, not a string");
	assert.deepEqual(typesOf(nodes), ["Person", "Book", "WebSite"]);
});

test("the events page gets one Event per upcoming event, and no Book", () => {
	const nodes = structuredDataFor(
		{ pageType: "events" },
		{
			futureEvents: [
				{
					summary: "Bookshop Reading",
					startDateTime: "2099-03-04T19:00:00+00:00",
					endDateTime: "2099-03-04T20:30:00+00:00",
					location: "The Assembly Rooms",
				},
				{ summary: "Library Talk", startDateTime: "2099-09-21" },
			],
			pastEvents: [{ summary: "Old Reading", startDateTime: "2019-05-01" }],
		},
		site,
	);

	assert.deepEqual(typesOf(nodes), ["Person", "WebSite", "Event", "Event"]);

	const events = nodes.filter((node) => node["@type"] === "Event");
	assert.deepEqual(
		events.map((event) => event.name),
		["Bookshop Reading", "Library Talk"],
	);
	assert.equal(events[0].startDate, "2099-03-04T19:00:00+00:00");
	assert.equal(events[0].endDate, "2099-03-04T20:30:00+00:00");
	assert.equal(events[0].location["@type"], "Place");
	assert.equal(events[0].location.name, "The Assembly Rooms");
	assert.equal(
		events[0].location.address.addressLocality,
		"The Assembly Rooms",
	);

	// No end and no location of its own: no `endDate`, and `Place` named "TBA"
	// with no address.
	assert.equal("endDate" in events[1], false);
	assert.equal(events[1].location.name, "TBA");
	assert.equal("address" in events[1].location, false);
});

test("an event with no startDateTime is skipped, not emitted malformed", () => {
	const nodes = structuredDataFor(
		{ pageType: "events" },
		{
			futureEvents: [
				{ summary: "Undated Appearance" },
				{ summary: "Library Talk", startDateTime: "2099-09-21" },
			],
		},
		site,
	);

	const events = nodes.filter((node) => node["@type"] === "Event");
	assert.deepEqual(
		events.map((event) => event.name),
		["Library Talk"],
	);
});

test("every other page gets Person and WebSite, and neither Book nor Event", () => {
	const calendar = {
		futureEvents: [{ summary: "Reading", startDateTime: "2099-01-01" }],
	};

	for (const [page, metadata] of [
		["/author/", { pageType: "author" }],
		["/contact/", { pageType: "contact" }],
		["/reviews/", { pageType: "website" }],
		["/email-success/", { pageType: "website" }],
		["/email-failure/", { pageType: "website" }],
	]) {
		assert.deepEqual(
			typesOf(structuredDataFor(metadata, calendar, site)),
			["Person", "WebSite"],
			`${page} should carry Person and WebSite only`,
		);
	}
});

test("a page that declares no pageType falls back to website", () => {
	// Four pages declare a `pageType` in their front matter; `/reviews/`,
	// `/email-success/`, `/email-failure/` and `sitemap.njk` declare none, and
	// nothing in the cascade defaults it since `_data/metadata.js` was deleted.
	assert.deepEqual(
		typesOf(structuredDataFor(undefined, {}, site)),
		["Person", "WebSite"],
		"no metadata at all is still a website, not a book",
	);
	assert.deepEqual(typesOf(structuredDataFor({ title: "Reviews" }, {}, site)), [
		"Person",
		"WebSite",
	]);
});

test("the identity values come from site, not from package.json", () => {
	const nodes = structuredDataFor({ pageType: "book" }, {}, site);
	const [person, book, website] = nodes;

	assert.equal(person.name, "Test Author");
	assert.equal(person.description, "Test Author writes test books.");
	assert.equal(person.url, "https://example.test");

	assert.equal(book.name, "A Book & Its Title");
	assert.equal(book.author.name, "Test Author");
	assert.equal(book.image, "https://example.test/images/cover.jpg");

	assert.equal(website.name, "Test Site Name - A Book & Its Title");
	assert.equal(website.url, "https://example.test");
	assert.equal(website.keywords, "one, two");
	// No page description of its own: the site-wide fallback.
	assert.equal(website.description, "The site-wide fallback description.");
	assert.equal(
		JSON.stringify(nodes).includes("softwareVersion"),
		false,
		"package.json's version has no business in a book site's schema",
	);
});

test("a page's own description reaches the WebSite schema", () => {
	const [, website] = structuredDataFor(
		{ description: "What readers are saying." },
		{},
		site,
	);

	assert.equal(website.description, "What readers are saying.");
});

test("the serialised block carries no character HTML can read", () => {
	const json = jsonForScriptElement(
		structuredDataFor({ pageType: "book" }, {}, site),
	);

	// The book's title has an ampersand, so this block had one to escape.
	assert.match(json, /A Book \\u0026 Its Title/);
	for (const character of ["<", ">", "&"]) {
		assert.equal(
			json.includes(character),
			false,
			`the block should contain no literal ${character}`,
		);
	}
	assert.match(json, /^\[.*\]$/s, "and it is still a JSON array");
});

test("a hostile event summary cannot terminate the script element", () => {
	// `summary`, `description` and `location` come from a Google Calendar, so
	// this is text the site does not control.
	const hostile = "</script><img src=x onerror=alert(1)>";
	const json = jsonForScriptElement(
		structuredDataFor(
			{ pageType: "events" },
			{
				futureEvents: [
					{
						summary: hostile,
						description: `A talk about <b>Mr & Mrs</b> ${hostile}`,
						location: hostile,
						startDateTime: "2099-09-21",
					},
				],
			},
			site,
		),
	);

	assert.equal(
		/<\/script/i.test(json),
		false,
		"nothing in the block can close the element it sits in",
	);
	assert.match(json, /\\u003c\/script\\u003e/);

	// And it is still the data that was put in: escaped, not mangled.
	const event = JSON.parse(json).find((node) => node["@type"] === "Event");
	assert.equal(event.name, hostile);
	assert.equal(event.location.name, hostile);
	assert.equal(event.description, `A talk about <b>Mr & Mrs</b> ${hostile}`);
});

test("the serialised block round-trips every page's nodes", () => {
	for (const [page, metadata] of [
		["/", { pageType: "book" }],
		["/events/", { pageType: "events" }],
		["/author/", { pageType: "author" }],
		["/reviews/", {}],
	]) {
		const nodes = structuredDataFor(
			metadata,
			{ futureEvents: [{ summary: "Talk", startDateTime: "2099-09-21" }] },
			site,
		);
		assert.deepEqual(
			JSON.parse(jsonForScriptElement(nodes)),
			nodes,
			`${page} should survive serialisation unchanged`,
		);
	}
});
