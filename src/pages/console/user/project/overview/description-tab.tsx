import ProjectReadme from "./project-readme"
import type { ProjectReadmeState } from "./use-project-readme"
import type { DomainProject } from "@/api/Api"

interface ProjectOverviewDescriptionTabProps {
  readme: ProjectReadmeState
  project?: DomainProject
}

export default function ProjectOverviewDescriptionTab({ readme, project }: ProjectOverviewDescriptionTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <ProjectReadme readme={readme} repoUrl={project?.repo_url} />
    </div>
  )
}
