'use client';

import { useState } from 'react';

import { countScale } from './report-charts';

const W = 800;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 32, left: 40 };

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const fullFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const at = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Daily Production Trend (28 Oct 2026, change 11): unique slabs produced per
 * plant day, a 2px line on a recessive grid. Hovering (or moving the keyboard
 * focus with the arrow keys) puts a crosshair on the nearest day and a
 * tooltip with its count. Every day of the range is a point, a quiet one at 0.
 */
export function TrendLine({ points, color }: { points: { day: string; slabs: number }[]; color: string }) {
  const [active, setActive] = useState<number | null>(null);
  // Whole slabs on the axis, never 2.5 of one.
  const scale = countScale(Math.max(1, ...points.map((p) => p.slabs)), 4);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / scale.max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.slabs).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const total = points.reduce((n, p) => n + p.slabs, 0);

  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = points.length === 1 ? 0 : Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  };

  const shown = active === null ? null : points[active];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none outline-none"
        role="img"
        tabIndex={0}
        aria-label={`Slabs produced per day: ${total} over ${points.length} day${points.length === 1 ? '' : 's'}`}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onTouchStart={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onTouchMove={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
          if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
        }}
      >
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-[var(--chart-ink-soft)] text-[11px] tabular-nums">
              {tick}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          // Every n-th day, and the last — unless the last would sit on the one before it.
          (i % labelEvery === 0 && !(i !== points.length - 1 && points.length - 1 - i < labelEvery / 2)) || i === points.length - 1 ? (
            <text key={p.day} x={x(i)} y={H - 10} textAnchor="middle" className="fill-[var(--chart-ink-soft)] text-[11px]">
              {dayFmt.format(at(p.day))}
            </text>
          ) : null,
        )}
        {shown && active !== null ? (
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--chart-ink-soft)" strokeDasharray="3 3" strokeWidth={1} />
        ) : null}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.length <= 31
          ? points.map((p, i) => (
              <circle key={p.day} cx={x(i)} cy={y(p.slabs)} r={active === i ? 5 : 4} fill={color} stroke="var(--surface, #fff)" strokeWidth={2} />
            ))
          : shown && active !== null ? (
              <circle cx={x(active)} cy={y(shown.slabs)} r={5} fill={color} stroke="var(--surface, #fff)" strokeWidth={2} />
            ) : null}
      </svg>
      {shown && active !== null ? (
        <div
          role="tooltip"
          className="border-line surface pointer-events-none absolute top-2 z-20 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-[0_4px_12px_rgba(16,24,40,0.12)]"
          style={{ left: `${(x(active) / W) * 100}%` }}
        >
          <span className="font-semibold">{fullFmt.format(at(shown.day))}</span>
          <br />
          {shown.slabs} {shown.slabs === 1 ? 'slab' : 'slabs'} produced
        </div>
      ) : null}
    </div>
  );
}
