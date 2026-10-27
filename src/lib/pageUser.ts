// STANDALONE: who a page is drawn for.
//
// In Pacific ERP every Chromia page calls requirePageUser() first, so a
// revoked session (or a stale "view as") is sent to /login even on a click
// between two pages of one layout (code review of 20 Oct 2026, AUTH-2). There
// is no sign-in here, so there is nothing to revoke: it returns the local user
// and never redirects. The call sites in the pages are left exactly as ported.
import { currentUser, type LocalUser } from "@/lib/rbac";

export async function requirePageUser(): Promise<LocalUser> {
  return currentUser();
}
