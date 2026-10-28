import { PLACE_COLORS, PLACE_LABELS, PRODUCTION_PLACES, type ProductionPlace } from '@/lib/chromia/constants/production-places';

import { readableInk } from './ink';

/**
 * The Reports page's charts (28 Oct 2026, change 11), server-rendered from the
 * rows report-repository.ts reads — no data is held here.
 *
 * One look throughout, the reference the owner gave: a titled panel, names
 * right-aligned beside thin rounded bars on faint vertical gridlines, and the
 * figure at the end of each bar. Every mark has a hover / focus tooltip (pure
 * CSS — group-hover — so it works without client script), the place colours
 * are the ERP's own (constants/production-places.ts), and text stays in ink,
 * never in a series colour.
 */

/** Whole-slab ticks: a count axis never reads 0.2 of a slab. */
export function countScale(max: number, targetTicks = 5): { max: number; ticks: number[] } {
  if (max <= 5) return { max: Math.max(1, max), ticks: Array.from({ length: Math.max(1, max) + 1 }, (_, i) => i) };
  const rough = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const top = Math.ceil(max / step) * step;
  return { max: top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

/**
 * Room kept at the right of every track for the figure at the bar's end, so
 * the longest bar is drawn at its true length rather than squeezed by its own
 * label — and the gridlines and axis share exactly the bars' scale.
 */
const ROOM = { wide: 'pr-20 sm:pr-28', compact: 'pr-20 sm:pr-24' } as const;

const LABEL_COL = {
  wide: 'w-24 shrink-0 truncate text-right text-[12px] sm:w-44 sm:text-[13px] lg:w-56',
  compact: 'w-20 shrink-0 truncate text-right text-[12px] sm:w-24 sm:text-[13px]',
} as const;

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
const slabs = (n: number) => `${n} ${n === 1 ? 'slab' : 'slabs'}`;

/** A hover / keyboard-focus tooltip above its mark. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="border-line surface pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-[0_4px_12px_rgba(16,24,40,0.12)] group-hover/mark:block group-focus/mark:block"
    >
      {children}
    </span>
  );
}

/** Faint vertical gridlines and the axis under a set of horizontal bars. */
function Grid({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ticks.map((tick) => (
        <span key={tick} className="absolute top-0 bottom-0 w-px bg-[var(--line)]" style={{ left: `${(tick / max) * 100}%` }} />
      ))}
    </div>
  );
}

function Axis({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <div aria-hidden className="text-muted relative mt-1 h-4 text-[11px] tabular-nums">
      {ticks.map((tick) => (
        <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${(tick / max) * 100}%` }}>
          {tick}
        </span>
      ))}
    </div>
  );
}


/**
 * Horizontal bars, highest first — one series, one colour. Each bar ends in
 * "count (share%)", as in the reference.
 */
export function HorizontalBars({
  rows,
  color,
  total,
  noun = slabs,
  compact = false,
}: {
  rows: { label: string; value: number }[];
  color: string;
  /** What the shares are of. */
  total: number;
  noun?: (n: number) => string;
  /** A half-width panel: a narrower name column. */
  compact?: boolean;
}) {
  const size = compact ? 'compact' : 'wide';
  const room = ROOM[size];
  const labelCol = LABEL_COL[size];
  const scale = countScale(Math.max(1, ...rows.map((r) => r.value)));
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3" data-bar={row.label}>
            <span className={labelCol} title={row.label}>
              {row.label}
            </span>
            <div className={`min-w-0 flex-1 ${room}`}>
            <div className="relative flex h-6 items-center">
              <Grid ticks={scale.ticks} max={scale.max} />
              <span
                tabIndex={0}
                aria-label={`${row.label}: ${noun(row.value)}, ${pct(row.value, total)}%`}
                className="group/mark relative z-10 h-5 rounded-r-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-600)]"
                style={{ width: `${(row.value / scale.max) * 100}%`, minWidth: row.value > 0 ? 3 : 0, background: color, flexShrink: 0 }}
              >
                <Tip>
                  <span className="font-semibold">{row.label}</span>
                  <br />
                  {noun(row.value)} · {pct(row.value, total)}%
                </Tip>
              </span>
              <span className="relative z-10 -mr-20 ml-2 sm:-mr-24 text-[13px] whitespace-nowrap tabular-nums">
                <span className="font-semibold">{row.value}</span>
                <span className="text-muted"> ({pct(row.value, total)}%)</span>
              </span>
            </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <span className={labelCol} />
        <div className={`min-w-0 flex-1 ${room}`}>
          <Axis ticks={scale.ticks} max={scale.max} />
        </div>
      </div>
    </div>
  );
}

/** The six places, as a key above the stacked bars. */
export function PlaceLegend({ places = PRODUCTION_PLACES }: { places?: readonly ProductionPlace[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Key">
      {places.map((place) => (
        <span key={place} className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap">
          <span className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/5" style={{ background: PLACE_COLORS[place] }} />
          {PLACE_LABELS[place]}
        </span>
      ))}
    </div>
  );
}

/**
 * Horizontal stacked bars: per design, its slabs split by place. Segments are
 * separated by a 2px gap; a segment wide enough carries its count, every
 * segment has a tooltip, and the row ends in its total.
 */
export function StackedPlaceBars({
  rows,
}: {
  rows: { label: string; total: number; places: Record<ProductionPlace, number> }[];
}) {
  const room = ROOM.wide;
  const labelCol = LABEL_COL.wide;
  const scale = countScale(Math.max(1, ...rows.map((r) => r.total)));
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3" data-stack={row.label}>
            <span className={labelCol} title={row.label}>
              {row.label}
            </span>
            <div className={`min-w-0 flex-1 ${room}`}>
            <div className="relative flex h-6 items-center">
              <Grid ticks={scale.ticks} max={scale.max} />
              <div className="relative z-10 flex h-5 shrink-0 gap-[2px]" style={{ width: `${(row.total / scale.max) * 100}%` }}>
                {PRODUCTION_PLACES.filter((place) => row.places[place] > 0).map((place, i, shown) => {
                  const n = row.places[place];
                  const share = n / row.total;
                  return (
                    <span
                      key={place}
                      tabIndex={0}
                      data-place={place}
                      aria-label={`${row.label}, ${PLACE_LABELS[place]}: ${slabs(n)}`}
                      className={`group/mark relative grid min-w-[3px] place-items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-600)] ${
                        i === shown.length - 1 ? 'rounded-r-[4px]' : ''
                      }`}
                      style={{ flexGrow: n, flexBasis: 0, background: PLACE_COLORS[place] }}
                    >
                      {share >= 0.12 && row.total / scale.max >= 0.25 ? (
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: readableInk(PLACE_COLORS[place]) }}>
                          {n}
                        </span>
                      ) : null}
                      <Tip>
                        <span className="font-semibold">{row.label}</span>
                        <br />
                        {PLACE_LABELS[place]}: {slabs(n)} ({pct(n, row.total)}%)
                      </Tip>
                    </span>
                  );
                })}
              </div>
              <span className="relative z-10 -mr-20 ml-2 sm:-mr-24 text-[13px] font-semibold whitespace-nowrap tabular-nums">{row.total}</span>
            </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <span className={labelCol} />
        <div className={`min-w-0 flex-1 ${room}`}>
          <Axis ticks={scale.ticks} max={scale.max} />
        </div>
      </div>
    </div>
  );
}

/**
 * A donut of the four placed outcomes, the total in its centre and every
 * count beside it. Slices are separated by a 2px surface gap.
 */
export function PlaceDonut({ slices }: { slices: { place: ProductionPlace; count: number }[] }) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  const R = 70;
  const W = 26;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row lg:flex-col xl:flex-row">
      <svg viewBox="0 0 180 180" className="size-44 shrink-0" role="img" aria-label={`Stock distribution of ${slabs(total)}`}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="var(--line)" strokeWidth={W} />
        {total > 0
          ? slices
              .filter((s) => s.count > 0)
              .map((s, _, shown) => {
                const length = (s.count / total) * C;
                const gap = shown.length > 1 ? 2 : 0;
                const dash = `${Math.max(length - gap, 0.5)} ${C - Math.max(length - gap, 0.5)}`;
                const offset = -at;
                at += length;
                return (
                  <circle
                    key={s.place}
                    data-slice={s.place}
                    cx="90"
                    cy="90"
                    r={R}
                    fill="none"
                    stroke={PLACE_COLORS[s.place]}
                    strokeWidth={W}
                    strokeDasharray={dash}
                    strokeDashoffset={offset}
                    transform="rotate(-90 90 90)"
                    className="transition-opacity hover:opacity-80"
                  >
                    <title>{`${PLACE_LABELS[s.place]}: ${slabs(s.count)} (${pct(s.count, total)}%)`}</title>
                  </circle>
                );
              })
          : null}
        <text x="90" y="86" textAnchor="middle" className="fill-[var(--chart-ink-strong)] text-[26px] font-semibold tabular-nums">
          {total}
        </text>
        <text x="90" y="106" textAnchor="middle" className="fill-[var(--chart-ink-soft)] text-[11px]">
          slabs
        </text>
      </svg>
      <ul className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
        {slices.map((s) => (
          <li key={s.place} className="flex items-center gap-3 text-sm" data-count={s.place}>
            <span className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/5" style={{ background: PLACE_COLORS[s.place] }} />
            <span className="min-w-0 flex-1 whitespace-nowrap">{PLACE_LABELS[s.place]}</span>
            <span className="font-semibold tabular-nums">{s.count}</span>
            <span className="text-muted w-14 text-right tabular-nums">{pct(s.count, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
