import { PLACE_COLORS, PLACE_LABELS, PRODUCTION_PLACES, type ProductionPlace } from '@/lib/chromia/constants/production-places';

import { readableInk } from './ink';

/**
 * The six production places as one horizontal bar — each place in its own
 * colour, as wide as its share, with its count — and a key under it that
 * always names all six, an empty place included, so the colours can be learnt
 * once and read everywhere else in the ERP.
 */
export function PlacePalette({ counts }: { counts: Record<ProductionPlace, number> }) {
  const total = PRODUCTION_PLACES.reduce((sum, place) => sum + counts[place], 0);
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return (
    <figure className="m-0" aria-label="Where the produced slabs are">
      {total === 0 ? (
        <div className="border-line text-muted grid h-12 place-items-center rounded-lg border border-dashed text-sm">
          No slabs produced yet.
        </div>
      ) : (
        <div className="flex h-12 w-full gap-[2px] overflow-hidden rounded-lg">
          {PRODUCTION_PLACES.filter((place) => counts[place] > 0).map((place) => (
            <div
              key={place}
              data-place={place}
              className="grid min-w-[44px] place-items-center transition-opacity hover:opacity-85"
              style={{ background: PLACE_COLORS[place], flexGrow: counts[place], flexBasis: 0 }}
              title={`${PLACE_LABELS[place]}: ${counts[place]} slabs (${pct(counts[place])}%)`}
            >
              <span
                className="text-[12px] font-semibold whitespace-nowrap tabular-nums"
                style={{ color: readableInk(PLACE_COLORS[place]) }}
              >
                {counts[place]}
              </span>
            </div>
          ))}
        </div>
      )}

      <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {PRODUCTION_PLACES.map((place) => (
          <span key={place} className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
            <span
              className="inline-block size-3.5 shrink-0 rounded-sm ring-1 ring-black/5"
              style={{ background: PLACE_COLORS[place] }}
            />
            <span className="font-medium">{PLACE_LABELS[place]}</span>
            <span className="text-muted tabular-nums">
              {counts[place]} · {pct(counts[place])}%
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
