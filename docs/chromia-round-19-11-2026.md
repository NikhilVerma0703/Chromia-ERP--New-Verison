# Chromia ERP — change round of 19 Nov 2026

The running record of this round's changes, in the order they were asked for.
Built on the working tree as it stood on 19 Nov 2026: `15ab47b` ("Changes 1-12")
plus the uncommitted 17 Nov round (`docs/chromia-round-17-11-2026.md`).
Nothing here is committed.

## Status

| # | Change | State |
|---|--------|-------|
| 1 | Dispatched: opens directly and quickly from the sidebar | Done |
| 2 | Delete: not for the Chromia Operator; every higher role keeps it | Done |
| 3 | Recalibration Dashboard: 8 KPI cards (Overall Status, Current Status) with drill-down | Done |
| 4 | Orders: role-based access, Action column, KPI lists with Total and Excel | Done |

Each change has the same headings as the 17 Nov round's notes.

---

### Change #1: Fix Dispatched page navigation and loading

#### Requirement (as given)

> Recheck and fix the Dispatched page navigation issue. Currently, clicking Dispatched takes too long to load, sometimes does not open at all, or opens only after first navigating to the Stockyard page. Investigate and fix the root cause so that: Dispatched opens directly and reliably with a single click from the sidebar. Loading time is optimized, with no unnecessary delays or dependency on visiting Stockyard first. All existing Dispatched page data, filters, tables, KPIs, and functionalities remain unchanged. Test navigation repeatedly to ensure the issue is fully resolved. Do not modify unrelated pages or functionality.

#### Root cause (measured)

- **The table drew every slab ever dispatched**, each row with its own Alter From Dispatched form and buttons. With 3,000 dispatched slabs (a production build on a throwaway database of 8,400 slabs), one click on Dispatched downloaded **4.4 MB** and took about **1.1 s** on the server; a refresh was **15 MB** and about **4 s**. Slab Records, which pages its table, was 73 KB. The page grew with every dispatch.
- **A sidebar click waited for all of it.** Dispatched had no loading screen, so the old page stayed on screen until the whole of Dispatched arrived — on a tablet over Wi-Fi, a click that "does nothing".
- **Why it worked after Stockyard:** the swipe navigation (`components/chromia/layout/swipe-nav.tsx`) prefetches the next and previous sections. Dispatched follows Stockyard, so on Stockyard it was downloaded in the background and the click was instant. From anywhere else, nothing was preloaded.
- **Extra database work:** each load read every slab four times (to skip earlier entries of re-entered slabs, once per query), and read every dispatch three times for the three KPIs. Prisma runs `distinct` in memory here, so each of those fetched every row.
- **Not the cause:** the dev server's first compile (about 2 s, once, the same for any page).

#### Decisions taken (for the owner to confirm or change)

- **The table is paged, 25 rows a page, with Previous and Next** — the same size and buttons as Slab Records. This is the one visible difference. The count beside the title, the three KPIs, every filter, the sort order, and each row's Alter From Dispatched, Edit and Delete are unchanged.
- **Paging keeps the filters.** Previous and Next carry them; Apply Filters and Clear Filters start again on page 1. A page number past the last shows the last page.
- **Loading screen:** while Dispatched is built, its title and grey placeholders show at once (`dispatch/loading.tsx`).
- **Stockyard is unchanged**, as asked, though its In Stock and Sent From Stock tables are built the same way and will grow the same way (see below).

#### Implemented

- `src/lib/chromia/server/repositories/dispatch-repository.ts`: `loadDispatchedPage` — one earlier-entries scan per load, one read of dispatch dates for all three KPIs, the table's rows worked out light (latest dispatch per slab, same order as before), and full details read only for the 25 rows drawn. `dispatchedKpis` and `listDispatchedSlabs` keep their results (the audit uses them).
- `src/lib/chromia/dispatched-filters.ts`: `page` in the filters (not a filter: not in `buildDispatchedQuery`), `DISPATCHED_PAGE_SIZE = 25`, `dispatchedPageQuery`.
- `src/app/chromia/dispatch/page.tsx`: one load; the count shows every matching slab; the page bar.
- `src/app/chromia/dispatch/loading.tsx` (new).

