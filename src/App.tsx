import { Route, BrowserRouter, Routes, Navigate, Outlet, useLocation, useParams } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import LoginPage from "@/pages/login"

import ConsoleAppShell from "@/pages/console/app-shell"
import HomePage from "@/pages/home"
import { Toaster } from "@/components/ui/sonner"
import SharedTerminalPage from "@/pages/shared-terminal"
import TeamManagerMembers from "./pages/console/manager/members"
import TeamManagerLogs from "@/pages/console/manager/logs"
import TeamManagerOverview from "./pages/console/manager/overview"
import TeamManagerProjects from "./pages/console/manager/projects"
import ManagerProjectDetailPage from "./pages/console/manager/project-detail"
import TeamManagerConversations from "./pages/console/manager/conversations"
import CodingProjectsPage from "@/pages/console/user/coding-projects"
import TeamOIDCLoginPage from "@/pages/team-oidc-login"
import TaskDetailPage from "@/pages/console/user/task/task-detail"
import { TooltipProvider } from "@/components/ui/tooltip"
import ManagerLoginPage from "@/pages/manager-login"
// 聊天 / Agent 对话 / Agent 管理：走 session 鉴权、按 user_id 隔离。
import ChatPage from "@/pages/console/user/chat-page-v2"
import AgentChatPage from "@/pages/console/user/agent-chat"
import AgentManagerPage from "@/pages/console/user/agent-manager-page"
import UserNotificationsPage from "@/pages/console/notifications"
import McpPage from "@/pages/console/user/mcp"
import UserToolsPage from "@/pages/console/user/resources"
import UserNodesPage from "@/pages/console/user/nodes-page"
import ProjectEditorsRedirect from "@/pages/console/user/project/editors"
import { EditorRedirect, EditorSessionRedirect, ProjectEditorRedirect, ProjectEditorSessionRedirect } from "@/pages/console/user/project/editor-route-redirect"
import ProjectWorkspace from "@/pages/console/user/project/overview"
import ProjectSectionView from "@/pages/console/user/project/overview/sections"
import { DEFAULT_CODING_SECTION, codingProjectPath, codingSectionPath, findCodingSection } from "@/config/coding-sections"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { useIsAdmin } from "@/hooks/use-is-admin"
import { useCurrentProject } from "@/components/console/current-project-context"
// 平台管理页（ai-lubricant）：已从 antd 重写为 shadcn，与团队管理页共处同一套六模式壳。
import { ApiKeys } from "@/pages/manager/platform/ApiKeys"
import { ProxyPool } from "@/pages/manager/platform/ProxyPool"
import { TunnelSchemes } from "@/pages/manager/platform/TunnelSchemes"
import { Channels } from "@/pages/manager/platform/Channels"
import { ModelRouting } from "@/pages/manager/platform/ModelRouting"
import { ModelMetadata } from "@/pages/manager/platform/ModelMetadata"
import { RequestLogs } from "@/pages/manager/platform/RequestLogs"
import { DataDashboard } from "@/pages/manager/platform/DataDashboard"
import { Security } from "@/pages/manager/platform/Security"
import { Resources } from "@/pages/manager/platform/Resources"
import Nodes from "@/pages/manager/platform/nodes"
import MarketplaceAdmin from "@/pages/manager/MarketplaceAdmin"

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const isAdmin = useIsAdmin()
  return isAdmin ? <>{children}</> : <Navigate to="/home" replace />
}

/**
 * 执行节点页按角色分流（同一 URL，两种视图）：
 * - 管理员：全量节点管理——入驻/审批、分配分组、移动、吊销、删除。
 * - 普通用户：只读的「我能操作的节点」树——自己所属分组被授权的节点。
 *
 * 原实现两条路由各自独立（/ops/nodes 只给用户侧、/ops/nodes-admin 只给管理端），
 * 但导航里只有前者有入口，管理员点「执行节点」落到用户侧视图：my-nodes 只返回
 * 分组绑定过的节点，管理员若不在任何绑定分组里，树就是空的。
 */
function OpsNodesRoute() {
  const isAdmin = useIsAdmin()
  return isAdmin ? <Nodes /> : <UserNodesPage />
}

