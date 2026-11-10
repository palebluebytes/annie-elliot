import pluginWebc from "@11ty/eleventy-plugin-webc";
import { eleventyImagePlugin } from "@11ty/eleventy-img";
import dotenv from "dotenv";

dotenv.config();

/** @param {import('@11ty/eleventy').UserConfig} eleventyConfig */
export default function (eleventyConfig) {
	eleventyConfig.ignores.add("*.md");

	// Add date filter for sitemap
	eleventyConfig.addFilter("date", function (date, format) {
		const d = date === "now" ? new Date() : new Date(date);
		if (format === "YYYY-MM-DD") {
			return d.toISOString().split("T")[0];
		}
		return d.toISOString();
	});

	eleventyConfig.addPlugin(pluginWebc, {
		components: [
			"./src/_components/**/*.webc",
			"npm:@11ty/eleventy-img/*.webc",
		],
	});

	eleventyConfig.setServerOptions({
		domDiff: false,
	});

	eleventyConfig.addPlugin(eleventyImagePlugin, {
		formats: ["webp", "jpeg"],
		urlPath: "/img/",
		// No "auto". That entry adds the SOURCE's own width as an extra rung, so
		// a call site that declares a ladder gets a rendition it never declared:
		// author.jpg is 2837x4256 and the build emitted a 2837w candidate of a
		// portrait that is never laid out above 540 CSS px, in both formats.
		// Source-width renditions were 11.8 MB of the gallery's 19.4 MB when
		// they were measured. The ladder is the cap, and every call site
		// overrides it to *widen*, never to narrow.
		// tests/images.spec.js guards this on every page.
		widths: [400, 640, 800, 1200],
		sharpWebpOptions: {
			quality: 78,
			effort: 5,
		},
		sharpJpegOptions: {
			quality: 78,
			mozjpeg: true,
		},

		// No default `sizes`. Every call site states its own — the separators
		// from a clamp, the portrait from the grid, the gallery from each
		// photo's share of its row — so a default here was dead weight that
		// read like a fallback: it looked as though an image could get its
		// `sizes` from the config, and none ever does.
		defaultAttributes: {
			loading: "lazy",
			decoding: "async",
		},
	});

	eleventyConfig.addPassthroughCopy({ "src/static/fonts": "fonts" });
	eleventyConfig.addPassthroughCopy({ "src/static/images": "images" });
	eleventyConfig.addPassthroughCopy({ "src/static/favicon": "favicon" });
	eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });

	// Transform to unescape JSON-LD after WebC/Eleventy processing
	eleventyConfig.addTransform("unescape-json-ld", function (content) {
		if (this.page.outputPath && this.page.outputPath.endsWith(".html")) {
			return content.replace(
				/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
				(match, p1) => {
					// Unescape common HTML entities that WebC might have injected
					const unescaped = p1
						.replace(/&amp;/g, "&")
						.replace(/&quot;/g, '"')
						.replace(/&#39;/g, "'")
						.replace(/&lt;/g, "<")
						.replace(/&gt;/g, ">");
					return `<script type="application/ld+json">${unescaped}</script>`;
				},
			);
		}
		return content;
	});
}

export const config = {
	dir: {
		input: "src",
		output: "dist",
		includes: "_includes",
		layouts: "_layouts",
	},
};