#### Database

None.

#### Verified

- **Same results as before:** the old repository (from `15ab47b`) and the new one compared on 8,400 slabs: the three KPIs, and the full list for seven filter combinations (none, Last Month, Month-wise, Custom with slab number, batch, slab number, one dispatch date) — identical rows in identical order.
- **Production build, 3,000 dispatched slabs:** a click on Dispatched now downloads **57 KB in about 0.33 s** (was 4.4 MB, 1.1 s); a refresh **181 KB in about 0.47 s** (was 15 MB, 4 s). Page 40 and a filtered page are the same size.
- **Clicks in the browser (production build):** Dispatched opened from the sidebar every time, from Dashboard, Slab Records, Approved Slabs, Recalibration, Trimming, Downloads and Stockyard; Next went to page 2; a filtered page 3 kept its filter in Previous/Next, and the count still showed all matching slabs. No console errors.
- **Tests:** typecheck clean; Vitest 589 (UTC and IST); node tests 81; workflow 82 steps on the test database; audit 75 checks on the test and the local database.
- **Not verified:** the live main ERP (its own data and network) — nothing has been run there.

#### Main ERP notes

- Port the four files. The same fault will be there: Pacific-ERP's Dispatched page draws every dispatched slab too.
- **Follow-up, not done:** Stockyard draws every slab on the rack and every slab sent from stock in one go; with real volumes it will slow the same way.

---

### Change #2: Role-based Delete

#### Requirement (as given)

> Update the Delete button permissions across all applicable Chromia ERP slab tables. 1. Chromia Operator – Remove Delete Access. For the following operator login: Email: chromia@thepacific.group. Remove the Delete permission completely. The Delete button must not be visible when this operator logs in. The operator must not be able to delete records through any alternative method, including direct API requests. Keep the existing Edit access and all other operator permissions unchanged. 2. Higher-Level Roles – Retain Full Delete Access. All roles above Chromia Operator must retain full Delete access, including: Admin, Plant In-Charge, Line Manager (Chromia branch), In-Charge (Chromia branch), Other authorized higher-level Chromia roles. Special case – Fab & Chromia Head: The user with the role Fab & Chromia Head (Gibin) must have full Delete access: Email: gibin@thepacific.group. Ensure this account can see and use the Delete button across all applicable sections. 3. Important Instructions. Implement proper role-based access control on both frontend and backend. Hide the Delete button for Chromia Operator and enforce the same restriction at the API/database operation level. Do not accidentally remove Delete access from any higher-level role. Preserve all existing Edit permissions and other functionalities. Apply the permissions consistently across Slab Records, Stockyard, Dispatched, Approved Slabs, Trimming, Recalibration, and all other applicable slab tables. Test using the relevant operator and higher-level roles. Expected Result: Chromia Operator can edit records but cannot see or execute Delete. All authorized higher-level roles, especially Fab & Chromia Head, retain full Delete access.

#### How the two logins differ (main ERP, read from Pacific-ERP `main` on 19 Nov 2026)

- **chromia@thepacific.group** ("Chromia Line", scripts/0118): role `CHROMIA` as its **own** job. Users & Roles calls it "Chromia Operator".
- **gibin@thepacific.group**: Line Manager on Fabrication ("Fab & Chromia Head"), with `CHROMIA` as his **second** job. While he works in Chromia, his session's role is also `CHROMIA` (the role switcher overlays the second job, `lib/roleContext.ts`), with that pair as his `altRole`/`altBranch`.
- So **the role alone cannot tell them apart**. The rule asks `isSecondJob` (lib/roles.ts), the same test that already names Gibin's job "Chromia Manager".

#### Decisions taken (for the owner to confirm or change)

