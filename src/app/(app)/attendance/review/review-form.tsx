"use client";

import { useActionState } from "react";
import { reviewAttendance, type ActionResult } from "@/actions/attendance";
import { Icon } from "@/components/icons";

export function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(reviewAttendance, {});
  if (state.ok) return <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">Review saved.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" className="input" placeholder="Note (required to reject) — e.g. at vendor yard for material pickup" maxLength={500} />
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <button name="decision" value="APPROVED" disabled={pending} className="btn btn-success flex-1">
          <Icon name="check" /> Approve
        </button>
        <button name="decision" value="REJECTED" disabled={pending} className="btn btn-danger flex-1">
          <Icon name="x" /> Reject
        </button>
      </div>
    </form>
  );
}
