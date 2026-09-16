/**
 * 统一控制台壳：合并原 /console（用户端）与 /manager（管理端）两套壳。
 *
 * 信息架构改为六模式（src/config/modes.ts），模式是唯一顶层结构；同一模式内
 * 管理项与普通用户项按角色过滤共存。原两套壳的差异按如下方式吸收：
 *
 * - 鉴权：统一走 ConsoleProtectedRoute（C 端 session role==admin，或应急管理员
 *   token 兜底）。不再按路径分两个壳。
 * - 面包屑：模式驱动 —— 第一段是模式名，第二段从该模式的导航项里匹配当前路径。
 *   原两套硬编码 map（user/page.tsx 12 条 + manager/page.tsx 20 条）已删除。
 * - 顶栏：左侧 SidebarTrigger + 面包屑；右侧统一 ConsoleHeaderActionsHost +
 *   主题切换 + 刷新。管理端的「全局配置」按钮改为 admin 可见的顶栏动作。
 * - DataProvider：始终挂载（侧栏 NavUser 等模式无关组件要用），
 *   但 Provider 内部按 C 端 session 是否存在决定是否真的拉取——应急管理员只有
 *   admin token、没有 session，否则会 401 刷屏。
 * - 当前项目切换器（ProjectSwitcher）与当前项目的功能页菜单（CodingProjectNav）
 *   只在 Coding 模式出现；Agent 平铺列表只在 Agent 模式出现。
 */
import { Fragment, useState, type ReactNode } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { RefreshCw, Settings } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

