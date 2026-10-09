import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProjectForm } from "@/components/project-form";
import { PageHeader } from "@/components/ui";
import { employeeOptions, loadProjectForm } from "@/lib/projects";
import { canViewProject } from "@/lib/scope";
import { can, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const canEditDetails = can(user, "projects.edit");
  const canManageMembers = can(user, "projects.members.manage");
  if (!canEditDetails && !canManageMembers) redirect("/forbidden");
  if (!(await canViewProject(user, id))) notFound();

  const data = await loadProjectForm(id);
  if (!data) notFound();

  return (
    <div>
      <PageHeader
        title="Project Setting"
        subtitle={`${data.project.projectCode} — ${data.project.projectName}`}
        back={{ href: `/projects/${id}`, label: "Back to project" }}
      />
      <ProjectForm
        projectId={id}
        initialDetails={data.details}
        initialMembers={data.members}
        initialLocations={data.locations}
        employees={await employeeOptions()}
        canEditDetails={canEditDetails}
        canManageMembers={canManageMembers}
      />
    </div>
  );
}
