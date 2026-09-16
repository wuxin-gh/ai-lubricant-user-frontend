/**
 * 「当前项目」：Coding 模式下侧栏切换按钮与面包屑共用的一份状态。
 *
 * 来源两处，URL 优先：
 *   - 路由 /coding/project/:projectId（含其子路径）→ 权威，进入即记住；
 *   - localStorage 记住的上次项目 → 离开项目详情后（任务页 / 编辑器页）仍然显示。
 *
 * 项目对象从 DataProvider 的项目列表里查。列表里查不到（被删 / 不再有权限）时
 * `project` 为 null，展示侧据此回退成「切换项目」，不显示一个已经打不开的名字。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"

import { type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { rememberCodingProject, rememberedCodingProjectId } from "@/utils/coding-project"

/** 从项目路由里取 id：/coding/project/:id 与 /coding/projects/:id 都算。 */
const PROJECT_ROUTE_RE = /^\/coding\/projects?\/([^/]+)/

interface CurrentProjectContextValue {
  /** 当前项目 id；没有时 null。 */
  projectId: string | null
  /** 当前项目对象；id 有但列表里查不到时为 null。 */
  project: DomainProject | null
  /** 项目列表是否仍在加载——列表没到齐时 project 为 null 不代表项目不存在。 */
  loading: boolean
  /** 切换当前项目（同时写 localStorage，侧栏与面包屑立即更新）。 */
  setCurrentProject: (projectId: string | null) => void
}

const CurrentProjectContext = createContext<CurrentProjectContextValue | null>(null)

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { projects, loadingProjects } = useCommonData()
  const [projectId, setProjectId] = useState<string | null>(() => rememberedCodingProjectId())

  const routeProjectId = useMemo(() => {
    const matched = PROJECT_ROUTE_RE.exec(location.pathname)
    return matched ? decodeURIComponent(matched[1]) : null
  }, [location.pathname])

  // 走到项目路由就以 URL 为准（比 localStorage 权威），并写回记住。
  useEffect(() => {
    if (!routeProjectId) return
    setProjectId(routeProjectId)
    rememberCodingProject(routeProjectId)
  }, [routeProjectId])

  const setCurrentProject = useCallback((next: string | null) => {
    setProjectId(next)
    rememberCodingProject(next)
  }, [])

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projects, projectId],
  )

  const value = useMemo(
    () => ({ projectId, project, loading: loadingProjects, setCurrentProject }),
    [projectId, project, loadingProjects, setCurrentProject],
  )

  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>
}

/** 当前项目；不在 Provider 内（如首页）时返回空值，调用方按「无当前项目」处理。 */
export function useCurrentProject(): CurrentProjectContextValue {
  return useContext(CurrentProjectContext) ?? {
    projectId: null,
    project: null,
    loading: false,
    setCurrentProject: () => {},
  }
}
