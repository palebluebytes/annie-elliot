/**
 * The gallery's presentation rules: which files this site shows, what it calls
 * them, and how they pack into justified rows.
 *
 * All of this is annie-elliot's, not Google's — which is why it stayed here when
 * the Drive half left for `@palebluebytes/cms`. Pure: no network, no
 * clock, no environment.
 */

// HEIC/HEIF skipped by default (browser + CI-decode risk). A site policy:
// `@palebluebytes/cms/files/google` returns every mimeType and filters
// none of them, deliberately.
export const SKIP_MIME = new Set(["image/heic", "image/heif"]);

// Leading digits + one separator (- _ . or space). Bare "01name" = no prefix.
const PREFIX_RE = /^(\d+)\s*[-_. ]\s*(.*)$/;

// The desktop container: --grid-max-width (77.5rem) less 2 x --grid-gutter
// (2.5rem at that size) = 72.5rem = 1160px at a 16px root. Row BREAKS are frozen
// at this width; the widths themselves stay fluid (each row is a flex container
// whose items carry `flex: var(--r) 1 0`), so rows remain flush and uncropped at
// every container width — measured 647-1240px in the ticket-02 prototype.
//
// This module is the one home for these numbers. The only copies left outside it
// are tests/gallery.spec.js — a deliberate independent oracle — and the two CSS
// lengths in src/reviews.webc that no JavaScript can reach (`--gap` and the
// degenerate-row cap), which `tests/unit/gallery-layout.test.js` reads out of the
// template and checks against the exports below.
export const PACK_WIDTH = 1160;
export const TARGET_ROW_HEIGHT = 352; // 22rem
export const ROW_GAP = 8; // 0.5rem — the gallery's --gap in reviews.webc

// How much taller than the target a row may get before the degenerate-gallery
// cap holds it back. Only reachable with one or two photos; see reviews.webc.
export const ROW_HEIGHT_CAP_FACTOR = 1.5;

// The two tiers the thumbnails' `sizes` declares against, as the CSS spells
// them. They used to live in the template "next to the CSS that defines them";
// they moved here when the arithmetic did, because a `sizes` string split across
// two files is a string neither file can be checked against. The CSS that still
// matches on them is the single-column tier at 39.9375rem (one pixel short of
// 40rem, deliberately) and `.photo-gallery`'s own container cap.
const PACKED_TIER = "77.5rem"; // at and above this the container IS PACK_WIDTH
const MOSAIC_TIER = "40rem"; // below this the mosaic is one full-width column

/**
 * What a thumbnail will actually be asked to fill, as a `sizes` attribute.
 *
 * The packed tier is the only one where the width is knowable in pixels: the
 * container is frozen at PACK_WIDTH there, so an item gets its share of that
 * width less the gaps its row spends. Below it the container is fluid and the
 * share is declared in `vw`; below the mosaic tier every photo is full width.
 *
 * The degenerate-gallery cap is applied here too, because it is a width the
 * browser is held to and `sizes` exists to tell the browser the truth. With a
 * single photo the share is the whole row, so the uncapped arithmetic declares
 * the full PACK_WIDTH while CSS holds the item at
 * `ROW_HEIGHT_CAP_FACTOR * TARGET_ROW_HEIGHT * ratio` — 1160px declared against
 * 354px rendered for a portrait, which pulls a rendition three times wider than
 * the slot. The cap cannot bind for the live gallery (its tallest row is ~403px
 * against the 528px ceiling), so this changes no `sizes` string that ships
 * today; it only stops lying in the state the valve exists for.
 *
 * @param {{ratio: number, rowRatioSum: number, rowCount: number}} item The
 *   item's own displayed ratio, its row's ratio sum and how many photos share
 *   the row — everything the packer knows and the browser does not.
 * @returns {string} A finished `sizes` attribute value.
 */
