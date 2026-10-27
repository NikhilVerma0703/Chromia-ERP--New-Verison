/**
 * Who did it.
 *
 * The standalone module owned its own `user` table and joined to it, so a
 * screen could write `run.importedBy.name`. Inside the ERP the actor is an ERP
 * user and the chromia_* tables hold a plain `*ById` string with no foreign
 * key — deliberately, so a slab's history survives a user row being archived.
 * The join therefore happens here instead: ids in, display names out, one
 * query per screen.
 *
 * STANDALONE: there is no ERP `users` table here. Rows written locally carry
 * the local user's id (lib/rbac.ts), which is named directly; any other id is
 * looked up in the module's own `chromia_user` directory, and an id found in
 * neither is simply left out, as the ERP left out an id with no user row.
 */
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID, localUser } from "@/lib/rbac";

/** Display names for the user ids stored on chromia_* rows. */
export async function actorNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const names = new Map<string, string>();
  if (unique.includes(LOCAL_USER_ID)) names.set(LOCAL_USER_ID, localUser().name);

  const others = unique.filter((id) => id !== LOCAL_USER_ID);
  if (others.length) {
    const rows = await prisma.chromiaUser.findMany({
      where: { id: { in: others } },
      select: { id: true, name: true, email: true },
    });
    for (const r of rows) names.set(r.id, r.name || r.email);
  }
  return names;
}
