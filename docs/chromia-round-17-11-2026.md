# Chromia ERP — change round of 17 Nov 2026

The running record of this round's changes, in the order they were asked for.
Each change is one commit on branch `chromia-round-17-11-2026`, started from
`main` at `15ab47b` (GitHub's "Changes 1-12").

## Status

| # | Change | State | Commit |
|---|--------|-------|--------|
| 1 | Orders: a standalone section for recording and tracking customer orders | Done | See `git log`: "Chromia change 1 (17 Nov round)" |

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
