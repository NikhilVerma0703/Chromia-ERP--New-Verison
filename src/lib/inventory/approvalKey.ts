// The ONE way a (design, batch) approval key is built.
//
// Sales approval is keyed by a pair, and two places derive that pair: the gate
// that decides which slabs are withheld (getUnapprovedSlabNumbers) and the slab
// intake form, which approves the pair of a slab it saves. If those two derive
// it even slightly differently, the form writes a row the gate never looks up:
// the approval is stored, the screen says the slab was approved, and the slab
// stays hidden. That is not a loud failure — it is a lie on screen.
//
// It happened once already, over the empty string: displayBatch("") is an em
// dash, and a second implementation read "" as "-". So there is no second
// implementation any more. Both sides call this, and the tests pin every batch
// shape the plant writes.
//
// It happened a second time over CAPITAL LETTERS AND SPACES (7 Oct 2026), and
// that is what the resolver and the folded key below are for: the approval
// screen filed a slab under the name the register shows — "Tajmahal" under
// "Taj Mahal", "BRILLIANT WHITE" under "Brilliant White" — and compared that
// name with the approved list exactly, while the gate looked the RAW spelling
// up in the alias table exactly and compared that. Measured on live Neon that
// day, AVAILABLE whole slabs only: 4 slabs (Tajmahal batches 1045 and 461)
// read as approved on the screen and were withheld from Sales and the
// Salesforce stock feed; 89 more (BRILLIANT WHITE, TAJ VEIN, Tajmahal 1243 and
// 463, Ultima white) were on the feed while the screen offered them as stock
// awaiting approval; and 21 (Bellagio gold, Bellagio green, Irish blue, Robo
// trail/trial) the other way round. Two rules for one question, each wrong on
// the other's slabs. So the resolution of the design is in here now too, and
// so is the comparison.
//
// Those 21 are approved under a case twin of a merged name, which this rule
// does not read (mergeCarriesSpelling, below, says why), so the change that
// brought it in has a step that runs on Neon BEFORE it is deployed:
// scripts/approval-case-fold-carry-2026-10-07.sql copies each such approval to
// the line's name. Deployed without it, the 21 leave Salesforce on the next
// stock push.
//
// Import-free apart from displayBatch, the design resolver and the colour
// chart (all three import-free themselves), so `node --test` reaches it — same
// reason lib/roles.ts and preventiveMaintenanceShared.ts are split out.
// Relative .ts imports for the same reason.
import { displayBatch } from "../batchDisplay.ts";
import { buildDesignResolver, foldName } from "./designSuggest.ts";
import { CATALOGUE_COLOURS } from "../catalogue/colours.ts";

/** What a slab with no design at all is filed under, on both sides. */
export const NO_DESIGN = "(no design)";
/** What a slab with NO batch is filed under. An EMPTY batch is not the same
 *  thing: it goes through displayBatch like any other string. */
export const NO_BATCH = "-";

export interface ApprovalKey {
  design: string;
  batch: string;
}

/**
 * The approval key for a slab.
 *
 * `design` must already be canonical — the name designResolver() gives the raw
 * spelling. This used to say the resolution "differs between the two sites"
 * and only what follows had to agree; that is the sentence the 7 Oct bug lived
 * in (see the header). Callers holding a raw slab now use slabApprovalKey(),
 * which does both halves.
 */
export function approvalKey(canonicalDesign: string | null | undefined, batch: string | null | undefined): ApprovalKey {
  return {
    design: canonicalDesign ?? NO_DESIGN,
    // NULL means "this slab has no batch". An empty or blank string is a batch
    // that was typed and came to nothing, and displayBatch decides what that
    // reads as — do not shortcut it to NO_BATCH.
    batch: batch == null ? NO_BATCH : displayBatch(batch),
  };
}

/**
 * THE APPROVALS A MERGE CARRIES (Salesforce's REPLY-25 §4.3, 7 Oct 2026).
 *
 * Approval is looked up under the design's MERGED-INTO name (the caller's
 * canonical, above), so a merge that moved the slabs but not their approvals
 * took approved stock off sale — and off the Salesforce stock feed, which
 * withholds anything pending: the yard's "Crecendo", approved batch by batch,
 * was merged into "Crescendo" on 5 October and every one of its slabs read as
 * awaiting approval from then on. A merge therefore carries each batch the
 * variant was approved under to the canonical name. It COPIES, never moves:
 * an un-merge finds the variant's approvals where they were.
 *
 * Approval is per batch, so the copy also approves any slab of that batch
 * already typed with the canonical spelling — the same batch of the same
 * design, which is what the approval was given to.
 */
