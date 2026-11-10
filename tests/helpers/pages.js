// Every page the site publishes, declared rather than discovered.
//
// `tests/visual.spec.js` used to find these by scraping the homepage for
// internal links, which failed two ways that both read as green: a crawl that
// finds nothing is a suite that asserts nothing, and the baseline filenames
// were derived from the hrefs it found — so changing a nav target silently
// *renamed* a baseline instead of failing against the old one. /email-success/
// and /email-failure/ are not reachable by crawl at all (nothing links to
// them) and had to be hand-injected into the crawl's results.
//
// `name` is the visual baseline's stem: `tests/visual.spec.js-snapshots/` holds
// `<name>-<project>-linux.png`. Renaming one here orphans a committed baseline
// and silently starts asserting against a fresh capture, so don't.
export const SITE_PAGES = [
	{ name: "home", url: "/" },
	{ name: "author", url: "/author/" },
	{ name: "contact", url: "/contact/" },
	{ name: "reviews", url: "/reviews/" },
	{ name: "events", url: "/events/" },
	{ name: "email-success", url: "/email-success/" },
	{ name: "email-failure", url: "/email-failure/" },
];
