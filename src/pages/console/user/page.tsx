import { BreadcrumbTaskProvider, useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { Fragment, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import UserSidebar from "@/components/console/nav/user-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import CommunityDialog from "@/components/console/nav/community-dialog"
import { RefreshCw } from "lucide-react"
import { DataProvider, useCommonData } from "@/components/console/data-provider"
import { UserHeaderActionsHost, UserHeaderActionsProvider } from "@/components/console/user-header-actions"
import { ModeToggle } from "@/components/mode-toggle"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

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

function UserConsoleContent() {
  const { t } = useTranslation()
  const location = useLocation()
  const breadcrumbContext = useBreadcrumbTask()
  const taskName = breadcrumbContext?.taskName ?? null
  const dynamicSegments = breadcrumbContext?.dynamicSegments ?? null

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/console/tasks": [
      { label: t("consoleShell.breadcrumbs.tasks"), href: "/console/tasks" },
    ],
    "/console/gitbot": [
      { label: t("consoleShell.breadcrumbs.gitBot"), href: "/console/gitbot" },
    ],
    "/console/ide": [
      { label: t("consoleShell.breadcrumbs.ide"), href: "/console/ide" },
    ],
    "/console/chat": [
      { label: t("consoleShell.breadcrumbs.chat"), href: "/console/chat" },
    ],
    "/console/agents": [
      { label: t("consoleShell.breadcrumbs.agents"), href: "/console/agents" },
    ],
    "/console/agent-chat": [
      { label: t("consoleShell.breadcrumbs.agentChat"), href: "/console/agent-chat" },
    ],
    "/console/mcp": [
      { label: t("consoleShell.breadcrumbs.mcp"), href: "/console/mcp" },
    ],
    "/console/my-tools": [
      { label: t("consoleShell.breadcrumbs.myTools"), href: "/console/my-tools" },
    ],
    "/console/nodes": [
      { label: t("consoleShell.breadcrumbs.nodes"), href: "/console/nodes" },
    ],
    "/console/notifications": [
      { label: t("consoleShell.breadcrumbs.notifications"), href: "/console/notifications" },
    ],
  }

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname

  const taskDetailMatch = normalizedPath.match(/^\/console\/task\/(?!develop\/)(.+)$/)
  const projectDetailMatch = normalizedPath.match(/^\/console\/project\/[^/]+$/)
  const editorSessionDetailMatch = normalizedPath.match(/^\/console\/editor\/[^/]+\/session\/[^/]+$/)
  // 动态路由先于静态 map 判定（镜像管理端 page.tsx 的顺序）：项目详情的子页
  // 不在 map 里，静态 key 只会命中列表页本身。
  const breadcrumbSegments =
    projectDetailMatch
      ? [
          { label: t("consoleShell.breadcrumbs.projects"), href: "/console/tasks" },
          { label: t("consoleShell.breadcrumbs.projectDetail") },
        ]
      : breadcrumbSegmentsMap[normalizedPath] ??
        (editorSessionDetailMatch && dynamicSegments
          ? dynamicSegments
          : taskDetailMatch
            ? [{ label: t("consoleShell.breadcrumbs.task"), href: "/console/tasks" }, { label: taskName ?? t("consoleShell.breadcrumbs.unknownTask") }]
            : [{ label: t("consoleShell.breadcrumbs.console") }])

  const [communityOpen, setCommunityOpen] = useState(false)

  return (
    <DataProvider>
        <SidebarProvider>
          <UserSidebar />
        <SidebarInset className="h-[calc(100vh-var(--spacing)*4)] min-w-0 overflow-hidden">
          <UserHeaderActionsProvider>
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
                    <BreadcrumbLink
                      href="/console"
                      className="whitespace-nowrap"
                    >
                      Ai Lubricant
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  {breadcrumbSegments.map((segment, index) => {
                    const isLast = index === breadcrumbSegments.length - 1
                    return (
                      <Fragment key={`${segment.label}-${index}`}>
                        {index === 0 && (
                          <BreadcrumbSeparator className="hidden shrink-0 lg:block" />
                        )}
                        {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
                        <BreadcrumbItem
                          className={isLast ? "min-w-0 shrink overflow-hidden" : "shrink-0"}
                        >
                          {isLast ? (
                            <BreadcrumbPage
                              className="block truncate"
                              title={segment.label}
                            >
                              {segment.label}
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink
                              href={segment.href ?? "#"}
                              className="whitespace-nowrap"
                            >
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
              {/* 页面主操作（如「添加设备」）挂在刷新按钮左侧，见 user-header-actions。 */}
              <UserHeaderActionsHost />
              <HeaderRefreshButton />
              <ModeToggle />
            </div>
          </header>
          <div className="flex h-full w-full flex-col gap-4 pb-4 overflow-y-hidden">
            <div className="h-full min-h-0 w-full min-w-0 px-4 overflow-x-hidden overflow-y-auto">
              <Outlet/>
            </div>
          </div>
          </UserHeaderActionsProvider>
        </SidebarInset>
        <CommunityDialog open={communityOpen} onOpenChange={setCommunityOpen} />
      </SidebarProvider>
    </DataProvider>
  )
}

export default function UserConsolePage() {
  return (
    <BreadcrumbTaskProvider>
      <UserConsoleContent />
    </BreadcrumbTaskProvider>
  )
}
