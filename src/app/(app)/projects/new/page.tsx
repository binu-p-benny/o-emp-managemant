import type { Metadata } from "next";
import { ProjectForm } from "@/components/project-form";
import { PageHeader } from "@/components/ui";
import { employeeOptions } from "@/lib/projects";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Add project" };

export default async function NewProjectPage() {
  await requirePermission("projects.create");
  return (
    <div>
      <PageHeader title="Project Setting" subtitle="Add a new project" back={{ href: "/projects", label: "Projects" }} />
      <ProjectForm employees={await employeeOptions()} canEditDetails canManageMembers />
    </div>
  );
}