- **Who cannot delete:** a login whose active role is `CHROMIA` as its own job — chromia@ and any other line login of that role. **Everyone else in the module can:** admins, the Plant In-Charge, Line Managers, In-Charges and operators of the Chromia branch (logins not yet moved to the role), and Gibin in his Chromia job.
- **What "Delete" covers:** the slab Delete on all eight slab tables (Slab Records, Stockyard In Stock Records and Sent From Stock, Dispatched, Approved Slabs, Trimming, Recalibration, Recal. Tracking) and Trimming's own Delete (a slab without design printing). Deleting an import stays admin-only, as before.
- **Edit is unchanged** for the operator, everywhere.
- **The message** if a delete is attempted anyway: "The Chromia Operator login cannot delete a slab record. Ask the In-Charge or an admin."

#### Implemented

- `src/lib/chromia/tier.ts`: `isChromiaLineOperator` and `chromiaCanDeleteSlab` (pure, node-testable). Exported from `access.ts`.
- `src/lib/chromia/current-user.ts`: `requireChromiaDeleter(doing)`, asked by `deleteSlabRecordAction` and `deleteTrimmingAction` — the server refuses, whatever page or request the action comes from.
- `src/components/chromia/ui/delete-slab-button.tsx`: `SlabActions` takes `canDelete`; Delete is drawn only when true, Edit always.
- The seven slab pages compute `canDelete = chromiaCanDeleteSlab(user)` and pass it to every Action cell; Trimming hides its own Delete the same way.
- **Standalone only** — `src/lib/rbac.ts`: optional `CHROMIA_LOCAL_ROLE`, `CHROMIA_LOCAL_BRANCH`, `CHROMIA_LOCAL_ALT_ROLE`, `CHROMIA_LOCAL_ALT_BRANCH`, `CHROMIA_LOCAL_EMAIL` to run a test server as another login. Unset (the normal case) it is the local admin, as before. **Do not port**: Pacific-ERP signs in.
- Tests: `tests/chromiaDeleteAccess.test.ts` (new); `chromiaAdminActions`, `edit-and-sort`, `stockyard-page` updated from the 17 Nov rule.

#### Database

None.

#### Verified

- **The rule, run for real:** the Chromia Operator cannot delete; Gibin in his Chromia job can; admin, Plant In-Charge, Chromia-branch Line Manager, In-Charge and operator can; nobody outside the module can.
- **The server, on the test database (workflow):** as the Chromia Operator, the real `deleteSlabRecordAction` is refused with the message and the slab stays; `deleteTrimmingAction` is refused the same way; Edit still saves. As Gibin in his Chromia job, the delete goes through and every count moves.
- **The pages:**
  - As the Chromia Operator, Edit on every row and **no Delete**: Slab Records 25, Stockyard 3,000, Dispatched 25, Approved Slabs 3, Recalibration 4, Recal. Tracking 4, Trimming 2.
  - As Gibin, Edit **and Delete** on every row of the same tables.
- **Not verified:** the real chromia@ and gibin@ sign-ins — the standalone has no sign-in, so they were run as their roles. Check both on Pacific-ERP after the port.

#### Main ERP notes

- Pacific-ERP already has `chromiaCanDeleteSlab`, the `canDelete` prop and its wiring on the seven pages. Port: the new body of `chromiaCanDeleteSlab` and `isChromiaLineOperator` (tier.ts), `requireChromiaDeleter` (current-user.ts) and its two uses, and the tests.
- After the port, sign in as chromia@ (no Delete anywhere; a delete posted anyway is refused) and as gibin@ switched to his Chromia job (Delete everywhere).

---

### Change #3: Recalibration Dashboard — 8 KPI cards

#### Requirement (summary; given in full in the chat of 19 Nov 2026)

> Two sections in the Recalibration Dashboard, four cards each. OVERALL STATUS (cumulative events, repeat attempts counted separately): Total Recalibrated Slabs, Total Slabs Sent for Recalibration, Total Slabs Received from Recalibration, Total Pending Slabs from Recalibration (Sent − Received). CURRENT STATUS (unique slabs, never counted twice): Ready for Recalibration, Sent for Recalibration, Received from Recalibration, Available Slabs after Recalibration (Received − slabs remaining for reprinting). "Click to View Slabs" on all four Current Status cards, the records exactly matching the count. The recalibration workflow itself must not change.