function TaskDetailRoute() {
  const { taskId } = useParams()
  return <TaskDetailPage key={taskId} />
}

/**
 * 项目工作区的裸路径 → 默认功能页（描述）。
 *
 * 同时兼容旧链接的 `?tab=` 查询串：老书签是 /coding/project/:id?tab=tasks 这种形态，
 * 现在功能页改成了路径段，故读一次 tab 并转到对应段；tab 缺失或非法就落到默认页。
 */
function ProjectSectionRedirect() {
  const { projectId = "" } = useParams()
  const location = useLocation()
  const requested = new URLSearchParams(location.search).get("tab")
  const section = findCodingSection(requested) ?? DEFAULT_CODING_SECTION
  return <Navigate to={codingSectionPath(projectId, section)} replace />
}

/** 项目功能页：段非法时渲染默认页（不跳转，避免 URL 与内容来回打架）。 */
function ProjectSectionRoute() {
  const { section } = useParams()
  const resolved = findCodingSection(section) ?? DEFAULT_CODING_SECTION
  return <ProjectSectionView section={resolved.path} />
}

/**
 * Coding 模式落地页分流：有「当前项目」就直接进它，否则进项目选择页。
 *
 * 「当前项目」由 CurrentProjectProvider 统一维护（URL 优先、localStorage 兜底），
 * 侧栏切换按钮与面包屑读的是同一份，故这里不再自己读 localStorage。
 *
 * 校验必须在项目列表到齐后做——项目可能已被删除或不再可见，直接跳会落到 404。
 * 但「等」不能无条件等：应急管理员（只有 admin token、无 C 端 session）下
 * DataProvider 根本不拉取，列表永远停在 loading，无条件等待会白屏。
 */
function CodingIndexRoute() {
  const { auth } = useAppRuntime()
  const { project, projectId, loading } = useCurrentProject()
  const sessionReady = auth.status === "authenticated"
  if (projectId) {
    if (sessionReady && loading) return null
    if (project?.id) return <Navigate to={codingProjectPath(project.id)} replace />
  }
  return <CodingProjectsPage />
}

function RootGate() {
  const { auth } = useAppRuntime()
  // 会话仍在解析中：别过早重定向，避免已登录用户刷新时闪回登录页。
  if (auth.loading) {
    return null
  }
  // 已登录进首页（快捷导航，独立页）；匿名进登录页。
  if (auth.status === 'authenticated') {
    return <Navigate to="/home" replace />
  }
  return <Navigate to="/login" replace />
}

/**
 * 路由表按六模式组织（src/config/modes.ts）：
 *
 *   /llm/*          供应商：试跑对话 + 供应商/模型/密钥/日志（管理项 admin 可见）
 *   /agent-mode/*   Agent：Agent 管理（对话页仍在，供活跃 Agent 深链进入）
 *   /coding/*       Coding：项目选择页（落地）+ 任务/项目/编辑器详情
 *   /resources     资源管理：资源中心 + 市场管理
 *   /devices       设备工具：CDP 浏览器 / 邮箱 / Android / iOS
 *   /ops/*          运维：执行节点 + 项目/对话记录 + 概览/用户/穿透/代理池/日志/安全/通知
 *
 * 注意 Agent 模式用 /agent-mode 而非 /agent：后者被后端 Agent API 占用
 * （agentClient.ts 的 AGENT_BASE，且在 main.py 的 _API_PREFIXES 里），
 * 前端路由用它会刷新 404。
 *
 * 全部旧路径（/console/*、/manager/*）保留 <Navigate> 重定向，书签不 404。
 */
