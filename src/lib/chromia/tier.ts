// Chromia access tiers — pure, import-free apart from the role-rank table.
//
// Alias-free (and importing `../roles.ts` with an explicit extension) for the
// same reason lib/fab/routing.ts is: `node --test` resolves neither the `@/`
// alias nor next-auth, so the logic that decides who may open the module has to
// live somewhere a test can import. tests/chromiaAccess.test.ts is that test.
//
// The module is gated exactly like Robo: ONE dedicated shop-floor role owns it,
// and admins span every department. The standalone app shipped seven roles of
// its own (ADMIN, PRODUCTION_MANAGER, SUPERVISOR, OPERATOR, QUALITY_INSPECTOR,
// STORE_KEEPER, VIEWER); those are not roles in this ERP and are NOT added to
// the Role enum — they collapse onto the two tiers below, which is all the
// module's screens actually distinguish.
import { isSecondJob, rankOf, ROLE_RANK } from "../roles.ts";
// The plant table, import-free but for roles.ts, so this module stays as
// importable by `node --test` as it was.
import { PLANT_INCHARGE } from "../plantAccess.ts";

export type ChromiaTier = "OPERATOR" | "ADMIN";

export const CHROMIA_TIER_RANK: Record<ChromiaTier, number> = { OPERATOR: 1, ADMIN: 2 };

/** The Chromia tier for a user, or null if the module is not theirs to open. */
export function chromiaTierOf(user: unknown): ChromiaTier | null {
  if (!user) return null;
  const role = String((user as { role?: string | null }).role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN"; // admins span every department
  if (role === "CHROMIA") return "OPERATOR";
  // The Plant In-Charge (scripts/0141). OPERATOR, not ADMIN, and the
  // distinction matters: OPERATOR opens every screen in this module — which
  // is the owner's "full access to all sections and subsections", and what
  // the login is for, since the shared attendance register has a door here.
  // ADMIN is only the import controls (import a register, delete an
  // import), which the owner put with the admins on CHR-4 of the 20 Oct code
  // review. Deleting a slab was the third until 17 Nov 2026, when the owner
  // gave it to every Chromia login.
  if (role === PLANT_INCHARGE) return "OPERATOR";
  // TRANSITIONAL: logins created by the retired department-style integration
  // (branch CHROMIA, shared shop-floor ranks). They keep the module until
  // scripts/0046-migrate-chromia-branch-users.sql moves them onto the role;
  // middleware caps them to it meanwhile. Remove with the other three arms.
  if (String((user as { branch?: string | null }).branch ?? "") === "CHROMIA") return "OPERATOR";
  return null;
}

/**
 * History-rewriting actions (import a register, delete an import). Asked by
 * requireChromiaAdmin (current-user.ts) in those actions, and by the Import
 * page to hide its controls — the owner's admin-only decision on CHR-4 of the
 * code review of 20 Oct 2026. Deleting a single slab record was one of them
 * until 17 Nov 2026, when the owner opened it to the operators.
 */
export function chromiaCanManage(user: unknown): boolean {
  return chromiaTierOf(user) === "ADMIN";
}

/**
 * The Chromia line login itself — "Chromia Operator" in Users & Roles: role
 * CHROMIA held as the login's OWN, main job (chromia@thepacific.group, "Chromia
 * Line", scripts/0118 in the main ERP).
 *
 * NOT a manager who holds CHROMIA as a SECOND job. Gibin (gibin@, "Fab &
 * Chromia Head") is a Line Manager on Fabrication with Chromia as his second
 * job; while he works in Chromia his session carries the very same role,
 * CHROMIA, with that pair as his altRole/altBranch (lib/roleContext.ts
 * applyRoleContext in the main ERP), so the role alone cannot tell the two
 * apart — isSecondJob can, and it is the test lib/roles.ts already uses to give
 * that job its manager's name ("Chromia Manager").
 */
export function isChromiaLineOperator(user: unknown): boolean {
  if (!user) return false;
  const u = user as { role?: string | null; branch?: string | null; altRole?: string | null; altBranch?: string | null };
  return String(u.role ?? "") === "CHROMIA" && !isSecondJob(u, u.role, u.branch);
}

/**
 * May this login permanently delete a slab record (or a Trimming record)?
 * Asked by every slab table to draw the Delete button, and by the delete
 * actions themselves (requireChromiaDeleter in current-user.ts), so a request
 * sent without the button is refused the same way.
 *
 * The owner, 19 Nov 2026: the Chromia Operator (chromia@thepacific.group) may
 * edit but not delete; every role above it keeps Delete — admins, the Plant
 * In-Charge, Line Managers and In-Charges of the Chromia branch, and the Fab &
 * Chromia Head (gibin@) in his Chromia job. Before that (17 Nov 2026) every
 * Chromia login could delete.
 */
export function chromiaCanDeleteSlab(user: unknown): boolean {
  return chromiaTierOf(user) !== null && !isChromiaLineOperator(user);
}

/**
 * Full Orders access (19 Nov 2026, change 4 of that round): the Dashboard
 * (customer search, KPIs and their lists, the Excel downloads), Customer
 * Name and Order Initiated By, and Delete. Every Chromia login but the
 * Chromia Operator — the same line as slab Delete (chromiaCanDeleteSlab), so
 * the Fab & Chromia Head (gibin@) in his Chromia job has all of it. The
 * operator keeps the Order Entry form and Edit, without those two fields.
 */
export function chromiaHasFullOrderAccess(user: unknown): boolean {
  return chromiaCanDeleteSlab(user);
}
