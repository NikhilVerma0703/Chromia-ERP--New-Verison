import { chromiaGate } from '@/lib/chromia/access';
import { loadSlabPhoto } from '@/lib/chromia/server/repositories/approved-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chromia/slab-photo/<photo id> — one saved photo of a Chromia slab
 * (Approved Slabs, 27 Oct 2026). Read-only. Only entry_photo rows of model
 * 'ChromiaSlab' are served from here, so no other module's photo leaks out of
 * this door. The headers are /api/photo's: the bytes are an image to look at,
 * never a document to run.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ photoId: string }> }) {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const { photoId } = await ctx.params;
  const photo = await loadSlabPhoto(photoId);
  if (!photo) return Response.json({ error: 'Not found' }, { status: 404 });

  return new Response(new Uint8Array(photo.data), {
    headers: {
      'Content-Type': photo.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Content-Disposition': `inline; filename="${photo.filename.replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
