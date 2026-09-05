import "@/styles/admin-scoped.css"
import { useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import ManagerSidebar from "@/components/manager/manager-sidebar"
import { ManagerHeaderActionsHost, ManagerHeaderActionsProvider } from "@/components/manager/manager-header-actions"
import { Fragment } from "react/jsx-runtime"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-context"
import { useThemeStore } from "@/@admin-port/store/themeStore"
import GlobalConfig from "@/pages/manager/platform/GlobalConfig"

export default function ManagerConsolePage() {
  const location = useLocation()
  const { t } = useTranslation()
  // 把 shadcn 的明暗同步到 admin themeStore：themeStore.applyTheme 会写
  // document.body 的 theme-* class，portal 到 body 的 antd 弹窗（通知中心等）
  // 借此拿到与 shadcn 一致的浅/深色 CSS 变量与 antd 算法，配色统一。
  const { resolvedTheme } = useTheme()
  const setAdminTheme = useThemeStore((state) => state.setTheme)
  const [globalConfigOpen, setGlobalConfigOpen] = useState(false)
  useEffect(() => {
    setAdminTheme(resolvedTheme === "dark" ? "slate" : "light")
  }, [resolvedTheme, setAdminTheme])

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/manager/overview": [
      { label: t("managerShell.nav.overview"), href: "/manager/overview" },
    ],
    "/manager/projects": [
      { label: t("managerShell.nav.projects"), href: "/manager/projects" },
    ],
    "/manager/tasks": [
      { label: t("managerShell.nav.projects"), href: "/manager/projects" },
    ],
    "/manager/conversations": [
      { label: t("managerShell.nav.conversations"), href: "/manager/conversations" },
    ],
    "/manager/members": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/skills": [
      { label: t("managerShell.nav.skills"), href: "/manager/skills" },
    ],
    "/manager/hosts": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/settings": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/models": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/images": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/oidc": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/logs": [
      { label: t("managerShell.nav.logs"), href: "/manager/logs" },
    ],
    // 平台管理（ai-lubricant）页面
    "/manager/data-dashboard": [{ label: "数据看板", href: "/manager/data-dashboard" }],
    "/manager/channels": [{ label: "渠道", href: "/manager/channels" }],
    "/manager/api-keys": [{ label: "密钥", href: "/manager/api-keys" }],
    "/manager/notifications": [{ label: "通知中心", href: "/manager/notifications" }],
    "/manager/proxy-pool": [{ label: "代理池", href: "/manager/proxy-pool" }],
    "/manager/model-routing": [{ label: "自定义模型", href: "/manager/model-routing" }],
    "/manager/model-metadata": [{ label: "模型", href: "/manager/model-metadata" }],
    "/manager/request-logs": [{ label: "请求日志", href: "/manager/request-logs" }],
    "/manager/security": [{ label: "安全", href: "/manager/security" }],
    "/manager/resources": [{ label: "资源", href: "/manager/resources" }],
  }

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname

  const dynamicProjectDetail = normalizedPath.match(/^\/manager\/projects\/[^/]+$/)
  const breadcrumbSegments = dynamicProjectDetail
    ? [
        { label: t("managerShell.nav.projects"), href: "/manager/projects" },
        { label: t("managerProjectDetail.title") },
      ]
    : breadcrumbSegmentsMap[normalizedPath] ?? [{ label: t("managerShell.breadcrumb.fallback") }]

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <ManagerSidebar />
      <SidebarInset>
        <ManagerHeaderActionsProvider>
        <header className="flex h-16 shrink-0 items-center gap-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 h-full items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 self-center data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
            />
            <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
              <BreadcrumbList className="min-w-0 flex-nowrap">
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">
                    Ai Lubricant
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {breadcrumbSegments.map((segment, index) => {
                  const isLast = index === breadcrumbSegments.length - 1
                  return (
                    <Fragment key={`${segment.label}-${index}`}>
                      {index === 0 && (
                        <BreadcrumbSeparator className="hidden lg:block" />
                      )}
                      {index > 0 && <BreadcrumbSeparator />}
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{segment.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink href={segment.href ?? "#"}>
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
          <div className="flex shrink-0 items-center px-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mr-2 h-8 gap-2 rounded-[min(var(--radius-md),10px)] px-2.5 text-sm font-medium"
              onClick={() => setGlobalConfigOpen(true)}
            >
              <Settings className="size-4" />
              全局配置
            </Button>
            <ManagerHeaderActionsHost />
          </div>
        </header>
        {/* platform-scope：把平台页内联读取的 admin 主题变量桥接为浅/深色，
            跟随 shadcn 壳，避免 Channels 等页整片变黑（见 admin-scoped.css）。 */}
        <div className="platform-scope flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
          <Outlet />
        </div>
        <GlobalConfig open={globalConfigOpen} onOpenChange={setGlobalConfigOpen} />
        </ManagerHeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}
