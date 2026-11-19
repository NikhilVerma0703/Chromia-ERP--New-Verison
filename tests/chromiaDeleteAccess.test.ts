// Who may permanently delete a Chromia slab record (the owner, 19 Nov 2026):
// every Chromia login but the Chromia Operator — chromia@thepacific.group,
// role CHROMIA as its own job — who keeps Edit. The rule is pure (tier.ts), so
// it is run here for real on each login as the main ERP's session gives it;
// that the pages and both delete actions ask it is read from the source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chromiaCanDeleteSlab, chromiaTierOf, isChromiaLineOperator } from "../src/lib/chromia/tier.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* The logins as currentUser() carries them in the main ERP: the role and
   branch of the job in use, with the second job's pair alongside. */
const CHROMIA_OPERATOR = { email: "chromia@thepacific.group", role: "CHROMIA", branch: "SHOP_FLOOR", altRole: null, altBranch: null };
/** Gibin in his Chromia job: the role switcher overlays the second job's pair. */
const GIBIN_IN_CHROMIA = { email: "gibin@thepacific.group", role: "CHROMIA", branch: "SHOP_FLOOR", altRole: "CHROMIA", altBranch: "SHOP_FLOOR" };
/** …and in his main job, where the Chromia module is not his to open at all. */
const GIBIN_IN_FAB = { email: "gibin@thepacific.group", role: "LINE_MANAGER", branch: "FABRICATION", altRole: "CHROMIA", altBranch: "SHOP_FLOOR" };

test("the Chromia Operator opens the module and edits, but may not delete", () => {
  assert.equal(chromiaTierOf(CHROMIA_OPERATOR), "OPERATOR");
  assert.equal(isChromiaLineOperator(CHROMIA_OPERATOR), true);
  assert.equal(chromiaCanDeleteSlab(CHROMIA_OPERATOR), false);
  // Any line login of that role is the same login for this rule.
  assert.equal(chromiaCanDeleteSlab({ role: "CHROMIA" }), false);
});

test("the Fab & Chromia Head (Gibin) deletes in his Chromia job, though his role there is CHROMIA too", () => {
  assert.equal(chromiaTierOf(GIBIN_IN_CHROMIA), "OPERATOR");
  assert.equal(isChromiaLineOperator(GIBIN_IN_CHROMIA), false, "CHROMIA is his second job, not his own");
  assert.equal(chromiaCanDeleteSlab(GIBIN_IN_CHROMIA), true);
  // In his Fabrication job the module is not his, so there is nothing to delete from.
  assert.equal(chromiaTierOf(GIBIN_IN_FAB), null);
  assert.equal(chromiaCanDeleteSlab(GIBIN_IN_FAB), false);
});

test("every role above the operator keeps Delete: admin, Plant In-Charge, Chromia-branch Line Manager and In-Charge", () => {
  for (const login of [
    { role: "ADMIN", branch: "SHOP_FLOOR" },
    { role: "ADMIN", branch: "OFFICE" },
    { role: "PLANT_INCHARGE", branch: "SHOP_FLOOR" },
    { role: "LINE_MANAGER", branch: "CHROMIA" },
    { role: "INCHARGE", branch: "CHROMIA" },
    { role: "OPERATOR", branch: "CHROMIA" },
  ]) {
    assert.equal(chromiaCanDeleteSlab(login), true, JSON.stringify(login));
  }
});

test("no login outside the module may delete, and no login is no delete", () => {
  for (const login of [null, undefined, { role: "ROBO" }, { role: "LINE_MANAGER", branch: "SHOP_FLOOR" }, { role: "VIEWER" }]) {
    assert.equal(chromiaCanDeleteSlab(login), false, JSON.stringify(login));
  }
});

test("both delete actions refuse it on the server, whatever page or request they come from", () => {
  const cu = read("src/lib/chromia/current-user.ts");
  const guard = cu.slice(cu.indexOf("export async function requireChromiaDeleter"));
  assert.match(guard, /const user = await requireActingUser\(\);\n\s+if \(!chromiaCanDeleteSlab\(await currentUser\(\)\)\) \{\n\s+throw new AppError\(\n\s+ErrorCode\.FORBIDDEN,/);
  assert.match(read("src/lib/chromia/server/actions/slab-record.ts"), /const user = await requireChromiaDeleter\('delete a slab record'\);\n\s+await deleteSlabRecord\(/);
  assert.match(read("src/lib/chromia/server/actions/trimming.ts"), /const user = await requireChromiaDeleter\('delete a Trimming record'\);\n\s+const done = await deleteTrimming\(/);
  // Edit is untouched: the corrections still ask only for a Chromia login.
  assert.match(read("src/lib/chromia/server/actions/slab-record.ts"), /updateSlabRecordAction[\s\S]*?const user = await requireActingUser\(\);/);
});

test("every slab table draws Delete only where the rule allows it, and always draws Edit", () => {
  const button = read("src/components/chromia/ui/delete-slab-button.tsx");
  assert.match(button, /<EditButton href=\{editHref\} slabNo=\{slabNo\} \/>\n\s+\{canDelete && <DeleteSlabButton slabId=\{slabId\} slabNo=\{slabNo\} \/>\}/);
  const pages = ["slabs", "stockyard", "dispatch", "approved", "trimming", "recalibrations", "recalibration-tracking"];
  for (const p of pages) {
    const page = read(`src/app/chromia/${p}/page.tsx`);
    assert.match(page, /const user = await requirePageUser\(\);[\s\S]{0,300}const canDelete = chromiaCanDeleteSlab\(user\);/, p);
    const actions = [...page.matchAll(/<SlabActions\b[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.ok(actions.length > 0, `${p}: has the Action column`);
    for (const a of actions) assert.match(a, /canDelete=\{canDelete\}/, p);
  }
  assert.match(read("src/app/chromia/trimming/page.tsx"), /\{canDelete && <DeleteTrimmingButton /);
});
