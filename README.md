# Chromia ERP — standalone

The Chromia line's ERP (slab intake → processing → QC → grading → recalibration loop → stockyard / dispatch, with dashboard, summary, downloads, register import and attendance), extracted on 27 Oct 2026 from the Pacific ERP main repository so it can be developed on its own.

- **Stack:** the one Pacific ERP uses: Next.js 15 (App Router), React 19, TypeScript, Prisma 6, PostgreSQL, Tailwind 3, Vitest.
- **Local development only:** no Docker, no sign-in. Open `http://localhost:3000` and the Chromia Dashboard opens directly, with all 12 sidebar items: Dashboard, Operator Entry, Slab Records, Stockyard, Dispatch, Recalibration, Recal. Tracking, Summary, Downloads, Import, Attendance and Slab Intake.
- Every save is recorded as one local admin user (`src/lib/rbac.ts`).

What came across, what was adapted and what still needs the main ERP: [docs/EXTRACTION-REPORT.md](docs/EXTRACTION-REPORT.md).

## Requirements

- Node.js **22.13 or newer** (`node -v`)
- PostgreSQL 14 or newer running locally (developed against 16)

## Setup (first time)

```bash
npm install
```

Copy the environment file and set your local Postgres password in `DATABASE_URL`:

```bash
copy .env.example .env
```

Create the database and its 47 tables. Prisma creates the `chromia_erp` database if it does not exist, then applies `prisma/migrations/0001_init`:

```bash
npm run db:migrate
```

Load the master data: stage definitions, locations, machines, base materials, designs, defect types, recalibration reasons, and the attendance roster:

```bash
npm run db:seed
```

## Run

```bash
npm run dev
```

Then open http://localhost:3000.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` then `npm start` | Production build, served locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:chromia` | Chromia's Vitest suite (`tests/chromia/`) |
| `npm run test:node` | The Chromia rules Pacific ERP tested with `node --test` (`tests/*.test.ts`) |
| `npm test` | Both |
| `npm run db:migrate` | Apply migrations; after a `schema.prisma` edit, create the next one |
| `npm run db:reset` | Drop and recreate the local database, then re-seed (**deletes all data**) |
| `npm run db:seed` | Re-run the seeds. Safe to repeat: every write is an upsert |
| `npm run db:studio` | Browse the tables in Prisma Studio |

## Database notes

- Table and column names are the same as production (`chromia_*`, `attendance_*`, `fg_*`, `entry_photo`, `polish_qc`, `press`, `jot`). The models in `prisma/schema.prisma` are copied unchanged from the main ERP.
- Schema changes are made with Prisma migrations: edit `schema.prisma`, then `npm run db:migrate -- --name <what-changed>`. Pacific ERP's hand-numbered Neon scripts are kept only as history in `docs/history/sql/`. **Do not run them.**
- **The app runs on UTC.** `npm run dev`, `build`, `start` and the seed scripts set `TZ=UTC` (through `cross-env`), because production runs on Vercel in UTC and stores dates as UTC midnight. Screens still show plant time (Asia/Kolkata), and the attendance clock rules use the plant clock. Start the app with these npm scripts rather than calling `next dev` directly, or dates will be stored in your PC's time zone.
- A fresh database has no slabs. Data is entered through the app (Slab Entry, Import, Slab Intake).

## Folder map

```
src/app/chromia/          the 11 Chromia screens (+ forwarding routes)
src/app/slab-intake/      Inventory → Slab Intake (finished goods)
src/app/api/              chromia exports, attendance API, /api/photo
src/lib/chromia/          the module: actions, services, repositories, validation, import, exports
src/lib/attendance/       the attendance register
src/lib/inventory/        the finished-goods slice Slab Intake and the Chromia bridge use
src/components/           Shell + sidebar, chromia/ UI kit, attendance UI, shared widgets
prisma/                   schema, migrations, seeds
tests/                    chromia/ (vitest) and chromia*.test.ts (node --test)
docs/                     extraction report, history, change-requests/
```