#### How the workflow records it (inspected first)

- QC Grade C → Recalibration opens a **recalibration record** for the next attempt (sent/received dates empty).
- **Send** fills its sent date; **Receive** its received date; **back on the line** (reprinting) its restarted time.
- QC after reprinting either **clears** the slab (A/B → Stock, Dispatch, Sample Cutting) or **fails** it again, which opens the next attempt's record; failing after the 5th attempt **writes the slab off** (no new record).
- Undoing an outcome on Slab Records' Edit removes a record not yet sent, or a send not yet received.

#### Decisions taken (the owner's answers, 19 Nov 2026)

- **Total Recalibrated Slabs** = every recalibration record — each time QC sent a slab to recalibration, sent yet or not. So it is ≥ Total Sent.
- **Ready for Recalibration** = first send only ("Ready for Recalibration"). A slab waiting for its 2nd or later send ("Need 2nd Time Recalibration") is in **no** Current Status card. (The old Ready card counted both.)
- **Available Slabs after Recalibration** = reprinted after its latest attempt and awaiting QC ("In Processing — After Attempt n"). It leaves the card when QC clears it or fails it. Equivalently: received this cycle − still waiting for reprinting.
- **Sent for Recalibration** (current) = out now, on any attempt — each slab once (a slab has at most one attempt out, so it always equals Total Pending).
- **Received from Recalibration** (current) = back, not yet reprinted.
- **Overall cards are clickable too**, listing one row per event (the old Sent/Received/Pending drill-downs, kept).
- A card's click shows its rows in Recalibration Records and scrolls there; a second click shows every slab again.

#### Implemented

- `src/lib/chromia/recalibration-board.ts`: `OVERALL_VIEWS`, `CURRENT_VIEWS`, the eight labels, `currentPositionOf` (each slab in at most one Current card), `boardKpis` and `boardRows` for all eight — one function makes both the count and the rows.
- `src/app/chromia/recalibrations/page.tsx`: the Dashboard's two sections, the cards ("Click to View Slabs" on Current), the `#records` anchor; the header line reads "… ready to send · … out at recalibration".
- `src/lib/chromia/server/audit/consistency.ts`: every card = its rows (all eight); Sent ≤ Recalibrated, Received ≤ Sent; Current Status counts each slab once; Sent now = Pending. Recal. Tracking's "waiting" (every slab waiting to be sent, repeats included) is now compared with that, not with Ready. **The Recal. Tracking page is unchanged.**

#### Database

None.

#### Verified

- **Unit tests:** the eight numbers on a board with one slab at each point of the journey, counted by hand; the owner's examples (11 first attempts + 5 repeats = 16; 3 sent, 2 received, 1 reprinted → Available 1); every card lists exactly its count; no slab in two Current cards.
- **Workflow (test database):** all 82 steps pass, each now asserting how all eight cards move — five attempts and the write-off, sent-and-received in one save, Dispatched → Recalibration, Trimming → Recalibration, and the QC corrections that undo a waiting record or a send — with the full audit after every step.
- **Browser (a throwaway database seeded with each point of the journey):** Overall 10 / 7 / 5 / 2; Current 2 / 2 / 1 / 1, as counted by hand. Each card's click listed exactly its count, with the right slabs and Current Status; a real click on Available marked the card and showed its 1 row. No console errors.
- **Audit:** 82 checks pass on the local database.
- **Not verified:** real plant data — the local database is empty and nothing has been run on Pacific-ERP.

#### Main ERP notes

- Port the three files and `tests/chromia/recalibration-board.test.ts`, and the audit change. Pacific-ERP's own tests that read the Recalibration Dashboard's four cards will need the eight.
- The `view` values in links changed meaning for `ready` (first send only) and gained `recalibrated`, `out`, `returned`, `available`.

---

### Change #4: Orders — role-based access, Action column, KPI lists

#### Requirement (summary; given in full in the chat of 19 Nov 2026)

