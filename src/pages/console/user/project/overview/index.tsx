import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ProjectInfo from "@/components/console/project/project-info"
import { type DomainProject } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { isProjectRepoUnbound } from "@/utils/project"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { IconAlertCircle } from "@tabler/icons-react"
import ProjectOverviewInfoTab from "./info-tab"
import ProjectOverviewDescriptionTab from "./description-tab"
import ProjectOverviewIssuesTab from "./issues-tab"
import ProjectOverviewTasksTab from "./tasks-tab"
import ProjectTunnelsTab from "./tunnels-tab"
import ProjectBuildTab from "./build-tab"
import { useProjectReadme } from "./use-project-readme"
import { useTranslation } from "react-i18next"
import { useCommonData } from "@/components/console/data-provider"

export default function ProjectOverviewPage() {
  const { t } = useTranslation()
  const { nodes } = useCommonData()
  const { projectId = "" } = useParams<{ projectId: string }>()
  const projectIdRef = useRef(projectId)
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const tabFromQuery =
    requestedTab === "tasks" || requestedTab === "description" || requestedTab === "build"
      ? requestedTab
      : null
  const [activeTab, setActiveTab] = useState(tabFromQuery || "description")

  useEffect(() => {
    setActiveTab(tabFromQuery || "description")
  }, [projectId, tabFromQuery])

  const [project, setProject] = useState<DomainProject | undefined>(undefined)
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)
  const readme = useProjectReadme(project)

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  const fetchProject = useCallback(async () => {
    const requestedId = projectId
    await apiRequest("v1UsersProjectsDetail", {}, [requestedId], (resp) => {
      if (projectIdRef.current !== requestedId) return
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || t("projectOverview.toast.fetchProjectFailed"))
      }
    })
  }, [projectId, t])

  useEffect(() => {
    if (!projectId) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (!active) {
        return
      }
      setProject(undefined)
      fetchProject()
    })

    return () => {
      active = false
    }
  }, [fetchProject, projectId])

  const isRepoUnbound = isProjectRepoUnbound(project)

  if (projectId && project && isRepoUnbound) {
    return (
      <Empty className="bg-muted flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertCircle className="size-6" />
          </EmptyMedia>
          <EmptyTitle>{t("projectOverview.unbound.title")}</EmptyTitle>
          <EmptyDescription>{t("projectOverview.unbound.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full w-full min-h-0">
      <ProjectInfo project={project} onRefresh={fetchProject} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        <TabsList>
          <TabsTrigger value="description">{t("projectOverview.tabs.description")}</TabsTrigger>
          <TabsTrigger value="info">{t("projectOverview.tabs.info")}</TabsTrigger>
          <TabsTrigger value="issues">{t("projectOverview.tabs.issues")}</TabsTrigger>
          <TabsTrigger value="tasks">{t("projectOverview.tabs.tasks")}</TabsTrigger>
          <TabsTrigger value="tunnels">穿透</TabsTrigger>
          <TabsTrigger value="build">构建</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-2 flex-1 min-h-0 flex flex-col overflow-hidden">
          <ProjectOverviewInfoTab projectId={projectId} project={project} />
        </TabsContent>
        <TabsContent value="description" className="mt-2 flex-1 min-h-0 flex flex-col overflow-hidden">
          <ProjectOverviewDescriptionTab readme={readme} project={project} />
        </TabsContent>
        <TabsContent value="issues" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewIssuesTab projectId={projectId} onTaskCreated={() => setTasksRefreshKey((k) => k + 1)} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewTasksTab projectId={projectId} refreshKey={tasksRefreshKey} />
        </TabsContent>
        <TabsContent value="tunnels" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectTunnelsTab projectId={projectId} nodes={nodes} />
        </TabsContent>
        <TabsContent value="build" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectBuildTab projectId={projectId} nodes={nodes} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
