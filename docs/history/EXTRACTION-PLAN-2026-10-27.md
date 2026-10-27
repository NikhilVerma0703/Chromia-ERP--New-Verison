# Chromia ERP — Phase 1 Audit & Phase 2 Extraction Plan

Source: `Pacific-ERP-main (3).zip` (2,881 files, all extracted and checked against the archive listing).
Extracted to `main-erp-extracted/Pacific-ERP-main/` — **read-only from here on; nothing in it has been modified.**
Date of audit: 27 Oct 2026. No files have been copied or created beyond this plan.

---

## 1. What the main ERP is

| | |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript 5.7 |
| ORM / DB | Prisma 6.2 (`prisma-client-js`), PostgreSQL (Neon in production) |
| Styling | Tailwind 3.4 + `src/app/globals.css` (689 lines, ERP-wide tokens + a `.chromia-root` block) |
| Auth | next-auth v5 beta + `src/lib/rbac.ts` + edge `src/middleware.ts` (883 lines) |
| Tests | `node --test` (ERP) and **Vitest** for Chromia (`npm run test:chromia`, `vitest.config.ts`) |
| Package manager | npm (`package-lock.json`), Node ≥ 22.13 |
| Migrations | **None in Prisma form.** Schema changes are hand-numbered SQL in `scripts/NNNN-*.sql`; `db push` only for local DBs |
| Schema | `prisma/schema.prisma`, ~10,000 lines, 111+ models |

## 2. Chromia inventory (what belongs to the module)

**174 files carry "chromia" in their path. The import trace from Chromia's entry points reaches 213 files: 131 are Chromia's own code and 82 come from the shared ERP.**

| Area | Path | Files |
|---|---|---|
| Pages (11 sections + sub-routes) | `src/app/chromia/**` | 35 |
| API routes | `src/app/api/chromia/**` (exports, production export, attendance) | 3 |
| UI components | `src/components/chromia/**` (charts, ui kit, swipe-nav, filter bar) | 14 |
| Domain / server layer | `src/lib/chromia/**` (actions, services, repositories, validation, import, exports, constants, config) | 79 |
| Seed | `prisma/seed-chromia.ts` (stage definitions, locations, machines, materials, designs, defects, recal reasons) | 1 |
| Schema | `prisma/schema.prisma` lines ~5085–6262: **19 enums + 33 models (`Chromia*`, tables `chromia_*`)** — self-contained, with no relations to non-Chromia models | — |
| Vitest suite | `tests/chromia/*.test.ts` | 30 |
| Node-test files | `tests/chromia*.test.ts`, `tests/fabChromiaHeadLabel.test.ts` | 9 |
| SQL history | `scripts/0044`, `0045` (create module), `0046` (user migration), `0063` (FG status), `0118` (manager login) | 5 |
| Docs | `docs/CHROMIA-INTEGRATION-PLAN.md` | 1 |

### The 11 sections (from `src/lib/chromia/config/navigation.ts`, mirrored in `navModel.ts`)
Dashboard · Operator Entry · Slab Records · Stockyard · Dispatch · Recalibration · Recal. Tracking · Summary · Downloads · Import · Attendance

