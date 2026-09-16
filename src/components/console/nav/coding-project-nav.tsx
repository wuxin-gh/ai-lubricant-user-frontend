/**
 * Coding 模式侧栏菜单：当前项目的功能页。
 *
 * 项目本身由顶部「切换项目」按钮选定（nav/project-switcher.tsx），故这里**不再列项目**，
 * 只列当前项目的功能页：描述 / 目录 / 需求-bug / 穿透 / 构建 / 任务。
 * 每项是一个独立路由 /coding/project/:projectId/<path>。
 *
 * 没有当前项目时不渲染功能菜单（此时主内容区是项目选择页，由 /coding 落地页承担）。
 */
import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { CODING_SECTIONS, codingSectionPath } from "@/config/coding-sections"
import { useCurrentProject } from "@/components/console/current-project-context"

export default function CodingProjectNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const { projectId } = useCurrentProject()

  const normalized = location.pathname.replace(/\/$/, "")

  // 项目选择页（/coding 与 /coding/projects）上不列功能页：那时用户在挑项目，
  // 列出来的会是「上一个项目」的功能页，点了还会跳到别的项目去。其余 Coding 页
  // （项目工作区、任务详情）都显示——在任务里也能一键跳回项目的某个功能页。
  const isSelectionPage = normalized === "/coding" || normalized === "/coding/projects"
  if (!projectId || isSelectionPage) return null

  return (
    <SidebarGroup className="p-0">
      <SidebarGroupLabel>{t("codingSections.groupLabel", "当前项目")}</SidebarGroupLabel>
      <SidebarMenu>
        {CODING_SECTIONS.map((section) => {
          const Icon = section.icon
          const to = codingSectionPath(projectId, section)
          const isActive = normalized === to
          return (
            <SidebarMenuItem key={section.path}>
              <SidebarMenuButton
                tooltip={t(section.labelKey, section.fallback)}
                isActive={isActive}
                asChild
              >
                <Link to={to}>
                  <Icon className="size-4" />
                  <span className="flex-1 truncate">{t(section.labelKey, section.fallback)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
