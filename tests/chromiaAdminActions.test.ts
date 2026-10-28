// CHROMIA DELETE AND IMPORT ARE AN ADMIN'S — the code review of 20 Oct 2026,
// CHR-4, and the owner's decision of the same day ("admins only").
//
// tier.ts and tests/chromiaAccess.test.ts always said only admins could delete
// a slab, delete an import or import a register, through chromiaCanManage —
// and nothing ever called it. requireActingUser admits the OPERATOR tier, so
// the shared line tablet (role CHROMIA), the Chromia manager (LINE_MANAGER on
// the CHROMIA branch) and any transitional CHROMIA-branch login could each
// remove any slab with its whole history, or a month's import. The rule is
// pure and runs here; the actions and pages import next-auth, Prisma and JSX,
// so their source is read.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaAdminActions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chromiaCanManage, chromiaTierOf } from "../src/lib/chromia/tier.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** One function's text: from its declaration to the next top-level export. */
function fn(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}(`);
  assert.ok(at >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next < 0 ? undefined : next);
}

test("who passes: an admin; not the tablet, the manager or a branch login — all of whom still open the module", () => {
  const tablet = { role: "CHROMIA", branch: "SHOP_FLOOR" };
  const manager = { role: "LINE_MANAGER", branch: "CHROMIA" };
  const branchOperator = { role: "OPERATOR", branch: "CHROMIA" };
  for (const login of [tablet, manager, branchOperator]) {
    assert.equal(chromiaTierOf(login), "OPERATOR", "still a Chromia login");
    assert.equal(chromiaCanManage(login), false, "but not for delete or import");
  }
  assert.equal(chromiaCanManage({ role: "ADMIN" }), true);
  assert.equal(chromiaCanManage(null), false);
});

const CURRENT_USER = read("src/lib/chromia/current-user.ts");

test("requireChromiaAdmin: a Chromia login first, then chromiaCanManage, refused as an AppError the actions show", () => {
  const body = fn(CURRENT_USER, "requireChromiaAdmin");
  assert.match(body, /const user = await requireActingUser\(\);\n\s+if \(!chromiaCanManage\(await currentUser\(\)\)\) \{\n\s+throw new AppError\(ErrorCode\.FORBIDDEN, `Only an admin can \$\{doing\}\.`, 403\);\n\s+\}\n\s+return user;/);
  assert.match(CURRENT_USER, /import \{ chromiaCanManage, chromiaTierOf \} from "\.\/tier";/);
});

test("the four actions ask it before they read a file or touch a row", () => {
  const record = read("src/lib/chromia/server/actions/slab-record.ts");
  const del = fn(record, "deleteSlabRecordAction");
  assert.match(del, /const user = await requireChromiaAdmin\('delete a slab record'\);\n\s+await deleteSlabRecord\(parsed\.data, user\.id\);/);
  assert.doesNotMatch(del, /requireActingUser\(/);
  // The correction itself stays the line's.
  assert.match(fn(record, "updateSlabRecordAction"), /const user = await requireActingUser\(\);/);

  const imp = read("src/lib/chromia/server/actions/import.ts");
  assert.doesNotMatch(imp, /requireActingUser/);
  const preview = fn(imp, "previewImportAction");
  assert.match(preview, /try \{\n\s+await requireChromiaAdmin\('import a production register'\);\n\s+const file = validateFile/);
  const run = fn(imp, "runImportAction");
  assert.match(run, /try \{\n\s+const user = await requireChromiaAdmin\('import a production register'\);\n\s+const file = validateFile/);
  assert.ok(run.indexOf("requireChromiaAdmin(") < run.indexOf("readSheet("));
  assert.ok(run.indexOf("requireChromiaAdmin(") < run.indexOf("importProRegister("));
  const delImport = fn(imp, "deleteImportAction");
  assert.match(delImport, /const user = await requireChromiaAdmin\('delete an imported file'\);\n\s+const result = await deleteImportBatch\(importBatchId, user\.id\);/);
});

test("the rest of the module is untouched: QC and its Edit, dispatch, the stockyard and recalibration stay the line's", () => {
  for (const f of ["slab", "dispatch", "stockyard", "recalibration-flow", "operator"]) {
    const src = read(`src/lib/chromia/server/actions/${f}.ts`);
    assert.doesNotMatch(src, /requireChromiaAdmin/, `${f}.ts`);
    assert.match(src, /await requireActingUser\(\)/, `${f}.ts`);
  }
});

test("Slab Records shows Edit only — the Delete button is gone (28 Oct 2026); the delete action stays an admin's", () => {
  const page = read("src/app/chromia/slabs/page.tsx");
  assert.match(page, /await requirePageUser\(\);/);
  assert.doesNotMatch(page, /canDelete|RowActions|ConfirmDialog|deleteSlabRecordAction/);
  assert.match(page, /<EditLink\n\s+href=\{`\$\{APP_ROUTES\.operator\}\?slab=\$\{slab\.id\}&edit=1&back=/);
});

test("Import shows the form and the Delete buttons only to an admin; everyone else still sees the history", () => {
  const page = read("src/app/chromia/import/page.tsx");
  assert.match(page, /const user = await requirePageUser\(\);/);
  assert.match(page, /const canManage = chromiaCanManage\(user\);/);
  assert.match(page, /\{canManage \? \(\n\s+<ImportForm \/>\n\s+\) : \(/);
  assert.match(page, /\{canManage \? <th className=\{`\$\{table\.th\} text-right`\}>Actions<\/th> : null\}/);
  assert.match(page, /\{canManage \? \(\n\s+<td className=\{`\$\{table\.td\} text-right`\}>\n\s+<DeleteImportButton/);
  assert.match(page, /const history = await prisma\.chromiaImportBatch\.findMany\(/, "the list is read for everyone");
});
