/**
 * What this site shows of a Drive folder: which files make the gallery, what it
 * calls them, what order they appear in, and how the packed rows are decorated
 * for `src/reviews.webc`.
 *
 * All of it is annie-elliot's policy rather than Google's, and all of it is
 * pure: no network, no clock, no environment, no `console`. The one ambient
 * thing the policy needs — where a photo's bytes come from — arrives as the
 * injected `mediaSrc`, so this module can be called with plain objects.
 * `src/_data/gallery.js` keeps the source resolution that needs the
 * environment.
 */

import { layOutRows, parseFilename, SKIP_MIME } from "./gallery-layout.js";

/**
 * @param {object[]} photos Normalised photos, as
 *   `@palebluebytes/cms/files/google` returns them.
 * @param {{mediaSrc: (photo: object) => string}} options `mediaSrc` resolves
 *   what eleventy-img is pointed at. Injected, and chosen ONCE by the caller:
 *   it used to re-read `process.env.FIXTURE_DATA` per photo.
 */
export function buildGallery(photos, { mediaSrc }) {
	// Named and RETURNED rather than warned about from in here. The pipeline used
	// to call `console.warn` itself, which made a side effect the only evidence
	// the skip happened and cost every caller a `console` stub. Handing the names
	// back widens the interface by one field and buys a module with no side
	// effects at all — `src/_data/gallery.js` does the warning.
	const skipped = [];

	const displayed = photos
		.filter((photo) => photo.mimeType?.startsWith("image/"))
		.filter((photo) => {
			// A site policy, not Google's: the package returns every mimeType and
			// filters none of them.
			if (SKIP_MIME.has(photo.mimeType)) {
				skipped.push(photo.name);
				return false; // soft-skip, no build failure
			}
			return true;
		})
		.map((photo) => {
			const { order, cleaned } = parseFilename(photo.name);
			return {
				id: photo.id,
				// ONE never-empty field. The Drive description is the photo's text
				// alternative (ticket 05), rendered once as the figcaption — both
				// <img> tags carry alt="", which is only safe if a figcaption always
				// exists to be that alternative. `photo.caption` is already
				// non-empty (`description || name`); this refines its filename half
				// into something readable, which is a convention of this site's and
				// not of Drive's.
				caption: photo.description || cleaned || photo.caption,
				ratio: photo.ratio,
				src: mediaSrc(photo),
				_order: order,
				_name: photo.name,
			};
		})
		// Numbered first (ascending); prefix-less fall to the end, alpha by filename.
		.sort((a, b) => {
			if (a._order != null && b._order != null) return a._order - b._order;
			if (a._order != null) return -1;
			if (b._order != null) return 1;
			return a._name.localeCompare(b._name);
		})
		.map(({ _order, _name, ...item }, index) => ({ ...item, index }));

	// Each item comes back with its `sizes` attribute finished. `share`,
	// `rowCount` and `rowRatioSum` used to be set here instead, and reviews.webc
	// recomposed PACK_WIDTH and ROW_GAP to turn them back into the pixel width
	// the packer had already computed. The decoration still happens where the
	// packer is, for the same reason as before — only it knows the row, and a
	// nested `webc:for` does not keep the outer loop's variable in scope for a
	// descendant's attributes.
	const rows = layOutRows(displayed);

	// `rows` (grouped, for the mosaic) and `photos` (flat, for the lightbox and
	// the #photo-N anchors) hold the SAME objects. Load-bearing: the decoration
	// above mutates them in place and reviews.webc reads both views.
	return { photos: displayed, rows, skipped };
}
