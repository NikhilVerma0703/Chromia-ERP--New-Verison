import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * The attendance roster — the plant's operators, in the plant's own order.
 *
 * THE ORDER IS THE DATA. It is the order the line is called in, which the
 * owner gave as a numbered list, and it is NOT alphabetical: Jagadeesh,
 * Rajesh, Saravanan .L, Kiran… A screen or a sheet that sorts it into
 * "Aaquib, Jagadeesh, Kiran…" is a different document from the register the
 * floor keeps, so `sortOrder` is what every reader orders by and nothing
 * re-sorts it. See lib/attendance/server.ts (listOperators).
 *
 * Spelling is the owner's too, down to the space in "Saravanan .L" and the
 * stop in "Praveen S.": these are the names as the register writes them.
 *
 * Idempotent, like every seed here — running it twice puts the list back the
 * way it is written below without touching anybody's attendance, and an
 * operator added on the floor since (further down the order) is left alone.
 */
const ROSTER = [
  "Jagadeesh",
  "Rajesh",
  "Saravanan .L",
  "Kiran",
  "Praveen S.",
  "Venkatraj",
  "U Kumar",
  "Aaquib",
  "Sebul",
  "Shiva",
  "Mani Bharathi",
  "Yogender Reddy",
];

async function main() {
  for (const [i, name] of ROSTER.entries()) {
    const sortOrder = i + 1;
    await prisma.attendanceOperator.upsert({
      where: { name },
      update: { sortOrder, isActive: true },
      create: { name, sortOrder },
    });
  }
  const listed = await prisma.attendanceOperator.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { sortOrder: true, name: true },
  });
  console.log(`Attendance roster (${listed.length}):`);
  for (const o of listed) console.log(`  ${String(o.sortOrder).padStart(2)}  ${o.name}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
