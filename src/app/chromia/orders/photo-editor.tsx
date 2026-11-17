'use client';

import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';

/** What the order form takes from the editor when it saves. */
export interface PhotoEditorHandle {
  /** The original and the annotated photo as JPEGs — or null when no photo was taken. */
  result(): Promise<{ original: Blob; edited: Blob } | null>;
  /** Back to empty, for the next order. */
  clear(): void;
}

/** The longest side a stored photo keeps — sharp on a screen, small in the database. */
const MAX_SIDE = 2000;

type Tool = 'pen' | 'highlight' | 'rect' | 'square' | 'circle' | 'arrow' | 'text' | 'crop';

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'pen', label: 'Pen' },
  { tool: 'highlight', label: 'Highlight' },
  { tool: 'rect', label: 'Rectangle' },
  { tool: 'square', label: 'Square' },
  { tool: 'circle', label: 'Circle' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'text', label: 'Text' },
  { tool: 'crop', label: 'Crop' },
];

const COLOURS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'White', value: '#ffffff' },
  { name: 'Black', value: '#111827' },
];

const SIZES = [
  { label: 'Thin', factor: 0.6 },
  { label: 'Medium', factor: 1 },
  { label: 'Thick', factor: 1.8 },
];

/** Resize choices: the longest side, in pixels. */
const RESIZE = [1600, 1200, 800];

interface Pt {
  x: number;
  y: number;
}

type Shape =
  | { kind: 'pen' | 'highlight'; colour: string; width: number; points: Pt[] }
  | { kind: 'rect' | 'square' | 'circle' | 'arrow'; colour: string; width: number; a: Pt; b: Pt }
  | { kind: 'text'; colour: string; size: number; at: Pt; text: string };

interface Snapshot {
  base: HTMLCanvasElement;
  shapes: Shape[];
}

const button =
  'border-line surface hover:border-line-strong inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-55';
const chip = (on: boolean) =>
  `inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors ${
    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line surface hover:border-line-strong'
  }`;

/** An image drawn onto its own canvas, its longest side at most `max`. */
function toCanvas(source: CanvasImageSource, width: number, height: number, max = MAX_SIDE): HTMLCanvasElement {
  const fit = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * fit));
  canvas.height = Math.max(1, Math.round(height * fit));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That picture could not be opened.'));
    img.src = src;
  });
}

