import * as React from "react"
import NavCommunity from "./nav-community"
import NavProject from "./nav-project"
import NavUser from "./nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Bot, Blocks, ChevronDown, ChevronRight, List, MessageSquare, Server, Wrench } from "lucide-react"
import { IS_ONLINE_EDITION } from "@/utils/edition"
import { publicUrl } from "@/utils/public-url"
import { useTranslation } from "react-i18next"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { Link, useLocation } from "react-router-dom"

// AI 工具导航项：聊天（多模态）、Agent 对话、资源中心、我的工具、执行节点。个人 MCP /
// Skill / 插件 / 提示词 / 市场收敛到资源中心页面；CDP 浏览器 / 邮箱实例独立为「我的工具」；
// 执行节点从原「配置」弹框提为顶级页（只读）。
const AI_TOOL_ITEMS: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { to: "/console/chat", label: "聊天", icon: MessageSquare },
  { to: "/console/mcp", label: "资源中心", icon: Blocks },
  { to: "/console/my-tools", label: "我的工具", icon: Wrench },
  { to: "/console/nodes", label: "执行节点", icon: Server },
]

export default function UserSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const location = useLocation()
  const isCnRegion = serverConfig?.region === "cn"
  const [agents, setAgents] = React.useState<Array<{ id: number; name: string; display_name: string; enabled: boolean }>>([])
  const [agentsExpanded, setAgentsExpanded] = React.useState(false)
  const isAgentChatActive = location.pathname === "/console/agent-chat"
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

  React.useEffect(() => {
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
  }, [])
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
              <Link to="/console/tasks">
                <img src={publicUrl("/ai-lubricant.svg")} alt="Ai Lubricant" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Ai Lubricant</span>
                  <span className="truncate text-xs text-foreground/60">{t(brandSubtitleKey)}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="p-2 md:p-0">
        <SidebarGroup>
          <SidebarGroupLabel>AI 工具</SidebarGroupLabel>
          <SidebarMenu>
            {AI_TOOL_ITEMS.slice(0, 1).map((item) => {
              const Icon = item.icon
              const active =
                location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton tooltip={item.label} isActive={active} asChild>
                    <Link to={item.to}>
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
            {/* 活跃 Agent 直接作为一级菜单。原来的「Agent 对话」父项已去掉，
                配置入口移到顶栏刷新按钮旁的「管理」按钮。 */}
            {primaryAgents.map((agent) => {
              const active = isAgentChatActive && activeAgentId === String(agent.id)
              const label = agent.display_name || agent.name
              return (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton tooltip={label} isActive={active} asChild>
                    <Link to={`/console/agent-chat?agentId=${agent.id}`}>
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
                            <Link to={`/console/agent-chat?agentId=${agent.id}`}>
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
            {AI_TOOL_ITEMS.slice(1).map((item) => {
              const Icon = item.icon
              const active =
                location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton tooltip={item.label} isActive={active} asChild>
                    <Link to={item.to}>
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
        <NavProject />
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
        {/* 用户头像 + 通知入口 + 管理后台。「配置」弹框已拆解：执行节点进侧栏顶级页、
            Git 身份进「管理项目」弹框、通知渠道进头像菜单。 */}
        <NavUser />
      </SidebarFooter>
    </Sidebar>
    </>
  )
}
