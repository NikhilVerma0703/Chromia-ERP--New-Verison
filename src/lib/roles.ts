// The ONE role-rank table, in a module with no imports at all.
//
// Split out of lib/rbac.ts (which re-exports it, so nothing else changed) for
// one reason: rbac.ts imports @/auth, and node --test resolves neither the
// alias nor next-auth — so any pure logic living there is untestable, the
// same reason fab/routing.ts is alias-free. Pure per-module logic (e.g. a
// module's access-tier mapping) and its tests both import THIS module, so the
// tests exercise the real table rather than a copy that drifts.
//
// Role hierarchy (low -> high). Kept as string-typed so this compiles even
// before `prisma generate` refreshes the @prisma/client enum.
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "SALES" | "COMMERCIAL" | "COMMERCIAL_MANAGER" | "COMMERCIAL_EXEC" | "COMMERCIAL_DOCS" | "COMMERCIAL_LOGISTICS" | "STORE" | "MAINTENANCE" | "ROBO" | "CHROMIA" | "SAMPLING" | "LAB" | "VIEWER" | "PLANT_INCHARGE";

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
// SAMPLING sits on rank 1 with the other capped module roles (ROBO, CHROMIA,
// STORE, MAINTENANCE): below every rank test in the ERP, so it inherits
// nothing and is named explicitly wherever it is wanted. Its own module gates
// on the ACTION rather than on a rank — see lib/sampling/actions.ts. LAB (the
// Lab module, scripts/0119) is the same shape again: rank 1, capped to /lab,
// and its module gates on the action — see lib/lab/actions.ts.
// PLANT_INCHARGE (scripts/0141) is rank 1 with them for the same reason: it
// holds the whole of Robo, the whole of Chromia and the whole attendance
// register, and NOTHING on the shop-floor ladder. Its powers are on
// lib/plantAccess.ts's table, which is read by name, so giving it a rank above
// the tablets would hand it every `rankOf(role) >= INCHARGE` test in the ERP —
// batch rectification, record edits — that nobody asked for it to have.
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, SALES: 1, COMMERCIAL: 1, COMMERCIAL_MANAGER: 1, COMMERCIAL_EXEC: 1, COMMERCIAL_DOCS: 1, COMMERCIAL_LOGISTICS: 1, ROBO: 1, CHROMIA: 1, SAMPLING: 1, LAB: 1, VIEWER: 1, PLANT_INCHARGE: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };

// VIEWER (scripts/0134) is the VIEW-ONLY login (Shyam, 23 Oct 2026: "a view
// only login, can see everything admin sees"). Its rank here only places it
// in Users & Roles: it never reaches a gate as VIEWER, because sign-in hands
// it the ADMIN role with readOnly set (src/auth.ts), and every save it makes
// is refused at the edge (middleware.ts 3b) and in the Prisma write guard
// (lib/viewAsServer.ts), the two refusals "View as" already relies on.
export const VIEW_ONLY_ROLE = "VIEWER";
export const VIEW_ONLY_SENTENCE = "This is a view-only login — nothing is saved. Ask an administrator to make the change.";

export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }

/** THE CAPPED MODULE ROLES: THE LOGINS AN ADMIN HANDS OUT, AND NOBODY BELOW.
 *
 *  Owner, 2026-10-20, twice. First for Lab: "should only admins create Lab
 *  logins? ... Only admins". Then for the rest of the set, on the code review's
 *  AUTH-4: Store, Maintenance, Robo, Chromia and Sampling logins are admin-only
 *  to create, reset, deactivate, change station or second role, exactly like
 *  Lab.
 *
 *  Every one of them is rank 1, so the ordinary "anything strictly below you"
 *  rule let any Shop Floor INCHARGE or LINE_MANAGER create one with a password
 *  they chose, reset a real one's password and sign in as it, or grant the role
 *  as a second job — and each of them carries a power the person handing it out
 *  does not hold. STORE signs off batch prices and edits per-batch supplier
 *  rates on /office/batch-verify (lib/costing/verification.ts names the role);
 *  MAINTENANCE files the maintenance response on a downtime incident; ROBO
 *  deletes robo slabs; CHROMIA, SAMPLING and LAB each run a whole module. A
 *  supervisor could become the batch-price verifier with one password reset.
 *
 *  VIEWER is here for the same reason, more sharply: the view-only login sees
 *  everything an admin sees, so a supervisor who could reset its password
 *  could read every screen in the ERP.
 *
 *  PLANT_INCHARGE sharper still: it is the login the two tablets are capped
 *  AGAINST (lib/plantAccess.ts). It holds the whole attendance register — the
 *  roster, the leave, the exports, and any day in either direction — across
 *  both plant modules, so a supervisor who could grant it, or reset it, could
 *  hand himself everything the tablets were just refused.
 *
 *  What is left below an admin is the ladder itself: a LINE_MANAGER hands out
 *  INCHARGE and OPERATOR, an INCHARGE hands out OPERATOR. */