export function approvalsCarried(
  rows: ReadonlyArray<{ batch: string; design?: string }>,
  variant: string,
  canonical: string,
  by: string | null,
): Array<{ design: string; batch: string; approvedBy: string }> {
  const seen = new Set<string>();
  const out: Array<{ design: string; batch: string; approvedBy: string }> = [];
  for (const r of rows) {
    if (seen.has(r.batch)) continue;
    seen.add(r.batch);
    // The spelling the approval was stored under, which is the variant itself
    // or one of its case/space twins (see mergeCarriesSpelling).
    const from = r.design ?? variant;
    out.push({ design: canonical, batch: r.batch, approvedBy: `carried from "${from}" at merge${by ? ` by ${by}` : ""}` });
  }
  return out;
}

/**
 * WHICH STORED APPROVALS A MERGE OF `variant` CARRIES — not only the rows
 * spelt exactly like the variant.
 *
 * Since the gate resolves designs with designResolver(), a merge moves every
 * spelling the resolver now sends to the canonical — "Bellagio gold" goes with
 * "Bellagio Gold", because the resolver folds an alias's variant as well as
 * matching it exactly. Carrying only the exact spelling's approvals would take
 * the twins' approved stock off sale at the moment of the merge: the REPLY-25
 * §4.3 failure again, one capital letter over. Live Neon, 7 Oct 2026: the slab
 * intake form had stored its approvals under "Bellagio gold", the spelling the
 * yard types, long after "Bellagio Gold" was merged into Honeydew (4 July),
 * because it looked the alias up exactly.
 *
 * Both conditions, deliberately:
 *   1. the stored spelling is a spelling OF THIS VARIANT (same folded key) —
 *      so a merge never sweeps up approvals of the canonical's other variants,
 *      which would approve one design's batch on the strength of another's
 *      (133 different experiments are merged into "Trial" on live Neon);
 *   2. after the merge the resolver really does send that spelling to the
 *      canonical — a twin that folds onto a colour-chart name stays where it
 *      is ("Ultima white" is filed under the chart's "Ultima White" even
 *      though "Ultima White" is merged into Brilliant White), so its approval
 *      does not move either.
 */
export function mergeCarriesSpelling(
  stored: string,
  variant: string,
  canonical: string,
  resolveAfterMerge: (raw: unknown) => string,
): boolean {
  return (
    approvalDesignKey(stored) === approvalDesignKey(variant) &&
    approvalDesignKey(resolveAfterMerge(stored)) === approvalDesignKey(canonical)
  );
}

/** The separator the gate has always used. NUL can appear in neither a design
 *  nor a batch, so no pair of real values can collide with another pair. Built
 *  with fromCharCode rather than a string escape so that no editor, patch or
 *  copy-paste can turn it into a real control character in the source — which
 *  is exactly what happened once while writing this file. */
export const KEY_SEP = String.fromCharCode(0);

// ───────────────────── the design half, decided once ─────────────────────

export interface DesignAliasRow { variant: string; canonical: string }

/**
 * THE NAME A RAW YARD SPELLING IS FILED UNDER — for the approval screen, the
 * gate in front of Sales and the Salesforce stock feed, the slab intake form,
 * and every register that prints a design.
 *
 * buildDesignResolver's rule, fed the same way everywhere: an explicit merge
 * wins; otherwise a spelling that differs from a colour-chart name or a merge's
 * canonical only in capitals, spaces or punctuation is filed under that name;
 * otherwise a spelling that folds onto a merged variant goes where the variant
 * went. The register routes each built this inline from the same two lists,
 * and the gate did not build it at all — it looked the raw spelling up in the
 * alias table exactly — which is how the screen and the gate came to disagree.
 * Everything that decides approval builds it here, so they cannot again.
 *
 * NOT IDEMPOTENT, and nothing may treat it as if it were. "Ultima white" is
 * filed under the chart's "Ultima White", and "Ultima White" is itself merged
 * into "Brilliant White" (Varun, 3 Jul 2026), so resolving the screen's name a
 * second time lands on a different design. A name that has been resolved once
 * — a register row, a design the approval screen posts — is already the key.
 */
export function designResolver(aliases: ReadonlyArray<DesignAliasRow>): (raw: unknown) => string {
  return buildDesignResolver(aliases, [
    ...CATALOGUE_COLOURS.map((c) => c.name),
    ...aliases.map((a) => a.canonical),
  ]);
}

