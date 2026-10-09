"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveConstructionPlanAction } from "@/actions/workflow";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";
import type { TaskView } from "@/lib/workflow/queries";
import { SourceChip, StatusChip } from "./chips";

type Row = { plannedStart: string; plannedEnd: string; assigneeId: string };

/** Head - Site Operations: kickoff + planned dates and assignees for all construction tasks. */
export function ConstructionPlanner({ projectId, kickoff, tasks, readOnly }: { projectId: string; kickoff: string | null; tasks: TaskView[]; readOnly?: boolean }) {
  const router = useRouter();
  const initial = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, { plannedStart: t.plannedStart ?? "", plannedEnd: t.plannedEnd ?? "", assigneeId: t.assignees[0]?.id ?? "" }])) as Record<string, Row>,
    [tasks],
  );
  const [k, setK] = useState(kickoff ?? "");
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [reason, setReason] = useState("");
  const [interior, setInterior] = useState("");
  const [needs, setNeeds] = useState<{ kind: string; message: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty = (id: string) => rows[id].plannedStart !== initial[id].plannedStart || rows[id].plannedEnd !== initial[id].plannedEnd;
  const touchedMilestone = tasks.some((t) => t.milestone && t.plannedSource === "AUTO" && dirty(t.id));
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveConstructionPlanAction(projectId, {
        kickoff: k || null,
        rows: tasks
          .filter((t) => dirty(t.id) || rows[t.id].assigneeId !== initial[t.id].assigneeId)
          .map((t) => ({
            taskId: t.id,
            plannedStart: dirty(t.id) ? rows[t.id].plannedStart || null : null,
            plannedEnd: dirty(t.id) ? rows[t.id].plannedEnd || null : null,
            assigneeId: rows[t.id].assigneeId !== initial[t.id].assigneeId ? rows[t.id].assigneeId || null : null,
          })),
        reason: reason || null,
        interiorOverrideReason: interior || null,
      });
      if (r.ok) {
        setNeeds(null);
        setMsg({ ok: true, text: "Plan saved. Auto dates were recalculated from the kickoff." });
        router.refresh();
      } else if (r.needsReason) setNeeds({ kind: r.needsReason, message: r.message ?? "" });
      else setMsg({ ok: false, text: r.error ?? "Could not save the plan." });
    });

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Construction kickoff</span>
          <input type="date" className="input w-44" value={k} onChange={(e) => setK(e.target.value)} disabled={readOnly} />
        </label>
        <p className="max-w-xl pb-2 text-xs text-stone-500">
          Preliminary work (+7 d), excavation (by +10 d) and plinth beam (excavation end +37 d) are automatic milestones from the kickoff. The rest are custom dates you set here.
          Landscaping follows interior execution.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Task</th>
              <th>Phase</th>
              <th>Planned start</th>
              <th>Planned end</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const row = rows[t.id];
              return (
                <tr key={t.id} className={cn(dirty(t.id) && "bg-gold-50/60")}>
                  <td className="text-xs text-stone-400 tabular-nums">{t.order}</td>
                  <td className="font-medium">
                    {t.name}
                    {t.milestone && <span className="ml-1.5 text-[10px] font-semibold text-gold-700 uppercase">milestone</span>}
                  </td>
                  <td className="text-xs whitespace-nowrap text-stone-500">{t.phaseName.split(":")[0].replace("Construction ", "C")}</td>
                  <td>
                    <input type="date" className="input w-36 py-1" value={row.plannedStart} disabled={readOnly || t.status === "COMPLETED"} onChange={(e) => set(t.id, { plannedStart: e.target.value })} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <input type="date" className="input w-36 py-1" value={row.plannedEnd} min={row.plannedStart || undefined} disabled={readOnly || t.status === "COMPLETED"} onChange={(e) => set(t.id, { plannedEnd: e.target.value })} />
                      <SourceChip source={dirty(t.id) ? "CUSTOM" : t.plannedSource} hasAutoRule={t.hasAutoRule} />
                    </div>
                  </td>
                  <td>
                    <select className="input min-w-40 py-1" value={row.assigneeId} disabled={readOnly || t.status === "COMPLETED"} onChange={(e) => set(t.id, { assigneeId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {t.pool.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.preferred ? "★ " : ""}
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <StatusChip status={t.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(touchedMilestone || needs?.kind === "milestone") && (
        <label className="block max-w-xl">
          <span className="label">Reason for overriding a milestone date *</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      )}
      {needs?.kind === "interior" && (
        <div className="max-w-xl rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Interior rule conflict</p>
          <p className="mt-1">{needs.message}</p>
          <label className="mt-2 block">
            <span className="label">Reason to override *</span>
            <input className="input" value={interior} onChange={(e) => setInterior(e.target.value)} maxLength={500} />
          </label>
        </div>
      )}
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className="btn btn-primary">
            <Icon name="check" /> {pending ? "Saving…" : needs ? "Save with reason" : "Save plan"}
          </button>
          {msg && <p className={cn("text-sm", msg.ok ? "text-emerald-700" : "text-red-700")}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