/** A square's far corner: the dragged box made square, in the drag's direction. */
function squareEnd(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + (dx < 0 ? -side : side), y: a.y + (dy < 0 ? -side : side) };
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (s.kind === 'text') {
    ctx.font = `600 ${s.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    const pad = s.size * 0.3;
    const w = ctx.measureText(s.text).width;
    // A label behind the note, so it reads on any part of the picture.
    ctx.fillStyle = s.colour === '#111827' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(s.at.x - pad, s.at.y - pad, w + 2 * pad, s.size * 1.2 + 2 * pad, pad);
    ctx.fill();
    ctx.fillStyle = s.colour;
    ctx.fillText(s.text, s.at.x, s.at.y);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = s.colour;
  ctx.lineWidth = s.width;
  if ('points' in s) {
    if (s.kind === 'highlight') {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = s.width * 4;
    }
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (s.points.length === 1) ctx.lineTo(s.points[0]!.x + 0.1, s.points[0]!.y);
    ctx.stroke();
  } else if (s.kind === 'rect' || s.kind === 'square') {
    const b = s.kind === 'square' ? squareEnd(s.a, s.b) : s.b;
    ctx.strokeRect(Math.min(s.a.x, b.x), Math.min(s.a.y, b.y), Math.abs(b.x - s.a.x), Math.abs(b.y - s.a.y));
  } else if (s.kind === 'circle') {
    const b = squareEnd(s.a, s.b);
    ctx.beginPath();
    ctx.arc((s.a.x + b.x) / 2, (s.a.y + b.y) / 2, Math.abs(b.x - s.a.x) / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.kind === 'arrow') {
    const { a, b } = s;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(s.width * 4, 14);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
  ctx.restore();
}

/** Every point of a shape moved and scaled: (p - offset) × factor. */
function transform(s: Shape, dx: number, dy: number, f: number): Shape {
  const t = (p: Pt): Pt => ({ x: (p.x - dx) * f, y: (p.y - dy) * f });
  if (s.kind === 'text') return { ...s, at: t(s.at), size: s.size * f };
  if ('points' in s) return { ...s, width: s.width * f, points: s.points.map(t) };
  return { ...s, width: s.width * f, a: t(s.a), b: t(s.b) };
}

/** The base picture with its notes drawn on, at full size. */
function flatten(base: HTMLCanvasElement, shapes: Shape[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(base, 0, 0);
    shapes.forEach((s) => drawShape(ctx, s));
  }
  return canvas;
}

const jpeg = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));

/**
 * Reference Photo — take or choose, then mark it up (Orders, 17 Nov 2026).
 *
 * "Open Camera" streams the device camera (the back one where there is one)
 * and "Capture" takes the frame; where the browser offers no stream it opens
 * the device's own camera app. "Choose from Gallery" picks a file.
 *
 * Then, as in a chat app's photo editor: Pen and Highlight draw freehand;
 * Rectangle, Square, Circle and Arrow are dragged out; Text places a typed
 * note where the picture is tapped; Crop drags a box and "Apply Crop" keeps
 * it; Resize scales the picture down. Every mark has a colour and a size, and
 * Undo steps back one change at a time. The original is kept as it was taken.
 * On Save the order form asks for both (`result`) and stores them together.
 */
export function PhotoEditor({ ref, savedOriginalSrc }: { ref?: Ref<PhotoEditorHandle>; savedOriginalSrc?: string | null }) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [crop, setCrop] = useState<{ a: Pt; b: Pt } | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [colour, setColour] = useState(COLOURS[0]!.value);
  const [size, setSize] = useState(1);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const original = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setStreaming(false);
  };
  useEffect(() => stopCamera, []);

  function clear() {
    stopCamera();
    original.current = null;
    setBase(null);
    setShapes([]);
    setHistory([]);
    setDraft(null);
    setCrop(null);
    setNote('');
    setProblem(null);
  }

  useImperativeHandle(ref, () => ({
    async result() {
      if (!original.current || !base) return null;
      const [o, e] = await Promise.all([jpeg(original.current), jpeg(flatten(base, shapes))]);
      return o && e ? { original: o, edited: e } : null;
    },
    clear,
  }));

  /** A new picture: it is the original, and editing starts from it. */
  function start(source: CanvasImageSource, width: number, height: number) {
    const first = toCanvas(source, width, height);
    original.current = first;
    setBase(toCanvas(first, first.width, first.height));
    setShapes([]);
    setHistory([]);
    setDraft(null);
    setCrop(null);
    setProblem(null);
  }

  async function open(src: string) {
    try {
      const img = await loadImage(src);
      start(img, img.naturalWidth, img.naturalHeight);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That picture could not be opened.');
    }
  }

  function takeFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProblem('That file is not a photo.');
      return;
    }
    const url = URL.createObjectURL(file);
    void open(url).finally(() => URL.revokeObjectURL(url));
  }

  async function openCamera() {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInput.current?.click();
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stream.current = media;
      setStreaming(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play();
        }
      });
    } catch {
      // Refused, or no camera: the device's camera app, or a file.
      cameraInput.current?.click();
    }
  }

  function captureFrame() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    start(v, v.videoWidth, v.videoHeight);
    stopCamera();
  }

  // Draw: the picture, its notes, the one being drawn, and the crop box.
  useEffect(() => {
    const canvas = view.current;
    if (!canvas || !base) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, 0, 0);
    shapes.forEach((s) => drawShape(ctx, s));
    if (draft) drawShape(ctx, draft);
    if (crop) {
      const x = Math.min(crop.a.x, crop.b.x);
      const y = Math.min(crop.a.y, crop.b.y);
      const w = Math.abs(crop.b.x - crop.a.x);
      const h = Math.abs(crop.b.y - crop.a.y);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, base.width, base.height);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, base.width / 400);
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [base, shapes, draft, crop]);

  /** One mark's line width, in the picture's own pixels. */
  const unit = base ? Math.max(2, Math.round(Math.max(base.width, base.height) / 300)) : 2;
  const width = unit * SIZES[size]!.factor;

  function point(event: ReactPointerEvent<HTMLCanvasElement>): Pt {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * (base?.width ?? 1)) / rect.width,
      y: ((event.clientY - rect.top) * (base?.height ?? 1)) / rect.height,
    };
  }

  /** Keep how things were, so Undo can return to it. */
  const remember = () => base && setHistory((h) => [...h.slice(-29), { base, shapes }]);

  function onDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!base) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = point(event);
    if (tool === 'text') {
      if (!note.trim()) {
        setProblem('Type the note first, then tap the picture where it goes.');
        return;
      }
      setProblem(null);
      remember();
      setShapes((s) => [...s, { kind: 'text', colour, size: unit * 8 * SIZES[size]!.factor, at: p, text: note.trim() }]);
      setNote('');
      return;
    }
    dragging.current = true;
    if (tool === 'crop') setCrop({ a: p, b: p });
    else if (tool === 'pen' || tool === 'highlight') setDraft({ kind: tool, colour, width, points: [p] });
    else setDraft({ kind: tool, colour, width, a: p, b: p });
  }

  function onMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragging.current) return;
    const p = point(event);
    if (tool === 'crop') setCrop((c) => (c ? { ...c, b: p } : c));
    else
      setDraft((d) => {
        if (!d || d.kind === 'text') return d;
        return 'points' in d ? { ...d, points: [...d.points, p] } : { ...d, b: p };
      });
  }

  function onUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (tool === 'crop' || !draft) return;
    const big = 'points' in draft || ('a' in draft && Math.abs(draft.b.x - draft.a.x) + Math.abs(draft.b.y - draft.a.y) > 6);
    if (big) {
      remember();
      setShapes((s) => [...s, draft]);
    }
    setDraft(null);
  }

  function applyCrop() {
    if (!base || !crop) return;
    const x = Math.round(Math.max(0, Math.min(crop.a.x, crop.b.x)));
    const y = Math.round(Math.max(0, Math.min(crop.a.y, crop.b.y)));
    const w = Math.round(Math.min(base.width - x, Math.abs(crop.b.x - crop.a.x)));
    const h = Math.round(Math.min(base.height - y, Math.abs(crop.b.y - crop.a.y)));
    if (w < 20 || h < 20) {
      setProblem('Drag a larger box over the part to keep, then Apply Crop.');
      return;
    }
    const next = document.createElement('canvas');
    next.width = w;
    next.height = h;
    next.getContext('2d')?.drawImage(base, x, y, w, h, 0, 0, w, h);
    remember();
    setBase(next);
    setShapes((s) => s.map((shape) => transform(shape, x, y, 1)));
    setCrop(null);
    setProblem(null);
  }

  function resize(longest: number) {
    if (!base) return;
    const f = longest / Math.max(base.width, base.height);
    if (f >= 1) {
      setProblem(`The picture is already ${base.width} × ${base.height} px.`);
      return;
    }
    remember();
    setBase(toCanvas(base, base.width, base.height, longest));
    setShapes((s) => s.map((shape) => transform(shape, 0, 0, f)));
    setProblem(null);
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setBase(last.base);
    setShapes(last.shapes);
    setCrop(null);
  }

  function startOver() {
    if (!original.current) return;
    remember();
    setBase(toCanvas(original.current, original.current.width, original.current.height));
    setShapes([]);
    setCrop(null);
  }

  return (
    <div className="flex flex-col gap-4" data-photo-editor="">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={openCamera} disabled={streaming} className={button}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Open Camera
        </button>
        <button type="button" onClick={() => galleryInput.current?.click()} className={button}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          Choose from Gallery
        </button>
        {savedOriginalSrc ? (
          <button type="button" onClick={() => void open(savedOriginalSrc)} className={button}>
            Edit Saved Photo Again
          </button>
        ) : null}
        {base ? (
          <button type="button" onClick={clear} className={button}>
            Remove New Photo
          </button>
        ) : null}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
        <input ref={galleryInput} type="file" accept="image/*" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
      </div>

      {streaming ? (
        <div className="flex flex-col items-start gap-3">
          <video ref={video} playsInline muted className="max-h-[60vh] max-w-full rounded-lg bg-black" />
          <div className="flex gap-3">
            <button type="button" onClick={captureFrame} className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 items-center rounded-lg px-5 text-sm font-semibold text-white">
              Capture
            </button>
            <button type="button" onClick={stopCamera} className={button}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {base && !streaming ? (
        <>
          <div className="border-line surface-muted flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tool">
              {TOOLS.map((t) => (
                <button key={t.tool} type="button" onClick={() => { setTool(t.tool); setCrop(null); }} className={chip(tool === t.tool)} aria-pressed={tool === t.tool}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2" role="group" aria-label="Colour">
                {COLOURS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColour(c.value)}
                    aria-label={c.name}
                    aria-pressed={colour === c.value}
                    title={c.name}
                    className={`size-8 rounded-full border-2 ${colour === c.value ? 'border-brand-600 ring-brand-600 ring-2 ring-offset-2' : 'border-line'}`}
                    style={{ background: c.value }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Size">
                {SIZES.map((s, i) => (
                  <button key={s.label} type="button" onClick={() => setSize(i)} className={chip(size === i)} aria-pressed={size === i}>
                    {s.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Resize</span>
                <select
                  value=""
                  onChange={(e) => e.target.value && resize(Number(e.target.value))}
                  className="border-line surface h-9 rounded-lg border px-2 text-sm"
                  aria-label="Resize the picture"
                >
                  <option value="">{base.width} × {base.height} px</option>
                  {RESIZE.map((r) => (
                    <option key={r} value={r}>
                      Longest side {r} px
                    </option>
                  ))}
                </select>
              </label>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={undo} disabled={history.length === 0} className={button}>
                  Undo
                </button>
                <button type="button" onClick={startOver} className={button}>
                  Start Over
                </button>
              </div>
            </div>
            {tool === 'text' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setProblem(null);
                  }}
                  maxLength={120}
                  placeholder="Type a note, then tap the picture where it goes"
                  aria-label="Note text"
                  className="border-line surface h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm"
                />
              </div>
            ) : null}
            {tool === 'crop' ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted text-sm">Drag a box over the part to keep.</span>
                <button type="button" onClick={applyCrop} disabled={!crop} className={button}>
                  Apply Crop
                </button>
                {crop ? (
                  <button type="button" onClick={() => setCrop(null)} className={button}>
                    Cancel Crop
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <canvas
            ref={view}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label="Reference photo — draw on it with the chosen tool"
            className="block h-auto max-h-[65vh] w-auto max-w-full touch-nonecursor-crosshair self-start rounded-lg"
          />
          <p className="text-muted text-xs">The photo is saved with the order — the original and this marked-up copy — when you save.</p>
        </>
      ) : null}

      {problem ? <p className="text-status-waste text-sm">{problem}</p> : null}
    </div>
  );
}
