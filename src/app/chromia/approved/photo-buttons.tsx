'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { API_ROUTES } from '@/lib/chromia/constants/app';

const iconButton =
  'border-line surface hover:border-line-strong inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-[var(--surface-muted)]';

/** "Click Picture of Slab" — opens the slab's form, where the photo is taken. */
export function TakePhotoLink({ href, slabNo }: { href: string; slabNo: string }) {
  return (
    <Link href={href} className={iconButton} aria-label={`Click picture of slab ${slabNo}`} title="Click Picture of Slab">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      Click Picture of Slab
    </Link>
  );
}

/**
 * The eye — View Photo. Opens the slab's saved photo over the page, in a
 * native <dialog>: Escape, the close button or a click outside the picture
 * closes it, and focus returns where it was.
 */
export function ViewPhotoButton({ photoId, slabNo }: { photoId: string; slabNo: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const src = `${API_ROUTES.slabPhoto}/${encodeURIComponent(photoId)}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={iconButton} aria-label={`View photo of slab ${slabNo}`} title="View Photo">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        View Photo
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="m-auto max-h-[92vh] max-w-[92vw] rounded-xl bg-transparent p-0 backdrop:bg-black/70"
        aria-label={`Photo of slab ${slabNo}`}
      >
        {open ? (
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-gray-900 shadow"
            >
              Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, served as-is */}
            <img src={src} alt={`Slab ${slabNo}`} className="max-h-[82vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
