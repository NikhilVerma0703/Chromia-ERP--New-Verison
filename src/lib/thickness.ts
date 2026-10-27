// Canonical slab-thickness handling. Nominal thickness is one of a short list of
// values; data has historically been entered inconsistently ("2cm", "2 cm",
// "20mm", "2"), so we canonicalise to a single spaced form everywhere.
// Pure module — no server imports, safe in client bundles.
//
// THIS LIST IS THE VOCABULARY, and every form's dropdown reads it (directly, or
// through lib/tables' SELECT_OPTIONS). A thickness added here has to be added
// to canonThickness in the same edit or it will not round-trip: the forms write
// through canonThickness, so a value the mapper does not recognise is stored as
// whatever was typed and then fails to match the option on the way back.
//
// "16 mm" AND NOT "1.6 cm" (owner, 2026-09-28: "add 16 mm thickness option"):
// the owner named it in millimetres and this is the plant's own word for the
// product. canonThickness folds "1.6cm", "16mm" and a bare "16" onto this one
// spelling.
//
// "12 mm" AND NO LONGER "1.2 cm" (owner, 2026-09-30: "i see a lot of 1.2cm —
// replace it from the forms and from the DB to 12mm — from the entire ERP").
// Until that day this one thickness was spelled in centimetres, the odd one out
// beside 16 mm and 7 mm. Every old spelling ("1.2 cm", "1.2cm", "1.2", "12mm",
// "12") still folds onto "12 mm", so a row that was written before the change
// and not yet rewritten by scripts/0093-thickness-12mm.sql reads correctly.
// Anything keyed on the literal ("1.2 cm" in a map, a === test, a card) had to
// change in the same commit — grep for the old spelling before adding one.

export const THICKNESS_FIELDS = new Set(["slabThickness", "thickness"]);
// 12 mm first, then 16 mm, so the list still reads ascending up to 3 cm. 7 mm
// stays last, where it has always been.
export const THICKNESS_OPTS = ["12 mm", "16 mm", "2 cm", "3 cm", "7 mm"];

/** Map any thickness spelling to one of the canonical options; unknown values pass through. */
export function canonThickness(v: unknown): string {
  if (v == null || v === "") return "";
  const raw = String(v).trim();
  const s = raw.toLowerCase().replace(/\s+/g, "");
  let n = NaN;
  const cm = s.match(/^(\d+(?:\.\d+)?)cm$/);
  const mm = s.match(/^(\d+(?:\.\d+)?)mm$/);
  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (cm) n = parseFloat(cm[1]);
  else if (mm) n = parseFloat(mm[1]) / 10;
  else if (plain) { const p = parseFloat(plain[1]); n = p >= 10 ? p / 10 : p; } // 12/20/30 => mm
  if (Number.isFinite(n)) {
    if (Math.abs(n - 0.7) < 0.05) return "7 mm";
    // "1.2 cm", "1.2cm", "12mm", "12 mm", "12" and "1.2" all land here.
    if (Math.abs(n - 1.2) < 0.05) return "12 mm";
    // 1.6 is 0.4 from its nearest neighbours either side, so the ±0.05 window
    // cannot reach 12 mm or 2 cm — "16", "16mm" and "1.6cm" all land here.
    if (Math.abs(n - 1.6) < 0.05) return "16 mm";
    if (Math.abs(n - 2) < 0.05) return "2 cm";
    if (Math.abs(n - 3) < 0.05) return "3 cm";
  }
  return raw;
}

/**
 * Every spelling in `stored` that reads as the same thickness as `want`, plus
 * `want` itself — for a filter on a free-text column that must match "12 mm",
 * "1.2 cm" and "12mm" alike. A value canonThickness does not recognise (a
 * combined "3 cm to 2 cm", a typo) matches only itself, trimmed.
 */
export function thicknessSpellings(want: string, stored: Iterable<string | null | undefined>): string[] {
  const target = canonThickness(want);
  const out = new Set<string>([want]);
  if (!target) return [...out];
  for (const v of stored) {
    if (typeof v === "string" && v !== "" && canonThickness(v) === target) out.add(v);
  }
  return [...out];
}
