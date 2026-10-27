'use client';

import { useActionState, useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';

import { FormError } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { saveApprovedSlabPhotoAction, type SlabPhotoFormState } from '@/lib/chromia/server/actions/approved';

/** A crop box in the displayed image's own pixels. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Drag = { kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; box: Box } | null;

/** The longest side a saved photo keeps — sharp on a screen, small in the database. */
const MAX_SIDE = 2000;
/** The smallest crop, in displayed pixels, so the box can always be grabbed. */
const MIN_BOX = 40;

const button =
  'border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-55';
const primary =
  'bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Slab photo — take or choose, crop, save (Approved Slabs, 27 Oct 2026).
 *
 * THE CAMERA. "Open Camera" streams the device camera into the page (the back
 * camera where there is one) and "Capture" takes the frame. Where the browser
 * offers no camera stream, the same button opens the device's own camera
 * through a file input with `capture`, which tablets and phones honour.
 * "Upload Image" chooses a file instead. Either way nothing is saved yet.
 *
 * THE CROP. The picture is shown with a box over it: drag inside to move it,
 * drag a corner to size it. Save draws exactly that part of the full-size
 * image onto a canvas (scaled down to MAX_SIDE on its longest side) and sends
 * it as a JPEG; the server checks it really is an image before storing it
 * against this slab. On success the page returns to Approved Slabs, where the
 * slab's camera button has become the eye.
 */
export function PhotoCapture({ slabId, slabNo, hasPhoto }: { slabId: string; slabNo: string; hasPhoto: boolean }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<SlabPhotoFormState, FormData>(saveApprovedSlabPhotoAction, {});
  const [isReturning, startReturn] = useTransition();
  const [, startSave] = useTransition();

  const [source, setSource] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<Drag>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const handled = useRef<number | null>(null);

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setStreaming(false);
  };
  useEffect(() => stopCamera, []);
  useEffect(() => () => { if (source?.startsWith('blob:')) URL.revokeObjectURL(source); }, [source]);

  // Saved: back to the list, once.
  useEffect(() => {
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    startReturn(() => router.push(APP_ROUTES.approved));
  }, [state.savedAt, router]);

  function takeFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProblem('That file is not a photo.');
      return;
    }
    setProblem(null);
    setBox(null);
    setSource(URL.createObjectURL(file));
  }

  async function openCamera() {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      captureInput.current?.click(); // the device's own camera
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
      // Refused or no camera: fall back to the device's camera app, or a file.
      captureInput.current?.click();
    }
  }

  function captureFrame() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    stopCamera();
    setBox(null);
    setSource(canvas.toDataURL('image/jpeg', 0.95));
  }

  /** A first crop box: the whole picture, inset a little so the corners show. */
  function onImageLoad() {
    const img = image.current;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    const inset = Math.round(Math.min(w, h) * 0.05);
    setBox({ x: inset, y: inset, w: w - 2 * inset, h: h - 2 * inset });
  }

  function startDrag(kind: NonNullable<Drag>['kind'], event: ReactPointerEvent) {
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { kind, startX: event.clientX, startY: event.clientY, box };
  }

  function onDrag(event: ReactPointerEvent) {
    const d = drag.current;
    const img = image.current;
    if (!d || !img) return;
    const W = img.clientWidth;
    const H = img.clientHeight;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    const b = d.box;
    if (d.kind === 'move') {
      setBox({ ...b, x: clamp(b.x + dx, 0, W - b.w), y: clamp(b.y + dy, 0, H - b.h) });
      return;
    }
    let { x, y, w, h } = b;
    if (d.kind === 'nw' || d.kind === 'sw') {
      const nx = clamp(b.x + dx, 0, b.x + b.w - MIN_BOX);
      w = b.w + (b.x - nx);
      x = nx;
    } else {
      w = clamp(b.w + dx, MIN_BOX, W - b.x);
    }
    if (d.kind === 'nw' || d.kind === 'ne') {
      const ny = clamp(b.y + dy, 0, b.y + b.h - MIN_BOX);
      h = b.h + (b.y - ny);
      y = ny;
    } else {
      h = clamp(b.h + dy, MIN_BOX, H - b.y);
    }
    setBox({ x, y, w, h });
  }

  const endDrag = () => {
    drag.current = null;
  };

  /** Draw the boxed part of the full-size image, scaled to MAX_SIDE, as a JPEG. */
  async function croppedBlob(): Promise<Blob | null> {
    const img = image.current;
    if (!img || !box) return null;
    const scale = img.naturalWidth / img.clientWidth;
    const sx = Math.round(box.x * scale);
    const sy = Math.round(box.y * scale);
    const sw = Math.round(box.w * scale);
    const sh = Math.round(box.h * scale);
    const fit = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * fit));
    canvas.height = Math.max(1, Math.round(sh * fit));
    canvas.getContext('2d')?.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  }

  async function save() {
    const blob = await croppedBlob();
    if (!blob) {
      setProblem('Take or choose a photo of the slab, crop it, then save.');
      return;
    }
    const fd = new FormData();
    fd.set('slabId', slabId);
    fd.set('photo', new File([blob], `approved-${slabNo}.jpg`, { type: 'image/jpeg' }));
    startSave(() => formAction(fd));
  }

  const busy = isPending || isReturning || Boolean(state.savedAt);

  return (
    <SectionCard title={hasPhoto ? 'Slab Photo — replace' : 'Slab Photo'} accent="grade">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={openCamera} disabled={busy || streaming} className={button}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Open Camera
          </button>
          <button type="button" onClick={() => uploadInput.current?.click()} disabled={busy} className={button}>
            Upload Image
          </button>
          {/* Hidden: the device camera app (capture), and a plain file choice. */}
          <input ref={captureInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
          <input ref={uploadInput} type="file" accept="image/*" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
          <span className="text-muted text-sm">
            {source ? 'Drag the box to move it, its corners to size it.' : `A photo of slab ${slabNo}.`}
          </span>
        </div>

        {streaming ? (
          <div className="flex flex-col items-start gap-3">
            <video ref={video} playsInline muted className="max-h-[60vh] max-w-full rounded-lg bg-black" />
            <div className="flex gap-3">
              <button type="button" onClick={captureFrame} className={primary}>
                Capture
              </button>
              <button type="button" onClick={stopCamera} className={button}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {source && !streaming ? (
          <div
            className="relative inline-block max-w-full touch-none select-none self-start"
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local, uncropped picture */}
            <img
              ref={image}
              src={source}
              alt={`Photo of slab ${slabNo}, to crop`}
              onLoad={onImageLoad}
              draggable={false}
              className="block max-h-[60vh] max-w-full rounded-lg"
            />
            {box ? (
              <div
                role="presentation"
                aria-label="Crop area"
                data-crop-box=""
                onPointerDown={(e) => startDrag('move', e)}
                className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <span
                    key={corner}
                    data-handle={corner}
                    onPointerDown={(e) => startDrag(corner, e)}
                    className="absolute size-4 rounded-sm border-2 border-white bg-brand-600"
                    style={{
                      left: corner.endsWith('w') ? -8 : undefined,
                      right: corner.endsWith('e') ? -8 : undefined,
                      top: corner.startsWith('n') ? -8 : undefined,
                      bottom: corner.startsWith('s') ? -8 : undefined,
                      cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <FormError message={problem ?? state.error} />

        <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
          <button type="button" onClick={save} disabled={busy || !source || !box || streaming} className={primary}>
            {isPending ? 'Saving…' : isReturning || state.savedAt ? 'Saved — returning…' : 'Save Changes'}
          </button>
          <span className="text-muted text-sm">Saves the cropped photo against slab {slabNo}. Nothing else about the slab changes.</span>
        </div>
      </div>
    </SectionCard>
  );
}
