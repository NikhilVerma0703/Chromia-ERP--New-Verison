// The design-name list as the server reads it (scripts/0115). The rules are
// in ./rules.ts; this file only reads the table and runs them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { ttlMemo } from "@/lib/ttlMemo";
import { FG_COLOURS } from "@/lib/commercial/fg-colour-codes";
import { checkDesign, currentDesignName, pickerOptions, withAka, type DesignCheck, type ListedDesign } from "./rules";

const db = prisma as any;

async function readList(): Promise<ListedDesign[]> {
  const rows: { id: string; name: string; isTrial: boolean; isActive: boolean }[] = await db.designName.findMany({
    select: { id: true, name: true, isTrial: true, isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, isTrial: r.isTrial, isActive: r.isActive }));
}

// A minute: a name a manager adds shows in the dropdowns of other servers
// within that, and a save never waits on it — designCheck below reads the
// table again before it refuses anything.
const cached = ttlMemo(60_000, readList);

/** Every name, retired ones included (isActive false). */
export async function designList(): Promise<ListedDesign[]> {
  return cached();
}

/** The active names, in picker order — what a dropdown offers. */
export async function designNameOptions(): Promise<string[]> {
  try {
    return pickerOptions(await designList()).map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * The check every write path runs (rules.checkDesign). A name the cached list
 * does not know is looked up again before it is refused, so a name added a
 * moment ago on another server is not turned away.
 */
export async function designCheck(value: unknown, stored?: unknown): Promise<DesignCheck> {
  // A blank design, or an old row's name sent back unchanged, needs no list:
  // answered before the table is read, so a save that does not choose a
  // design never fails because the list could not be read.
  const quick = checkDesign(value, [], stored);
  if (quick.ok) return quick;
  const first = checkDesign(value, await designList(), stored);
  if (first.ok) return first;
  return checkDesign(value, await readList(), stored);
}

/**
 * Old rows' design names as they are called now (rules.currentDesignName):
 * "Carrara Cloud" on an MIS hour of August reads Soneva. Read once a minute,
 * like the list; when the tables cannot be read, every name stays as written.
 */
const resolver = ttlMemo(60_000, async () => {
  const [picker, all] = await Promise.all([designPickerList(), readList()]);
  return currentDesignName(picker, all);
});
export async function designNameNow(): Promise<(raw: unknown) => string> {
  try {
    return await resolver();
  } catch {
    return (raw) => String(raw ?? "").trim();
  }
}

/**
 * The picker's list: active names with their other spellings — the merges
 * that file a spelling under the name, the FG code list's names that carry
 * the same code as the name, and the name's alternate names on Design codes
 * (rules withAka). Search words only: the picker saves the name itself.
 */
export async function designPickerList(): Promise<ListedDesign[]> {
  const [list, aliases, master] = await Promise.all([
    readList(),
    db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
    db.commercialDesignCode.findMany({ select: { design: true, code: true, alternateNames: true } }).catch(() => []),
  ]);
  return withAka(list, { aliases, master, fg: FG_COLOURS });
}
