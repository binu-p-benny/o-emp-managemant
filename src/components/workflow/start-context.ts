import type { ProjectWorkflowView, TaskView } from "@/lib/workflow/queries";
import type { StartContext } from "./task-row";

/** What the "Start phase" dialog needs: the stages to assign and, for construction, the kickoff. */
export function startContextFor(view: ProjectWorkflowView, task: TaskView): StartContext | undefined {
  if (task.kind !== "PHASE_START") return undefined;
  const constructionStart = task.phaseKey === "CONSTRUCTION_1";
  const stages = constructionStart
    ? view.phases.filter((p) => p.isConstruction).flatMap((p) => p.tasks)
    : view.phases.find((p) => p.key === task.phaseKey)?.tasks ?? [];
  return { stages: [...stages].sort((a, b) => a.order - b.order), isConstructionStart: constructionStart, kickoff: view.project.constructionKickoff };
}