export const CAPPED_MODULE_ROLES: ReadonlySet<string> = new Set(["STORE", "MAINTENANCE", "ROBO", "CHROMIA", "SAMPLING", "LAB", "VIEWER", "PLANT_INCHARGE"]);

/** The first capped module role among `targetRoles` (primary first, then the
 *  second job — getUserRoles' order), or null. What the refusal names. */
export function cappedRoleOf(targetRoles: readonly (string | null | undefined)[]): string | null {
  return targetRoles.find((r): r is string => !!r && CAPPED_MODULE_ROLES.has(r)) ?? null;
}

/** WHO MAY HAND OUT, OR TOUCH, A MODULE LOGIN: AN ADMIN, AND NOBODY BELOW.
 *  Three call sites ask this one question: creatableRoles (what the Role
 *  dropdown and the second-job list offer), canManageTarget in
 *  admin/users/actions.ts (the gate every reset / deactivate / station /
 *  second-role / sign-out change goes through), and the button rule in
 *  UserAdmin.tsx (so no button, and no live machine select, is drawn that the
 *  server refuses). `targetRoles` is every role the target can wear — primary
 *  and second job alike, so a Store hat cannot hide behind an Operator primary. */
export function moduleLoginNeedsAdmin(callerRank: number, targetRoles: readonly (string | null | undefined)[]): boolean {
  return callerRank < ROLE_RANK.ADMIN && cappedRoleOf(targetRoles) !== null;
}

/** The Commercial module's two roles (owner, 2026-09-07, answer 9: "a
 *  commercial manager role"). OUTSIDE the module they are one thing — the
 *  office login that lands on /office/commercial, sees the finished-goods
 *  slab table and the read-only production lookups, and writes nothing else —
 *  so every seam that used to ask `role === "COMMERCIAL"` asks this instead
 *  and a third commercial role (the per-task roles the owner also asked for)
 *  is one entry here. INSIDE the module lib/commercial/access-rules.ts tells
 *  them apart: the manager approves the checklist, cancels a PI and edits the
 *  production plan; Commercial does not. The manager sits on rank 1 with
 *  Commercial deliberately: its extra powers are on the module's action
 *  table, not on the ladder, so it inherits none of the shop-floor rank
 *  tests (canRectify and the like). */
