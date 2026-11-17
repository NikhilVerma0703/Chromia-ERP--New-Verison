# Chromia ERP — change round of 17 Nov 2026

The running record of this round's changes, in the order they were asked for.
Each change is one commit on branch `chromia-round-17-11-2026`, started from
`main` at `15ab47b` (GitHub's "Changes 1-12").

## Status

| # | Change | State | Commit |
|---|--------|-------|--------|
| 1 | Orders: a standalone section for recording and tracking customer orders | Done | See `git log`: "Chromia change 1 (17 Nov round)" |
| 2 | Attendance: Out-Time the next day for any In-Time, and shifts of any length | Done | See `git log`: "Chromia change 2 (17 Nov round)" |
| 3 | Edit and Delete for operators on Slab Records, Stockyard, Dispatched, Approved Slabs, Trimming and Recalibration | Done | See `git log`: "Chromia change 3 (17 Nov round)" |

Each change below has the same headings:

- **Requirement (as given):** the request word for word.
- **Decisions taken:** anything settled while building it, for the owner to confirm or change.
- **Implemented:** what now happens, and the files changed.
- **Database:** any schema or data change, and what the main ERP will need. "None" if there is none.
- **Verified:** the tests and checks run, and their real results, including anything not verified.
- **Main ERP notes:** anything the port to Pacific-ERP must handle differently from the standalone.

---

### Change #1: Orders

#### Requirement (as given)

> Implement a completely new, standalone section in Chromia ERP named Orders (or another suitable professional name).
> This section is strictly for recording and tracking customer orders. It must remain completely independent of all existing slab production, Stockyard, Dispatch, Approved, Recalibration, and other slab outcome workflows.
>
> **1. Dashboard.** At the top, create a Dashboard subsection with: A customer search field: Search Customer Name. When searched, display all matching order records and their details. Two medium-sized KPI cards: 1. Total Completed Orders — display the count in green. 2. Total Pending Orders — display the count in red, with a clickable Click to See Orders feature to display all pending orders.
>
> **2. Order Entry Form.** Below the Dashboard, create a form with the following fields: Order Details — 1. Customer Name 2. Requested By 3. Design Name 4. Base Material Name 5. Printing File Name 6. Quantity of Slabs 7. Thickness of Slabs — dropdown: 3 cm (30 mm), 2 cm (20 mm), 1.2 cm (12 mm), Others. 8. Finishing Type — dropdown: Polishing, Leather, Honed, Others. When Others is selected, allow manual entry of the finishing type. 9. Requested Delivery Date. After these nine fields, add a centered subsection heading: DELIVERY STATUS. Delivery Status — 10. Actual Delivery Date 11. Person In-Charge Name 12. Reference Photo 13. Remarks
>
> **3. Reference Photo Upload & Editing.** Provide options to upload a reference photo either from the device gallery or directly using the camera. After uploading, provide image-editing tools, including: Crop and resize. Add text and notes. Draw circles, rectangles, and squares. Highlight or outline specific areas using different colours. Add arrows and annotations to point out specific details. Provide an editing experience similar to WhatsApp's image annotation tools, allowing users to highlight a particular area and add explanatory notes. Save the original and edited reference image with the corresponding order record.
>
> **4. Flexible Saving & Automatic Order Status.** Allow users to save an order even when some fields are left empty. Do not make every field mandatory. Automatically determine order status using the Actual Delivery Date: If Actual Delivery Date is empty → Pending (red indicator). If Actual Delivery Date is entered → Order Completed (green indicator).
>
> **5. Latest 10 Orders Table.** Below the form, create a table named Recent Orders, displaying the latest 10 records first. Show columns in exactly this order: 1. S.No. — descending sequence: 10, 9, 8, ... 2, 1. 2. Customer Name 3. Requested By 4. Design Name 5. Base Material Name 6. Printing File Name 7. Quantity of Slabs 8. Thickness of Slabs 9. Finishing Type 10. Requested Delivery Date 11. Actual Delivery Date — display -- if empty. 12. Person In-Charge Name 13. Remarks 14. Status — show: Pending (red indicator). Order Completed (green indicator). Ensure the table updates automatically after every new order entry or edit.
>
> **6. Important Requirements.** Keep the Orders section completely separate from all existing Chromia ERP modules and slab workflows. Order records must not affect slab counts, QC outcomes, Stockyard, Dispatch, Approved, Sample Cutting, Recalibration, Trimming, or any other production-related KPI or report. Use actual database storage so records and uploaded images persist after refresh. Implement working customer search and clickable Pending Orders KPI. Keep the form, dashboard, and table responsive and consistent with the existing ERP design. Do not introduce role-based access restrictions yet. Operator, In-Charge, and Admin permissions will be specified separately later. Do not modify any existing ERP functionality or business logic.

#### Decisions taken (for the owner to confirm or change)

- **Name and place:** "Orders", at `/chromia/orders`. In the sidebar it has its own ORDERS heading, last, after Attendance, so no existing entry moves. It is also last in the tablet swipe order.
- **Only Customer Name is required.** Every other field can be left empty and filled in later. An order with no customer name could not be found by the search, so the form refuses it.
- **Editing an order:** the Customer Name in every Orders table is a link that opens the order in the same form, to fill in or change anything. That is how an order is completed: enter its Actual Delivery Date. No Action column was added, because the requirement fixes the fourteen columns.
- **No Delete.** The requirement doesn't ask for one.
- **Thickness → Others** asks for a number and cm or mm, like Trimming's Others, and is shown in both units, for example `1.8 cm (18 mm)`.
- **Search** matches any part of the customer name, ignoring case ("acme" finds "Acme Tiles"). It lists every matching order, not only the latest ten, in the same fourteen columns, under the Dashboard.
- **Click to See Orders** opens a Pending Orders table of every pending order under the Dashboard. A second click closes it, as with the Dashboard's clickable KPIs. Total Completed Orders isn't clickable, because only the pending one was asked for.
- **S.No. counts down in every Orders table:** with fewer than ten orders, Recent Orders numbers them from the count down to 1, for example 2, 1.
- **Empty cells show "—"** as on the other Chromia tables, except Actual Delivery Date, which shows "--" as asked.
- **Dates:** no limits. A requested or actual delivery date may be any real date, because the requirement sets no rule.
- **Reference Photo editor**, built into the page:
  - **Getting a photo:** Open Camera, or Choose from Gallery.
  - **Tools:** Pen, Highlight, Rectangle, Square, Circle, Arrow, Text (type the note, then tap where it goes), and Crop (drag a box, then Apply Crop).
  - **Options:** six colours, three sizes, Resize (longest side 1600, 1200 or 800 px), Undo and Start Over.
  - **Storage:** photos are kept at most 2000 px on the longest side.
- **Saving photos:** on Save, the original and the marked-up copy are both stored. A new photo replaces the order's earlier pair, and the earlier pair is deleted. When an order is opened again, its saved photo is shown with links to the marked-up and the original copy. "Edit Saved Photo Again" reopens the original in the editor.
- **Suggestions:** Customer Name suggests names already used, Base Material Name suggests the Chromia base materials, and Printing File Name suggests the design file names. All three stay free text.
- **No access rules:** none were added, as asked. Every Chromia login can see and use Orders.

#### Implemented

- **Page `/chromia/orders`:** Dashboard (Search Customer Name, Total Completed Orders in green, Total Pending Orders in red with Click to See Orders), then Order Entry, then Recent Orders (the latest ten).
- **Status:** worked out from the Actual Delivery Date, never stored. The form shows the status beside Actual Delivery Date as it is typed.
- **Saving:** after a save the page refreshes, so the new order is at the top of Recent Orders and the KPIs change. A new-order form then empties itself. Saving from an opened order returns to Orders.
- **`/chromia/orders/<id>`:** one order in the same form, with Update Order.
- **Photos:** `/api/chromia/order-photo/<id>` serves only order photos, with the same safety headers as slab photos. The server checks the bytes really are an image (JPEG, PNG or WebP) and that each file is at most 8 MB.
- **Audit:** each save writes a Chromia audit log row (entity `Order`, CREATE or UPDATE).
- **Independence:** the Orders code reads and writes only `chromia_order`, its photos and the audit log. No other page, count, KPI, report or download reads an order. A test holds both of these.

Main files:
- `src/lib/chromia/orders.ts` (new: options, status, S.No., form rules)
- `src/lib/chromia/server/actions/orders.ts` (new)
- `src/lib/chromia/server/repositories/order-repository.ts` (new)
- `src/app/chromia/orders/page.tsx`, `order-form.tsx`, `photo-editor.tsx`, `orders-table.tsx`, `form-values.ts`, `[id]/page.tsx` (all new)
- `src/app/api/chromia/order-photo/[photoId]/route.ts` (new)
- `src/lib/chromia/constants/app.ts`, `src/lib/chromia/config/navigation.ts`, `src/lib/navModel.ts`
- `tests/chromia/orders.test.ts` (new)

#### Database

- `prisma/migrations/0009_orders/migration.sql`: one new table, `chromia_order`, with two indexes. It has no foreign key to any slab table, and no existing table or row changes.
- Photos are rows of the existing `entry_photo` table with model `ChromiaOrder`. The order keeps the ids of its original and marked-up copy.
- Applied to the local `chromia_erp` and to the test database. `prisma migrate diff` shows no difference on both.

#### Verified

- **Typecheck:** clean.
- **Unit tests:** Vitest 569 passed, 16 of them new in `tests/chromia/orders.test.ts`. Node tests 74 passed, including the sidebar parity check.
- **Build:** the production build compiles, with the three new routes.
- **On the test database:** the workflow check passes all 65 steps and the audit all 75 checks, with orders in the database. On the local `chromia_erp`, the audit passes all 75 checks.
- **In the browser, on the test database:**
  - **Full order:** every field filled, Finishing → Others "Brushed".
  - **Photo:** from the gallery, marked with a rectangle, an arrow, a yellow highlight and a text note. A second note was removed with Undo; then the photo was cropped and resized to 800 px.
  - **First save:** the order went to the top of Recent Orders as Pending, with "--" for Actual Delivery Date. The form emptied itself.
  - **Photos stored:** both the original and the marked-up JPEG are in `entry_photo`.
  - **Required field:** saving with no customer name was refused with "Enter the customer name". A customer-only order saved, and S.No. read 2, 1.
  - **Completing an order:** opening Acme Tiles from its name showed every field and the saved photo. Entering an Actual Delivery Date made it Order Completed, and the KPIs read 1 completed and 1 pending.
  - **Replacing the photo:** stored the new pair and deleted the old pair.
  - **Click to See Orders:** opened and closed the Pending Orders table.
  - **Search:** "acme" found Acme Tiles. "nobody" said no order was found.
  - **Sidebar and phone width:** the sidebar shows Orders. At 375 px wide the page has no sideways scroll; the tables scroll inside their cards. No console errors.
- **Not verified:**
  - **Camera:** the camera button wasn't tried, because this computer has no camera in the test browser. It uses the same code as the Approved Slabs photo.
  - **Gallery picker:** the photo was handed to the gallery input by a script, because the system file picker can't be driven.
  - **Circle, Square and Pen:** not drawn in the browser. They share the drag and draw code that was tested.
  - **Pacific-ERP:** nothing has been run there.

#### Main ERP notes

- **Schema:** the next numbered script creates `chromia_order` with its indexes. It must be idempotent, with an action_log row and an UNDO note (drop the table and delete `entry_photo` rows of model `ChromiaOrder`).
- **Sidebar:** add the Orders row to `CHROMIA_ITEMS` and an "Orders" section in the CHROMIA login's lists in `navModel.ts`, edit `tests/fixtures/nav-sidebar.json` by hand, and keep `chromiaNavParity` in step.
- **Access:** no rule was added. Pacific-ERP's `chromiaGate` still applies to the photo route.
- **Tests:** port `tests/chromia/orders.test.ts`. Its "no other file reads an order" test scans `src/`, so check it against the main ERP's larger tree.

---

### Change #2: Attendance — Out-Time the next day for any In-Time, and no longest shift

#### Requirement (as given)

> **Attendance In-Time & Next-Day Out-Time Fix (Robo ERP + Chromia ERP).** Analyze the existing interconnected Attendance module used by both Robo ERP and Chromia ERP and fix the following issue.
>
> **Required Change: Allow Next-Day Out-Time for Any Valid In-Time.** Previously, the overnight shift issue was partially fixed, but the current logic still allows next-day Out-Time only when the operator's In-Time is after 18:00. This restriction must be removed. An operator who records In-Time before 18:00 must also be allowed to enter Out-Time on the following day. For example: In-Time: 16:45 today → Out-Time: 06:12 tomorrow should be allowed. In-Time: 17:53 today → Out-Time: 06:12 tomorrow should be allowed. In-Time: 17:56 today → Out-Time: 06:12 tomorrow should be allowed. For the last example, the system should correctly calculate the total working duration as 12h 16m.
>
> **Implementation Requirements.** 1. Remove the hardcoded 18:00 restriction or any equivalent condition that prevents next-day Out-Time entry. 2. Allow an operator to record Out-Time on the next calendar day regardless of whether their In-Time was before or after 18:00. 3. Calculate the total working duration accurately using the actual In-Time and Out-Time date-time values, including overnight shifts. 4. Ensure that the next-day Out-Time is saved against the correct original attendance record and date. 5. Retain all existing validation rules, including preventing invalid Out-Time entries, duplicate active attendance records, and incorrect time calculations. 6. Do not break the existing multiple-shift-per-day functionality or other previously fixed overnight attendance scenarios.
>
> **Important: Both ERPs Must Reflect the Change.** Attendance is interconnected/shared between Robo ERP and Chromia ERP. Implement the fix in the shared attendance logic/backend so that the updated behaviour works consistently in both applications. Do not create separate or duplicate attendance logic for the two ERPs.
>
> **Strict Instructions.** First inspect the existing attendance implementation, database structure, and time-validation logic. Make only the changes required for this issue. Preserve all existing UI, workflows, permissions, validations, reports, downloads, and other attendance functionalities. Do not modify unrelated modules or functionality. Test the above scenarios, including In-Time before 18:00 and Out-Time the following morning, in both Robo ERP and Chromia ERP.
>
> **Expected Result:** Any valid In-Time today, whether before or after 18:00, must allow the operator to record Out-Time the next day, with accurate total working hours in both ERPs.

Added while it was being built (the owner, 17 Nov 2026):

> not only 16 hours, keep any time in time (for example operator can work continously for 35 hours also

#### Decisions taken (for the owner to confirm or change)

- **Both limits are gone:** the 18:00 rule, and the 16-hour longest shift that sat beside it. A shift may be any length.
- **The Out's date is now recorded.** The two times alone can't say how long a shift of a day or more was: 08:00 → 19:00 is 11 hours or 35. Each Out saved from now on records its date:
  - a stamped Out (the tablet's "Mark out now") gets today's date;
  - the Plant In-Charge's typed Out gets the date they give it, or, left empty, the date read from the times as before.
- **Rows saved before keep reading as they did.** They have no Out date, so an Out earlier than the In still counts as the next morning.
- **An open shift is always the shift still running.** With no longest shift, an In-Time left without an Out on the previous date is never "incomplete": the next date's register offers it to be marked out ("Night shift from …"). A new shift for that operator waits until it is marked out, as before. These still hold the next day as incomplete:
  - an Out with no In;
  - an earlier shift of that date left open.
- **The tablet** can mark out last night's shift on the next date, however long it has run. A shift that ran past the next date entirely, such as Saturday 06:00 to Monday, is typed by the Plant In-Charge with its Out date. That is how the tablet's today-only rule already works.
- **The In-Charge's editor** has a small **Out date** box under the Out-Time, on rows whose times are typed. Left empty, the date is read from the times. Filling it in is needed only for a shift that ended later than the next morning.
- **Overlaps:**
  - The next date's first shift may not start before a long shift ended. After 08:00 Sat → 19:00 Sun, Sunday's next In must be 19:00 or later.
  - A date that a shift ran through entirely takes no shift of its own.
  - Only the previous date's shifts are checked, as before.
- **Downloads:**
  - The Out-Time prints exactly as before for a shift ending the same day or the next morning.
  - It gets its date beside it only when the times can't place it: `19:00 (16/11/2026)` for a 35-hour shift.
  - Total Working Hours and the Sum of Total Working Hours count the full length.

#### Implemented

- **`src/lib/attendance/attendance.ts`, the shared rules both ERPs use:**
  - `workedMinutes` and `workedLabel` take the Out's date into account, and a shift's hours have no upper limit.
  - New `outDaysOf` and `endsAfterItsDate`; `outDate` reads a recorded Out date first.
  - `overnightShiftOpen` and `overnightAwaitingOut` no longer have the 18:00 or 16-hour conditions. `EVENING_SHIFT_FROM`, `MAX_SHIFT_MINUTES` and `SHIFT_TOO_LONG` are gone.
  - `shiftLengthError` refuses only an Out that isn't after the In.
  - `canStartAnotherShift`, `shiftOverlapError` and `laterThanNowError` read the recorded Out date.
- **`src/lib/attendance/server.ts`, the one API behind both screens:**
  - It records the Out date with every Out.
  - A typed Out date may not be before the shift's own date, on a date still to come, or later than now today.
  - Hours, Downloads and the audit trail all use the Out date.
- **`src/components/attendance/AttendanceClient.tsx`, the one register screen behind both doors:**
  - The Out date box, and live hours that use it.
  - Last night's Out, typed from today's register, is sent with today's date.

#### Database

- `prisma/migrations/0010_attendance_out_date/migration.sql` adds one nullable column, `attendance_day.outDate` (yyyy-mm-dd). No row is changed.
- Applied to the local `chromia_erp` and to the test database.

#### Verified

- **Typecheck:** clean.
- **Vitest:** 581 passed, with `tests/chromia/attendance-shifts.test.ts` rewritten for the new rules:
  - the owner's three examples;
  - 35 hours;
  - 49h 30m across two dates;
  - Out not after In;
  - the sum;
  - overlaps;
  - a typed future date.
- **Node tests:** 74 passed. Audit: all 75 checks pass. The production build compiles.
- **New `npm run test:attendance`, 40 of 40 checks pass.** It drives the shared API on a simulated plant clock, on the test database, as the line tablet and as the Plant In-Charge:
  - **The owner's three examples, from each login:** In 16:45 → 13h 27m, 17:53 → 12h 19m, 17:56 → 12h 16m. Each was saved on the original row and dated the next day.
  - **35 hours:** 08:00 Sat → 19:00 Sun, marked out by the tablet and typed by the In-Charge.
  - **49h 30m:** 06:00 Sat → 07:30 Mon.
  - **Overlaps:** a Sunday shift before the 35h one ended is refused, and one after it is accepted.
  - **Refused Outs:** future Out dates, an Out before the In, and equal times are refused.
  - **Incomplete days:** an Out with no In still holds the next day.
  - **Old rows:** a row from before reads 12h as it did.
  - **Two shifts on one date:** still work.
  - **Downloads:** the cells and the sum are correct.
- **In the browser, as the In-Charge, on the test database:**
  - **Jagadeesh's open 16:45 shift from 16 Nov** showed on 17 Nov's register as "Night shift from 16/11/2026". Under the old rule it would have been an incomplete day.
  - **Entering Out 06:12** showed 13h 27m and saved on the 16 Nov row, dated 17 Nov.
  - **Rajesh on 15 Nov:** In 08:00, Out 19:00 read 11h until Out date 16/11 was entered, then 35h. After saving it shows `19:00 16/11/2026 · 35h`. No console errors.
- **Not verified:**
  - **The Robo screen:** it isn't in the standalone. It uses the same component, API code and rules file, so the fix reaches it when ported, but it hasn't been opened.
  - **The tablet's screen:** the standalone runs as admin, so the tablet was exercised through the API only.
  - **Pacific-ERP:** nothing has been run there.

#### Main ERP notes

- **Schema:** the next numbered script adds `outDate` (nullable text), idempotent, with an action_log row and an UNDO note (drop the column; rows longer than the times can show would then read wrongly).
- **`src/lib/attendance/reportEmail.ts`, which is not in the standalone:** it uses `nightShiftRow` and `workedLabel`. It should select `outDate` and pass it (`nightShiftRow` reads `date` and `outDate` on the row; `workedLabel(in, out, outDaysOf(date, outDate))`), or a 35-hour shift shows its hours wrong in the 07:00 and 19:00 emails.
- **Removed exports:** `EVENING_SHIFT_FROM`, `MAX_SHIFT_MINUTES` and `SHIFT_TOO_LONG` are gone. Check Pacific-ERP for other importers, such as Robo pages and tests like `tests/attendance.test.ts` and `review1026Plant.test.ts`, and update tests pinned to the 16-hour or 18:00 rule.
- **Testing:** check the Robo attendance screen after the port, and port `scripts/workflow/attendance-check.ts` only if the main ERP wants it, since `scripts/workflow/` stayed out last time.

---

### Change #3: Edit and Delete for operators on every slab table

#### Requirement (as given)

> **Enable Edit & Delete Access for Operators.** Implement the following change in the Chromia ERP Operator Login. Operator Login Credentials: Email/Username: chromia@thepacific.group · Password: (given in chat; not recorded here)
>
> **1. Enable Edit & Delete Actions for Operators.** Currently, when logged in as an operator, the option to delete slabs is still unavailable. I have already requested this functionality earlier, but it has not been implemented correctly. I want both Edit and Delete buttons to be fully functional for operators, just like they are for users with higher-level access. Apply this change to the last column (Action) of the tables on ALL the following pages: 1. Slab Records 2. Stockyard 3. Dispatched 4. Approved Slabs 5. Trimming 6. Recalibration
>
> **2. Action Column Requirements.** Ensure the last column in every listed table is named Action. Display both Edit and Delete buttons in this column. Both buttons must work properly when logged in as an operator. Operators must be able to edit existing slab records and permanently delete slab records from all the listed sections. Ensure the changes are reflected correctly across all interconnected pages, dashboards, KPIs, reports, and records.
>
> **3. Important Instructions.** Remove the existing role-based restriction that prevents operators from using Edit and Delete actions on these pages. Do not limit this permission to only one page; it must apply consistently across all six sections. Ensure the Delete operation permanently removes the selected record from the database and updates all related views and counts. Retain the existing delete confirmation mechanism and data-integrity checks. Do not modify unrelated permissions, workflows, UI designs, or functionalities. Test all six sections using the provided Chromia operator login credentials and verify that both Edit and Delete work correctly.
>
> **Expected Result:** Chromia operators must have the same Edit and Delete functionality as higher-level users for slab records across all six specified sections. No page should have a missing, disabled, or non-functional Edit/Delete action for operators.

#### What was wrong

All six tables already showed Edit and Delete to every login (change 5, 7 Nov 2026). Edit already saved for operators. **Delete did not:** its server action asked for an admin (`requireChromiaAdmin('delete a slab record')`, the CHR-4 decision of 20 Oct 2026). An operator saw the button, confirmed, and got "Only an admin can delete a slab record." Dispatched's last column also read **Actions**, from change 12, not Action.

#### Decisions taken (for the owner to confirm or change)

- **Who may now delete a slab:** any Chromia login, meaning the line operator, the Plant In-Charge and admins. `requireActingUser` still refuses anyone who isn't a Chromia login, from whatever page the action is posted.
- **Unchanged, as not asked:** importing a production register and deleting an import stay admin-only. Import still says so to an operator.
- **Unchanged confirmation:** the Delete confirmation ("Delete slab … permanently?"), what is deleted (the slab, its earlier entries and everything recorded against it), and the audit log row.
- **Dispatched's column** is renamed Action, as this instruction asks, replacing change 12's "Actions".
- **Recal. Tracking** uses the same button and gains the same; it wasn't on the list but shares the action.

#### Implemented

- `src/lib/chromia/server/actions/slab-record.ts`: `deleteSlabRecordAction` asks `requireActingUser()` instead of `requireChromiaAdmin(...)`.
- `src/app/chromia/dispatch/page.tsx`: the last column is named Action.
- The comments in `current-user.ts` and `tier.ts` that listed slab deletion as admin-only are corrected.
- Tests: `tests/chromiaAdminActions.test.ts`, `tests/chromia/edit-and-sort.test.ts`, `dispatched.test.ts` and `dispatched-alter.test.ts` now hold the new rule and the Action heading.

#### Database

None.

#### Verified

- **Checks:** typecheck clean; Vitest 581 and node tests 74 pass; the production build compiles; the audit passes all 75 checks after the deletes.
- **Logged in as an operator, on the test database:** the standalone has no sign-in page, so the test copy ran as a Chromia operator (role `CHROMIA`, operator tier) — the tier chromia@thepacific.group has in Pacific-ERP. Import showed "done by an admin", confirming it was an operator.
- **Edit and Delete on each table, as that operator:**

| Page | Edit (saved, returned to the table) | Delete (confirmed in the dialog) |
|---|---|---|
| Slab Records | 900104, Slab Remarks | 900105 |
| Stockyard | 900301, Slab Remarks | 900302 |
| Dispatched | 900201, Slab Remarks | 900402 |
| Approved Slabs | 900108, Slab Remarks | 900303 |
| Recalibration | 900106, Slab Remarks | 900106 |
| Trimming | 900107 (graded C → Trimming on Slab Entry first), Sent Date → "Sent for Trimming" | 900107 |

- **The deletes were permanent:** none of the six deleted slab numbers is left in `chromia_slab`, soft-deleted or not. Each has a DELETE row in the Chromia audit log. The Dashboard went from 14 produced slabs to 8, each place down by the slab deleted from it. No console errors.
- **Not verified:**
  - **The real login:** the standalone has no sign-in, so chromia@thepacific.group itself wasn't used, and its password wasn't used or stored.
  - **Pacific-ERP:** nothing has been run there.

#### Main ERP notes

- **The operator login:** in the 27 Oct copy of Pacific-ERP, chromia@thepacific.group is a LINE_MANAGER on the CHROMIA branch, read as a Chromia operator by `chromiaTierOf` and let into `/chromia` by the middleware. Check its current role and branch after the port, then test the six tables signed in as it.
- **Tests:** port the four updated tests. `tests/chromiaAccess.test.ts` (chromiaCanManage) is unchanged and still right, because chromiaCanManage now guards import only.
