import { Route, BrowserRouter, Routes, Navigate, useParams } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import LoginPage from "@/pages/login"

import UserConsolePage from "@/pages/console/user/page"
import ManagerConsolePage from "@/pages/console/manager/page"
import TasksPage from "@/pages/console/user/tasks"
import IDEIDE from "@/pages/console/user/ide-ide"
import GitBotsPage from "@/pages/console/user/git-bots"
import TerminalPage from "@/pages/console/user/terminal"
import FileManagerPage from "@/pages/console/user/file-manager"
import { Toaster } from "@/components/ui/sonner"
import SharedTerminalPage from "@/pages/shared-terminal"
import TeamManagerMembers from "./pages/console/manager/members"
import TeamManagerLogs from "@/pages/console/manager/logs"
import TeamManagerOverview from "./pages/console/manager/overview"
import TeamManagerProjects from "./pages/console/manager/projects"
import ManagerProjectDetailPage from "./pages/console/manager/project-detail"
import TeamManagerConversations from "./pages/console/manager/conversations"
import TeamOIDCLoginPage from "./pages/team-oidc-login"
import ProjectOverviewPage from "./pages/console/user/project/overview"
import TaskDetailPage from "./pages/console/user/task/task-detail"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ManagerProtectedRoute } from "@/components/admin-console-shell"
import ManagerLoginPage from "@/pages/manager-login"
// 聊天 / Agent 对话 / Agent 管理：用户侧原生 shadcn 页面，走 session 鉴权、按 user_id 隔离。
import ChatPage from "@/pages/console/user/chat-page-v2"
import AgentChatPage from "@/pages/console/user/agent-chat"
import AgentManagerPage from "@/pages/console/user/agent-manager-page"
import UserNotificationsPage from "@/pages/console/notifications"
import McpPage from "@/pages/console/user/mcp"
import UserToolsPage from "@/pages/console/user/resources"
import UserNodesPage from "@/pages/console/user/nodes-page"
import ProjectEditorsRedirect from "@/pages/console/user/project/editors"
import { EditorRedirect, EditorSessionRedirect, ProjectEditorRedirect, ProjectEditorSessionRedirect } from "@/pages/console/user/project/editor-route-redirect"
import { useAppRuntime } from "@/components/app-runtime-provider"
// 平台管理页已从 antd 重写为 shadcn，融入统一 /manager 管理端，数据层复用 @/@admin-port/api。
import { ApiKeys } from "@/pages/manager/platform/ApiKeys"
import { ProxyPool } from "@/pages/manager/platform/ProxyPool"
import { TunnelSchemes } from "@/pages/manager/platform/TunnelSchemes"
import { Channels } from "@/pages/manager/platform/Channels"
import { ModelRouting } from "@/pages/manager/platform/ModelRouting"
import { ModelMetadata } from "@/pages/manager/platform/ModelMetadata"
import { RequestLogs } from "@/pages/manager/platform/RequestLogs"
import { DataDashboard } from "@/pages/manager/platform/DataDashboard"
import { Security } from "@/pages/manager/platform/Security"
import { Notifications } from "@/pages/manager/platform/Notifications"
import { Resources } from "@/pages/manager/platform/Resources"
import { Nodes } from "@/pages/manager/platform/nodes"
import MarketplaceAdmin from "@/pages/manager/MarketplaceAdmin"

function TaskDetailRoute() {
  const { taskId } = useParams()
  return <TaskDetailPage key={taskId} />
}