**The 12th sidebar item: Inventory → Slab Intake** (confirmed from your production screenshot of the Chromia login's sidebar). It is **not** Chromia module code. It is the main ERP's finished-goods intake page `/slab-intake` (`src/app/slab-intake/*`, 1,237 lines), which `navModel.ts` adds to the Chromia login's sidebar for the named intake people. It reads and writes **main-ERP finished-goods tables**: `fg_finished_slab` (FinishedSlab), `slab_event` (SlabEvent), `entry_photo` (slab photos), `fg_sales_hidden_design` and `fg_sales_approved_batch` (raw SQL), plus the design-name master (`lib/designList`). It reaches 88 files in all. It belongs with the finished-goods bridge question: see §8, Q2.

The production sidebar groups the items as follows, and the standalone sidebar will copy it exactly: **Production** (Dashboard, Operator Entry, Slab Records, Stockyard, Dispatch) · **Recalibration** (Recalibration, Recal. Tracking) · **Reports** (Summary, Downloads) · **Setup** (Import) · **Attendance** (Attendance) · **Inventory** (Slab Intake).

Hidden (link-only) routes kept: `/chromia/slabs/new` and `/chromia/slabs/[id]/edit` (both forward to Operator Entry), `/chromia/recalibrations/[slabId]`.

## 3. Shared ERP dependencies Chromia uses

| Dependency | Used for | Pulls in | Plan |
|---|---|---|---|
| `components/Shell.tsx` | Sidebar, user card, sign-out around every Chromia page | Nav, navModel (794 lines, every module's nav), RoleSwitcher, view-as banner, sales session, dashboard access… ~40 files | **Recreate** a small local `Shell` with the same sidebar look, listing only the 11 Chromia sections. No user card or sign-out. |
| `lib/rbac.ts` → `currentUser()` | Used by `access.ts`, `current-user.ts`, attendance server | next-auth, users, session revalidation, view-as, login throttle | **Replace** with a local `currentUser()` that always returns a fixed local user (no auth, as you required). |
| `lib/pageUser.ts` → `requirePageUser()` | First line of 12 pages | rbac, view-as | **Replace** with a local version that returns the same fixed user and never redirects. |
| `lib/prisma.ts` | The one Prisma client | The ERP's "view-as" write guard (`viewAs`, `viewAsServer`, `prismaReads`) | **Replace** with a plain Prisma singleton. The view-as guard is an ERP admin feature, so it has no meaning here. |
| `lib/roles.ts`, `lib/plantAccess.ts` | Tier rules (`chromiaTierOf`), attendance rights | Small, pure | **Copy and trim** to the roles Chromia reads. |
| `lib/attendance/*`, `components/attendance/AttendanceClient.tsx` | The Attendance section | `actionLog` (which drags in silo/tables/backfill), `viewAsServer`, `robo/exportStyle`, `robo/time`, `robo/TimeInput`, `components/ui`, `Toast`, `commercial/invoices/ui` | **Copy** attendance and its UI dependencies. Replace the `actionLog` audit write with a local equivalent and drop `viewAsServer`. Leave out `reportEmail.ts` (the cron email job). |
| `lib/inventory/finishedSlab.ts` (via `chromia/inventory-bridge.ts`) | Marks the **main ERP's finished-goods** slab as `CHROMIA` when a slab enters printing; unmarks it on corrections | 1,100 lines + grading, slabFixRules, thickness; needs `FinishedSlab` + `SlabEvent` tables | **Decision needed (see §8, Q2).** Recommended: a local no-op bridge with the same function signatures that logs what it would have marked. The bridge is already written so it can never fail a save. |
| `lib/prisma` `user` table (via `chromia/actors.ts`) | Shows actor display names for `*ById` columns | ERP `users` table | **Adapt**: resolve names from the local user, falling back to the dormant `ChromiaUser` table. |
| `app/globals.css`, `tailwind.config.ts`, root `layout.tsx` | Base tokens + `.chromia-root` rules | — | **Copy** the token and base layers plus the `.chromia-root` block. Leave out other modules' CSS. |
| `public/` icons | Favicon/manifest | — | Copy icons only. |

npm packages needed (subset of the ERP's): `next`, `react`, `react-dom`, `@prisma/client`, `prisma`, `zod`, `clsx`, `tailwind-merge`, `xlsx` (SheetJS CDN tarball, as the ERP pins it), `xlsx-js-style`, `tailwindcss@3`, `postcss`, `autoprefixer`, `typescript`, `tsx`, `vitest`, `@types/*`.
**Not needed:** next-auth, bcryptjs, nodemailer, pdf-lib, pdfjs, pdfmake, sharp, tesseract, exceljs, recharts (Chromia draws its own charts), Inngest.

## 4. Environment variables

Read by Chromia or its dependencies: `DATABASE_URL` (required), `DATABASE_URL_POOLED` (Neon only, so it will be dropped), `LOG_LEVEL` (optional), `NODE_ENV`, `NEXT_RUNTIME` (set by Next). `ATTENDANCE_REPORT_EMAILS` belongs to the email cron, which will be left out.
New, optional: `CHROMIA_ACTING_USER_NAME`, the name recorded as "who did it" on local writes.
**There is no `.env` file in the ZIP.** No secrets were found to exclude. I will also not copy `.claude/settings.json`, `claude/claude-mem-export.json` or other machine-specific files.

## 5. Change history: what the code shows vs. what was documented

**Finding: the ZIP contains no Chromia change-request documents.** The only Chromia planning doc is `docs/CHROMIA-INTEGRATION-PLAN.md`, the original July/August merge plan. The repo's `CLAUDE.md` names `context.md`, `review-fix-plan.md` and `audit-triage.md`, but **none of the three is in the archive.** The August–September change requests you mentioned (pushed to GitHub separately) are not here, so I **cannot yet do the documented-vs-implemented comparison** for them. Please send them (see §8, Q1).

What the code itself shows as implemented, from dated comments and tests:

| # | Change | Evidence | Status |
|---|---|---|---|
| 1 | Module ported in whole as `Chromia*` models with full namespacing (integration plan §4) | schema, `scripts/0045` | Implemented |
| 2 | Chromia's own Dashboard and Summary kept as screens. **This differs from the integration plan §6**, which said to fold them into `/tables` and `/report` | `app/chromia/dashboard`, `reports` | Implemented (plan superseded) |
| 3 | Integration plan Phase 4: port the Vitest suite to `node --test` | `vitest.config.ts` keeps Vitest on purpose | **Not done, by decision** |
| 4 | Header tab strip removed; sidebar is the navigation; swipe-between-sections kept | `layout.tsx` | Implemented |
| 5 | Slab Intake taken out of the menu; QC moved onto Operator Entry; old routes forward | `navigation.ts`, `slabs/new`, `slabs/[id]/edit` | Implemented |
| 6 | Stockyard: stocked A/B slabs can be released and dispatched later | `stockyard/*` | Implemented |
| 7 | Dispatch queue separate from QC grading | `dispatch/*` | Implemented |
| 8 | Recalibration flow (trip → restart → regrade, five-attempt ceiling) + Recal. Tracking | `recalibration-flow*`, tests | Implemented |
| 9 | Excel register import (PRO register) + undo/delete import | `import/*` | Implemented |
| 10 | Shared attendance register (Robo and Chromia), roster order (0139), leave type (0140), evening-shift and today-only rules (owner, 26 Oct) | `lib/attendance` | Implemented |
| 11 | Finished-goods "CHROMIA" status bridge (0063) | `inventory-bridge.ts` | Implemented. **ERP-only integration** |
| 12 | Plant In-Charge role gets the OPERATOR tier (26 Oct, scripts/0141) | `tier.ts` | Implemented (becomes moot without auth) |
| 13–22 | Code review of 20 Oct 2026, **CHR-1 to CHR-10**: QC Edit can't undo a real dispatch (1); import delete keeps hand-worked slabs (2); dashboard counts only real dispatches (3); delete/import admin-only (4); one transaction per QC save (5); double-dispatch race guard (6); import chunking and deadline (7); plant-day dates in all reports (8); FG mark follows slab-number corrections (9); list paging limits (10) | named in comments + `tests/chromia*.test.ts` | Implemented |
| 23 | AUTH-2: per-page session re-check | `requirePageUser` in every page | Implemented. **Removed in standalone (no auth)** |

Each line will be checked again when I copy it (Phase 3). Once you send the GitHub change-request files, I will add each one to this table as implemented, partly implemented or not implemented, with file evidence.

## 6. Extraction plan (Phase 3, only after your approval)

Target: `Chromia-ERP-Standalone/`, next to `main-erp-extracted/`.

**A. Copy without changes** (business logic stays as it is)
- `src/app/chromia/**`, keeping the routes under `/chromia/*` so every internal link, `APP_ROUTES` entry, redirect and test still works unchanged.
- `src/app/api/chromia/**`, `src/components/chromia/**`, `src/lib/chromia/**` (except the 6 seams in B)
- `tests/chromia/**` (Vitest), `prisma/seed-chromia.ts`, `prisma/seed-attendance.ts`
- Attendance: `src/lib/attendance/{attendance,clock,filters,report,server}.ts`, `src/components/attendance/AttendanceClient.tsx`, `src/components/{ui.tsx,Toast.tsx}`, `src/components/robo/TimeInput.tsx`, `src/lib/robo/{time,exportStyle,exportRowRoles}.ts`, `src/components/commercial/invoices/ui.ts`
- Pure helpers: `src/lib/roles.ts`, `src/lib/plantAccess.ts` (trimmed only if they import something missing)

**B. Adapt** (each change marked with a `STANDALONE:` comment saying what the ERP did)
1. `src/lib/prisma.ts`: plain Prisma singleton.
2. `src/lib/rbac.ts`: new, about 20 lines. `currentUser()` returns `{ id: "local-user", name, email, role: "ADMIN" }`.
3. `src/lib/pageUser.ts`: returns that user and never redirects.
4. `src/components/Shell.tsx`: new and small. The same sidebar styling with the 11 sections, no login or sign-out.
5. `src/lib/chromia/inventory-bridge.ts`: no-op that logs (pending Q2).
6. `src/lib/chromia/actors.ts`: names from the local user / `ChromiaUser` instead of the ERP `users` table.
7. `src/lib/attendance/server.ts`: `actionLog` replaced by a local audit write (`ChromiaAuditLog`, or a console log; see Q4). `viewAsServer` and `rbac` swapped for the local versions.
8. `src/app/page.tsx`: `/` redirects to `/chromia/dashboard`, so opening localhost lands on Chromia.
9. Root `layout.tsx` + `globals.css` + `tailwind.config.ts`: the ERP base plus the `.chromia-root` block only.
10. `middleware.ts`: **none**, since nothing needs gating.

**C. Database**
- `prisma/schema.prisma` = generator + datasource + the 19 Chromia enums + 33 Chromia models + the 3 Attendance models, copied character-for-character with all `@map`/`@@map`, so table names stay the same as production (`chromia_*`, `attendance_*`).
- A real Prisma migration baseline: `prisma/migrations/0001_init/migration.sql`, generated with `prisma migrate diff --from-empty`. Then `npm run db:migrate` works on a fresh local DB, followed by `npm run db:seed:chromia` and `npm run db:seed:attendance`.
- The historical Neon SQL scripts (0044/0045/0046/0063/0118/0123/0139/0140) are kept under `docs/history/sql/` as a record only. They are not run.

**D. Config**: `package.json` (trimmed deps; scripts `dev`, `build`, `start`, `test:chromia`, `typecheck`, `db:migrate`, `db:seed:*`), `tsconfig.json`, `next.config.mjs` (security headers kept; PWA/Vercel bits dropped), `postcss.config.js`, `.gitignore`, `.env.example`, `README.md`. **No Docker, no auth, no deployment config.**

**E. Docs**: `docs/history/CHROMIA-INTEGRATION-PLAN.md`, `docs/history/sql/*`, any change-request files you send, `docs/EXTRACTION-REPORT.md` (file-by-file summary, features, gaps, test results).

**F. Tests**
- Vitest suite: copied as is.
- The 9 ERP `node --test` Chromia files: the ones that test pure Chromia rules (`chromiaAccess`, `chromiaListLimits`, `chromiaQcCorrection`, `chromiaReportDays`, `chromiaImportRuns`, `chromiaAdminActions`) are ported to Vitest.
- `chromiaNavParity` (checks Chromia's nav against the ERP `navModel`) is rewritten to check against the new local Shell.
- `fabChromiaHeadLabel` is a Fabrication test, so it is left out.

## 7. What will NOT work standalone (by necessity)

1. **Finished-goods marking** (slab status `CHROMIA` in the main ERP's FG inventory, plus `chromia_conflict` events). This writes to another module's tables.
2. **Robo-side attendance**: the register is shared with Robo in production. Standalone, it is a Chromia-only copy of the same tables.
3. **Links out of the Chromia login's nav to `/inventory` (Finished Goods) and `/slab-intake`**: main-ERP pages, not part of the module. Left out.
4. **Month incentive viewer** (navModel, 26 Oct): an ERP page. Left out.
5. **Attendance daily email cron** (`reportEmail.ts`, nodemailer). Left out.
6. **Real user attribution**: every write is recorded against one local user until auth is added.
7. **Role tiers**: everything runs as ADMIN, so the delete-slab / import / delete-import controls are visible (see Q3).

## 8. Questions before Phase 3

1. **Change-request documents.** They are not in the ZIP. Can you add them to the chat, or tell me where they are on disk / GitHub? Without them, §5 can only list what the code shows.
2. **Finished goods: Slab Intake (12th sidebar item) + the CHROMIA-status bridge.** These two stand or fall together, because both write the main ERP's finished-goods tables.
   (a) **Recommended now that Slab Intake is confirmed as a section:** carry a *local finished-goods slice*: the `FinishedSlab`, `SlabEvent`, `SlabStatus`, `EntryPhoto` and design-master models, plus the two `fg_sales_*` tables, with `/slab-intake` and the real `finishedSlab.ts`/grading logic. Slab Intake then works as it does today, and the bridge keeps marking slabs `CHROMIA`, against the local DB. Cost: about 90 more files and about 8 more tables. The local FG table starts empty, so it will not match production stock.
   (b) Leave Slab Intake out and stub the bridge as a no-op. The result is smaller and purely Chromia, but 11 sections instead of 12.
3. **Access tier for the local user.** **Recommended:** ADMIN, so every control in all 11 sections works, including the 3 admin-only destructive actions. The alternative is OPERATOR, which hides those three.
4. **Attendance audit trail.** The ERP writes attendance edits to its global `ActionLog`. **Recommended:** write them to the existing `ChromiaAuditLog` table, so no new table is added.
5. **Database.** PostgreSQL 16 is installed on this machine. **Recommended:** a local database `chromia_erp` on `localhost:5432` through Prisma migrations. Confirm, or name another DB/URL.
6. **Location.** The folder the app made for this session is deleted with the session. Where should `Chromia-ERP-Standalone` live long-term? For example, `C:\Users\User\Desktop\Chromia ERP\`, with the extracted main ERP next to it.
