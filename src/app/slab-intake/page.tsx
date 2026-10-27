import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { slabIntakeGate } from "@/lib/inventory/intakeGate";
import { prisma } from "@/lib/prisma";
import { designPickerList } from "@/lib/designList/server";
import { SlabIntakeForm } from "./SlabIntakeForm";
import { canonThickness } from "@/lib/thickness";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;

/**
 * Slab intake — the form for the three named intake people (and admins) to add
 * slabs finished goods is missing (already-made stock, Chromia printed slabs)
 * and to check/override the details on slabs it already has.
 *
 * THE GATE IS RE-CHECKED HERE even though middleware already admitted the
 * request: middleware stops a request at the path, this stops a direct render,
 * and each is useless on its own the day the other is edited. A refusal goes
 * home ("/"), which middleware answers with the refused login's own home page
 * — a UI condition is not an authorisation, and every action in actions.ts
 * re-checks the same gate again for itself.
 *
 * The datalists are read here, server-side, so the form offers the values the
 * inventory actually holds rather than a hardcoded list that drifts (the
 * lesson /api/inventory/filters records). Designs are the design-name list
 * (lib/designList), the only names the save accepts.
 */
export default async function SlabIntakePage() {
  const gate = await slabIntakeGate();
  if (!gate.ok) redirect(gate.status === 401 ? "/login" : "/");

  // groupBy, not findMany({distinct}) — Prisma does not push `distinct` down to
  // SQL (see /api/inventory/filters). qualityIssue is an ARRAY column, which
  // groupBy cannot unnest, so that one is real SQL.
  const by = (field: string) =>
    db.finishedSlab.groupBy({ by: [field], where: { [field]: { not: null } }, _count: { _all: true } }).catch(() => []);
  const [polishRows, thicknessRows, bayRows, issueRows, designs] = await Promise.all([
    by("polishType"), by("slabThickness"), by("bayNumber"),
    db.$queryRaw`SELECT DISTINCT unnest(quality_issue) AS issue FROM fg_finished_slab`.catch(() => []),
    designPickerList().catch(() => []),
  ]);

  const clean = (rows: any[], field: string): string[] =>
    [...new Set(rows.map((r) => r[field]).filter((v: unknown): v is string => typeof v === "string" && v.trim() !== ""))];

  const lists = {
    // The design-name list, which is all the save accepts (lib/designList).
    designs,
    issues: clean(issueRows as any[], "issue").sort((a, b) => a.localeCompare(b)),
    polishTypes: clean(polishRows, "polishType").sort((a, b) => a.localeCompare(b)),
    // One suggestion per thickness: "1.2 cm" and "12mm" are both "12 mm" (the
    // save canonicalises); combined values pass through as they are.
    thicknesses: [...new Set(clean(thicknessRows, "slabThickness").map((t) => canonThickness(t) || t))].sort((a, b) => a.localeCompare(b)),
    bays: clean(bayRows, "bayNumber").sort((a, b) => a.localeCompare(b)),
  };

  return (
    <Shell>
      <SlabIntakeForm lists={lists} />
    </Shell>
  );
}