function RootGate() {
  const { auth } = useAppRuntime()
  // 会话仍在解析中：别过早重定向，避免已登录用户刷新时闪回登录页。
  if (auth.loading) {
    return null
  }
  // 营销首页已下线：根路径对匿名用户一律进登录页，已登录进控制台。
  if (auth.status === 'authenticated') {
    return <Navigate to="/console" replace />
  }
  return <Navigate to="/login" replace />
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="ai-lubricant-theme">
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootGate />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/team-login/:teamId" element={<TeamOIDCLoginPage />} />
            <Route path="/console" element={<UserConsolePage />}>
              <Route index element={<Navigate to="/console/tasks" replace />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="task/:taskId" element={<TaskDetailRoute />} />
              <Route path="notifications" element={<UserNotificationsPage />} />
              <Route path="project/:projectId" element={<ProjectOverviewPage />} />
              <Route path="project/:projectId/editors" element={<ProjectEditorsRedirect />} />
              {/* 编辑器与项目一对一，编辑器详情/会话已提为独立顶层路由。
                  旧的 project 作用域路径重定向到新路由，兼容历史链接与侧边栏旧入口。 */}
              <Route path="project/:projectId/editor/:editorId" element={<ProjectEditorRedirect />} />
              <Route path="project/:projectId/editor/:editorId/session/:sessionId" element={<ProjectEditorSessionRedirect />} />
              <Route path="editor/:editorId" element={<EditorRedirect />} />
              <Route path="editor/:editorId/session/:sessionId" element={<EditorSessionRedirect />} />
              <Route path="gitbot" element={<GitBotsPage />} />
              <Route path="ide" element={<IDEIDE />} />
              {/* 聊天 / Agent 对话与配置：用户侧原生 shadcn 页面。
                  聊天与媒体发送经后端服务端调主链路（前端只传 api_key_id）。 */}
              <Route path="chat" element={<ChatPage />} />
              <Route path="agents" element={<AgentManagerPage />} />
              <Route path="agent-chat" element={<AgentChatPage />} />
              {/* 旧路径兼容：我的工具已从资源中心拆出为独立页。 */}
              <Route path="resources" element={<Navigate to="/console/my-tools" replace />} />
              {/* MCP 服务：用户自配外部 SSE MCP 的顶级管理页（原设置对话框里的 MCP tab）。 */}
              <Route path="mcp" element={<McpPage />} />
              {/* 我的工具：CDP 浏览器 / 邮箱实例管理，从资源中心拆出为独立页。 */}
              <Route path="my-tools" element={<UserToolsPage />} />
              {/* 执行节点：原设置弹框节点分区提为顶级页，只读。 */}
              <Route path="nodes" element={<UserNodesPage />} />
              {/* 编辑器一定归属项目，全局编辑器页已下线；管理入口在项目详情「编辑器」tab。
                  旧路径重定向到任务列表，避免书签 404。 */}
              <Route path="editors" element={<Navigate to="/console/tasks" replace />} />
              {/* 旧路径兼容：/console/test-model 重定向到新聊天页 */}
              <Route path="test-model" element={<Navigate to="/console/chat" replace />} />
            </Route>
            {/* 节点终端已改为列表内弹框（NodeTerminalDialog），不再有独立路由。 */}
            <Route path="/console/terminal" element={<TerminalPage />} />
            <Route path="/console/files" element={<FileManagerPage />} />
            <Route path="/sharedterminal" element={<SharedTerminalPage />} />
            <Route path="/manager" element={<ManagerProtectedRoute><ManagerConsolePage /></ManagerProtectedRoute>}>
              <Route index element={<Navigate to="/manager/projects" replace />} />
              <Route path="overview" element={<TeamManagerOverview />} />
              <Route path="projects" element={<TeamManagerProjects />} />
              <Route path="projects/:projectId" element={<ManagerProjectDetailPage />} />
              <Route path="tasks" element={<Navigate to="/manager/projects" replace />} />
              <Route path="conversations" element={<TeamManagerConversations />} />
              <Route path="members" element={<TeamManagerMembers />} />
              <Route path="skills" element={<Navigate to="/manager/resources?tab=skills" replace />} />
              <Route path="mcp" element={<Navigate to="/manager/resources?tab=mcp" replace />} />
              <Route path="settings" element={<Navigate to="/manager/members" replace />} />
              <Route path="hosts" element={<Navigate to="/manager/members" replace />} />
              <Route path="images" element={<Navigate to="/manager/members" replace />} />
              <Route path="models" element={<Navigate to="/manager/members" replace />} />
              <Route path="logs" element={<TeamManagerLogs />} />
              <Route path="manager" element={<Navigate to="/manager/members" replace />} />
              <Route path="oidc" element={<Navigate to="/manager/members" replace />} />
              {/* 平台管理（ai-lubricant）：融入同一个 /manager 管理端。已从 antd
                  重写为 shadcn，数据层复用 @/@admin-port/api。聊天/agent 归用户侧
                  （/console），不放这里。 */}
              <Route path="data-dashboard" element={<DataDashboard />} />
              <Route path="channels" element={<Channels />} />
              <Route path="api-keys" element={<ApiKeys />} />
              <Route path="proxy-pool" element={<ProxyPool />} />
              <Route path="tunnel-schemes" element={<TunnelSchemes />} />
              <Route path="nodes" element={<Nodes />} />
              <Route path="model-routing" element={<ModelRouting />} />
              <Route path="model-metadata" element={<ModelMetadata />} />
              <Route path="request-logs" element={<RequestLogs />} />
              {/* 任务 / 编辑器已合并进项目详情（/manager/projects/:projectId）。
                  旧路径保留重定向，兼容书签与外部链接。 */}
              <Route path="editors" element={<Navigate to="/manager/projects" replace />} />
              <Route path="project-prompts" element={<Navigate to="/manager/resources?tab=prompts" replace />} />
              <Route path="security" element={<Security />} />
              <Route path="mcp-market" element={<Navigate to="/manager/resources?tab=mcp" replace />} />
              <Route path="plugins" element={<Navigate to="/manager/resources?tab=plugins" replace />} />
              <Route path="resources" element={<Resources />} />
              <Route path="skills-market" element={<Navigate to="/manager/resources?tab=skills" replace />} />
              {/* 市场管理（服务端代管 GitHub 写入）。未配置 [marketplace] 时页面自身
                  显示未启用提示，导航项也不会出现。 */}
              <Route path="marketplace-admin" element={<MarketplaceAdmin />} />
              <Route path="notifications" element={<Notifications />} />
              {/* 使用方法已降级为 API Keys 页内弹框；旧路由重定向过去 */}
              <Route path="usage-guide" element={<Navigate to="/manager/api-keys" replace />} />
            </Route>
            {/* 应急管理员登录（单密码）。用于还没有 role=admin 的 C 端用户时进管理端。
                登录成功后进入统一的 /manager 管理端。只有一个管理端（/manager/*），
                这里只是它的应急密码登录入口。 */}
            <Route path="/manager/login" element={<ManagerLoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
