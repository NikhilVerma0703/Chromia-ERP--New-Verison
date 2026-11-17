import { chromiaGate } from '@/lib/chromia/access';
import { loadOrderPhoto } from '@/lib/chromia/server/repositories/order-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chromia/order-photo/<photo id> — one saved Reference Photo of an
 * order (Orders, 17 Nov 2026), original or annotated. Read-only, and only
 * entry_photo rows of model 'ChromiaOrder'. The headers are slab-photo's: the
 * bytes are an image to look at, never a document to run.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ photoId: string }> }) {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const { photoId } = await ctx.params;
  const photo = await loadOrderPhoto(photoId);
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
