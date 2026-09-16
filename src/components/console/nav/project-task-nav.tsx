/**
 * 侧栏「当前项目的任务」：活跃任务 + 历史任务，挂在「任务」功能页菜单项下方。
 *
 * 与功能页菜单（CodingProjectNav）视觉隔离：加分隔线 + 独立分组标题，让「选功能」
 * 与「选任务」两段一眼分得开。
 *
 * 数据走 listUserTasks({ project_id })，只取当前项目的任务（与「任务」功能页同源，
 * 但这里只要最近几条做快捷跳转，不翻页）。每次导航重拉一次——任务创建后会跳到任务页，
 * 停止/删除后也总会离开当前页，故跟着 pathname 刷新足够覆盖主要流程，不需要轮询。
 */
import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { IconPointFilled } from "@tabler/icons-react"
import { Loader2 } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { getTaskDisplayName } from "@/utils/common"
import { listUserTasks, type UserTaskSummary } from "@/api/userTaskClient"
import { useCurrentProject } from "@/components/console/current-project-context"

/** 每组最多列几条；更多的去「任务」功能页看全量。 */
const LIMIT = 5

/** 活跃 = 还在跑或排队；其余都算历史。 */
const ACTIVE_STATUSES = new Set(["pending", "processing"])

export default function ProjectTaskNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const { projectId } = useCurrentProject()
  const [tasks, setTasks] = useState<UserTaskSummary[]>([])
  const [loading, setLoading] = useState(false)

  const normalized = location.pathname.replace(/\/$/, "")
  // 项目选择页不显示：那时用户在挑项目，列出的是上一个项目的任务。
  const isSelectionPage = normalized === "/coding" || normalized === "/coding/projects"
  const enabled = !!projectId && !isSelectionPage

  const load = useCallback(async () => {
    if (!projectId) {
      setTasks([])
      return
    }
    setLoading(true)
    try {
      const result = await listUserTasks({ project_id: projectId, page: 1, page_size: 50 })
      setTasks(result.rows)
    } catch {
      // 侧栏快捷列表拉不到就静默留空——它只是加速入口，不该弹错打断。
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load, location.pathname])

  if (!enabled) return null

  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).slice(0, LIMIT)
  const history = tasks
    .filter((task) => !ACTIVE_STATUSES.has(task.status))
    .sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0))
    .slice(0, LIMIT)

  const renderTask = (task: UserTaskSummary) => {
    const to = `/coding/task/${task.id}`
    const isActive = ACTIVE_STATUSES.has(task.status)
    return (
      <SidebarMenuItem key={task.id}>
        <SidebarMenuButton tooltip={getTaskDisplayName(task)} isActive={normalized === to} asChild>
          <Link to={to}>
            {isActive ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <IconPointFilled className="size-3.5 shrink-0 text-muted-foreground/40" />
            )}
            <span className="truncate">{getTaskDisplayName(task)}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  // 分组标题是 <div>，不能放进 SidebarMenu（<ul>）里，故作为 <ul> 的兄弟节点。
  const renderGroup = (label: string, items: UserTaskSummary[], topGap: boolean) => {
    if (items.length === 0) return null
    return (
      <>
        <div className={topGap ? "px-2 pt-2 pb-0.5 text-xs text-muted-foreground/70" : "px-2 pt-1 pb-0.5 text-xs text-muted-foreground/70"}>
          {label}
        </div>
        <SidebarMenu>{items.map(renderTask)}</SidebarMenu>
      </>
    )
  }

  const isEmpty = active.length === 0 && history.length === 0

  return (
    // mt-3 + 顶部细线：与上方的功能页菜单明确隔开，避免两段入口糊成一片。
    <SidebarGroup className="mt-3 border-t pt-2 p-0">
      <SidebarGroupLabel>{t("codingSections.tasksGroupLabel", "项目任务")}</SidebarGroupLabel>
      {isEmpty ? (
        <div className="px-2 py-1 text-xs text-muted-foreground/60">
          {loading
            ? t("codingSections.tasksLoading", "加载中…")
            : t("codingSections.noTasks", "暂无任务")}
        </div>
      ) : (
        <>
          {renderGroup(t("codingSections.activeTasks", "活跃任务"), active, false)}
          {renderGroup(t("codingSections.historyTasks", "历史任务"), history, true)}
        </>
      )}
    </SidebarGroup>
  )
}
