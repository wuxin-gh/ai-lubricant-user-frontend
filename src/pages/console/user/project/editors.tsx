import { Navigate, useParams } from "react-router-dom"

/**
 * 旧的独立项目编辑器页已下线：编辑器管理统一在项目详情「编辑器」tab 内。
 * 这里把 `/console/project/:id/editors` 和 `/console/project/:id/editor/:editorId`
 * 重定向到项目详情页并聚焦编辑器 tab（带上要选中的编辑器 id）。
 */
export default function ProjectEditorsRedirect() {
  const { projectId = "" } = useParams<{ projectId: string; editorId?: string }>()
  return <Navigate to={`/console/project/${projectId}?tab=tasks`} replace />
}