function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="ai-lubricant-theme">
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootGate />} />
            <Route path="/login" element={<LoginPage />} />
            {/* 首页：独立页（不属于任何模式），点侧栏顶部 logo 进入。 */}
            <Route path="/home" element={<HomePage />} />
            <Route path="/team-login/:teamId" element={<TeamOIDCLoginPage />} />

            {/* ── 六模式统一壳 ───────────────────────────────────────── */}
            <Route element={<ConsoleAppShell />}>
              {/* 供应商（模式 id 仍为 llm，前缀 /llm 保持不变） */}
              <Route path="/llm">
                <Route index element={<Navigate to="/llm/chat" replace />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="dashboard" element={<AdminOnlyRoute><DataDashboard /></AdminOnlyRoute>} />
                <Route path="channels" element={<AdminOnlyRoute><Channels /></AdminOnlyRoute>} />
                <Route path="models" element={<AdminOnlyRoute><ModelMetadata /></AdminOnlyRoute>} />
                <Route path="routing" element={<AdminOnlyRoute><ModelRouting /></AdminOnlyRoute>} />
                <Route path="keys" element={<AdminOnlyRoute><ApiKeys /></AdminOnlyRoute>} />
                <Route path="request-logs" element={<AdminOnlyRoute><RequestLogs /></AdminOnlyRoute>} />
              </Route>

              {/* Agent（前缀避开后端占用的 /agent） */}
              <Route path="/agent-mode">
                {/* 「Agent 对话」导航项已下线，模式入口改为 Agent 管理；对话页路由
                    仍保留，供侧栏活跃 Agent 平铺列表 ?agentId= 深链进入。 */}
                <Route index element={<Navigate to="/agent-mode/manage" replace />} />
                <Route path="chat" element={<AgentChatPage />} />
                <Route path="manage" element={<AgentManagerPage />} />
                {/* 「对话记录」已移至运维，旧路径保留重定向。 */}
                <Route path="conversations" element={<Navigate to="/ops/conversations" replace />} />
              </Route>

              {/* Coding：模式入口 /coding 按「上次进入的项目」分流，导航项是「切换项目」。 */}
              <Route path="/coding">
                <Route index element={<CodingIndexRoute />} />
                <Route path="tasks" element={<Navigate to="/coding" replace />} />
                <Route path="task/:taskId" element={<TaskDetailRoute />} />
                {/* 项目选择页：/coding 的兜底落地页（没有当前项目时），也是切换项目
                    弹框的内容。导航里没有它的入口——切换走侧栏按钮。 */}
                <Route path="projects" element={<CodingProjectsPage />} />
                {/* 选择页的子路径 → 用户侧项目概览（管理端项目详情已移至
                    /ops/projects/:projectId，这条只是 /coding/projects 下的旧链接兼容）。 */}
                <Route path="projects/:projectId" element={<LegacyProjectRedirect />} />
                {/* 项目工作区：每个功能页是一个独立路由（描述/目录/需求/穿透/构建/任务），
                    由侧栏 CodingProjectNav 切换；裸路径与旧 ?tab= 链接由 index 路由兼容。
                    注意 :section 是动态段，但下面的 editors/editor 是静态段，RR 静态优先，
                    故 /project/:id/editors 不会被 :section 吃掉。 */}
                <Route path="project/:projectId" element={<ProjectWorkspace><Outlet /></ProjectWorkspace>}>
                  <Route index element={<ProjectSectionRedirect />} />
                  <Route path=":section" element={<ProjectSectionRoute />} />
                </Route>
                <Route path="project/:projectId/editors" element={<ProjectEditorsRedirect />} />
                {/* 编辑器与项目一对一，详情/会话为独立路径；旧的 project 作用域
                    路径重定向到新路径，兼容历史链接与侧边栏旧入口。 */}
                <Route path="project/:projectId/editor/:editorId" element={<ProjectEditorRedirect />} />
                <Route path="project/:projectId/editor/:editorId/session/:sessionId" element={<ProjectEditorSessionRedirect />} />
                <Route path="editor/:editorId" element={<EditorRedirect />} />
                <Route path="editor/:editorId/session/:sessionId" element={<EditorSessionRedirect />} />
              </Route>

              {/* 资源管理：资源中心（用户侧）与资源总览（管理侧）共用同一组件 */}
              <Route path="/resources">
                <Route index element={<McpPage />} />
                <Route path="admin" element={<AdminOnlyRoute><Resources /></AdminOnlyRoute>} />
                <Route path="marketplace" element={<AdminOnlyRoute><MarketplaceAdmin /></AdminOnlyRoute>} />
              </Route>

              {/* 设备工具：CDP 浏览器 / 邮箱 / Android / iOS 四类实例 */}
              <Route path="/devices">
                <Route index element={<UserToolsPage />} />
              </Route>

              {/* 运维 */}
              <Route path="/ops">
                <Route index element={<Navigate to="/ops/nodes" replace />} />
                <Route path="nodes" element={<OpsNodesRoute />} />
                {/* 旧管理端路径保持原样：它只是管理端书签的别名，仍限管理员。 */}
                <Route path="nodes-admin" element={<AdminOnlyRoute><Nodes /></AdminOnlyRoute>} />
                {/* 项目与对话记录：原在 Coding / Agent 模式，收敛到运维统一查看。
                    项目列表走 /api/v1/users/projects（按 owner 隔离，普通用户只看
                    自己的），故不包 AdminOnlyRoute。 */}
                <Route path="projects" element={<TeamManagerProjects />} />
                <Route path="projects/:projectId" element={<AdminOnlyRoute><ManagerProjectDetailPage /></AdminOnlyRoute>} />
                <Route path="conversations" element={<AdminOnlyRoute><TeamManagerConversations /></AdminOnlyRoute>} />
                <Route path="overview" element={<AdminOnlyRoute><TeamManagerOverview /></AdminOnlyRoute>} />
                <Route path="members" element={<AdminOnlyRoute><TeamManagerMembers /></AdminOnlyRoute>} />
                {/* 代理池与内网穿透：后端已按 owner 隔离（各自只看到自己的），
                    故对普通用户开放，不再包 AdminOnlyRoute。 */}
                <Route path="proxy-pool" element={<ProxyPool />} />
                <Route path="tunnels" element={<TunnelSchemes />} />
                <Route path="logs" element={<AdminOnlyRoute><TeamManagerLogs /></AdminOnlyRoute>} />
                <Route path="security" element={<AdminOnlyRoute><Security /></AdminOnlyRoute>} />
                <Route path="notifications" element={<UserNotificationsPage />} />
              </Route>

              {/* ── 旧路径兼容（书签/外部链接不 404） ────────────────── */}
              <Route path="/console">
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="tasks" element={<Navigate to="/home" replace />} />
                <Route path="task/:taskId" element={<LegacyTaskRedirect />} />
                <Route path="project/:projectId" element={<LegacyProjectRedirect />} />
                <Route path="project/:projectId/*" element={<LegacyProjectRedirect />} />
                <Route path="editor/*" element={<LegacyEditorRedirect />} />
                <Route path="editors" element={<Navigate to="/home" replace />} />
                <Route path="chat" element={<Navigate to="/llm/chat" replace />} />
                <Route path="test-model" element={<Navigate to="/llm/chat" replace />} />
                <Route path="agent-chat" element={<LegacyAgentChatRedirect />} />
                <Route path="agents" element={<Navigate to="/agent-mode/manage" replace />} />
                <Route path="mcp" element={<Navigate to="/resources" replace />} />
                <Route path="resources" element={<Navigate to="/resources" replace />} />
                <Route path="my-tools" element={<Navigate to="/devices" replace />} />
                <Route path="nodes" element={<Navigate to="/ops/nodes" replace />} />
                <Route path="notifications" element={<Navigate to="/ops/notifications" replace />} />
                {/* 已下线的僵尸入口（侧栏无入口）：统一回任务列表。 */}
                <Route path="gitbot" element={<Navigate to="/home" replace />} />
                <Route path="ide" element={<Navigate to="/home" replace />} />
                <Route path="terminal" element={<Navigate to="/home" replace />} />
                <Route path="files" element={<Navigate to="/home" replace />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Route>

              <Route path="/manager">
                <Route index element={<Navigate to="/ops/projects" replace />} />
                <Route path="overview" element={<Navigate to="/ops/overview" replace />} />
                <Route path="projects" element={<Navigate to="/ops/projects" replace />} />
                <Route path="projects/:projectId" element={<LegacyManagerProjectRedirect />} />
                <Route path="tasks" element={<Navigate to="/ops/projects" replace />} />
                <Route path="conversations" element={<Navigate to="/ops/conversations" replace />} />
                <Route path="members" element={<Navigate to="/ops/members" replace />} />
                <Route path="logs" element={<Navigate to="/ops/logs" replace />} />
                <Route path="data-dashboard" element={<Navigate to="/llm/dashboard" replace />} />
                <Route path="channels" element={<Navigate to="/llm/channels" replace />} />
                <Route path="api-keys" element={<Navigate to="/llm/keys" replace />} />
                <Route path="model-metadata" element={<Navigate to="/llm/models" replace />} />
                <Route path="model-routing" element={<Navigate to="/llm/routing" replace />} />
                <Route path="request-logs" element={<Navigate to="/llm/request-logs" replace />} />
                <Route path="resources" element={<Navigate to="/resources/admin" replace />} />
                <Route path="marketplace-admin" element={<Navigate to="/resources/marketplace" replace />} />
                <Route path="proxy-pool" element={<Navigate to="/ops/proxy-pool" replace />} />
                <Route path="tunnel-schemes" element={<Navigate to="/ops/tunnels" replace />} />
                <Route path="nodes" element={<Navigate to="/ops/nodes-admin" replace />} />
                <Route path="security" element={<Navigate to="/ops/security" replace />} />
                <Route path="notifications" element={<Navigate to="/ops/notifications" replace />} />
                {/* 已并入资源中心 / 用户页的旧入口 */}
                <Route path="skills" element={<Navigate to="/resources" replace />} />
                <Route path="mcp" element={<Navigate to="/resources" replace />} />
                <Route path="plugins" element={<Navigate to="/resources" replace />} />
                <Route path="project-prompts" element={<Navigate to="/resources" replace />} />
                <Route path="skills-market" element={<Navigate to="/resources" replace />} />
                <Route path="mcp-market" element={<Navigate to="/resources" replace />} />
                <Route path="hosts" element={<Navigate to="/ops/members" replace />} />
                <Route path="images" element={<Navigate to="/ops/members" replace />} />
                <Route path="models" element={<Navigate to="/ops/members" replace />} />
                <Route path="settings" element={<Navigate to="/ops/members" replace />} />
                <Route path="oidc" element={<Navigate to="/ops/members" replace />} />
                <Route path="manager" element={<Navigate to="/ops/members" replace />} />
                <Route path="editors" element={<Navigate to="/ops/projects" replace />} />
                <Route path="usage-guide" element={<Navigate to="/llm/keys" replace />} />
                <Route path="*" element={<Navigate to="/ops/projects" replace />} />
              </Route>
            </Route>

            {/* 应急管理员登录（单密码）。登录成功后进入统一壳。 */}
            <Route path="/manager/login" element={<ManagerLoginPage />} />
            <Route path="/sharedterminal" element={<SharedTerminalPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

/** 旧任务详情路径 → /coding/task/:taskId（保留 taskId）。 */
function LegacyTaskRedirect() {
  const { taskId } = useParams()
  return <Navigate to={`/coding/task/${taskId}`} replace />
}

/** 旧项目路径 → 项目工作区默认功能页（保留 projectId）。 */
function LegacyProjectRedirect() {
  const { projectId = "" } = useParams()
  return <Navigate to={codingProjectPath(projectId)} replace />
}

/** 旧编辑器路径 → /coding/editor/*（保留尾段与查询串）。 */
function LegacyEditorRedirect() {
  const rest = useParams()["*"] ?? ""
  return <Navigate to={`/coding/editor/${rest}`} replace />
}

/** 旧 Agent 对话路径 → /agent-mode/chat（保留 agentId/conversationId 查询串）。 */
function LegacyAgentChatRedirect() {
  const search = window.location.search
  return <Navigate to={`/agent-mode/chat${search}`} replace />
}

/** 旧管理端项目详情 → /ops/projects/:projectId。 */
function LegacyManagerProjectRedirect() {
  const { projectId } = useParams()
  return <Navigate to={`/ops/projects/${projectId}`} replace />
}

export default App
