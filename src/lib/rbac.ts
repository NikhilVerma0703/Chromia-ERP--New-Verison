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
  station: string | null;
  readOnly: boolean;
}

/** The fixed id stored in every chromia_* `*ById` column written locally. */
export const LOCAL_USER_ID = "local-user";

export function localUser(): LocalUser {
  return {
    id: LOCAL_USER_ID,
    name: process.env.CHROMIA_ACTING_USER_NAME?.trim() || "Local User",
    email: "local-user@chromia.local",
    role: "ADMIN",
    branch: "SHOP_FLOOR",
    station: null,
    readOnly: false,
  };
}

/** The signed-in user — always the local user in the standalone app. */
export async function currentUser(): Promise<LocalUser> {
  return localUser();
}
