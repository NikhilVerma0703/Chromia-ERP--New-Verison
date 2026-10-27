// WHO MAY DO WHAT ON THE PLANT FLOOR — the ONE table, read by every gate.
//
// Alias-free, and importing `./roles.ts` with an explicit extension, for the
// two reasons lib/chromia/tier.ts and lib/fab/routing.ts give: `node --test`
// resolves neither the `@/` alias nor next-auth, so the logic that decides who
// may do what has to live somewhere a test can import; and middleware.ts and
// auth.config.ts are edge-safe and Prisma-free, so a module either of them
// reads may import nothing else at all. tests/plantAccess.test.ts is the test.
//
// ── WHY A TABLE AND NOT A CHECK PER SCREEN ────────────────────────────────
// Owner, 26 Oct 2026: "Enforce permissions in both the frontend and backend;
// hiding menu items alone is insufficient" and "Prevent operators from
// accessing restricted pages or APIs directly through URLs or manual
// requests." That is four places asking the same question about one login —
// the edge (middleware.ts), the nav (navModel.ts), the route gate
// (lib/attendance/server.ts, the two Robo export routes) and the screen
// itself (AttendanceClient, DownloadsClient). lib/routeCaps.ts exists because
// two of those once wrote the answer out separately and drifted; there are
// four here, so the answer is written once and imported.
//
// ── THE TWO TIERS ─────────────────────────────────────────────────────────
// OPERATOR is the shared tablet standing on the line. It is not a person: one
// login per ERP, used by whoever is on shift, which is why it may mark ANY
// operator present and may do it only for the plant's today. It cannot go back
// to a day that is closed, cannot alter a row that is already written, and
// never sees the two parts of the register that are a supervisor's work —
// Leave Taken and Downloads.
//
// INCHARGE is the Plant In-Charge: the whole register, every day, both
// modules, and the slab exports. An ADMIN is an In-Charge here too — admins
// span every department everywhere else in this ERP and this is not the file
// to make them the exception.
//
// NOBODY'S CREDENTIALS ARE IN THIS FILE, or anywhere else in the source. The
// two tablet logins and the In-Charge login are made in Users & Roles like
// every other login in the ERP, and their passwords are bcrypt hashes in the
// users table (src/auth.ts). A role is what the code knows about.
import { isSecondJob, rankOf, ROLE_RANK, SECOND_JOB_LABEL } from "./roles.ts";

/** The Plant In-Charge: the full plant login, both modules and the whole
 *  register. A Role value (scripts/0141), not a rank — it sits on rank 1 with
 *  the other capped module roles, because its powers are on this table rather
 *  than on the shop-floor ladder. */
export const PLANT_INCHARGE = "PLANT_INCHARGE";

/** The line's shared tablet logins. ROBO and CHROMIA are already named
 *  "Robo Operator" and "Chromia Operator" in ROLE_LABEL; this is that name
 *  taken at its word. */
export const PLANT_OPERATOR_ROLES: ReadonlySet<string> = new Set(["ROBO", "CHROMIA"]);

export type PlantTier = "OPERATOR" | "INCHARGE";

export interface PlantRights {
  tier: PlantTier;
  /** Robo → Downloads → Download Slab Records, and the two export endpoints
   *  the card's buttons call. The other two cards on that page (Reference
   *  Sheet, QC Rejection Analysis) are the operator's and are not on this
   *  table at all. */
  slabExports: boolean;
  /** Attendance → a date other than the plant's today, in either direction. */
  anyDate: boolean;
  /** Attendance → change something already written on a row. Adding the
   *  Out-Time to a row that has none is not a change; that is the other half
   *  of marking attendance. */
  amendSaved: boolean;
  /** Attendance → + Add / Edit / Delete on the roster of operators. */
  roster: boolean;
  /** Attendance → Leave Taken, all four of its endpoints. */
  leave: boolean;
  /** Attendance → Downloads, both of its endpoints. */
  downloads: boolean;
}

/** The table itself. Frozen because it is module state read by the edge on
 *  every request: a rights object handed to a caller must not be something
 *  that caller can widen. */
export const PLANT_RIGHTS: Readonly<Record<PlantTier, PlantRights>> = Object.freeze({
  OPERATOR: Object.freeze({
    tier: "OPERATOR",
    slabExports: false,
    anyDate: false,
    amendSaved: false,
    roster: false,
    leave: false,
    downloads: false,
  }),
  INCHARGE: Object.freeze({
    tier: "INCHARGE",
    slabExports: true,
    anyDate: true,
    amendSaved: true,
    roster: true,
    leave: true,
    downloads: true,
  }),
}) as Readonly<Record<PlantTier, PlantRights>>;

