/**
 * Coding 模式（当前项目）的功能页清单。
 *
 * 项目由侧栏顶部的「切换项目」按钮选定（见 nav/project-switcher.tsx），侧栏菜单
 * 不再列项目，而是列**当前项目的功能页**——每项是一个独立路由
 * `/coding/project/:projectId/<path>`，不再是同一页里的 Tab。
 *
 * 数组顺序即侧栏菜单的展示顺序。
 */
import { CircleDot, FileText, FolderTree, Hammer, ListTodo, Waypoints } from "lucide-react"
import type { ComponentType } from "react"

export interface CodingSection {
  /** 路由段，同时是稳定标识（与旧 `?tab=` 的取值一致，便于兼容重定向）。 */
  path: string
  labelKey: string
  fallback: string
  icon: ComponentType<{ className?: string }>
}

export const CODING_SECTIONS: CodingSection[] = [
  { path: "description", labelKey: "codingSections.description", fallback: "描述", icon: FileText },
  { path: "info", labelKey: "codingSections.info", fallback: "目录", icon: FolderTree },
  { path: "issues", labelKey: "codingSections.issues", fallback: "需求/bug", icon: CircleDot },
  { path: "tunnels", labelKey: "codingSections.tunnels", fallback: "穿透", icon: Waypoints },
  { path: "build", labelKey: "codingSections.build", fallback: "构建", icon: Hammer },
  { path: "tasks", labelKey: "codingSections.tasks", fallback: "任务", icon: ListTodo },
]

/** 项目工作区的默认落地页（裸 /coding/project/:id 或非法 section 都落到它）。 */
export const DEFAULT_CODING_SECTION: CodingSection = CODING_SECTIONS[0]

export function findCodingSection(path?: string | null): CodingSection | undefined {
  if (!path) return undefined
  return CODING_SECTIONS.find((section) => section.path === path)
}

/** 某项目下某功能页的完整路径。 */
export function codingSectionPath(projectId: string, section: CodingSection): string {
  return `/coding/project/${encodeURIComponent(projectId)}/${section.path}`
}

/** 项目工作区根路径（= 默认功能页）。 */
export function codingProjectPath(projectId: string): string {
  return codingSectionPath(projectId, DEFAULT_CODING_SECTION)
}

const SECTION_PATH_RE = /^\/coding\/projects?\/([^/]+)\/([^/]+)$/

/**
 * 从 pathname 反推当前功能页。壳的面包屑用它补第二段（壳本身拿不到子路由参数）。
 * 同时接受 /coding/projects/:id/:section（旧的管理端路径），两者都映射到同一功能页。
 */
export function resolveCodingSectionFromPath(pathname: string): CodingSection | undefined {
  const normalized = pathname !== "/" ? pathname.replace(/\/$/, "") : pathname
  const matched = SECTION_PATH_RE.exec(normalized)
  return matched ? findCodingSection(matched[2]) : undefined
}
