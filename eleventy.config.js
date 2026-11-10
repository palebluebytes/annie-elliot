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
		widths: [400, 640, 800, 1200, "auto"],
		sharpWebpOptions: {
			quality: 78,
			effort: 5,
		},
		sharpJpegOptions: {
			quality: 78,
			mozjpeg: true,
		},

		defaultAttributes: {
			loading: "lazy",
			decoding: "async",
			sizes: "(max-width: 600px) 100vw, (max-width: 960px) 50vw, 600px",
		},
	});

	eleventyConfig.addPassthroughCopy({ "src/static/fonts": "fonts" });
	eleventyConfig.addPassthroughCopy({ "src/static/images": "images" });
	eleventyConfig.addPassthroughCopy({ "src/static/favicon": "favicon" });
	eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
}

export const config = {
	dir: {
		input: "src",
		output: "dist",
		includes: "_includes",
		layouts: "_layouts",
	},
};
