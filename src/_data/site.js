/**
 * The site's identity — the one module that knows where this site lives, what
 * the book is called and who wrote it. Nothing else may hold a second copy.
 *
 * It used to be held twice: `_data/metadata.js` carried a global `canonical`
 * and `_lib/structuredData.js` a module-level `siteUrl` plus a read of
 * `package.json`. Two modules claiming the same fact is a leaky seam, and the
 * wrong canonicals on three pages were its symptom — the global `canonical` was
 * always truthy, so the layout's `|| host + page.url` fallback could never fire.
 * A page's canonical is now derived in exactly one place,
 * `eleventyComputed.canonical` in `src/src.11tydata.js`.
 *
 * `default` only: an Eleventy `_data/*.js` module with any other export is
 * handed to templates as the whole module namespace, and `$data.site` silently
 * becomes `{ default, … }`. See AGENTS.md.
 */
export default {
	/** The host, no trailing slash — every canonical is this plus `page.url`. */
	url: "https://annieelliot.co.uk",

	/** `og:site_name`, and the display name in the `WebSite` schema. */
	name: "Annie Elliot",

	/** The description a page falls back to when it declares none of its own. */
	description:
		"A website for the novel Mr & Mrs Charles Dickens: Her Story by the author Annie Elliot",

	keywords: [
		"annie elliot",
		"charles dickens",
		"book",
		"novel",
		"author website",
		"literary fiction",
	],

	/** The book's full title, as it is printed and as the `Book` schema names it. */
	bookTitle: "Mr & Mrs Charles Dickens: Her Story",

	/**
	 * Site-root-relative path to the share card. No page renders it — the cover
	 * on the home page is inline SVG — so this is purely what `og:image`,
	 * `twitter:image` and the `Book` schema point at. See AGENTS.md: change the
	 * SVG and this raster twin goes stale silently.
	 */
	coverImage: "/images/book-cover.jpg",

	author: {
		name: "Annie Elliot",
		bio: "Annie Elliot is the author of Mr & Mrs Charles Dickens, Her Story. She has an MA in Creative Writing and a BA (Hons) in Literary Studies.",
	},
};
