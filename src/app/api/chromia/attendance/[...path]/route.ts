import type { NextRequest } from 'next/server';

import { attendanceApi } from '@/lib/attendance/server';
import { chromiaGate } from '@/lib/chromia/access';

export const dynamic = 'force-dynamic';

/**
 * /api/chromia/attendance/… — the Chromia line's door onto the ONE attendance
 * register, the twin of /api/robo/attendance/…. Same handler, same tables: an
 * operator's day entered on the Robo tablet IS the row the Chromia tablet
 * shows, because it is the same row.
 *
 * Middleware already stops anyone without the CHROMIA role or an admin rank at
 * the path prefix; chromiaGate is the second layer, the way the module's other
 * API routes do it, because a handler that trusts middleware alone is one
 * matcher edit away from being public.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });
  const { path } = await ctx.params;
  return attendanceApi(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