> Chromia Operators: no Dashboard (not even by URL or API); Customer Name and Requested By (renamed **Order Initiated By** for all roles) hidden in the form and in Recent Orders, which then begins S.No. → Design Name (highlighted, opening the order); Requested Delivery Date stays editable; Actual Delivery Date updatable; Action column after Status with Edit only — no Delete, enforced on the server. Every higher role, especially the Fab & Chromia Head (gibin@), has everything, Delete included. Both Dashboard KPIs get "Click to See Orders", a table, an Excel download of exactly those orders, and a Total of Quantity of Slabs on screen and in the Excel.

#### Decisions taken (for the owner to confirm or change)

- **Who is the operator:** the same rule as slab Delete (change #2): role CHROMIA as the login's own job. Gibin in his Chromia job, admins, the Plant In-Charge and the Chromia-branch Line Manager and In-Charge have full access (`chromiaHasFullOrderAccess`).
- **Operators can create orders** (the owner's answer): saved without a Customer Name, which a higher role adds later. Customer Name is still required for higher roles. Such an order shows "Customer not entered" to them.
- **The operator's two fields are server-side:** whatever an operator's request carries, the save keeps the order's own Customer Name and Order Initiated By (none for a new order). The page doesn't even send customer names to an operator's browser (no suggestions list, no hidden values).
- **No Dashboard for the operator:** it isn't drawn and its data isn't read, so `?customer=` and `?view=` show nothing. The Excel route answers 403.
- **Completed Orders is clickable too** (it wasn't). Each KPI opens its list; a second click closes it.
- **The Action column** (Edit, and Delete where allowed) is on every Orders table: Recent Orders, search results, both KPI lists.
- **Delete** removes the order and its Reference Photo pair, asks first (the slab Delete's dialog), and writes a DELETE row to the Chromia audit log.
- **The Excel** has the table's columns (without Action), the same rows in the same order with the same S.No., and a bold Total row under Quantity of Slabs. File: `chromia-pending-orders_<plant day>.xlsx`.

#### Implemented

- `src/lib/chromia/tier.ts`, `access.ts`: `chromiaHasFullOrderAccess`.
- `src/lib/chromia/orders.ts`: Order Initiated By label; customer name optional for the operator's form; Pending/Completed views; `quantityTotal`; the Excel columns and rows (`orderExportMatrix`).
- `src/lib/chromia/server/actions/orders.ts`: the save keeps the operator off the two fields; `deleteOrderAction` (refused to the operator).
- `src/lib/chromia/server/repositories/order-repository.ts`: `listCompletedOrders`, `listOrdersInView`.
- `src/app/api/chromia/orders-export/route.ts` (new); `src/lib/chromia/server/exports/sheet.ts`: an optional bold footer row.
- `src/app/chromia/orders/page.tsx`, `[id]/page.tsx`, `order-form.tsx`, `orders-table.tsx`, `delete-order-button.tsx` (new).

#### Database

None.

#### Verified

- **Tests:** Vitest 600 (UTC and IST), node 81; typecheck clean.
- **Workflow (test database), the real actions as each login:** an admin's new order still needs a customer; the operator's saves without one; a customer name and initiator forged into the operator's request are ignored while both delivery dates save; the operator's Delete is refused; Gibin adds the customer and deletes both orders, each logged — 89 steps pass with the full audit.
- **Browser, as the Chromia Operator:** with `?view=pending&customer=…` in the address — no Dashboard; the form without the two fields (Requested and Actual Delivery Date present); the table S.No. → Design Name (a highlighted link to each order) → … → Action with Edit only; no customer name anywhere in the page source; the single order titled by its design; the Excel refused (403); an Actual Delivery Date entered through the form saved and the order kept its (empty) customer.
- **Browser, as Gibin:** Dashboard with both "Click to See Orders"; Pending 1 order, Total 5; Completed 3 orders, Total 24; Edit and Delete on every row; both downloads opened and matched their lists row for row, with the Total; a Delete through the dialog removed the order and Completed went 3 → 2.
- **Not verified:** Pacific-ERP and its real logins.

#### Main ERP notes

- Pacific-ERP's Orders arrive with the 17 Nov round; port this change after it. Add the route to Pacific's own route/middleware gates as the other `/api/chromia` routes are.
