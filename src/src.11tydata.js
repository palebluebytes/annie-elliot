import {
	jsonForScriptElement,
	structuredDataFor,
} from "./_lib/structuredData.js";

export default {
	layout: "./html.webc",
	eleventyComputed: {
		/**
		 * The single point at which a page's canonical is resolved, from `site`
		 * and the page's own URL. `html.webc` reads this one value for the
		 * canonical link, `og:url` and `twitter:url`.
		 *
		 * It has to be computed here rather than defaulted in `_data/`: Eleventy
		 * DEEP-merges the cascade, so a global `metadata.canonical` merges *under*
		 * a page's front-matter `metadata:` block instead of being replaced by it.
		 * That is how the layout's `metadata.canonical || host + page.url` became
		 * unreachable and three pages shipped the bare host as their canonical.
		 *
		 * A page may still override by declaring `metadata.canonical` in its own
		 * front matter — for a page that deliberately points elsewhere.
		 */
		canonical: (data) =>
			data.metadata?.canonical || data.site.url + data.page.url,

		/**
		 * Must be computed here, not in `_data/`. Eleventy calls a function-exported
		 * global data file ONCE for the whole build and hands it the config-API
		 * global data, not the page's data cascade — so `page`, `metadata` and
		 * `calendar` all arrive empty and every page gets a byte-identical block.
		 * `eleventyComputed` runs per page, which is what the generator needs.
		 *
		 * This is the one place the schema is serialised. `structuredDataFor`
		 * returns data; `jsonForScriptElement` spells it for a `<script>` body,
		 * escaping `<`, `>` and `&` as JSON `\uXXXX` escapes so that neither
		 * WebC's `@raw` nor a `</script>` in a calendar event can touch it. That
		 * is what retired the `unescape-json-ld` transform, which used to reverse
		 * five HTML entity classes back out of every finished page.
		 */
		structuredDataJson: (data) =>
			jsonForScriptElement(
				structuredDataFor(data.page, data.metadata, data.calendar, data.site),
			),
	},
};
