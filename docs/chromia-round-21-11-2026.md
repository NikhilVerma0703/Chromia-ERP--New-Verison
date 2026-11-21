# Chromia ERP — change round of 21 Nov 2026

The running record of this round's changes, in the order they were asked for.
Built on `main` at `b28a917` (the 19 Nov round), on branch `chromia-round-21-11-2026`,
one commit per change.

## Status

| # | Change | State |
|---|--------|-------|
| 1 | Trimming Dashboard: 8 KPI cards (Overall Status, Current Status) with drill-down | Done |
| 2 | Trimming → Find a Slab: five filters over Trimming Records | Done |
| 3 | Orders: Printing Completed? (Yes / No) and the Printing Status column, for every role | Done |

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

---

### Change #2: Trimming → Find a Slab

#### Requirement (as given)

> Update the Trimming section's subsection order to: 1. Dashboard 2. Trimming Without Design Printing 3. Find a Slab 4. Trimming Records. Only implement the missing Find a Slab subsection: the same 5 filter fields — Production Date, Batch Number, Slab Number, Base Material / Slab Name, File Name / Planned Design — with Clear Filters and Apply Filters. Apply Filters shows the matching records in the existing Trimming Records table; Clear Filters resets every field and restores the complete list. No duplicate table; no change to the Trimming workflows.

#### Decisions taken (for the owner to confirm or change)

- **The same form as Recalibration's Find a Slab** — type-ahead dropdowns over the values in Trimming Records; each field a case-blind "contains", the date a plant day; any fields together.
- **It reads what Trimming Records shows** — a production slab's own details, or a Without Design Printing slab's own entry.
- **A KPI card chosen above stays chosen through a search**; Clear Filters returns to every record with no card chosen.
- The count beside Trimming Records says what is shown ("All trimming slabs: 4 · filtered").

#### Implemented

- `src/app/chromia/trimming/find-a-slab.tsx` (new).
- `src/lib/chromia/trimming-board.ts` — `parseTrimFilters`, `matchesTrimFilters`, `trimFilterOptions`, `buildTrimQuery`.
- `src/app/chromia/trimming/page.tsx` — Find a Slab between Trimming Without Design Printing and Trimming Records.

#### Database

None.

#### Verified

- **In the browser:** Batch "DB-2" + Material "carr" → the two matching rows, KPIs unchanged; Production Date alone → that day's rows; Clear Filters → all rows, fields empty. No console errors.
- **Workflow:** Find a Slab by slab, batch and material finds the slab once; with Total Trimmed chosen, both its attempts; an unknown slab number finds nothing.
- **Unit tests:** the five fields alone and together, the section order, and one table only.

---

### Change #3: Order Printing Status

#### Requirement (as given)

> Order Entry Form: add a dropdown field named Printing Completed? immediately after Requested Delivery Date, with options Yes and No; save and persist it. Recent Orders: add a column named Printing Status immediately after Requested Delivery Date — "Printing Completed" for Yes (normal black text), "Printing NOT Completed" for No, with only the word NOT in red. Chromia Operators must be able to see and set the field, see the column, and change it through the existing Edit, in both Create and Edit. Preserve every existing role restriction (no Customer Name or Order Initiated By for operators, no Delete). Update Recent Orders immediately after saving.

#### Decisions taken (for the owner to confirm or change)

- **Stored as Yes = true, No = false, and empty where nobody has chosen.** The dropdown starts on "Select", as Thickness and Finishing Type do. Every order entered before this change shows "—" in Printing Status until someone chooses. Saving the form saves whatever the dropdown shows, so choosing "Select" again clears it.
- **Not required** — like every order field except the customer's name.
- **Every role's**, the Chromia Operator's included. The operator's form still has no Customer Name or Order Initiated By, and the server still keeps the order's own values for both; Delete is still refused to the operator.
- **The column is in every Orders table** (Recent Orders, a customer search, the Pending and Completed lists) and **in the Pending / Completed Excel**, right after Requested Delivery Date — the Excel's columns are the table's, in its order.

#### Implemented

- `prisma/schema.prisma`, `prisma/migrations/0012_order_printing_completed/migration.sql` — `chromia_order.printing_completed` (nullable boolean).
- `src/lib/chromia/orders.ts` — the field in the form schema and stored values; `PRINTING_COMPLETED_OPTIONS`, `printingChoiceOf`, `printingStatusLabel`; the Excel column.
- `src/app/chromia/orders/order-form.tsx`, `form-values.ts` — the dropdown after Requested Delivery Date, filled from the order on Edit.
- `src/app/chromia/orders/orders-table.tsx` — the Printing Status column (only NOT in red).
- `src/lib/chromia/server/repositories/order-repository.ts`, `src/app/api/chromia/orders-export/route.ts`.

#### Database

Migration `0012_order_printing_completed` — one nullable column, no row changed. Applied to the local `chromia_erp` (backed up first to `db-backups/chromia_erp-before-0012-2026-11-21.dump`) and to the test database.

#### Verified

- **In the browser, as admin** (test database, demo order removed afterwards): the form shows Printing Completed? after Requested Delivery Date with Select / Yes / No; saved with No, the order was at once at the top of Recent Orders reading "Printing NOT Completed", only NOT in red, and the form emptied.
- **As the Chromia Operator:** the same field and column; no Customer Name, Order Initiated By or Delete. Edit opened with No chosen; changed to Yes and updated, Recent Orders read "Printing Completed" in plain text, and the order kept its customer name.
- **Workflow (test database):** an operator's new order saved with No, changed to Yes through Edit, shown so in Recent Orders, customer still empty.
- **Tests:** typecheck clean; Vitest 615; node tests 81; workflows 96 steps; audit 82 checks; production build.
