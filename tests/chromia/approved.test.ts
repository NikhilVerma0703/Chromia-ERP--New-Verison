import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { approvedDateWhere, approvedSlabWhere, buildApprovedQuery, hasApprovedFilters, parseApprovedFilters } from '@/lib/chromia/approved-filters';
import { navigation } from '@/lib/chromia/config/navigation';
import { plantDayRange } from '@/lib/chromia/plant-time';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Approved Slabs → Find a Slab (27 Oct 2026)', () => {
  it('no filter means every approved slab', () => {
    const none = parseApprovedFilters({});
    expect(hasApprovedFilters(none)).toBe(false);
    expect(approvedDateWhere(none)).toEqual({});
    expect(approvedSlabWhere(none)).toEqual({});
  });

  it('Approved Date is one plant day of the approving stock entry', () => {
    const f = parseApprovedFilters({ approvedDate: '2026-10-26' });
    const { from, to } = plantDayRange('2026-10-26', '2026-10-26');
    expect(approvedDateWhere(f)).toEqual({ releasedAt: { gte: from, lte: to } });
    expect(parseApprovedFilters({ approvedDate: '2026-02-30' }).approvedDate).toBe('');
  });

  it('combines batch, material and design, matching anywhere', () => {
    const where = approvedSlabWhere(parseApprovedFilters({ batchNo: '14', baseMaterial: 'astral', fileName: 'taj' }));
    expect(where.batch).toEqual({ batchNo: { contains: '14', mode: 'insensitive' } });
    expect(where.baseMaterial).toEqual({ name: { contains: 'astral', mode: 'insensitive' } });
    expect(where.plannedDesign).toEqual({
      OR: [
        { fileName: { contains: 'taj', mode: 'insensitive' } },
        { name: { contains: 'taj', mode: 'insensitive' } },
      ],
    });
    expect(new URLSearchParams(buildApprovedQuery(parseApprovedFilters({ fileName: 'taj' }))).get('fileName')).toBe('taj');
  });
});

describe('Approved Slabs page (27 Oct 2026)', () => {
  const page = read('src/app/chromia/approved/page.tsx');
  const repo = read('src/lib/chromia/server/repositories/approved-repository.ts');

  it('sits directly below Dispatched in both navigations', () => {
    const hrefs = navigation.map((n) => n.href);
    expect(hrefs.indexOf('/chromia/approved')).toBe(hrefs.indexOf('/chromia/dispatch') + 1);
    const nav = read('src/lib/navModel.ts');
    expect(nav).toMatch(/label: "Dispatched" \},\n(?:\s+\/\/[^\n]*\n)*\s+\{ href: "\/chromia\/approved",\s+icon: I\.approved, label: "Approved Slabs" \}/);
    expect(nav).toMatch(/"\/chromia\/dispatch", "\/chromia\/approved"\]\.includes/);
  });

  it('is Dashboard (one KPI), Find a Slab, Approved Slabs', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'Approved Slabs']);
    expect(page.indexOf('<ApprovedFindASlab')).toBeGreaterThan(page.indexOf('title="Dashboard"'));
    expect([...page.matchAll(/<Stat label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Total Approved Slabs']);
    const form = read('src/app/chromia/approved/find-a-slab.tsx');
    expect(form).toMatch(/<SectionCard title="Find a Slab"/);
    expect(form).toMatch(/Apply Filters/);
    expect(form).toMatch(/Clear Filters/);
  });

  it('lists the ten columns in exactly the order asked for, and the Action column last (28 Oct 2026)', () => {
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
    expect([...head.matchAll(/>([^<>]+)<\/th>/g)].map((m) => m[1])).toEqual([
      'Approved Date',
      'Production Date',
      'Batch No.',
      'Slab No.',
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
      'Grade',
      'Slab Remarks',
      'View',
      'Action',
    ]);
  });

  it('shows the camera until a photo is saved, then the eye; the slab number opens the slab too', () => {
    expect(page).toMatch(/slab\.photo \? <ViewPhotoButton photoId=\{slab\.photo\.id\} slabNo=\{slab\.slabNo\} \/> : <TakePhotoLink href=\{open\} slabNo=\{slab\.slabNo\} \/>/);
    expect(page).toMatch(/<Link href=\{open\} className=\{`\$\{link\} font-mono`\}/);
    expect(read('src/app/chromia/approved/photo-buttons.tsx')).toMatch(/Click Picture of Slab/);
  });

  it('counts each approved slab once, the same way for the KPI and the table', () => {
    expect(repo).toMatch(/export async function approvedKpi[\s\S]{0,400}distinct: \['slabId'\]/);
    // Approved now, each physical slab once (change 10).
    expect(repo).toMatch(/slab: \{ AND: \[await physicalSlabWhere\(\), \{ status: SlabStatus\.APPROVED \}\] \}/);
    const list = repo.slice(repo.indexOf('export async function listApprovedSlabs('));
    expect(list).toMatch(/releaseOutcome: StockOutcome\.APPROVED,/);
    expect(list).toMatch(/distinct: \['slabId'\]/);
  });
});

describe('Approved slab photo (27 Oct 2026)', () => {
  const action = read('src/lib/chromia/server/actions/approved.ts');
  const view = read('src/app/chromia/approved/[slabId]/page.tsx');
  const capture = read('src/app/chromia/approved/[slabId]/photo-capture.tsx');

  it('stores only a real image of an approved slab, against that slab, adding never overwriting', () => {
    expect(action).toMatch(/const kind = KINDS\.find\(\(candidate\) => candidate\.magic\(bytes\)\);/);
    expect(action).toMatch(/if \(!\(await loadApproval\(slab\.id\)\)\)/);
    expect(action).toMatch(/await prisma\.entryPhoto\.create\(\{[\s\S]{0,120}model: SLAB_PHOTO_MODEL,\n\s+recordId: slab\.id,/);
    // No slab is created or changed by a photo.
    expect(action).not.toMatch(/chromiaSlab\.(create|update|upsert)|entryPhoto\.(update|delete|upsert)/);
  });

  it('shows the entry and QC Report read-only, marked as Approved, with the photo controls under it', () => {
    expect(view).toMatch(/Marked as Approved/);
    expect(view).not.toMatch(/<form|Action\b/);
    expect(view.indexOf('title="New Entry"')).toBeLessThan(view.indexOf('title="QC Report"'));
    expect(view.indexOf('title="QC Report"')).toBeLessThan(view.indexOf('<PhotoCapture'));
  });

  it('offers the camera and an upload, crops before saving, and returns to Approved Slabs', () => {
    expect(capture).toMatch(/navigator\.mediaDevices\.getUserMedia\(/);
    expect(capture).toMatch(/capture="environment"/);
    expect(capture).toMatch(/Upload Image/);
    expect(capture).toMatch(/drawImage\(img, sx, sy, sw, sh, 0, 0, canvas\.width, canvas\.height\)/);
    expect(capture).toMatch(/router\.push\(APP_ROUTES\.approved\)/);
    expect(capture).toMatch(/'Save Changes'/);
  });
});
