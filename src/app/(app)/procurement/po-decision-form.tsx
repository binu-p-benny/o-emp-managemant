"use client";

import { useActionState } from "react";
import { decidePurchaseOrder, type FormState } from "@/actions/modules";
import { Icon } from "@/components/icons";

export function PODecisionForm({ id, withinLimit, nextRole }: { id: string; withinLimit: boolean; nextRole: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decidePurchaseOrder, {});
  if (state.ok) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" maxLength={500} className="input" placeholder="Note (required to reject)" />
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="APPROVE" disabled={pending} className="btn btn-success btn-sm">
          <Icon name="check" className="h-3.5 w-3.5" />
          {withinLimit ? "Approve" : `Endorse → ${nextRole ?? "next approver"}`}
        </button>
        <button name="decision" value="REJECT" disabled={pending} className="btn btn-danger btn-sm">
          <Icon name="x" className="h-3.5 w-3.5" /> Reject
        </button>
      </div>
    </form>
  );
}
