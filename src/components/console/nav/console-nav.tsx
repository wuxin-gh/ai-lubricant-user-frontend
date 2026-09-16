/**
 * 模式导航：渲染当前模式下的导航项，按角色与市场可写状态过滤。
 *
 * 这是原 /manager 侧栏 nav-main.tsx 的 NAV_SECTIONS 升级版——「分组」变为
 * 「模式」，模式内不再有二级分组。原三段过滤（adminOnly / marketplaceOnly /
 * offlineOnly）语义原样保留，用户侧项与管理侧项在同一模式下按角色共存。
 */
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
import { MODES, modeHref, modeItemMatches, type ModeNavItem } from "@/config/modes"
import { useActiveMode } from "@/hooks/use-active-mode"
import { useIsAdmin } from "@/hooks/use-is-admin"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { fetchMarketplaceStatus } from "@/api/marketplaceAdmin"

export function ConsoleNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const activeMode = useActiveMode()
  const isAdmin = useIsAdmin()

  // 「市场管理」入口看 writable（配了 github_token）而非 enabled：
  // 只配仓库地址时市场可看但不可管，不该出现管理入口。（沿用 nav-main 口径）
  const [marketplaceWritable, setMarketplaceWritable] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMarketplaceStatus()
      .then((st) => { if (!cancelled) setMarketplaceWritable(!!st.writable) })
      .catch(() => { if (!cancelled) setMarketplaceWritable(false) })
    return () => { cancelled = true }
  }, [])

  const mode = activeMode ?? MODES[0]
  const items = mode.items.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.userOnly && isAdmin) return false
    if (item.marketplaceOnly && !marketplaceWritable) return false
    if (item.offlineOnly && !IS_OFFLINE_EDITION) return false
    return true
  })
  if (items.length === 0) return null

  const isActive = (item: ModeNavItem) =>
    modeItemMatches(mode, item, location.pathname, location.search)

  return (
    <SidebarGroup className="p-0">
      <SidebarGroupLabel>{t(mode.labelKey, mode.fallback)}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const Icon = item.icon
          const full = modeHref(mode, item)
          return (
            <SidebarMenuItem key={full}>
              <SidebarMenuButton tooltip={t(item.labelKey, item.fallback)} isActive={isActive(item)} asChild>
                <Link to={full}>
                  <Icon className="size-4" />
                  <span className="flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

export default ConsoleNav
