import { Icon } from "@/components/icons";
import { ProgressBar, Stat } from "@/components/ui";
import { percent } from "@/lib/format";
import type { PhaseView, ProjectWorkflowView } from "@/lib/workflow/queries";
import { DELAY_LABEL, type DelayTypeKey } from "@/lib/workflow/types";
import { PhaseStatusBadge, fmtDay } from "./chips";
import { startContextFor } from "./start-context";
import { TaskRow } from "./task-row";

const monthYear = (key: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short", year: "2-digit" }).format(new Date(`${key}T00:00:00Z`));

export function WorkflowHeader({ view }: { view: ProjectWorkflowView }) {
  const target = view.constructionTarget;
  const [firstActive, ...moreActive] = view.activeLabel.split(" + ");
  const late = target?.plannedFinish && target.plannedFinish > target.latest;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          compact
          label="Current phase"
          value={firstActive}
          hint={[moreActive.length ? `+ ${moreActive.join(", ")} in parallel` : null, view.project.designApprovedAt ? `Design approved ${fmtDay(view.project.designApprovedAt.slice(0, 10))}` : "Design not yet approved"].filter(Boolean).join(" · ")}
          icon="layers"
          tone="brand"
        />
        <Stat label="Stages approved" value={`${view.progress.done}/${view.progress.total}`} hint={`${percent(view.progress.done, view.progress.total)}% of the standard flow`} icon="check" tone="green" />
        <Stat
          compact
          label="Construction target (10–12 months)"
          value={target ? `${monthYear(target.earliest)} – ${monthYear(target.latest)}` : "Not kicked off"}
          hint={target ? (target.plannedFinish ? `Kickoff ${fmtDay(target.kickoff)} · planned finish ${fmtDay(target.plannedFinish)}${late ? " (beyond 12 months)" : ""}` : `Kickoff ${fmtDay(target.kickoff)}`) : "from construction kickoff"}
          icon="calendar"
          tone={late ? "red" : "blue"}
        />
        <Stat
          label="Delays"
          value={view.delaySummary.count ? `${view.delaySummary.count} · ${view.delaySummary.days}d` : "None"}
          hint={(Object.keys(view.delaySummary.byType) as DelayTypeKey[])
            .filter((k) => view.delaySummary.byType[k].count)
            .map((k) => `${DELAY_LABEL[k]} ${view.delaySummary.byType[k].count}×/${view.delaySummary.byType[k].days}d`)
            .join(" · ") || "in-house vs client side"}
          icon="flag"
          tone={view.delaySummary.count ? "red" : "gray"}
        />
      </div>
      {view.interiorConflict && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          {view.interiorConflict}
        </p>
      )}
    </div>
  );
}

function PhaseCard({ view, phase }: { view: ProjectWorkflowView; phase: PhaseView }) {
  const rows = phase.tasks;
  return (
    <section className={`card overflow-hidden ${phase.status === "ACTIVE" ? "ring-2 ring-brand-300" : ""}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-3">
        <h3 className="font-semibold text-ink-900">{phase.name}</h3>
        <PhaseStatusBadge status={phase.status} />
        <span className="text-xs text-stone-500">Owner: {phase.ownerRoleName}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-stone-500">
          {(phase.actualStart || phase.actualEnd) && (
            <span className="tabular-nums">
              {fmtDay(phase.actualStart)} → {fmtDay(phase.actualEnd)}
            </span>
          )}
          {phase.total > 0 && (
            <span className="flex w-28 items-center gap-2">
              <ProgressBar value={percent(phase.done, phase.total)} tone={phase.status === "COMPLETED" ? "green" : "brand"} />
              <span className="tabular-nums">
                {phase.done}/{phase.total}
              </span>
            </span>
          )}
        </span>
      </header>
      {!phase.startTask && rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-500">{phase.opensWhen ?? "Not reached yet."}</p>
      ) : (
        <ul>
          {phase.startTask && <TaskRow task={phase.startTask} startContext={startContextFor(view, phase.startTask)} />}
          {rows.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
      {phase.status === "LOCKED" && rows.length > 0 && <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">{phase.opensWhen}</p>}
    </section>
  );
}

export function WorkflowBoard({ view }: { view: ProjectWorkflowView }) {
  const design = view.phases.filter((p) => !p.isConstruction);
  const construction = view.phases.filter((p) => p.isConstruction);
  const approval = view.approvals[0];
  const d2 = view.phases.find((p) => p.key === "DESIGN_2");
  return (
    <div className="space-y-6">
      <WorkflowHeader view={view} />

      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Design</h2>
        {design.map((p) => (
          <PhaseCard key={p.key} view={view} phase={p} />
        ))}
        <section className="card overflow-hidden">
          <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
            <h3 className="font-semibold">Design approval gate</h3>
            <span className="text-xs text-stone-500">Architect Head approves → construction handed to Head - Site Operations</span>
          </header>
          {approval ? (
            <ul>
              <TaskRow task={approval} />
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-stone-500">
              Unlocks when every Design Phase 1 and 2 task is approved{d2 ? ` (${d2.done}/${d2.total} working-drawing stages done)` : ""}. Interior design (Phases 3–4) isn&apos;t blocked by this gate.
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Construction</h2>
        {construction.map((p) => (
          <PhaseCard key={p.key} view={view} phase={p} />
        ))}
      </div>
    </div>
  );
}
