// THE DESIGN-NAME LIST — pure, and it imports nothing, so `node --test` loads
// it bare (the same reason lib/roles.ts and inventory/designSuggest.ts import
// nothing).
//
// The owner, 8 Oct 2026: "wherever they are giving design names in forms make
// it strictly dropdown anything else they want to entre they tell the manager
// and he can add it in a name list (like we have made in commercial but here
// without codes add these fields here tho (non mandatory) filler type (quartz,
// cristobalite, glass , mix), grit type (quartz, cristobalite, glass , mix)
// and grit size, filler size".
//
// THE RULE, server side and on every form that names a design:
//   - a name on the list is saved in the list's spelling ("simply white" is
//     saved "Simply White");
//   - a name not on the list is refused, with who to ask;
//   - an edit that leaves a row's old name as it was is not refused, so a row
//     entered before the list existed can still be corrected for something
//     else. Changing it means picking from the list.
// The table is scripts/0115; managers keep it on /designs.

/** Filler and grit are each one of these, or not recorded. */
export const MATERIAL_TYPES = ["Quartz", "Cristobalite", "Glass", "Mix"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export interface ListedDesign {
  id?: string;
  name: string;
  isTrial?: boolean;
  /** Absent means active. */
  isActive?: boolean;
  /** Other spellings that find this name in the picker: its merges, and the
   *  FG code list's names that carry the same code ("Carrara Cloud" finds
   *  Soneva). Search words only; they are never saved. */
  aka?: readonly string[];
}

/** Capitals, letters and digits only — the fold the stock register, the
 *  approvals and the Salesforce codes use (inventory/designSuggest foldName),
 *  and the list's unique key. */
export function designKey(name: unknown): string {
  return String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * THE PRODUCTION FORMS' DESIGN FIELD, by table. The station forms, the table
 * editor and the MIS sheet all save through tables/actions createRow/saveRow,
 * which check this field. Left out on purpose: the Airtable mirrors with no
 * form (production report, RM sheet, slab-wise inventory, inventory), the vein
 * and GEV program names, and Chromia's print-file names.
 */
export const DESIGN_LIST_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  Press: "designName",
  Distributor: "designName",
  Kreos: "designName",
  Oven: "designName",
  Jot: "designName",
  Robot: "designName",
  ChangeParametersPress: "designName",
  ChangeParametersDistributor: "designName",
  ChangeParametersKreos: "designName",
  ChangeParametersOven: "designName",
  ChangeParametersRobot: "designName",
  PolishEntry: "design",
  PolishQc: "design",
  Mis: "design",
});

export function designFieldOf(model: string): string | null {
  return Object.prototype.hasOwnProperty.call(DESIGN_LIST_FIELDS, model) ? DESIGN_LIST_FIELDS[model]! : null;
}

const active = (d: ListedDesign) => d.isActive !== false;

/** The list's spelling of a name, or null when no active name on the list
 *  folds to it. */
export function listSpelling(value: unknown, list: readonly ListedDesign[]): string | null {
  const key = designKey(value);
  if (!key) return null;
  return list.find((d) => active(d) && designKey(d.name) === key)?.name ?? null;
}

export function notOnListMessage(value: string): string {
  return `“${value}” is not on the design-name list. Pick a design from the list, or ask your line manager to add it on the Design names page.`;
}

export type DesignCheck = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * The one check every write path runs. `stored` is what the row holds now
 * (undefined for a new row): an edit that sends it back unchanged is not a
 * choice of design and is let through as it stands.
 *
 * AN ALTERNATE NAME IS NOT A NAME ON THE LIST (owner, 20 Oct 2026: "only for
 * search not for saving"). Only `name` is matched, never `aka`, so a design's
 * alternate name or merged spelling typed into a form is refused here; the
 * picker turns it into the design's own name before it is sent (DesignSelect
 * settles on the one match). Either way the primary name is what is stored.
 */
export function checkDesign(value: unknown, list: readonly ListedDesign[], stored?: unknown): DesignCheck {
  const typed = String(value ?? "").trim();
  if (!typed) return { ok: true, value: null };
  const spelt = listSpelling(typed, list);
  if (spelt) return { ok: true, value: spelt };
  if (stored !== undefined && stored !== null && String(stored).trim() === typed) return { ok: true, value: String(stored) };
  return { ok: false, error: notOnListMessage(typed) };
}