/**
 * The tier a (role, branch) pair stands on, or null when the plant modules are
 * not theirs at all.
 *
 * Two plain strings rather than a user object, so middleware — which has them
 * unpacked already — and a test can both call it without building one.
 * plantTierOfUser below is the one-line wrapper for the route gates.
 */
export function plantTierOf(role?: string | null, branch?: string | null): PlantTier | null {
  const r = String(role ?? "");
  // Admins span every department. Said here rather than left to each caller,
  // because a caller that forgot would lock an admin out of a screen they are
  // meant to be able to repair.
  if (rankOf(r) >= ROLE_RANK.ADMIN) return "INCHARGE";
  if (r === PLANT_INCHARGE) return "INCHARGE";
  if (PLANT_OPERATOR_ROLES.has(r)) return "OPERATOR";
  // TRANSITIONAL, exactly as in lib/chromia/tier.ts: logins created by the
  // retired department-style Chromia integration carry branch CHROMIA and a
  // shop-floor rank. They are tablets, so they are operators. Goes with the
  // other transitional arms when scripts/0046 has moved the last of them.
  if (String(branch ?? "") === "CHROMIA") return "OPERATOR";
  return null;
}

/**
 * The same question of a session user — and the one place the answer can
 * differ from the bare (role, branch) pair.
 *
 * A LINE ROLE HELD AS A SECOND JOB IS A MANAGER, NOT THE TABLET. gibin@ (Fab &
 * Chromia Head) holds CHROMIA as his second job (scripts/0118), and the owner
 * asked for it to be the manager's job, not the line's (13 Oct 2026: "instead
 * of chromia operator give him manager view"; SECOND_JOB_LABEL names it
 * "Chromia Manager"). The 26 Oct caps are for the two tablet logins, whose
 * MAIN job is the line. So a second job that SECOND_JOB_LABEL names is tier
 * INCHARGE, as the register was his before the caps. Only such a job: a ROBO
 * second job has no manager's name and stays a tablet until the owner gives
 * it one. Asked only here, because only the session user carries the second
 * job — middleware passes the active user for that reason.
 */
export function plantTierOfUser(user: unknown): PlantTier | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null; altRole?: string | null; altBranch?: string | null };
  const role = String(u.role ?? "");
  if (PLANT_OPERATOR_ROLES.has(role) && SECOND_JOB_LABEL[role] && isSecondJob(u, u.role, u.branch)) return "INCHARGE";
  return plantTierOf(u.role, u.branch);
}

/**
 * The Robo module's own audience: the ROBO tablet, and the Plant In-Charge
 * standing over it (an admin included — plantTierOf says so). A CHROMIA
 * tablet is tier OPERATOR too and is not in it; nor is a Chromia second job,
 * since this asks the bare pair.
 *
 * Read by roboGate AND by the two Robo writes the tablet may make
 * (rbac.canDeleteRoboSlab, rbac.canEditRoboSetup), so the In-Charge can never
 * have less of Robo than the tablet he supervises — the owner's "full access
 * to all sections and subsections".
 */
export function roboAudience(role?: string | null, branch?: string | null): boolean {
  return String(role ?? "") === "ROBO" || plantTierOf(role, branch) === "INCHARGE";
}

/**
 * What a tier may do. A tier of null — a login with no business in these
 * modules — is given the operator's rights and not a widened set, so a caller
 * that reads this BEFORE its gate has refused the request still reads "no".
 * The gate is what refuses; this fails in the safe direction while it does.
 */
export function plantRightsOf(tier: PlantTier | null): PlantRights {
  return PLANT_RIGHTS[tier === "INCHARGE" ? "INCHARGE" : "OPERATOR"];
}

/** Rights for a session user, in one call. */
export function plantRightsOfUser(user: unknown): PlantRights {
  return plantRightsOf(plantTierOfUser(user));
}

/* ── THE SENTENCES ────────────────────────────────────────────────────────
   One wording per refusal, said the same way by the API and by the screen, so
   an operator who gets past the hidden control reads the same sentence the
   page would have shown. */

/** A day other than today, asked for by the tablet. */
export const ONLY_TODAY = "This tablet records today only. Ask the Plant In-Charge for another day.";
/** A row that is already written, being written over by the tablet. */
export const ALREADY_SAVED = "This row is already saved. Ask the Plant In-Charge to change it.";
/** Anything the tablet has no business in at all: leave, downloads, the
 *  roster, the slab exports. */
export const NOT_YOURS = "That is the Plant In-Charge's to do.";
