import { test, expect } from "@playwright/test";

/** Every JSON-LD node on the page, flattened out of its `<script>` arrays. */
async function readJsonLd(page) {
	const blocks = await page.$$eval(
		'script[type="application/ld+json"]',
		(scripts) =>
			scripts
				.map((s) => {
					try {
						return JSON.parse(s.innerText);
					} catch (e) {
						return null;
					}
				})
				.filter((s) => s !== null),
	);
	return blocks.flat();
}

test.describe("SEO Checks", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
	});

	test("should have correct title", async ({ page }) => {
		await expect(page).toHaveTitle(
			"Mr & Mrs Charles Dickens: Her Story | A Novel by Annie Elliot",
		);
	});

	test("should have correct meta description", async ({ page }) => {
		const metaDescription = page.locator('meta[name="description"]');
		await expect(metaDescription).toHaveAttribute(
			"content",
			/Discover the untold story of Mrs Dickens\. Annie Elliot['’]s historical novel reveals the life of Catherine Dickens, the woman behind the famous author\./,
		);
	});

	test("should have viewport meta tag", async ({ page }) => {
		const viewport = page.locator('meta[name="viewport"]');
		await expect(viewport).toHaveCount(1);
	});

	test("should have correct Open Graph tags", async ({ page }) => {
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			"content",
			"Mr & Mrs Charles Dickens: Her Story | A Novel by Annie Elliot",
		);

		await expect(
			page.locator('meta[property="og:description"]'),
		).toHaveAttribute(
			"content",
			/Discover the untold story of Mrs Dickens\. Annie Elliot['’]s historical novel reveals the life of Catherine Dickens, the woman behind the famous author\./,
		);

		await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
			"content",
			"https://annieelliot.co.uk/images/book-cover.jpg",
		);

		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			"content",
			"https://annieelliot.co.uk/",
		);
	});

	test("should include Book JSON-LD schema", async ({ page }) => {
		const schemas = await readJsonLd(page);
		const bookSchema = schemas.find((s) => s["@type"] === "Book");

		expect(bookSchema).toBeDefined();
		expect(bookSchema.name).toBe("Mr & Mrs Charles Dickens: Her Story");
		expect(bookSchema.author.name).toBe("Annie Elliot");
		expect(bookSchema.workExample.isbn).toBe("978-1784650961");
		expect(bookSchema.image).toContain("/images/book-cover.jpg");
	});

	test("should not carry Event schema on the home page", async ({ page }) => {
		const schemas = await readJsonLd(page);
		expect(schemas.filter((s) => s["@type"] === "Event")).toHaveLength(0);
	});
});

/**
 * This assertion used to sit in the home-page block above, its whole body
 * wrapped in `if ((await reviewsSection.count()) > 0)` — and the home page has
 * carried no `#reviews` since that section moved to its own page, so the test
 * passed without asserting anything. (It also looked for an `h3` reading
 * "Reviews", which exists nowhere in the repo.) Re-pointed at the page the
 * markup is actually on, with the guard removed so an absent section fails.
 */
test.describe("Reviews page markup", () => {
	test("quotes are semantic figure/blockquote/figcaption", async ({ page }) => {
		await page.goto("/reviews/");

		await expect(page.locator("h1")).toHaveText("Reader Reviews");

		const reviewsSection = page.locator("#reviews");
		await expect(reviewsSection).toBeVisible();

		const cards = reviewsSection.locator("figure.review-card");
		expect(await cards.count()).toBeGreaterThan(0);

		const first = cards.first();
		await expect(first.locator("blockquote.quote")).toBeVisible();
		await expect(first.locator("figcaption.reviewer")).toBeVisible();
	});
});

/**
 * A page's canonical, `og:url` and `twitter:url` must each name that page's own
 * URL. They were resolved three times in the layout as
 * `metadata.canonical || host + page.url`, and a global `metadata.canonical`
 * made the fallback unreachable: Eleventy deep-merges data, so a page's own
 * front-matter `metadata:` block merged *over* the global rather than replacing
 * it, and every page without its own canonical shipped the bare host. `/reviews/`,
 * `/email-success/` and `/email-failure/` all told Google they were duplicates of
 * the home page.
 *
 * The host literal here is deliberately not imported from `src/_data/site.js` —
 * this is an independent oracle, like the geometry in `tests/gallery.spec.js`.
 */
const EVERY_PAGE = [
	"/",
	"/author/",
	"/contact/",
	"/events/",
	"/reviews/",
	"/email-success/",
	"/email-failure/",
];

test.describe("Per-page canonical", () => {
	for (const url of EVERY_PAGE) {
		test(`${url} names itself, not another page`, async ({ page }) => {
			await page.goto(url);
			const own = `https://annieelliot.co.uk${url}`;

			await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
				"href",
				own,
			);
			await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
				"content",
				own,
			);
			await expect(
				page.locator('meta[property="twitter:url"]'),
			).toHaveAttribute("content", own);
		});
	}
});

/**
 * Structured data is computed per page (`src/src.11tydata.js`), so each page gets
 * a different set of schemas. It used to be computed once per build from empty
 * inputs, which put Book on all seven pages and Event on none — a green build
 * that silently published the wrong schema. These assertions are the guard.
 */
test.describe("Per-page structured data", () => {
	test("Book schema appears only on the home page", async ({ page }) => {
		for (const url of ["/author/", "/reviews/", "/contact/", "/events/"]) {
			await page.goto(url);
			const schemas = await readJsonLd(page);
			expect(
				schemas.filter((s) => s["@type"] === "Book"),
				`Book schema should not appear on ${url}`,
			).toHaveLength(0);
			// Person and WebSite are on every page.
			expect(schemas.map((s) => s["@type"])).toEqual(
				expect.arrayContaining(["Person", "WebSite"]),
			);
		}
	});

	test("events page carries an Event schema per upcoming event", async ({
		page,
	}) => {
		await page.goto("/events/");
		const events = (await readJsonLd(page)).filter(
			(s) => s["@type"] === "Event",
		);

		// The three 2099 fixture events; the 2019 ones are past and the cancelled
		// one is filtered out in calendar.js.
		expect(events.map((e) => e.name)).toEqual([
			"Bookshop Reading",
			"Literary Festival Weekend",
			"Library Talk",
		]);

		// Google's all-day `end.date` is EXCLUSIVE — the festival arrives ending on
		// the 17th — and the calendar layer steps it back, so the schema's endDate
		// is the same last day the page prints ("Tuesday, 16 June 2099").
		const festival = events[1];
		expect(festival.startDate).toBe("2099-06-13");
		expect(festival.endDate).toBe("2099-06-16");

		const reading = events[0];
		expect(reading.startDate).toBe("2099-03-04T19:00:00+00:00");
		expect(reading.location["@type"]).toBe("Place");
		expect(reading.location.name).toContain("The Assembly Rooms");
		expect(reading.organizer.name).toBe("Annie Elliot");
	});

	test("page description reaches the WebSite schema", async ({ page }) => {
		await page.goto("/events/");
		const website = (await readJsonLd(page)).find(
			(s) => s["@type"] === "WebSite",
		);
		expect(website.description).toContain("Find upcoming book events");
	});
});