/** The names a picker offers: active ones, trials last, each group A–Z. */
export function pickerOptions(list: readonly ListedDesign[]): ListedDesign[] {
  return list
    .filter(active)
    .slice()
    .sort((a, b) => Number(!!a.isTrial) - Number(!!b.isTrial) || a.name.localeCompare(b.name));
}

/**
 * A design as it is called NOW, for reports that read old rows (owner, 26 Oct
 * 2026, on the downtime card's "Carrara Cloud": "we changed the name of it to
 * Soneva and the alternate name is carrara cloud"). `picker` is withAka's list:
 * the active names with their other spellings (merges, same-code FG names,
 * alternate names on Design codes); `all` is every name, retired included.
 *   - a name on the list, in any capitals, is that name as the list spells it;
 *   - a spelling that is another spelling of exactly ONE active name is that
 *     name ("Carrara Cloud" → Soneva, "CARRARACLOUD" → Soneva);
 *   - a retired name nothing else claims stays itself, as the list spells it;
 *   - anything else (blank, a spelling two names share, a name nobody knows)
 *     is returned as given.
 * Compared folded (designKey), as the picker searches.
 */
export function currentDesignName(picker: readonly ListedDesign[], all: readonly ListedDesign[] = picker): (raw: unknown) => string {
  const active = new Map<string, string>();
  for (const d of picker) active.set(designKey(d.name), d.name);
  const claimed = new Map<string, Set<string>>();
  for (const d of picker) {
    for (const a of d.aka ?? []) {
      const k = designKey(a);
      if (!k || active.has(k)) continue;
      let s = claimed.get(k);
      if (!s) claimed.set(k, (s = new Set()));
      s.add(d.name);
    }
  }
  const anyName = new Map<string, string>();
  for (const d of all) if (!anyName.has(designKey(d.name))) anyName.set(designKey(d.name), d.name);
  return (raw) => {
    const typed = String(raw ?? "").trim();
    const k = designKey(typed);
    if (!k) return typed;
    const now = active.get(k);
    if (now) return now;
    const by = claimed.get(k);
    if (by && by.size === 1) return [...by][0];
    return anyName.get(k) ?? typed;
  };
}

/** "Contains", on the name and its other spellings, ignoring capitals,
 *  spaces and punctuation: "carrara cloud" and "CARRARACLOUD" both find
 *  Soneva. An empty query keeps the whole list. */
export function pickerMatches(query: string, options: readonly ListedDesign[]): ListedDesign[] {
  const q = designKey(query);
  if (!q) return options.slice();
  return options.filter((o) => designKey(o.name).includes(q) || (o.aka ?? []).some((a) => designKey(a).includes(q)));
}

/** The other spelling that matched, to show beside the name ("Soneva — also
 *  Carrara Cloud"), or null when the name itself matched. */
export function matchedAka(query: string, option: ListedDesign): string | null {
  const q = designKey(query);
  if (!q || designKey(option.name).includes(q)) return null;
  return (option.aka ?? []).find((a) => designKey(a).includes(q)) ?? null;
}

/**
 * The picker's list: the active names, in picker order, each with its other
 * spellings as search words —
 *   - the spellings merged into it (fg_design_alias);
 *   - the FG code list's names that carry the same code (its master row's
 *     code, else the list's own code for the name);
 *   - its ALTERNATE NAMES on Design codes (owner, 20 Oct 2026: "add an
 *     alternate name filed also in … designs but only for search not for
 *     saving into the actual DB"), read off the master row that folds alike,
 *     or off the row of a spelling merged into it.
 * Search words only: the picker saves the option's own name, and checkDesign
 * refuses a typed word that is not a name on the list.
 */
