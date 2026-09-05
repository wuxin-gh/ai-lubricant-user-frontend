import { ProjectFileManager } from "@/components/console/project/files"
import { type DomainProject } from "@/api/Api"

interface ProjectOverviewInfoTabProps {
  projectId: string
  project?: DomainProject
}

export default function ProjectOverviewInfoTab({ projectId, project }: ProjectOverviewInfoTabProps) {
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
      <ProjectFileManager key={`files-${projectId}`} project={project} className="w-full" />
    </div>
  )
}
