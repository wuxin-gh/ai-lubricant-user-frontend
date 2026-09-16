/**
 * 项目工作区外壳：/coding/project/:projectId/:section
 *
 * 一个项目 = 一组功能页（描述 / 目录 / 需求 / 穿透 / 构建 / 任务），每页是独立路由，
 * 由侧栏菜单切换（见 src/config/coding-sections.ts，不再是同一页里的 Tab）。
 *
 * 本组件负责取项目、渲染项目信息条（ProjectInfo：名称 / 栈 / Review / AI 对话 /
 * 编辑删除），再吐 children。项目只取一次，切功能页不重新拉取、不闪。
 *
 * 两种用法：
 *   - 路由：<ProjectWorkspace><Outlet /></ProjectWorkspace>（功能页走子路由）
 *   - 管理端项目详情：<ProjectWorkspace><ProjectSectionView section={默认页}/></ProjectWorkspace>
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { type DomainProject } from "@/api/Api"
import type { NodeInfo } from "@/api/nodes"
import { apiRequest } from "@/utils/requestUtils"
import { isProjectRepoUnbound } from "@/utils/project"
import { useCommonData } from "@/components/console/data-provider"
import ProjectInfo from "@/components/console/project/project-info"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { IconAlertCircle } from "@tabler/icons-react"

interface ProjectWorkspaceValue {
  projectId: string
  project?: DomainProject
  nodes: NodeInfo[]
  reloadProject: () => void
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceValue | null>(null)

/** 当前项目工作区上下文；功能页用它取 project / projectId / nodes。 */
export function useProjectWorkspace(): ProjectWorkspaceValue {
  const ctx = useContext(ProjectWorkspaceContext)
  if (!ctx) throw new Error("useProjectWorkspace 必须在 ProjectWorkspace 内使用")
  return ctx
}

export default function ProjectWorkspace({ children }: { children: ReactNode }) {
  const { projectId = "" } = useParams<{ projectId: string }>()
  const { nodes } = useCommonData()
  const { t } = useTranslation()
  const projectIdRef = useRef(projectId)
  const [project, setProject] = useState<DomainProject | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  const fetchProject = useCallback(async () => {
    const requestedId = projectId
    setLoading(true)
    await apiRequest("v1UsersProjectsDetail", {}, [requestedId], (resp) => {
      if (projectIdRef.current !== requestedId) return
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || t("projectOverview.toast.fetchProjectFailed"))
      }
    })
    setLoading(false)
  }, [projectId, t])

  useEffect(() => {
    if (!projectId) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setProject(undefined)
      void fetchProject()
    })
    return () => {
      active = false
    }
  }, [fetchProject, projectId])

  // 项目没绑仓库：给空态，不渲染功能页（功能页都要仓库才有意义）。
  if (projectId && project && isProjectRepoUnbound(project)) {
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

  // 取数阶段整页给个 spinner，避免功能页各自渲染一遍 loading 又被替换。
  if (loading && !project) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <ProjectWorkspaceContext.Provider
      value={{ projectId, project, nodes, reloadProject: () => void fetchProject() }}
    >
      <div className="flex h-full w-full min-h-0 flex-col gap-4">
        <ProjectInfo project={project} onRefresh={() => void fetchProject()} />
        {/* 功能页内容：按内容自然撑高，别挂 flex-1 高度链（见壳的滚动容器约定）。 */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </ProjectWorkspaceContext.Provider>
  )
}