export function withAka(
  list: readonly ListedDesign[],
  from: {
    aliases: readonly { variant: string; canonical: string }[];
    master: readonly { design: string; code: string | null; alternateNames?: readonly string[] | null }[];
    fg: readonly { name: string; code: string }[];
  },
): ListedDesign[] {
  const aka = new Map<string, Set<string>>();
  const add = (key: string, spelling: string) => {
    if (!key || designKey(spelling) === key) return;
    let s = aka.get(key);
    if (!s) aka.set(key, (s = new Set()));
    s.add(spelling.trim());
  };
  const canonOf = new Map<string, string>();
  for (const a of from.aliases) {
    add(designKey(a.canonical), a.variant);
    canonOf.set(designKey(a.variant), designKey(a.canonical));
  }
  const codeOf = new Map<string, string>();
  for (const m of from.master) if (m.code) codeOf.set(designKey(m.design), m.code);
  for (const f of from.fg) if (!codeOf.has(designKey(f.name))) codeOf.set(designKey(f.name), f.code);
  const byCode = new Map<string, string[]>();
  for (const f of from.fg) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f.name]);
  for (const d of list) {
    const code = codeOf.get(designKey(d.name));
    for (const n of code ? byCode.get(code) ?? [] : []) add(designKey(d.name), n);
  }
  for (const m of from.master) {
    const key = designKey(m.design);
    const canon = canonOf.get(key);
    for (const n of m.alternateNames ?? []) {
      add(key, n);
      if (canon) add(canon, n);
    }
  }
  return pickerOptions(list).map((d) => ({ ...d, aka: [...(aka.get(designKey(d.name)) ?? [])].sort() }));
}

// ─────────────────────────── the manager's form ───────────────────────────

export interface DesignNameInput {
  name: string;
  isTrial: boolean;
  fillerType: MaterialType | null;
  gritType: MaterialType | null;
  fillerSize: string | null;
  gritSize: string | null;
  notes: string | null;
}

const squash = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
};

function material(v: unknown, label: string): { ok: true; value: MaterialType | null } | { ok: false; error: string } {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, value: null };
  const hit = MATERIAL_TYPES.find((m) => m.toLowerCase() === s.toLowerCase());
  return hit ? { ok: true, value: hit } : { ok: false, error: `${label} must be ${MATERIAL_TYPES.join(", ")} or left blank.` };
}

/**
 * A new name, or the fields of one already on the list. The name itself is
 * set once: a name is retired, never renamed, because every row that carries
 * it would keep the old spelling and fall off the list.
 */
export function parseDesignName(body: unknown, mode: "create" | "update"):
  | { ok: true; data: Partial<DesignNameInput> & { isActive?: boolean } }
  | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const data: Partial<DesignNameInput> & { isActive?: boolean } = {};
  if (mode === "create") {
    const name = squash(b.name, 80);
    if (!name || !designKey(name)) return { ok: false, error: "Type the design name." };
    data.name = name;
  }
  const has = (k: string) => mode === "create" || Object.prototype.hasOwnProperty.call(b, k);
  if (has("isTrial")) data.isTrial = b.isTrial === true;
  if (has("fillerType")) { const r = material(b.fillerType, "Filler type"); if (!r.ok) return r; data.fillerType = r.value; }
  if (has("gritType")) { const r = material(b.gritType, "Grit type"); if (!r.ok) return r; data.gritType = r.value; }
  if (has("fillerSize")) data.fillerSize = squash(b.fillerSize, 40);
  if (has("gritSize")) data.gritSize = squash(b.gritSize, 40);
  if (has("notes")) data.notes = squash(b.notes, 300);
  if (mode === "update" && Object.prototype.hasOwnProperty.call(b, "isActive")) data.isActive = b.isActive === true;
  return { ok: true, data };
}

/** Why a new name cannot be added, or null. `all` includes retired names: a
 *  retired name is restored, not added again. */
export function addRefusal(name: string, all: readonly ListedDesign[]): string | null {
  const key = designKey(name);
  const twin = all.find((d) => designKey(d.name) === key);
  if (!twin) return null;
  return twin.isActive === false
    ? `“${twin.name}” is already on the list, retired. Restore it instead of adding it again.`
    : `“${twin.name}” is already on the list.`;
}

/** The design a spelling is merged into (fg_design_alias, compared folded),
 *  or null — a merge whose canonical folds to the same name is a case twin,
 *  not another design. */
export function mergedInto(name: string, aliases: readonly { variant: string; canonical: string }[]): string | null {
  const key = designKey(name);
  const hit = aliases.find((a) => designKey(a.variant) === key && designKey(a.canonical) !== key);
  return hit ? hit.canonical : null;
}

/** Who may add, change and retire names: an admin, or a line manager on the
 *  shop floor. Commercial keeps its own design master with codes. */
export function canManageDesignList(role: unknown, branch: unknown): boolean {
  const r = String(role ?? "");
  if (r === "ADMIN") return true;
  return r === "LINE_MANAGER" && String(branch ?? "SHOP_FLOOR") === "SHOP_FLOOR";
}
