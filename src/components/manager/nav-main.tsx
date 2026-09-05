import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconReport, IconUsersGroup } from "@tabler/icons-react"
import {
  BarChart3,
  Boxes,
  FolderGit2,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Network,
  ScrollText,
  Server,
  ShieldCheck,
  Store,
  Waypoints,
} from "lucide-react"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { fetchMarketplaceStatus } from "@/api/marketplaceAdmin"

// 统一的 /manager 管理端导航。不再区分「平台管理 / 团队管理」，改为按功能分组，
// 每组带小标题。团队协作项（MonkeyCode）与平台项（ai-lubricant）融合在同一套菜单里。
type NavItem = {
  to: string
  labelKey: string
  fallback: string
  icon: React.ComponentType<{ className?: string }>
  offlineOnly?: boolean
  /** 仅在市场可写时显示（服务端配了 github_token，GET /api/v1/marketplace/status 的 writable）。 */
  marketplaceOnly?: boolean
}

type NavSection = {
  labelKey: string
  fallback: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: "managerNav.groups.overview",
    fallback: "概览",
    items: [
      { to: "/manager/overview", labelKey: "managerShell.nav.overview", fallback: "概览", icon: LayoutDashboard },
      { to: "/manager/data-dashboard", labelKey: "platformNav.dashboard", fallback: "数据看板", icon: BarChart3 },
    ],
  },
  {
    labelKey: "managerNav.groups.team",
    fallback: "团队协作",
    items: [
      { to: "/manager/projects", labelKey: "managerShell.nav.projects", fallback: "项目", icon: FolderGit2 },
      { to: "/manager/conversations", labelKey: "managerShell.nav.conversations", fallback: "对话", icon: MessagesSquare },
      { to: "/manager/members", labelKey: "managerShell.nav.members", fallback: "用户", icon: IconUsersGroup },
      { to: "/manager/resources", labelKey: "platformNav.resources", fallback: "资源中心", icon: Boxes },
      {
        to: "/manager/marketplace-admin",
        labelKey: "platformNav.marketplaceAdmin",
        fallback: "市场管理",
        icon: Store,
        marketplaceOnly: true,
      },
    ],
  },
  {
    labelKey: "managerNav.groups.models",
    fallback: "模型接入",
    items: [
      { to: "/manager/channels", labelKey: "platformNav.channels", fallback: "渠道", icon: Boxes },
      { to: "/manager/model-metadata", labelKey: "platformNav.modelMetadata", fallback: "模型", icon: Waypoints },
      { to: "/manager/api-keys", labelKey: "platformNav.apiKeys", fallback: "密钥", icon: KeyRound },
    ],
  },
  {
    labelKey: "managerNav.groups.ops",
    fallback: "运维监控",
    items: [
      { to: "/manager/request-logs", labelKey: "platformNav.requestLogs", fallback: "请求日志", icon: ScrollText },
      { to: "/manager/logs", labelKey: "managerShell.nav.logs", fallback: "系统日志", icon: IconReport },
      { to: "/manager/security", labelKey: "platformNav.security", fallback: "安全", icon: ShieldCheck },
    ],
  },
  {
    labelKey: "managerNav.groups.system",
    fallback: "系统设置",
    items: [
      { to: "/manager/proxy-pool", labelKey: "platformNav.proxyPool", fallback: "代理池", icon: Network },
      { to: "/manager/tunnel-schemes", labelKey: "platformNav.tunnelSchemes", fallback: "内网穿透", icon: Network },
      { to: "/manager/nodes", labelKey: "platformNav.nodes", fallback: "执行节点", icon: Server },
    ],
  },
]

export default function NavMain() {
  const location = useLocation()
  const { t } = useTranslation()
  // 「市场管理」入口看 writable（配了 github_token）而非 enabled：
  // 只配仓库地址时市场可看但不可管，不该出现管理入口。
  const [marketplaceWritable, setMarketplaceWritable] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMarketplaceStatus()
      .then((st) => { if (!cancelled) setMarketplaceWritable(!!st.writable) })
      .catch(() => { if (!cancelled) setMarketplaceWritable(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => {
          if (item.offlineOnly && !IS_OFFLINE_EDITION) return false
          if (item.marketplaceOnly && !marketplaceWritable) return false
          return true
        })
        if (items.length === 0) return null
        return (
          <SidebarGroup key={section.labelKey} className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{t(section.labelKey, section.fallback)}</SidebarGroupLabel>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton isActive={location.pathname === item.to} asChild>
                      <Link to={item.to}>
                        <Icon className="size-4" />
                        <span className="flex-1">{t(item.labelKey, item.fallback)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        )
      })}
    </>
  )
}
