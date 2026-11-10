/**
 * Deliberately not in `src/_data/`. Every `.js` there is a data file, and one
 * exporting no `default` is handed to templates as the whole module namespace —
 * this file used to leak a `structuredData` global equal to
 * `{ getStructuredData }`. It is a helper, so it lives outside the cascade and
 * is imported explicitly by `src/src.11tydata.js`.
 */
import dotenv from "dotenv";

dotenv.config();

/**
 * Build the page's JSON-LD. Called per page from `src/src.11tydata.js`, so
 * `page`, `metadata` and `calendar` are the values from that page's data
 * cascade — `metadata` is the page's own front matter, `calendar` is the global
 * `_data/calendar.js` export (`{ futureEvents, pastEvents }`).
 *
 * The site's identity arrives as `site` (`_data/site.js`) rather than being held
 * here. This module used to keep a module-level `siteUrl` and read
 * `package.json` for the host, the description and the keywords — a second copy
 * of facts `_data/site.js` now owns.
 */
export async function getStructuredData(page, metadata, calendar, site) {
	// Prioritize metadata.pageType, fallback to checking page URL
	let pageType = metadata?.pageType;
	if (!pageType) {
		const pageUrlValue = page?.url || "";
		// Check for events page
		if (pageUrlValue.includes("/events")) {
			pageType = "events";
		} else if (
			pageUrlValue === "/" ||
			pageUrlValue === "" ||
			pageUrlValue.endsWith("/index.html")
		) {
			pageType = "book";
		} else {
			pageType = "website";
		}
	}

	const structuredData = [];

	// Person schema (Author) - for all pages
	const authorSchema = {
		"@context": "https://schema.org",
		"@type": "Person",
		name: site.author.name,
		url: site.url,
		jobTitle: "Author",
		description: site.author.bio,
		sameAs: site.url,
	};
	structuredData.push(authorSchema);

	// Book schema - for home page
	const isHomePage =
		pageType === "book" ||
		page?.url === "/" ||
		page?.url === "/index.html" ||
		!page?.url ||
		(page?.url && page.url.endsWith("/index.html"));
	if (isHomePage) {
		const bookSchema = {
			"@context": "https://schema.org",
			"@type": "Book",
			name: site.bookTitle,
			author: {
				"@type": "Person",
				name: site.author.name,
				url: site.url,
			},
			workExample: {
				"@type": "Book",
				isbn: "978-1784650961",
				bookFormat: "https://schema.org/Paperback",
			},
			image: site.url + site.coverImage,
			description:
				"The untold story of Catherine Dickens, wife of Charles Dickens, reimagining her life and marriage.",
		};
		structuredData.push(bookSchema);
	}

	// WebSite schema - for all pages
	const websiteSchema = {
		"@context": "https://schema.org",
		"@type": "WebSite",
		// An abbreviated title, agreeing with neither `site.name` nor
		// `site.bookTitle`. Left as a literal rather than quietly changing shipped
		// output; it is one for whoever rewrites this module to compose from `site`.
		name: "Annie Elliot - Mr & Mrs Charles Dickens",
		url: site.url,
		author: {
			"@type": "Person",
			name: site.author.name,
		},
		creator: {
			"@type": "Organization",
			name: "Pale Blue Bytes",
			url: "https://palebluebytes.space",
		},
		description: metadata?.description || site.description,
		...(site.keywords?.length > 0 && {
			keywords: site.keywords.join(", "),
		}),
	};
	structuredData.push(websiteSchema);

	// Event schemas - for events page
	if (pageType === "events") {
		const futureEvents = calendar?.futureEvents;

		if (Array.isArray(futureEvents)) {
			futureEvents.forEach((event) => {
				if (event.startDateTime) {
					const eventSchema = {
						"@context": "https://schema.org",
						"@type": "Event",
						name: event.summary || "Book Event",
						description:
							event.description ||
							`Book event with ${site.author.name}, author of ${site.bookTitle}`,
						startDate: event.startDateTime,
						...(event.endDateTime && { endDate: event.endDateTime }),
						location: {
							"@type": "Place",
							name: event.location || "TBA",
							...(event.location &&
								event.location !== "TBA" && {
									address: {
										"@type": "PostalAddress",
										addressLocality: event.location,
									},
								}),
						},
						organizer: {
							"@type": "Person",
							name: site.author.name,
							url: site.url + "/author/",
						},
						eventAttendanceMode:
							"https://schema.org/OfflineEventAttendanceMode",
						eventStatus: "https://schema.org/EventScheduled",
					};
					structuredData.push(eventSchema);
				}
			});
		}
	}

	return JSON.stringify(structuredData);
}
