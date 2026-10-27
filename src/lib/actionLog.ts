/* eslint-disable @typescript-eslint/no-explicit-any */
// STANDALONE: the audit trail for attendance writes.
//
// In Pacific ERP, logActionTx writes a row to the ERP-wide `action_log` table
// (the one behind the global Undo), in the same transaction as the change.
// That table and its Undo belong to the whole ERP, not to Chromia, so here the
// same row goes to Chromia's own `chromia_audit_log` — still inside the
// caller's transaction, so if the trail cannot be written neither is the
// change, exactly as before. Everything the ERP row carried is kept in
// `changes`: kind, model, the human summary, and the payload (the row before
// and after, and the action name).
import type { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/rbac";

export type ActionKind = string;

export interface LogInput {
  kind: ActionKind;
  summary: string;
  batchKey?: string | null;
  model?: string | null;
  payload: any;
}

/** CREATE / UPDATE / DELETE from the payload's action name ("attendance.leave.add" …). */
function auditAction(action: unknown): "CREATE" | "UPDATE" | "DELETE" {
  const a = String(action ?? "");
  if (/\.(add|create)$/.test(a)) return "CREATE";
  if (/\.delete$/.test(a)) return "DELETE";
  return "UPDATE";
}

export async function logActionTx(tx: Prisma.TransactionClient, input: LogInput): Promise<void> {
  const u = await currentUser();
  const p = input.payload ?? {};
  const entityId = String(p.after?.id ?? p.before?.id ?? input.batchKey ?? "");
  await tx.chromiaAuditLog.create({
    data: {
      entity: input.model ?? input.kind,
      entityId,
      action: auditAction(p.action),
      userId: u.id,
      changes: {
        kind: input.kind,
        summary: input.summary,
        actor: u.email,
        batchKey: input.batchKey ?? null,
        payload: JSON.parse(JSON.stringify(p)),
      },
    },
  });
}
