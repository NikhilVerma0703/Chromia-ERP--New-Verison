import type { Metadata } from 'next';

import { AttendanceClient } from '@/components/attendance/AttendanceClient';
import { requirePageUser } from '@/lib/pageUser';
import { plantRightsOfUser } from '@/lib/plantAccess';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

/**
 * Chromia → Attendance. The twin of /robo/attendance: one component over one
 * set of tables, so the two lines read the same register and an edit on either
 * is the edit. The module layout supplies the Shell and chromiaGate.
 *
 * The heading is the ERP's own (the h1 and grey line of app/robo/attendance
 * and app/office/finance), not the Chromia PageHeader: this register is not a
 * ported Chromia screen but one ERP screen with two doors, and it reads the
 * same through either.
 */
export default async function ChromiaAttendancePage() {
  // Signed in, or no further, on every visit: the module layout's gate is
  // not run again when the browser moves between this module's pages
  // (requirePageUser in lib/pageUser.ts says why).
  const user = await requirePageUser();
  // The SAME rights the Robo door computes, from the same table and the same
  // session — the owner asked for "the same permissions consistently in both
  // ERPs", and one register with two screens that disagreed about who may
  // keep it would be the worst of both.
  const rights = plantRightsOfUser(user);
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Attendance</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          One register for both lines — the same operators, the same days, whichever ERP it is entered from.
        </p>
      </div>
      <AttendanceClient api="/api/chromia/attendance" rights={rights} />
    </>
  );
}