// 平台页（Channels 等）以内联样式直读 admin 主题变量，需要这份 .platform-scope
// 桥接样式（原由 manager 壳导入）。
import "@/styles/admin-scoped.css"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import UserSidebar from "@/components/console/nav/user-sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { DataProvider, useCommonData } from "@/components/console/data-provider"
import {
  ConsoleHeaderActionsHost,
  ConsoleHeaderActionsProvider,
} from "@/components/console/console-header-actions"
import { useActiveMode } from "@/hooks/use-active-mode"
import { useIsAdmin } from "@/hooks/use-is-admin"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { useAuthStore } from "@/@admin-port/store/authStore"
import { BreadcrumbTaskProvider, useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { CurrentProjectProvider, useCurrentProject } from "@/components/console/current-project-context"
import { codingProjectPath, resolveCodingSectionFromPath } from "@/config/coding-sections"
import { modeEntryPath, modeHref, modeItemMatches, modePath } from "@/config/modes"
import GlobalConfig from "@/pages/manager/platform/GlobalConfig"

/** 鉴权守卫：与原 ManagerProtectedRoute 判定口径一致，未登录跳 /login。 */
function ConsoleProtectedRoute({ children }: { children: ReactNode }) {
  const { auth } = useAppRuntime()
  const hasAdminToken = useAuthStore((state) => state.isAuthenticated)

  // 会话仍在解析中：别过早重定向，避免已登录用户刷新时闪回登录页。
  if (auth.loading && !hasAdminToken) return null
  if (auth.status !== "authenticated" && !hasAdminToken) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function HeaderRefreshButton() {
  const { t } = useTranslation()
  const { reloadAll } = useCommonData()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reloadAll()
      toast.success(t("consoleShell.actions.dataRefreshed", "数据已刷新"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleShell.actions.refreshFailed", "刷新失败"))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={refreshing}
      onClick={() => void refresh()}
      title={t("consoleShell.actions.refreshPage")}
    >
      <RefreshCw className={`h-[1.2rem] w-[1.2rem] ${refreshing ? "animate-spin" : ""}`} />
      {t("consoleShell.actions.refresh")}
    </Button>
  )
}

function ConsoleHeader() {
  const { t } = useTranslation()
  const location = useLocation()
  const mode = useActiveMode()
  const isAdmin = useIsAdmin()
  const [globalConfigOpen, setGlobalConfigOpen] = useState(false)

  // 模式驱动的面包屑：第一段模式名（链到模式入口），第二段是命中的导航项。
  // 详情页（任务/编辑器会话）由页面经 BreadcrumbTaskContext 动态补充段。
  // Coding 模式额外插入当前项目名——该模式没有导航项，用户需要知道「在哪个项目里」。
  const breadcrumbContext = useBreadcrumbTask()
  const { project: currentProject } = useCurrentProject()
  const segments: { label: string; href?: string }[] = []
  if (mode) {
    const normalized = location.pathname.replace(/\/$/, "")
    const isTaskDetail = normalized.startsWith("/coding/task/")
    const dynamic = breadcrumbContext?.dynamicSegments ?? null
    if (isTaskDetail) {
      segments.push({ label: t("home.title", "快捷导航"), href: "/home" })
      if (breadcrumbContext?.taskName) segments.push({ label: breadcrumbContext.taskName })
    } else if (dynamic && dynamic.length > 0) {
      segments.push(...dynamic)
    } else {
      segments.push({ label: t(mode.labelKey, mode.fallback), href: modeEntryPath(mode) })
      if (mode.id === "coding" && currentProject) {
        segments.push({
          label: currentProject.name || t("codingProjects.unnamed", "未命名项目"),
          href: codingProjectPath(currentProject.id || ""),
        })
        // 项目工作区里再补一段功能页名（描述 / 目录 / 需求 / …）。
        const section = resolveCodingSectionFromPath(location.pathname)
        if (section) segments.push({ label: t(section.labelKey, section.fallback) })
      }
      // 命中项按「pathname + query」匹配：资源中心 5 个 Tab 共用 /resources，
      // 只有 tab 不同，靠 query 才能选对那一段。带 query 的优先，无 query 的兜底。
      const withQuery = mode.items.find((item) => modeItemMatches(mode, item, location.pathname, location.search))
      const hit = withQuery ?? mode.items.find((item) => {
        const full = modePath(mode.prefix, item.to)
        return normalized === full || normalized.startsWith(`${full}/`)
      })
      if (hit && modeHref(mode, hit) !== segments[0].href) {
        segments.push({ label: t(hit.labelKey, hit.fallback) })
      }
    }
  }

  return (
    <>
      <header className="flex h-15 shrink-0 items-center gap-2 overflow-hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator
            orientation="vertical"
            className="mr-2 shrink-0 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
          />
          <Breadcrumb className="flex min-w-0 flex-1 overflow-hidden">
            <BreadcrumbList className="min-w-0 flex-1 flex-nowrap break-normal">
              <BreadcrumbItem className="hidden shrink-0 lg:block">
                <BreadcrumbLink href="/" className="whitespace-nowrap">
                  Ai Lubricant
                </BreadcrumbLink>
              </BreadcrumbItem>
              {segments.map((segment, index) => {
                const isLast = index === segments.length - 1
                return (
                  <Fragment key={`${segment.label}-${index}`}>
                    <BreadcrumbSeparator className="shrink-0" />
                    <BreadcrumbItem className={isLast ? "min-w-0 shrink overflow-hidden" : "shrink-0"}>
                      {isLast ? (
                        <BreadcrumbPage className="block truncate" title={segment.label}>
                          {segment.label}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={segment.href ?? "#"} className="whitespace-nowrap">
                          {segment.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 px-4">
          {/* 页面主操作（如「添加设备」「刷新数据」）挂在刷新按钮左侧。 */}
          <ConsoleHeaderActionsHost />
          <HeaderRefreshButton />
          {/* 全局配置原在管理端壳里；合并后按角色收敛为顶栏动作。 */}
          {isAdmin ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setGlobalConfigOpen(true)}
              title="全局配置"
            >
              <Settings className="h-[1.2rem] w-[1.2rem]" />
              <span className="hidden sm:inline">全局配置</span>
            </Button>
          ) : null}
          <ModeToggle />
        </div>
      </header>
      {isAdmin ? <GlobalConfig open={globalConfigOpen} onOpenChange={setGlobalConfigOpen} /> : null}
    </>
  )
}

function ConsoleBody() {
  return (
    <SidebarProvider>
      <UserSidebar />
      <SidebarInset className="h-[calc(100vh-var(--spacing)*4)] min-w-0 overflow-hidden">
        <ConsoleHeaderActionsProvider>
          <ConsoleHeader />
          <div className="flex h-full w-full flex-col gap-4 pb-4 overflow-y-hidden">
            {/* platform-scope：平台页（Channels 等）以内联样式直读 admin 主题变量
                （--bg/--surface/--text…），这里把这些变量桥接成跟随 shadcn 的浅/深色，
                否则整页会按 admin 的深色默认值渲染（见 admin-scoped.css）。 */}
            <div className="platform-scope h-full min-h-0 w-full min-w-0 px-4 overflow-x-hidden overflow-y-auto">
              <Outlet />
            </div>
          </div>
        </ConsoleHeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function ConsoleAppShell() {
  return (
    <ConsoleProtectedRoute>
      <BreadcrumbTaskProvider>
        <DataProvider>
          {/* CurrentProject 要读 DataProvider 的项目列表，故必须在其内部。 */}
          <CurrentProjectProvider>
            <ConsoleBody />
          </CurrentProjectProvider>
        </DataProvider>
      </BreadcrumbTaskProvider>
    </ConsoleProtectedRoute>
  )
}
