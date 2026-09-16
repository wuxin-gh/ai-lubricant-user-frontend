import * as React from "react"
import NavCommunity from "./nav-community"
import NavUser from "./nav-user"
import CodingProjectNav from "./coding-project-nav"
import ProjectTaskNav from "./project-task-nav"
import { ConsoleNav } from "./console-nav"
import { ModeSwitcher } from "./mode-switcher"
import { ProjectSwitcher } from "./project-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Bot, ChevronDown, ChevronRight, List } from "lucide-react"
import { IS_ONLINE_EDITION } from "@/utils/edition"
import { publicUrl } from "@/utils/public-url"
import { useTranslation } from "react-i18next"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { useActiveMode } from "@/hooks/use-active-mode"
import { Link, useLocation } from "react-router-dom"

/**
 * 控制台侧栏。信息架构改为六模式（src/config/modes.ts）：
 *
 * - 顶部模式切换器（ModeSwitcher）→ 当前模式的导航项（ConsoleNav）。
 * - 原「AI 工具」硬编码 4 项（聊天/资源中心/我的工具/执行节点）已由模式导航取代。
 * - 当前项目切换器（ProjectSwitcher）+ 当前项目的功能页菜单（CodingProjectNav）
 *   只在 Coding 模式渲染。
 * - 活跃 Agent 平铺列表只在 Agent 模式渲染。
 */
export default function UserSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const location = useLocation()
  const isCnRegion = serverConfig?.region === "cn"
  const activeMode = useActiveMode()
  const [agents, setAgents] = React.useState<Array<{ id: number; name: string; display_name: string; enabled: boolean }>>([])
  const [agentsExpanded, setAgentsExpanded] = React.useState(false)
  const isAgentChatActive = location.pathname === "/agent-mode/chat"
  const activeAgentId = new URLSearchParams(location.search).get("agentId")
  // 最多 3 个活跃 Agent 直接平铺成一级菜单；多出来的收进「Agent 列表」二级菜单，
  // 不超过 3 个时那个一级菜单整体不出现。
  const primaryAgents = agents.slice(0, 3)
  const overflowAgents = agents.slice(3)
  const isOverflowAgentActive =
    isAgentChatActive && overflowAgents.some((agent) => String(agent.id) === activeAgentId)

  React.useEffect(() => {
    if (isOverflowAgentActive) setAgentsExpanded(true)
  }, [isOverflowAgentActive])

  // Agent 平铺列表只在 Agent 模式下有意义，其它模式不拉取、不渲染。
  const showAgents = activeMode?.id === "agent"
  React.useEffect(() => {
    if (!showAgents) return
    let active = true
    const load = () => {
      fetch("/agent/agents", { credentials: "include" })
        .then((response) => response.ok ? response.json() : [])
        .then((items) => {
          if (active && Array.isArray(items)) setAgents(items.filter((item) => item?.enabled))
        })
        .catch(() => {
          if (active) setAgents([])
        })
    }
    load()
    window.addEventListener("agent-manager:changed", load)
    return () => {
      active = false
      window.removeEventListener("agent-manager:changed", load)
    }
  }, [showAgents])
  // 品牌副标题与管理端侧边栏保持同一个来源（managerShell.brand.subtitle），
  // 不再按 region 在「长亭百智云 / CyberServal」之间切换，避免两端文案漂移。
  const brandSubtitleKey = "managerShell.brand.subtitle"

  return (
    <>
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader className="md:p-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              {/* logo → 首页（快捷导航，独立页，不属于任何模式）。 */}
              <Link to="/home">
                <img src={publicUrl("/ai-lubricant.svg")} alt="Ai Lubricant" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Ai Lubricant</span>
                  <span className="truncate text-xs text-foreground/60">{t(brandSubtitleKey)}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* 模式切换器：折叠态隐藏（图标态放不下），展开态占满一行。 */}
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <ModeSwitcher className="mt-1" />
          </SidebarMenuItem>
          {/* 当前项目 + 切换入口：仅 Coding 模式（组件内部判定）。 */}
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <ProjectSwitcher className="mt-1" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="p-2 md:p-0">
        <ConsoleNav />
        {/* 活跃 Agent 平铺：仅 Agent 模式。 */}
        {showAgents && (primaryAgents.length > 0 || overflowAgents.length > 0) ? (
          <SidebarGroup>
            <SidebarMenu>
              {primaryAgents.map((agent) => {
                const active = isAgentChatActive && activeAgentId === String(agent.id)
                const label = agent.display_name || agent.name
                return (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton tooltip={label} isActive={active} asChild>
                      <Link to={`/agent-mode/chat?agentId=${agent.id}`}>
                        <Bot className="size-4" />
                        <span className="truncate">{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
              {overflowAgents.length > 0 && (
                <SidebarMenuItem>
                  <div className="flex items-center">
                    <button
                      type="button"
                      className="ml-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground/70 hover:text-primary"
                      aria-label={agentsExpanded ? "收起" : "展开"}
                      onClick={() => setAgentsExpanded((current) => !current)}
                    >
                      {agentsExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <SidebarMenuButton
                      tooltip="Agent 列表"
                      isActive={isOverflowAgentActive}
                      onClick={() => setAgentsExpanded((current) => !current)}
                    >
                      <List className="size-4" />
                      <span>Agent 列表</span>
                    </SidebarMenuButton>
                  </div>
                  {agentsExpanded && (
                    <SidebarMenuSub className="mr-0 gap-0.5 pl-2">
                      {overflowAgents.map((agent) => {
                        const active = isAgentChatActive && activeAgentId === String(agent.id)
                        return (
                          <SidebarMenuSubItem key={agent.id}>
                            <SidebarMenuSubButton asChild size="sm" isActive={active} className="w-full">
                              <Link to={`/agent-mode/chat?agentId=${agent.id}`}>
                                <Bot className="size-3.5 shrink-0" />
                                <span className="truncate">{agent.display_name || agent.name}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
        {/* 当前项目的功能页菜单 + 该项目的任务快捷列表：仅 Coding 模式。 */}
        {activeMode?.id === "coding" ? (
          <>
            <CodingProjectNav />
            <ProjectTaskNav />
          </>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="md:p-0">
        <div className="flex items-stretch gap-2 group-data-[collapsible=icon]:flex-col">
          {IS_ONLINE_EDITION && isCnRegion && (
            <NavCommunity
              menuClassName="flex-1"
              itemClassName="h-full"
              buttonClassName="h-full py-1"
            />
          )}
        </div>
        {/* 用户头像 + 通知入口。「配置」弹框已拆解：执行节点进侧栏顶级页、
            Git 身份进「管理项目」弹框、通知渠道进头像菜单。 */}
        <NavUser />
      </SidebarFooter>
    </Sidebar>
    </>
  )
}
