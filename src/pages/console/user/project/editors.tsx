import { Navigate, useParams } from "react-router-dom"

import { CODING_SECTIONS, codingSectionPath } from "@/config/coding-sections"

/** 编辑器旧入口的落点：任务页（编辑器管理已并入任务/项目工作区）。 */
const TASKS_SECTION = CODING_SECTIONS.find((s) => s.path === "tasks") ?? CODING_SECTIONS[0]

/**
 * 旧的独立项目编辑器页已下线：编辑器管理统一在项目工作区的「任务」页内。
 * 这里把 `/coding/project/:id/editors` 重定向到该页。
 */
export default function ProjectEditorsRedirect() {
  const { projectId = "" } = useParams<{ projectId: string; editorId?: string }>()
  return <Navigate to={codingSectionPath(projectId, TASKS_SECTION)} replace />
}
