"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  approveTaskAction,
  completeTaskAction,
  flagDelayAction,
  reassignTaskAction,
  resetPlannedAction,
  sendBackTaskAction,
  setActualDatesAction,
  setPlannedDatesAction,
  startPhaseAction,
  startTaskAction,
  submitTaskAction,
  type WorkflowResult,
} from "@/actions/workflow";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/modal";
import { cn } from "@/lib/format";
import type { PoolMember, TaskView } from "@/lib/workflow/queries";
import { DELAY_LABEL, type DelayTypeKey } from "@/lib/workflow/types";
import { DelayBadge, DueChip, SourceChip, StatusChip, fmtDay, fmtVariance } from "./chips";

type Dialog = null | "start-phase" | "submit" | "approve" | "send-back" | "complete" | "start" | "planned" | "actual" | "delay" | "reassign";

export type StartContext = { stages: TaskView[]; isConstructionStart: boolean; kickoff: string | null };

const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function TaskRow({ task, startContext, project }: { task: TaskView; startContext?: StartContext; project?: { code: string; id: string } }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<{ kind: string; message: string } | null>(null);
  const p = task.perms;

  const open = (d: Dialog) => {
    setError(null);
    setNeeds(null);
    setMenu(false);
    setDialog(d);
  };
  const close = () => {
    setDialog(null);
    setNeeds(null);
    setError(null);
  };
  const call = (fn: () => Promise<WorkflowResult>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        close();
        router.refresh();
      } else if (r.needsReason) {
        setNeeds({ kind: r.needsReason, message: r.message ?? "A reason is required." });
      } else setError(r.error ?? "Something went wrong.");
    });

  const variance = fmtVariance(task.variance);
  const isStart = task.kind === "PHASE_START";
  const isApproval = task.kind === "APPROVAL";
  const muted = task.status === "COMPLETED";

  // Primary inline action
  let primary: ReactNode = null;
  if (p.canStartPhase) primary = <ActionBtn tone="primary" icon="login" onClick={() => open("start-phase")}>Start phase</ActionBtn>;
  else if (p.canReview)
    primary = (
      <>
        <ActionBtn tone="success" icon="check" onClick={() => open("approve")}>Approve</ActionBtn>
        <ActionBtn tone="danger" icon="refresh" onClick={() => open("send-back")}>Send back</ActionBtn>
      </>
    );
  else if (p.canSubmit) primary = <ActionBtn tone="primary" icon="check" onClick={() => open("submit")}>{task.status === "REWORK" ? "Resubmit" : "Submit for review"}</ActionBtn>;
  else if (p.canComplete) primary = <ActionBtn tone="primary" icon="check" onClick={() => open("complete")}>{isApproval ? "Approve design" : task.templateKey === "d1_final_plan" ? "Confirm final plan" : "Mark complete"}</ActionBtn>;
  else if (p.canStart) primary = <ActionBtn tone="secondary" icon="login" onClick={() => open("start")}>{p.startNeedsOverride ? "Start early…" : "Start"}</ActionBtn>;

  const menuItems: [string, Dialog][] = [
    ...(p.canSetDates ? ([["Set planned date", "planned"]] as [string, Dialog][]) : []),
    ...(p.canEditActual ? ([["Edit actual dates", "actual"]] as [string, Dialog][]) : []),
    ...(p.canFlagDelay ? ([["Flag delay", "delay"]] as [string, Dialog][]) : []),
    ...(p.canReassign ? ([[p.reassignWithinTeamOnly ? "Hand over to teammate" : "Assign / reassign", "reassign"]] as [string, Dialog][]) : []),
  ];

  return (
    <li id={`task-${task.id}`} className={cn("scroll-mt-24 border-b border-stone-100 last:border-b-0", isStart && "bg-gold-50/60", task.due === "overdue" && !muted && "bg-red-50/40")}>
      <div className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_auto] md:items-center">
        {/* Name */}
        <div className="min-w-0">
          <button type="button" onClick={() => setExpanded((x) => !x)} className="flex max-w-full items-start gap-1.5 text-left">
            <Icon name="chevronRight" className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform", expanded && "rotate-90")} />
            <span className={cn("font-medium", muted && "text-stone-500", isStart && "text-gold-800")}>
              {isStart && <Icon name="flag" className="mr-1 inline h-3.5 w-3.5" />}
              {task.name}
            </span>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5">
            {project && (
              <Link href={`/projects/${project.id}?tab=workflow#task-${task.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                {project.code}
              </Link>
            )}
            <StatusChip status={task.status} />
            {!muted && <DueChip due={task.due} />}
            {task.milestone && <span className="text-[10px] font-semibold text-gold-700 uppercase">Milestone</span>}
            {task.reworkCount > 0 && <span className="text-[11px] text-orange-700">↺ {task.reworkCount} rework</span>}
            <DelayBadge count={task.delays.length} days={task.delayDays} />
            {!task.visible && <span className="text-[10px] text-stone-400 uppercase">Hidden from workers until kickoff</span>}
          </div>
          {task.blocker && task.status === "NOT_STARTED" && <p className="mt-1 pl-5 text-[11px] text-stone-500">Waiting: {task.blocker}</p>}
        </div>

        {/* Assignees */}
        <div className="min-w-0 pl-5 text-sm md:pl-0">
          <span className="text-[10px] font-semibold text-stone-400 uppercase md:hidden">Assigned · </span>
          {task.assignees.length ? (
            task.assignees.map((a) => (
              <span key={a.id} className="mr-1 inline-block truncate">
                {a.name} <span className="text-xs text-stone-400">({a.roleName})</span>
                {task.assignees.length > 1 ? "," : ""}
              </span>
            ))
          ) : (
            <span className="text-stone-400">Unassigned</span>
          )}
          {task.requiresReview && task.reviewer && <span className="block truncate text-[11px] text-stone-400">Review: {task.reviewer.name}</span>}
        </div>

        {/* Planned */}
        <div className="pl-5 text-sm md:pl-0">
          <div className="flex items-center gap-1.5">
            <SourceChip source={task.plannedSource} hasAutoRule={task.hasAutoRule} />
            <span className="tabular-nums">{task.plannedStart && task.plannedStart !== task.plannedEnd ? `${fmtDay(task.plannedStart)} → ` : ""}{task.plannedEnd ? fmtDay(task.plannedEnd) : <span className="text-stone-400">{isStart || task.hasAutoRule ? "—" : "Set custom date"}</span>}</span>
          </div>
          {task.originalAutoPlannedEnd && task.plannedSource === "CUSTOM" && (
            <span className="block text-[11px] text-stone-400">
              auto was {fmtDay(task.originalAutoPlannedEnd)}
              {task.plannedChangedBy ? ` · changed by ${task.plannedChangedBy}` : ""}
            </span>
          )}
        </div>

        {/* Actual */}
        <div className="pl-5 text-sm md:pl-0">
          <span className="tabular-nums">{task.actualStart ? fmtDay(task.actualStart) : "—"} → {task.actualEnd ? fmtDay(task.actualEnd) : "—"}</span>
          {variance && <span className={cn("ml-1.5 text-[11px] font-semibold", variance.tone)}>{variance.text}</span>}
          {task.submittedAt && (
            <span className="block text-[11px] text-stone-400">
              submitted {fmtDay(task.submittedAt.slice(0, 10))}
              {task.actualEnd && task.status === "COMPLETED" && task.requiresReview ? ` · approved ${fmtDay(task.actualEnd)}` : ""}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="relative flex flex-wrap items-center justify-end gap-1.5 pl-5 md:pl-0">
          {primary}
          {menuItems.length > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} className="btn btn-ghost btn-sm" aria-label="More actions" aria-expanded={menu}>
                •••
              </button>
              {menu && (
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
                  {menuItems.map(([label, d]) => (
                    <button key={label} type="button" onClick={() => open(d)} className="block w-full px-3 py-1.5 text-left hover:bg-stone-50">
                      {label}
                    </button>
                  ))}
                  {p.canResetAuto && (
                    <button type="button" disabled={pending} onClick={() => (setMenu(false), call(() => resetPlannedAction(task.id)))} className="block w-full px-3 py-1.5 text-left hover:bg-stone-50">
                      Reset to auto date
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && <TaskHistory task={task} />}
      {error && !dialog && <p className="px-4 pb-2 text-sm text-red-700">{error}</p>}

      {/* ── Dialogs ── */}
      <Modal open={dialog === "start-phase"} onClose={close} title={task.name} wide={!!startContext?.stages.length}>
        <StartPhaseForm task={task} ctx={startContext} pending={pending} error={error} onSubmit={(v) => call(() => startPhaseAction({ taskId: task.id, ...v }))} />
      </Modal>
      <Modal open={dialog === "submit"} onClose={close} title={`Submit "${task.name}" for review`}>
        <NoteForm label="Note for the reviewer (optional)" submit={task.status === "REWORK" ? "Resubmit" : "Submit for review"} pending={pending} error={error} onSubmit={(note) => call(() => submitTaskAction(task.id, note))} />
      </Modal>
      <Modal open={dialog === "approve"} onClose={close} title={`Approve "${task.name}"`}>
        <DateNoteForm dateLabel="Completed on" submit="Approve" pending={pending} error={error} onSubmit={(date, note) => call(() => approveTaskAction(task.id, note, date))} />
      </Modal>
      <Modal open={dialog === "complete"} onClose={close} title={isApproval ? "Approve design" : `Complete "${task.name}"`}>
        {isApproval && <p className="mb-3 text-sm text-stone-600">Approving hands construction over to Head - Site Operations: a “Start Construction Phase 1” task is created for them.</p>}
        <DateNoteForm dateLabel="Completed on" submit={isApproval ? "Approve design" : "Mark complete"} hideNote pending={pending} error={error} onSubmit={(date) => call(() => completeTaskAction(task.id, date))} />
      </Modal>
      <Modal open={dialog === "start"} onClose={close} title={`Start "${task.name}"`}>
        {p.startNeedsOverride ? (
          <>
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{task.blocker} Starting now overrides the sequence.</p>
            <NoteForm label="Reason for starting early" required submit="Start anyway" pending={pending} error={error} onSubmit={(reason) => call(() => startTaskAction(task.id, reason))} />
          </>
        ) : (
          <NoteForm label="" hideInput submit="Start now" pending={pending} error={error} onSubmit={() => call(() => startTaskAction(task.id))} />
        )}
      </Modal>
      <Modal open={dialog === "send-back"} onClose={close} title={`Send "${task.name}" back for rework`}>
        <SendBackForm task={task} pending={pending} error={error} onSubmit={(v) => call(() => sendBackTaskAction(task.id, v))} />
      </Modal>
      <Modal open={dialog === "planned"} onClose={close} title={`Planned dates — ${task.name}`}>
        <PlannedForm task={task} needs={needs} pending={pending} error={error} onSubmit={(v) => call(() => setPlannedDatesAction(task.id, v))} />
      </Modal>
      <Modal open={dialog === "actual"} onClose={close} title={`Actual dates — ${task.name}`}>
        <ActualForm task={task} pending={pending} error={error} onSubmit={(v) => call(() => setActualDatesAction(task.id, v))} />
      </Modal>
      <Modal open={dialog === "delay"} onClose={close} title={`Flag delay — ${task.name}`}>
        <DelayForm task={task} pending={pending} error={error} onSubmit={(v) => call(() => flagDelayAction(task.id, v))} />
      </Modal>
      <Modal open={dialog === "reassign"} onClose={close} title={`${p.reassignWithinTeamOnly ? "Hand over" : "Assign"} — ${task.name}`}>
        <ReassignForm task={task} pending={pending} error={error} onSubmit={(v) => call(() => reassignTaskAction(task.id, v))} />
      </Modal>
    </li>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function ActionBtn({ tone, icon, onClick, children }: { tone: "primary" | "secondary" | "success" | "danger"; icon: "check" | "login" | "refresh"; onClick: () => void; children: ReactNode }) {
  const cls = { primary: "btn-primary", secondary: "btn-secondary", success: "btn-success", danger: "btn-danger" }[tone];
  return (
    <button type="button" onClick={onClick} className={cn("btn btn-sm", cls)}>
      <Icon name={icon} className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Footer({ pending, error, submit, disabled }: { pending: boolean; error: string | null; submit: string; disabled?: boolean }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      {error && <p className="mr-auto text-sm text-red-700">{error}</p>}
      <button className="btn btn-primary" disabled={pending || disabled}>
        {pending ? "Saving…" : submit}
      </button>
    </div>
  );
}

function NoteForm({ label, submit, pending, error, onSubmit, required, hideInput }: { label: string; submit: string; pending: boolean; error: string | null; onSubmit: (note: string) => void; required?: boolean; hideInput?: boolean }) {
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(note);
      }}
    >
      {!hideInput && (
        <label className="block">
          <span className="label">{label}</span>
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={required} maxLength={1000} />
        </label>
      )}
      <Footer pending={pending} error={error} submit={submit} disabled={required && !note.trim()} />
    </form>
  );
}

function DateNoteForm({ dateLabel, submit, pending, error, onSubmit, hideNote }: { dateLabel: string; submit: string; pending: boolean; error: string | null; onSubmit: (date: string, note: string) => void; hideNote?: boolean }) {
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(date, note);
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="label">{dateLabel}</span>
        <input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required />
      </label>
      {!hideNote && (
        <label className="block">
          <span className="label">Comment (optional)</span>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </label>
      )}
      <Footer pending={pending} error={error} submit={submit} />
    </form>
  );
}

function SendBackForm({ task, pending, error, onSubmit }: { task: TaskView; pending: boolean; error: string | null; onSubmit: (v: { note: string; logDelayDays: number | null; reassignTo: string | null }) => void }) {
  const [note, setNote] = useState("");
  const [log, setLog] = useState(false);
  const [days, setDays] = useState(1);
  const [to, setTo] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ note, logDelayDays: log ? days : null, reassignTo: to || null });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="label">What needs rework? (required)</span>
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={1000} />
      </label>
      <label className="block">
        <span className="label">Return to</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Same assignee ({task.assignees.map((a) => a.name).join(", ") || "unassigned"})</option>
          {task.pool.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.roleName}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-lg bg-stone-50 p-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
          <span>Log the rework as a delay (type “Rework”, reason = the note above)</span>
        </label>
        {log && (
          <label className="mt-2 flex items-center gap-2 pl-6">
            <span className="text-stone-600">Delay days</span>
            <input type="number" min={0} className="input w-24" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
        )}
      </div>
      <Footer pending={pending} error={error} submit="Send back" disabled={!note.trim()} />
    </form>
  );
}

function PlannedForm({ task, needs, pending, error, onSubmit }: { task: TaskView; needs: { kind: string; message: string } | null; pending: boolean; error: string | null; onSubmit: (v: { plannedStart: string | null; plannedEnd: string; reason: string | null; interiorOverrideReason: string | null }) => void }) {
  const [start, setStart] = useState(task.plannedStart ?? "");
  const [end, setEnd] = useState(task.plannedEnd ?? "");
  const [reason, setReason] = useState("");
  const [interior, setInterior] = useState("");
  const askReason = task.milestone || needs?.kind === "milestone";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ plannedStart: start || null, plannedEnd: end, reason: reason || null, interiorOverrideReason: interior || null });
      }}
      className="space-y-3"
    >
      <p className="text-sm text-stone-600">
        {task.hasAutoRule
          ? "Setting a date by hand switches this task to CUSTOM; the automatic date is kept on record and can be restored with “Reset to auto date”."
          : "This task has no automatic date — set the planned dates here."}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Planned start</span>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Planned end *</span>
          <input type="date" className="input" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      {askReason && (
        <label className="block">
          <span className="label">Reason for overriding the milestone date{task.milestone ? " *" : ""}</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required={task.milestone} maxLength={500} />
        </label>
      )}
      {needs?.kind === "interior" && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Interior rule conflict</p>
          <p className="mt-1">{needs.message}</p>
          <label className="mt-2 block">
            <span className="label">Reason to override *</span>
            <input className="input" value={interior} onChange={(e) => setInterior(e.target.value)} required maxLength={500} />
          </label>
        </div>
      )}
      <Footer pending={pending} error={error} submit={needs?.kind === "interior" ? "Override & save" : "Save planned dates"} />
    </form>
  );
}

function ActualForm({ task, pending, error, onSubmit }: { task: TaskView; pending: boolean; error: string | null; onSubmit: (v: { actualStart: string | null; actualEnd: string | null }) => void }) {
  const [start, setStart] = useState(task.actualStart ?? "");
  const [end, setEnd] = useState(task.actualEnd ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ actualStart: start || null, actualEnd: task.status === "COMPLETED" ? end || null : null });
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Actual start</span>
          <input type="date" className="input" value={start} max={todayISO()} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Actual end</span>
          <input type="date" className="input" value={end} max={todayISO()} onChange={(e) => setEnd(e.target.value)} disabled={task.status !== "COMPLETED"} />
        </label>
      </div>
      {task.status !== "COMPLETED" && <p className="text-xs text-stone-500">The actual end is set when the task is completed or approved.</p>}
      <Footer pending={pending} error={error} submit="Save actual dates" />
    </form>
  );
}

function DelayForm({ task, pending, error, onSubmit }: { task: TaskView; pending: boolean; error: string | null; onSubmit: (v: { type: DelayTypeKey; reason: string; delayDays: number; shiftFollowing: boolean }) => void }) {
  const auto = task.plannedEnd ? Math.max(0, daysBetween(task.plannedEnd, task.actualEnd ?? todayISO())) : 0;
  const [type, setType] = useState<DelayTypeKey>("IN_HOUSE");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(auto);
  const [shift, setShift] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ type, reason, delayDays: days, shiftFollowing: type === "CLIENT_SIDE" && shift });
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Delay type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as DelayTypeKey)}>
            {(Object.keys(DELAY_LABEL) as DelayTypeKey[]).map((k) => (
              <option key={k} value={k}>
                {DELAY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Delay days</span>
          <input type="number" min={0} className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <span className="mt-1 block text-[11px] text-stone-500">Auto: {auto} (actual or today − planned end)</span>
        </label>
      </div>
      <label className="block">
        <span className="label">Reason *</span>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} />
      </label>
      {type === "CLIENT_SIDE" && task.downstreamCount > 0 && (
        <label className="flex items-start gap-2 rounded-lg bg-stone-50 p-3 text-sm">
          <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
          <span>
            Also shift the planned dates of the <strong>{task.downstreamCount}</strong> following task{task.downstreamCount === 1 ? "" : "s"} by {days} day{days === 1 ? "" : "s"}
          </span>
        </label>
      )}
      <Footer pending={pending} error={error} submit="Flag delay" disabled={!reason.trim()} />
    </form>
  );
}

function ReassignForm({ task, pending, error, onSubmit }: { task: TaskView; pending: boolean; error: string | null; onSubmit: (v: { toUserId: string; replaceUserId: string | null; reason: string | null }) => void }) {
  const teamOnly = task.perms.reassignWithinTeamOnly;
  const pool: PoolMember[] = task.pool.filter((m) => !task.assignees.some((a) => a.id === m.id) && (!teamOnly || m.sameTeam));
  const [to, setTo] = useState(pool[0]?.id ?? "");
  const [replace, setReplace] = useState(task.multiAssignee ? "" : task.assignees[0]?.id ?? "");
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ toUserId: to, replaceUserId: teamOnly ? null : replace || null, reason: reason || null });
      }}
      className="space-y-3"
    >
      {pool.length === 0 ? (
        <p className="text-sm text-stone-600">{teamOnly ? "There's no one else in your team who can take this task." : "Everyone in the pool is already assigned."}</p>
      ) : (
        <>
          <label className="block">
            <span className="label">{teamOnly ? "Hand over to" : "Assign to"}</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              {pool.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.preferred ? "★ " : ""}
                  {m.name} — {m.roleName}
                </option>
              ))}
            </select>
            {pool.some((m) => m.preferred) && <span className="mt-1 block text-[11px] text-stone-500">★ preferred for this stage</span>}
          </label>
          {!teamOnly && task.assignees.length > 0 && (
            <label className="block">
              <span className="label">Replace</span>
              <select className="input" value={replace} onChange={(e) => setReplace(e.target.value)}>
                {task.multiAssignee && <option value="">Nobody — add as an extra assignee</option>}
                {task.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label">Note (optional)</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
        </>
      )}
      <Footer pending={pending} error={error} submit={teamOnly ? "Hand over" : "Save assignment"} disabled={!to} />
    </form>
  );
}

function StartPhaseForm({ task, ctx, pending, error, onSubmit }: { task: TaskView; ctx?: StartContext; pending: boolean; error: string | null; onSubmit: (v: { startDate: string; kickoff?: string; assignments: { taskId: string; userId: string }[] }) => void }) {
  const [start, setStart] = useState(todayISO());
  const [kickoff, setKickoff] = useState(ctx?.kickoff ?? todayISO());
  const stages = (ctx?.stages ?? []).filter((s) => s.status !== "COMPLETED");
  const [assign, setAssign] = useState<Record<string, string>>(Object.fromEntries(stages.map((s) => [s.id, s.assignees[0]?.id ?? ""])));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          startDate: start,
          kickoff: ctx?.isConstructionStart ? kickoff : undefined,
          assignments: Object.entries(assign)
            .filter(([taskId, userId]) => userId && !stages.find((s) => s.id === taskId)?.assignees.some((a) => a.id === userId))
            .map(([taskId, userId]) => ({ taskId, userId })),
        });
      }}
      className="space-y-4"
    >
      <p className="text-sm text-stone-600">
        Starting the phase sets its actual start date. Stages then run in order, each planned from the previous one.
        {ctx?.isConstructionStart && " This is the construction kickoff: assigned workers will now see their tasks."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Phase start date</span>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        {ctx?.isConstructionStart && (
          <label className="block">
            <span className="label">Construction kickoff (anchor for auto dates)</span>
            <input type="date" className="input" value={kickoff} onChange={(e) => setKickoff(e.target.value)} required />
          </label>
        )}
      </div>
      {stages.length > 0 && (
        <div>
          <p className="label">Assign stages (optional — can be done later)</p>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {stages.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-40 shrink-0 truncate text-sm font-medium">{s.name}</span>
                <select className="input py-1.5" value={assign[s.id] ?? ""} onChange={(e) => setAssign((a) => ({ ...a, [s.id]: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {s.pool.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.preferred ? "★ " : ""}
                      {m.name} — {m.roleName}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Footer pending={pending} error={error} submit="Start phase" />
    </form>
  );
}

function TaskHistory({ task }: { task: TaskView }) {
  const rows = [
    ...task.reviews.map((r) => ({ at: r.at, text: `${r.decision === "SUBMITTED" ? "Submitted for review" : r.decision === "APPROVED" ? "Approved" : "Sent back"} by ${r.by}`, note: r.note })),
    ...task.history.map((h) => ({ at: h.at, text: h.from ? `Reassigned ${h.from} → ${h.to} by ${h.by}` : `Assigned to ${h.to} by ${h.by}`, note: h.reason })),
    ...task.delays.map((d) => ({ at: d.at, text: `${DELAY_LABEL[d.type]} delay · ${d.days}d flagged by ${d.by}${d.shifted ? " · following tasks shifted" : ""}`, note: d.reason })),
    ...task.events
      .filter((e) => e.type !== "COMPLETED")
      .map((e) => ({ at: e.at, text: `${EVENT_LABEL[e.type] ?? e.type}${e.by ? ` by ${e.by}` : ""}`, note: e.note })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="border-t border-dashed border-stone-200 bg-stone-50/70 px-4 py-3 pl-9 text-sm">
      {rows.length === 0 ? (
        <p className="text-stone-500">No history yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-28 shrink-0 text-xs text-stone-400 tabular-nums">{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span>
                {r.text}
                {r.note && <span className="block text-xs text-stone-500 italic">“{r.note}”</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  PHASE_STARTED: "Phase started",
  STARTED: "Started",
  SEQUENCE_OVERRIDE: "Started early (sequence override)",
  PLANNED_CHANGED: "Planned date changed",
  RESET_TO_AUTO: "Reset to auto date",
  ACTUAL_CHANGED: "Actual dates edited",
  SHIFTED_FOLLOWING: "Shifted following tasks",
  INTERIOR_RULE_OVERRIDE: "Interior rule overridden",
  BACKFILLED: "Backfilled",
};
