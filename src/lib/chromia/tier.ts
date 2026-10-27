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
import { rankOf, ROLE_RANK } from "../roles.ts";
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
  // ADMIN is only the three destructive controls (delete a slab, import a
  // register, delete an import), which the owner put with the admins on
  // CHR-4 of the 20 Oct code review. Nothing in the 26 Oct instruction asks
  // for that to be reopened, and a role that widened it on the way past
  // would be taking a decision nobody made.
  if (role === PLANT_INCHARGE) return "OPERATOR";
  // TRANSITIONAL: logins created by the retired department-style integration
  // (branch CHROMIA, shared shop-floor ranks). They keep the module until
  // scripts/0046-migrate-chromia-branch-users.sql moves them onto the role;
  // middleware caps them to it meanwhile. Remove with the other three arms.
  if (String((user as { branch?: string | null }).branch ?? "") === "CHROMIA") return "OPERATOR";
  return null;
}

/**
 * Destructive or history-rewriting actions (delete a slab, import a register,
 * delete an import). Asked by requireChromiaAdmin (current-user.ts) in those
 * actions, and by the Slab Records and Import pages to hide their controls —
 * the owner's admin-only decision on CHR-4 of the code review of 20 Oct 2026.
 * Until then nothing called it, and every Chromia login could run them.
 */
export function chromiaCanManage(user: unknown): boolean {
  return chromiaTierOf(user) === "ADMIN";
}
