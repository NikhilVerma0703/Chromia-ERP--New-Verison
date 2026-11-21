# Chromia ERP — change round of 21 Nov 2026

The running record of this round's changes, in the order they were asked for.
Built on `main` at `b28a917` (the 19 Nov round), on branch `chromia-round-21-11-2026`,
one commit per change.

## Status

| # | Change | State |
|---|--------|-------|
| 1 | Trimming Dashboard: 8 KPI cards (Overall Status, Current Status) with drill-down | Done |

Each change has the same headings as the earlier rounds' notes.

---

### Change #1: Trimming Dashboard (8 KPIs)

#### Requirement (as given)

> Implement a new Dashboard subsection at the top of the existing Trimming section, similar to the Recalibration Dashboard, with 8 KPI cards divided into two groups of 4 each. OVERALL STATUS (cumulative historical counts): Total Trimmed Slabs (every slab ever marked for Trimming, repeated attempts counted separately, including slabs later cleared through QC with Grade A/B — the same for Recalibration), Total Slabs Sent for Trimming, Total Slabs Received from Trimming, Total Pending Slabs from Trimming (Sent − Received). CURRENT STATUS (unique slab counts): Ready for Trimming (Grade C → Trimming and Trimming Without Design Printing, not yet sent), Sent for Trimming, Received from Trimming, Available Slabs after Trimming (received, not yet reprinted / processed). "Click to View Slabs" on the four Current Status cards. Preserve all existing Trimming workflows, records and permissions.

#### The Trimming workflow, as it stands (analysed first)

1. **Into Trimming.** Slab Entry QC Grade C → Trimming opens the slab's `chromia_trimming` record in the same save (`trimming-open.ts`). A slab that has been to recalibration cannot go to Trimming. A slab entered under **Trimming Without Design Printing** is a record of its own, not yet a Chromia slab.
2. **A. Trimmed From → To**, **B. Send & Receive** on the slab's Trimming page. On receipt the slab's thickness becomes the To value.
3. **D. QC Report after trimming** — saved on the Trimming page itself, straight after receipt: the slab's next pass is opened and graded on it (A → Stock, B → Stock / Sample Cutting, C → Recalibration). There is **no separate reprinting step** between receipt and this QC Report; saving it is what "processed" means here.
4. **Again.** A slab graded C → Trimming again after a finished trimming had its record **cleared** for the new one; the earlier trimming survived only as a sentence in the slab's history. So until now the database could not count repeat attempts.

#### Decisions taken (for the owner to confirm or change)

- **Every attempt is now kept.** Before the record is cleared for a new trimming, the finished one is saved as an attempt (`chromia_trimming_attempt`, migration 0011). The record is always the latest attempt; attempts are numbered 1st, 2nd, … The existing data has no repeat trimmings (none on the local database), so nothing needed backfilling.
- **Overall Status counts events** (each attempt), from the beginning, and an attempt stays counted after QC clears the slab: Total Trimmed = every attempt, sent yet or not; Sent = attempts with a Sent Date; Received = attempts with a Received Date; Pending = Sent − Received.
- **Current Status counts slabs, by their latest attempt:** Ready = not yet sent (From → To chosen or not); Sent = sent, not received; Received = received; **Available = received and not yet processed** (no QC Report after trimming yet) — i.e. Received minus the slabs already reprinted / graded / sent on. Because Trimming has no reprint step before that QC Report, a slab in Available is also in Received; a slab whose QC Report is saved stays in Received and leaves Available.
- **Every card is clickable**, as on Recalibration: the four Current cards say "Click to View Slabs" and list one row per slab; the four Overall cards list one row per attempt. A card's number is always its row count (the same function makes both). A second click shows every record again.
- **The KPIs are never narrowed by Find a Slab** (as on Recalibration); the table is.
- **Recalibration needed no change:** its Overall Status already counts every recalibration trip — repeat attempts each count, and a slab's trips stay counted after QC clears it (the board keeps every slab that has a trip).
- **The table keeps its twelve columns.** A row of a slab trimmed more than once says which trimming it is, after its Current Status ("· 2nd trimming").

#### Implemented

- `prisma/schema.prisma`, `prisma/migrations/0011_trimming_attempts/migration.sql` — the attempt table (additive, guarded).
- `src/lib/chromia/server/services/trimming-open.ts` — keeps the finished trimming as an attempt before clearing the record.
- `src/lib/chromia/trimming-board.ts` (new, pure) — the eight views, KPIs and rows.
- `src/lib/chromia/server/repositories/trimming-repository.ts` — each row carries its attempts; `loadTrimmingBoard`, `rowForAttempt`.
- `src/app/chromia/trimming/page.tsx` — the Dashboard at the top; the table follows the chosen card.

#### Database

Migration `0011_trimming_attempts` — one new table, no row changed. Applied to the local `chromia_erp` (backed up first to `db-backups/chromia_erp-before-0011-2026-11-21.dump`) and to the test database.

#### Verified

- **Workflow on the test database:** a slab graded C → Trimming, sent, received, QC A → Stock, then corrected back to C → Trimming and sent again — each step moves exactly the cards it should (e.g. receipt: Received +1, Pending −1, Sent for Trimming −1, Received from Trimming +1, Available +1; QC: Available −1 only; trimmed again: Total Trimmed +1, Ready +1), and the 1st trimming is kept with its dates and grade.
- **In the browser** (demo records on the test database, removed afterwards): the eight cards showed 5 / 4 / 3 / 1 and 1 / 1 / 2 / 1, matching the records; Total Slabs Sent listed four rows, the twice-trimmed slab once per attempt.
- **Tests:** typecheck clean; Vitest 610; node tests 81; workflows 95 steps; attendance 40; audit 82 checks; production build.

