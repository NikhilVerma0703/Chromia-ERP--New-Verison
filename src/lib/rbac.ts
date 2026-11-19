// STANDALONE: who the app runs as.
//
// In Pacific ERP this file is the whole role/session layer (next-auth v5,
// session revalidation, "view as", station and department rules — 541 lines).
// The standalone Chromia ERP has no sign-in by design (local development and
// manual testing only), so every request runs as ONE local user.
//
// The user is an ADMIN: every Chromia gate the ERP wrote (chromiaTierOf,
// chromiaCanManage, plantRightsOfUser, canUseSlabIntake) is kept unchanged and
// simply answers "yes" for this user — so all twelve sections and every
// control in them, including the three admin-only ones (delete a slab record,
// import a register, delete an import), are open. Restoring sign-in later means
// replacing currentUser() here; nothing that calls it has to change.

export interface LocalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  /** The login's second job, as the main ERP's session carries it (null for almost everybody). */
  altRole: string | null;
  altBranch: string | null;
  station: string | null;
  readOnly: boolean;
}

/** The fixed id stored in every chromia_* `*ById` column written locally. */
export const LOCAL_USER_ID = "local-user";

/*
 * TESTING AS ANOTHER LOGIN (19 Nov 2026). With none of these set — the normal
 * case — the local user is the ADMIN above, exactly as before. Set them on a
 * test server to run every request as another login, in the shape the main
 * ERP's session gives it (role and branch of the job in use, plus the second
 * job's pair), for example:
 *   the Chromia Operator (chromia@):      CHROMIA_LOCAL_ROLE=CHROMIA
 *   the Fab & Chromia Head (gibin@) in
 *   his Chromia job:                      CHROMIA_LOCAL_ROLE=CHROMIA CHROMIA_LOCAL_ALT_ROLE=CHROMIA
 *   the Plant In-Charge:                  CHROMIA_LOCAL_ROLE=PLANT_INCHARGE
 *   a Line Manager on the Chromia branch: CHROMIA_LOCAL_ROLE=LINE_MANAGER CHROMIA_LOCAL_BRANCH=CHROMIA
 * The branches default to SHOP_FLOOR. Standalone only: the main ERP signs in.
 */
const env = (name: string) => process.env[name]?.trim() || "";

export function localUser(): LocalUser {
  const altRole = env("CHROMIA_LOCAL_ALT_ROLE") || null;
  return {
    id: LOCAL_USER_ID,
    name: process.env.CHROMIA_ACTING_USER_NAME?.trim() || "Local User",
    email: env("CHROMIA_LOCAL_EMAIL") || "local-user@chromia.local",
    role: env("CHROMIA_LOCAL_ROLE") || "ADMIN",
    branch: env("CHROMIA_LOCAL_BRANCH") || "SHOP_FLOOR",
    altRole,
    altBranch: altRole ? env("CHROMIA_LOCAL_ALT_BRANCH") || "SHOP_FLOOR" : null,
    station: null,
    readOnly: false,
  };
}

/** The signed-in user — always the local user in the standalone app. */
export async function currentUser(): Promise<LocalUser> {
  return localUser();
}