export function thumbnailSizes({ ratio, rowRatioSum, rowCount }) {
	const share = ratio / rowRatioSum;
	const rowWidth = PACK_WIDTH - ROW_GAP * (rowCount - 1);
	// The same bound src/reviews.webc applies as a max-width, in px.
	const capPx = ROW_HEIGHT_CAP_FACTOR * TARGET_ROW_HEIGHT * ratio;

	const packed = Math.round(Math.min(share * rowWidth, capPx));
	const fluid = Math.round(share * 100);
	// Below the packed tier the container is fluid, so the cap can only be
	// expressed against the viewport — `min()` is valid in a source-size, and the
	// lightbox's own `sizes` already relies on it. Emitted only when the cap
	// actually binds, so the shipping strings stay exactly as they were.
	const fluidClause =
		capPx < share * rowWidth
			? `min(${fluid}vw, ${Math.round(capPx)}px)`
			: `${fluid}vw`;

	return `(min-width: ${PACKED_TIER}) ${packed}px, (min-width: ${MOSAIC_TIER}) ${fluidClause}, 100vw`;
}

/**
 * Annie's ordering convention, read off the filename: an optional numeric
 * prefix, and a stem tidied into something readable enough to be a caption.
 *
 * @param {string} name
 * @returns {{order: number|null, cleaned: string}}
 */
export function parseFilename(name) {
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name; // strip extension
	const m = base.match(PREFIX_RE);
	const order = m ? parseInt(m[1], 10) : null;
	const stem = m ? m[2] : base;
	const cleaned = stem.replace(/[-_]+/g, " ").trim(); // "cleaned filename"
	return { order, cleaned };
}

/**
 * Justified-row packing (the Flickr/Google-Photos shape), O(n²) DP — 121
 * iterations for 11 photos. Minimises the sum of squared log-deviation of each
 * row's height from the target, log so "twice too tall" and "half as tall" cost
 * the same. Every row is costed INCLUDING the last, which is what makes the
 * final row come out flush and near-target instead of ragged — the map's
 * "stretch the last row, clamped to 1.5x" rule then never has to fire.
 *
 * Greedy was tried in the prototype and is worse: it commits to a locally-good
 * row that strands the tail (3+2+4+2, spread 0.90-1.31x, against DP's 3+2+3+3
 * at 1.00-1.16x).
 *
 * @param {{ratio: number}[]} items
 * @returns {{ratio: number}[][]} The same objects, grouped — never copies.
 */
export function packRows(items) {
	const count = items.length;

	// The height a row of items[from..to) would take at the packing width.
	const rowHeight = (from, to) => {
		let ratioSum = 0;
		for (let k = from; k < to; k++) ratioSum += items[k].ratio;
		return (PACK_WIDTH - ROW_GAP * (to - from - 1)) / ratioSum;
	};

	const costTo = new Array(count + 1).fill(Infinity);
	const rowStart = new Array(count + 1).fill(-1);
	costTo[0] = 0;

	for (let to = 1; to <= count; to++) {
		for (let from = 0; from < to; from++) {
			if (costTo[from] === Infinity) continue;
			const deviation = Math.log(rowHeight(from, to) / TARGET_ROW_HEIGHT);
			const cost = costTo[from] + deviation * deviation;
			if (cost < costTo[to]) {
				costTo[to] = cost;
				rowStart[to] = from;
			}
		}
	}

	const rows = [];
	for (let to = count; to > 0; to = rowStart[to])
		rows.unshift(items.slice(rowStart[to], to));
	return rows; // empty input -> [] (the reconstruction loop never runs)
}

/**
 * The packed rows with each item's geometry FINISHED — the interface the page
 * actually needs.
 *
 * `packRows` alone forced every caller to restate the packer's own numbers to
 * get anything useful out of a row: the template had to recompose `1160` and
 * `8` to turn a share back into pixels, which is how the same formula came to
 * have six holders. The width is knowable here and nowhere else, so this is
 * where the `sizes` string is built.
 *
 * @param {{ratio: number}[]} items
 * @returns {{ratio: number, sizes: string}[][]} The same objects, grouped and
 *   decorated in place — never copies.
 */
export function layOutRows(items) {
	const rows = packRows(items);

	for (const row of rows) {
		const rowRatioSum = row.reduce((total, item) => total + item.ratio, 0);
		for (const item of row) {
			item.sizes = thumbnailSizes({
				ratio: item.ratio,
				rowRatioSum,
				rowCount: row.length,
			});
		}
	}

	return rows;
}
