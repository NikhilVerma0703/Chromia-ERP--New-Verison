// A value read at most once per `ttlMs` in this server process, and once at a
// time: concurrent callers share the read in flight. A failed read is not
// kept — the next caller reads again. Import-free, so `node --test` reaches it
// (tests/ttlMemo.test.ts).
//
// For small, slow-changing reference sets that a hot path would otherwise
// re-read on every request (lib/inventory/searchWhere storedThicknessSpellings).
// Not for figures a screen prints as current.

export function ttlMemo<T>(ttlMs: number, read: () => Promise<T>): (nowMs?: number) => Promise<T> {
  let held: { atMs: number; value: Promise<T> } | null = null;
  return (nowMs = Date.now()) => {
    if (held && nowMs - held.atMs < ttlMs && nowMs >= held.atMs) return held.value;
    const value = read();
    const mine = { atMs: nowMs, value };
    held = mine;
    value.catch(() => { if (held === mine) held = null; });
    return value;
  };
}
