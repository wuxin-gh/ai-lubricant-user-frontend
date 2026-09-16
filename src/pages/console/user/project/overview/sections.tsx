/**
 * 项目功能页内容：按 section 渲染对应的功能（描述 / 目录 / 需求 / 穿透 / 构建 / 任务）。
 *
 * 这些原本是项目详情页里的 Tabs，现在每项是一个独立路由页；本组件只负责把
 * section 映射到具体功能组件，项目数据从 ProjectWorkspace 上下文取。
 */
import { findCodingSection, DEFAULT_CODING_SECTION, type CodingSection } from "@/config/coding-sections"
import { useProjectWorkspace } from "./index"
import { useProjectReadme } from "./use-project-readme"
import ProjectOverviewDescriptionTab from "./description-tab"
import ProjectOverviewInfoTab from "./info-tab"
import ProjectOverviewIssuesTab from "./issues-tab"
import ProjectOverviewTasksTab from "./tasks-tab"
import ProjectTunnelsTab from "./tunnels-tab"
import ProjectBuildTab from "./build-tab"

/** 按路由段渲染功能页；段非法时回落到默认页（描述）。 */
export default function ProjectSectionView({ section: sectionProp }: { section?: string }) {
  const { projectId, project, nodes } = useProjectWorkspace()
  const section: CodingSection = findCodingSection(sectionProp) ?? DEFAULT_CODING_SECTION

  // README 只在「描述」页需要；其它页不拉取（避免每次切页都发一轮仓库请求）。
  const readme = useProjectReadme(section.path === "description" ? project : undefined)

  switch (section.path) {
    case "info":
      return <ProjectOverviewInfoTab projectId={projectId} project={project} />
    case "issues":
      return <ProjectOverviewIssuesTab projectId={projectId} />
    case "tunnels":
      return <ProjectTunnelsTab projectId={projectId} nodes={nodes} />
    case "build":
      return <ProjectBuildTab projectId={projectId} nodes={nodes} />
    case "tasks":
      return <ProjectOverviewTasksTab projectId={projectId} />
    case "description":
    default:
      return <ProjectOverviewDescriptionTab readme={readme} project={project} />
  }
}
