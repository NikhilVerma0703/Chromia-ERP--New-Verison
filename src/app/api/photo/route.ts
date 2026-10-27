/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/photo?id=… — one stored entry photo (the Slab Intake defect photos).
//
// STANDALONE: Pacific ERP's route serves every module's entry photos and
// decides per login and per table who may see which (canSeeModel, station and
// department rules, the finished-goods grant). Here the only photos are Slab
// Intake's and the only user is the local admin, so the ERP's own answer for
// that user — the FinishedSlab intake viewer — is the whole rule: the photo
// is served if it is a FinishedSlab photo. The response and its headers are
// the ERP's, unchanged.
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export async function GET(request: Request) {
  try {
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const rows: any[] = await db.$queryRaw`SELECT model, filename, mime, data FROM entry_photo WHERE id = ${id}`;
    if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    if (r.model !== "FinishedSlab") return Response.json({ error: "Not authorized" }, { status: 403 });
    return new Response(new Uint8Array(r.data), {
      headers: {
        "Content-Type": r.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": `inline; filename="${String(r.filename).replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("Photo error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