/**
 * The design half of the lookup: the name folded the way buildDesignResolver
 * and the Salesforce product codes fold it — capitals, spaces and punctuation
 * dropped — so "Taj Mahal", "Tajmahal" and "TAJ MAHAL" are one key.
 *
 * WHY FOLD THE KEY AS WELL AS RESOLVE THE NAME. The resolver only folds onto a
 * name the system already knows, and the approved list holds whatever spelling
 * was current when the tick was given: the intake form stored the raw spelling
 * it was handed, the screen stores the name it showed. On live Neon on 7 Oct
 * 2026 the approved list held "BRILLIANT WHITE", "TAJ VEIN", "Tajmahal" and
 * "Ultima white" rows that the screen's own register names never matched.
 * Folding both sides is what lets an approval given under one spelling of a
 * design count for every spelling of that design.
 *
 * IT JOINS SPELLINGS, NEVER DESIGNS. Every group of distinct names on live
 * Neon (slabs, approvals, merges) that this fold joins beyond capitals and
 * outer spaces was checked by hand that day — 19 groups, all one design typed
 * two ways: "Taj Mahal"/"Tajmahal", "Drift Wood"/"Driftwood", "Have Lock"/
 * "Havelock", "Honey Dew"/"Honey dew"/"Honeydew", "Mid Night"/"Midnight",
 * "Chess Board"/"Chessboard", "Aureate - A"/"Aureate-A", "Trail -1"/"Trail-1"
 * and their kin. Letters and digits are kept, so "Honeydew - A" is not
 * "Honeydew", and a merge between two genuinely different names still has to
 * be made by an administrator on Inventory → Designs.
 *
 * A name with no letter or digit in it (a lone "-") keeps itself as its key,
 * so such names never fold into one another.
 */
export function approvalDesignKey(design: string): string {
  return foldName(design) || design;
}

/** The two halves joined for a Set/Map lookup — the design half folded. */
export function approvalKeyString(k: ApprovalKey): string {
  return `${approvalDesignKey(k.design)}${KEY_SEP}${k.batch}`;
}

/**
 * The approval key of a slab as it lies in fg_finished_slab: its raw design
 * resolved, its raw batch through displayBatch. A slab with no design is filed
 * under NO_DESIGN before it is resolved, exactly as the register's
 * `coalesce(design, '(no design)')` does.
 */
export function slabApprovalKey(
  resolve: (raw: unknown) => string,
  design: string | null | undefined,
  batch: string | null | undefined,
): ApprovalKey {
  return approvalKey(resolve(design ?? NO_DESIGN), batch);
}

export interface ApprovalBook {
  /** designResolver over the aliases the book was built from. */
  resolve: (raw: unknown) => string;
  /** Where a key stands — the register's rule (approvalState below). */
  stateOf(key: ApprovalKey): "approved" | "pending" | "hidden";
}

/**
 * THE ONE ANSWER TO "IS THIS STOCK APPROVED FOR SALES", from the three tables
 * it is kept in. The approval screen (/api/inventory/summary) and the gate
 * (searchWhere.readUnapprovedPairs, which the Salesforce stock push uses
 * strictly) both build this from the same three reads and ask it the same
 * question, so a register line that reads approved is a line whose slabs Sales
 * and Salesforce see, and the reverse.
 */
export function approvalBook(input: {
  aliases: ReadonlyArray<DesignAliasRow>;
  approved: ReadonlyArray<{ design: string; batch: string }>;
  hidden: ReadonlyArray<{ design: string }>;
}): ApprovalBook {
  const resolve = designResolver(input.aliases);
  const ok = new Set<string>(input.approved.map((a) => approvalKeyString({ design: a.design, batch: a.batch })));
  const hidden = new Set<string>(input.hidden.map((h) => approvalDesignKey(h.design)));
  return {
    resolve,
    stateOf: (key) => approvalState(hidden.has(approvalDesignKey(key.design)), ok.has(approvalKeyString(key))),
  };
}

/**
 * The stored spellings that ARE this key — what an un-tick must delete. The
 * approved list can hold one approval under several spellings ("Tajmahal" from
 * the intake form, "Taj Mahal" from the screen); deleting only the spelling
 * the screen posted would leave the line approved, and the box would tick
 * itself again on the next refresh.
 */
export function sameDesignSpellings(stored: ReadonlyArray<string>, design: string): string[] {
  const k = approvalDesignKey(design);
  return [...new Set(stored.filter((s) => approvalDesignKey(s) === k))];
}

/**
 * Where a (design, batch) pair stands with Sales — the register's own rule
 * (/api/inventory/summary): `approved = designApproved && batchApproved`,
 * `pending = designApproved && !batchApproved`. A design HIDDEN by the master
 * is neither approved nor pending: nobody is asked to approve it, so it is
 * never counted as "awaiting approval".
 */
export function approvalState(designHidden: boolean, batchApproved: boolean): "approved" | "pending" | "hidden" {
  if (designHidden) return "hidden";
  return batchApproved ? "approved" : "pending";
}