export const COMMERCIAL_ROLES: ReadonlySet<string> = new Set(["COMMERCIAL", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS"]);
export function isCommercialRole(role?: string | null): boolean { return COMMERCIAL_ROLES.has(String(role ?? "")); }

// Station and role LABELS, here with the rank table for the same two reasons:
// node --test can reach them, and a client component can import them without
// dragging lib/rbac.ts's auth chain into the browser bundle (see rbac.ts).
export type StationName =
  | "PRESS" | "OVEN" | "JOT" | "MIXER" | "KREOS"
  | "DISTRIBUTOR" | "SILO" | "POLISH_QC" | "POLISH_ENTRY" | "CUTTING";

export const STATIONS: StationName[] = ["PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO", "POLISH_QC", "POLISH_ENTRY", "CUTTING"];
export const STATION_LABEL: Record<string, string> = {
  PRESS: "Press", OVEN: "Oven", JOT: "Jot", MIXER: "Mixer", KREOS: "Kreos",
  DISTRIBUTOR: "Distributor", SILO: "Silo", POLISH_QC: "Polish QC", POLISH_ENTRY: "Polish Entry", CUTTING: "Cutting",
};

export const ROLE_LABEL: Record<string, string> = {
  OPERATOR: "Operator", INCHARGE: "Incharge", LINE_MANAGER: "Line Manager", ADMIN: "Administrator",
  FINANCE: "Finance", ACCOUNTS: "Accounts", SALES: "Sales", COMMERCIAL: "Commercial", COMMERCIAL_MANAGER: "Commercial Manager",
  // One role per set of tasks, named for the desk rather than the person
  // (owner, 2026-09-08): Setumani, Raghav and Murali respectively.
  COMMERCIAL_EXEC: "Commercial Executive", COMMERCIAL_DOCS: "Commercial Documentation", COMMERCIAL_LOGISTICS: "Commercial Logistics",
  STORE: "Store Incharge", MAINTENANCE: "Maintenance Manager",
  ROBO: "Robo Operator",
  CHROMIA: "Chromia Operator",
  // The owner's own title for the man the attendance report is addressed to
  // (26 Oct 2026: "In-Charge Access ... full access to all sections and
  // subsections"). One login over both plant modules and the whole shared
  // register — see lib/plantAccess.ts, which is the whole of what it means.
  PLANT_INCHARGE: "Plant In-Charge",
  // The owner's own word for this person. Not "Sampling Operator": there is one
  // sampling login and it runs the whole module — the inventory, the intake and
  // all three dispatch transitions.
  SAMPLING: "Sampling Incharge",
  // The lab staff's login: the whole Lab module but its hard deletes and its
  // S.No. / slab-number overrides, which stay with an admin
  // (lib/lab/actions.ts). One word, like the module's sidebar heading.
  LAB: "Lab",
  VIEWER: "View only",
};

/** Fabrication shares the ONE role hierarchy with Shop Floor (LINE_MANAGER /
 * INCHARGE / OPERATOR — see lib/fab/access.ts's fabTierOf: there is no
 * parallel fabRole field), but the generic ROLE_LABEL names ("Line Manager",
 * "Incharge", "Operator") don't read as fabrication-specific anywhere the
 * role is displayed — most visibly in Users & Roles, where an admin picking
 * the Fabrication department couldn't find "Fabrication Manager" /
 * "Fabrication Supervisor" / "Fabrication Machine Operator" by name. This
 * gives the SAME underlying roles department-appropriate display names
 * without introducing a second role system or touching the Role enum/DB. */
export const FAB_ROLE_LABEL: Record<string, string> = {
  // Owner, 13 Oct 2026: "instead of fabrication manager put it as Fab &
  // Chromia Head" — gibin@, the one login on this pair, runs Chromia as well
  // (his second job, scripts/0118).
  LINE_MANAGER: "Fab & Chromia Head",
  INCHARGE: "Fabrication Supervisor",
  OPERATOR: "Fabrication Machine Operator",
};
/** A role held as a login's SECOND job, under the name that job goes by.
 * Users & Roles grants CHROMIA as a second job to a manager (gibin@, Fab &
 * Chromia Head; scripts/0118), and the owner asked for it to read as the
 * manager's job, not the line's (13 Oct 2026: "instead of chromia operator
 * give him manager view"). The screens are the same — lib/chromia/tier.ts has
 * one tier for the role either way — so this is a name and nothing else.
 * chromia@ ("Chromia Line") holds CHROMIA as its MAIN job and stays
 * "Chromia Operator". */
export const SECOND_JOB_LABEL: Record<string, string> = {
  CHROMIA: "Chromia Manager",
};
/** Is (role, branch) this login's second job — its altRole/altBranch pair? */
export function isSecondJob(login: { altRole?: string | null; altBranch?: string | null } | null | undefined, role?: string | null, branch?: string | null): boolean {
  return !!login?.altRole && login.altRole === role && (login.altBranch ?? null) === (branch ?? null);
}
/** Role label, department-aware: Fabrication uses its own label map for the
 * roles it shares with Shop Floor; every other branch (and any role with no
 * department-specific name) falls back to the generic ROLE_LABEL. `secondJob`
 * names the pair as a login's second job (SECOND_JOB_LABEL), where it has a
 * name of its own. */
export function roleLabelFor(role?: string | null, branch?: string | null, secondJob = false): string {
  const r = String(role ?? "");
  if (secondJob && SECOND_JOB_LABEL[r]) return SECOND_JOB_LABEL[r];
  if (branch === "FABRICATION" && FAB_ROLE_LABEL[r]) return FAB_ROLE_LABEL[r];
  return ROLE_LABEL[r] ?? r;
}
