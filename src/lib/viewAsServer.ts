// STANDALONE: "View as" does not exist here.
//
// In Pacific ERP an admin can view the ERP as another login, read-only, and
// these helpers refuse writes while that view is on. The standalone app has one
// local user and no views, so nothing is ever blocked. The signatures are the
// ERP's, so the attendance server (the only caller) is unchanged.

/** The sentence a blocked write shows, or null when writes are allowed — always null here. */
export async function viewAsBlocked(): Promise<string | null> {
  return null;
}

/** Runs `fn` unless a view is on — always runs it here. */
export async function unlessViewing<T>(fn: () => Promise<T>): Promise<T | undefined> {
  return fn();
}

/** Throws while viewing as another login — never throws here. */
export async function assertNotViewingAs(_what: string): Promise<void> {}
