/**
 * Endpoint mapping layer (path 2): map the generated ``Api.ts`` method names to
 * our FastAPI routes without regenerating the 8122-line client.
 *
 * Background: ``src/api/Api.ts`` is generated from MonkeyCode's Go backend
 * swagger. Our backend is FastAPI with routes under ``/api/v1/users/*``. Rather
 * than force our routes to match the swagger operationIds, we map the method
 * names to real routes here and adapt the response envelope to the shape the
 * frontend expects (``{code, message, data}`` with ``code === 0`` on success).
 *
 * Method-name convention (swagger-generated): a path is encoded as PascalCase
 * segments + a verb suffix (List/Detail/Create/Update/Delete). Path params are
 * passed positionally via ``extrax`` at call sites. ``params`` is the query for
 * GET/DELETE and the JSON body for POST/PUT.
 *
 * Only the domains we have actually implemented are mapped. Unmapped methods
 * resolve to a clean "not implemented" envelope so the UI degrades gracefully
 * instead of crashing — this lets the portal boot and the implemented pages
 * work while the VM/agent-compose-dependent surfaces stay dormant.
 */

export type HttpVerb = "GET" | "POST" | "PUT" | "DELETE";

export interface EndpointSpec {
  method: HttpVerb;
  /**
   * Path template. ``{0}``/``{1}`` are filled positionally from ``extrax``.
   * All paths are relative to the app origin (same-origin; dev server proxies
   * ``/api`` to the backend, matching the vendored vite config).
   */
  path: string;
  /**
   * Optional response reshaper: our REST responses (e.g. ``{total, rows}``) are
   * adapted to the key the frontend reads (e.g. ``{tasks: [...]}``). Receives the
   * raw parsed JSON body and returns the ``data`` payload.
   */
  transform?: (raw: any) => any;
}

/**
 * Wrap a list under a named key, tolerating several backend shapes: a bare
 * array, ``{rows}``, ``{data}``, or the named key itself (``{nodes}`` for
 * ``listUnder("nodes")``). The named-key case matters for endpoints like
 * ``/teams/my-nodes`` that already return ``{nodes: [...]}`` — without it the
 * list is silently dropped to ``[]``.
 */
function listUnder(key: string): (raw: any) => any {
  return (raw: any) => {
    const rows = Array.isArray(raw)
      ? raw
      : raw?.[key] ?? raw?.rows ?? raw?.data ?? [];
    return { [key]: rows, total: raw?.total, page: raw?.page, page_size: raw?.page_size };
  };
}

/**
 * The task table is also the project-conversation list in the ported manager
 * UI. Normalize task summary fields to the generated TeamConversationItem
 * shape so its project_id/detail link and content/title stay available.
 */
function taskConversations(raw: any): any {
  const rows = Array.isArray(raw) ? raw : raw?.rows ?? raw?.data ?? [];
  const conversations = rows.map((row: any) => ({
    ...row,
    task_id: row.task_id ?? row.id,
    task_title: row.task_title ?? row.title,
    content: row.content ?? row.title ?? "",
  }));
  return { conversations, total: raw?.total, page: raw?.page, page_size: raw?.page_size };
}

/**
 * The endpoint table. Keys are ``Api.ts`` method names. Extend this as more
 * backend domains land. A missing entry is NOT an error — see ``resolveEndpoint``.
 */
export const ENDPOINT_MAP: Record<string, EndpointSpec> = {
  // ---- Auth / user (Phase A) ---------------------------------------------
  v1UsersPasswordLoginCreate: { method: "POST", path: "/api/v1/users/password-login" },
  v1UsersStatusList: { method: "GET", path: "/api/v1/users/status" },
  v1UsersLogoutCreate: { method: "POST", path: "/api/v1/users/logout" },
  v1UsersMembersList: { method: "GET", path: "/api/v1/users/members" },

  // ---- Runtime keys (Phase B) --------------------------------------------
  v1UsersModelGatewayRuntimeKeysList: {
    method: "GET",
    path: "/api/v1/users/model-gateway/runtime-keys",
  },
  v1UsersModelGatewayRuntimeKeysCreate: {
    method: "POST",
    path: "/api/v1/users/model-gateway/runtime-keys",
  },
  v1UsersModelGatewayRuntimeKeysDelete: {
    method: "DELETE",
    path: "/api/v1/users/model-gateway/runtime-keys/{0}",
  },

  // ---- Tasks (Phase C) ----------------------------------------------------
  v1UsersTasksList: { method: "GET", path: "/api/v1/users/tasks", transform: listUnder("tasks") },
  v1UsersTasksDetail: { method: "GET", path: "/api/v1/users/tasks/{0}" },
  v1UsersTasksCreate: { method: "POST", path: "/api/v1/users/tasks" },
  v1UsersTasksUpdate: { method: "PUT", path: "/api/v1/users/tasks/{0}" },
  v1UsersTasksDelete: { method: "DELETE", path: "/api/v1/users/tasks/{0}" },
  v1UsersTasksStopUpdate: { method: "PUT", path: "/api/v1/users/tasks/stop" },

  // ---- Projects (Phase C) -------------------------------------------------
  v1UsersProjectsList: {
    method: "GET",
    path: "/api/v1/users/projects",
    transform: listUnder("projects"),
  },
  v1UsersProjectsDetail: { method: "GET", path: "/api/v1/users/projects/{0}" },
  v1UsersProjectsCreate: { method: "POST", path: "/api/v1/users/projects" },
  v1UsersProjectsUpdate: { method: "PUT", path: "/api/v1/users/projects/{0}" },
  v1UsersProjectsDelete: { method: "DELETE", path: "/api/v1/users/projects/{0}" },
  v1UsersProjectsCollaboratorsList: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/collaborators",
  },
  v1UsersProjectsCollaboratorsCreate: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/collaborators",
  },
  v1UsersProjectsCollaboratorsDelete: {
    method: "DELETE",
    path: "/api/v1/users/projects/{0}/collaborators/{1}",
  },
  // 项目关联：定向引用关系，权限按源项目 token 对目标仓库的实际可达性判定。
  v1UsersProjectsAssociationsList: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/associations",
  },
  v1UsersProjectsAssociationsCreate: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/associations",
  },
  v1UsersProjectsAssociationsDelete: {
    method: "DELETE",
    path: "/api/v1/users/projects/{0}/associations/{1}",
  },
  // 生成的 Api.ts 方法名是 ``...IssuesDetail``（GET 问题列表）；保留 ``...List`` 别名。
  v1UsersProjectsIssuesDetail: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/issues",
    transform: listUnder("issues"),
  },
  v1UsersProjectsIssuesList: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/issues",
    transform: listUnder("issues"),
  },
  v1UsersProjectsIssuesCreate: { method: "POST", path: "/api/v1/users/projects/{0}/issues" },
  v1UsersProjectsIssuesUpdate: {
    method: "PUT",
    path: "/api/v1/users/projects/{0}/issues/{1}",
  },
  v1UsersProjectsIssuesDelete: {
    method: "DELETE",
    path: "/api/v1/users/projects/{0}/issues/{1}",
  },
  // 需求/bug 分配：创建首个任务并推进状态（服务端两阶段，失败保持可分配）。
  v1UsersProjectsIssuesAssign: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/issues/{1}/assign",
  },
  // 人工确认/退回设计文档或 bug 根因。agent 无权走这个口。
  v1UsersProjectsIssuesConfirm: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/issues/{1}/confirm",
  },
  v1UsersProjectsIssuesCommentsList: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/issues/{1}/comments",
  },
  v1UsersProjectsIssuesCommentsCreate: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/issues/{1}/comments",
  },
  // 仓库读:目录树 + 文件内容。query(recursive/ref/path)由 toQuery 自动拼接。
  v1UsersProjectsTreeDetail: { method: "GET", path: "/api/v1/users/projects/{0}/tree" },
  v1UsersProjectsTreeBlobDetail: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/tree/blob",
  },
  // Git 子模块：后端读仓库 .gitmodules 派生，不落库；相对地址已按父仓解析为绝对地址。
  v1UsersProjectsSubmodulesList: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/submodules",
  },
  // 技术栈识别：stack 是建项目后异步扫的缓存（null = 未扫/扫描中/失败），rescan 同步重扫。
  v1UsersProjectsStackDetail: {
    method: "GET",
    path: "/api/v1/users/projects/{0}/stack",
  },
  v1UsersProjectsStackRescanCreate: {
    method: "POST",
    path: "/api/v1/users/projects/{0}/stack/rescan",
  },

  // ---- Git identities / bots (Phase C) -----------------------------------
  v1UsersGitIdentitiesList: { method: "GET", path: "/api/v1/users/git-identities" },
  v1UsersGitIdentitiesDetail: { method: "GET", path: "/api/v1/users/git-identities/{0}" },
  // {1} 是仓库 full_name（owner/repo）；前端已 encodeURIComponent 一次，fillPath 再编码一次，
  // 后端路由用 ``:path`` + unquote 还原。分支列表用于项目详情页解析默认分支。
  v1UsersGitIdentitiesBranchesDetail: {
    method: "GET",
    path: "/api/v1/users/git-identities/{0}/{1}/branches",
  },
  v1UsersGitIdentitiesCreate: { method: "POST", path: "/api/v1/users/git-identities" },
  v1UsersGitIdentitiesUpdate: { method: "PUT", path: "/api/v1/users/git-identities/{0}" },
  v1UsersGitIdentitiesDelete: { method: "DELETE", path: "/api/v1/users/git-identities/{0}" },
  v1UsersGitBotsList: { method: "GET", path: "/api/v1/users/git-bots" },
  v1UsersGitBotsCreate: { method: "POST", path: "/api/v1/users/git-bots" },
  v1UsersGitBotsUpdate: { method: "PUT", path: "/api/v1/users/git-bots/{0}" },
  v1UsersGitBotsDelete: { method: "DELETE", path: "/api/v1/users/git-bots/{0}" },

  // ---- Nodes (agent-compose, read-only "use" view) -----------------------
  // The task runtime is now a chosen agent-compose node (hosts/images/VMs were
  // removed). A user sees the nodes their groups were granted, aggregated by the
  // backend at /api/v1/teams/my-nodes.
  v1UsersNodesList: { method: "GET", path: "/api/v1/teams/my-nodes", transform: listUnder("nodes") },

  v1UsersModelsList: {
    method: "GET",
    path: "/api/v1/users/models",
    transform: listUnder("models"),
  },
  v1UsersModelsAvailableList: {
    method: "GET",
    path: "/api/v1/users/models/available",
    transform: listUnder("models"),
  },
  v1UsersModelsCreate: { method: "POST", path: "/api/v1/users/models" },
  v1UsersModelsUpdate: { method: "PUT", path: "/api/v1/users/models/{0}" },
  v1UsersModelsDelete: { method: "DELETE", path: "/api/v1/users/models/{0}" },
  v1UsersModelsHealthCheckCreate: {
    method: "POST",
    path: "/api/v1/users/models/health-check",
  },
  v1UsersModelsHealthCheckDetail: {
    method: "GET",
    path: "/api/v1/users/models/{0}/health-check",
  },
  // ---- Skills / plugins (Phase D) ----------------------------------------
  v1SkillsList: { method: "GET", path: "/api/v1/skills" },
  v1PluginsList: { method: "GET", path: "/api/v1/plugins" },

  // ---- Notify (Phase D) ---------------------------------------------------
  v1UsersNotifyChannelsList: { method: "GET", path: "/api/v1/users/notify/channels" },
  v1UsersNotifyChannelsCreate: { method: "POST", path: "/api/v1/users/notify/channels" },
  v1UsersNotifyChannelsUpdate: { method: "PUT", path: "/api/v1/users/notify/channels/{0}" },
  v1UsersNotifyChannelsDelete: { method: "DELETE", path: "/api/v1/users/notify/channels/{0}" },
  v1UsersNotifyEventTypesList: { method: "GET", path: "/api/v1/users/notify/event-types" },

  // ---- Team administration (MonkeyCode manager) ---------------------------
  v1TeamsDashboardList: { method: "GET", path: "/api/v1/teams/dashboard" },

  // Users / passwords / membership
  v1TeamsUsersList: { method: "GET", path: "/api/v1/teams/users" },
  v1TeamsUsersStatusList: { method: "GET", path: "/api/v1/teams/users/status" },
  v1TeamsUsersLogoutCreate: { method: "POST", path: "/api/v1/teams/users/logout" },
  // 用户头像菜单使用此生成方法名；当前用户密码由团队用户路由处理。
  v1UsersPasswordsChangeUpdate: {
    method: "PUT",
    path: "/api/v1/teams/users/passwords/change",
  },
  v1TeamsUsersWithPasswordCreate: { method: "POST", path: "/api/v1/teams/users/with-password" },
  // Keep the misspelled swagger operationId used by older generated clients.
  v1TeamsUsersWithPaswordCreate: { method: "POST", path: "/api/v1/teams/users/with-password" },
  v1TeamsUsersDelete: { method: "DELETE", path: "/api/v1/teams/users/{0}" },
  v1TeamsUsersPasswordsChangeUpdate: {
    method: "PUT",
    path: "/api/v1/teams/users/passwords/change",
  },
  v1TeamsUsersPasswordsResetUpdate: {
    method: "PUT",
    path: "/api/v1/teams/users/{0}/passwords/reset",
  },
  // 统一「用户与权限」页：一张全量用户表 + 每行管理员开关。
  v1TeamsUsersAllList: { method: "GET", path: "/api/v1/teams/users/all" },
  v1TeamsUsersAdminUpdate: { method: "PUT", path: "/api/v1/teams/users/{0}/admin" },
  v1TeamsUsersCreate: { method: "POST", path: "/api/v1/teams/users" },
  v1TeamsUsersUpdate: { method: "PUT", path: "/api/v1/teams/users/{0}" },

  // Team groups
  v1TeamsGroupsList: { method: "GET", path: "/api/v1/teams/groups" },
  v1TeamsGroupsCreate: { method: "POST", path: "/api/v1/teams/groups" },
  v1TeamsGroupsUpdate: { method: "PUT", path: "/api/v1/teams/groups/{0}" },
  v1TeamsGroupsDelete: { method: "DELETE", path: "/api/v1/teams/groups/{0}" },
  v1TeamsGroupsUsersUpdate: { method: "PUT", path: "/api/v1/teams/groups/{0}/users" },
  // 分组侧配置该组能用哪些系统 Key（权限统一在分组侧，不再从 key 侧配「适用分组」）。
  v1TeamsGroupsApiKeysList: { method: "GET", path: "/api/v1/teams/groups/{0}/api-keys" },
  v1TeamsGroupsApiKeysUpdate: { method: "PUT", path: "/api/v1/teams/groups/{0}/api-keys" },
  v1TeamsGroupsMcpServicesList: { method: "GET", path: "/api/v1/teams/groups/{0}/mcp-services" },
  v1TeamsGroupsMcpServicesUpdate: { method: "PUT", path: "/api/v1/teams/groups/{0}/mcp-services" },
  v1TeamsGroupsNodePickerList: { method: "GET", path: "/api/v1/teams/groups/{0}/node-picker" },
  v1TeamsGroupsNodesBind: { method: "POST", path: "/api/v1/teams/groups/{0}/nodes" },
  v1TeamsGroupsNodesUnbind: { method: "DELETE", path: "/api/v1/teams/groups/{0}/nodes/{1}" },
  v1TeamsSkillsList: { method: "GET", path: "/api/v1/teams/skills" },
  v1TeamsGroupsSkillsList: { method: "GET", path: "/api/v1/teams/groups/{0}/skills" },
  v1TeamsGroupsSkillsUpdate: { method: "PUT", path: "/api/v1/teams/groups/{0}/skills" },

  // Team models / health-check (backed by mc_team_models; mobile + console settings depend on it)
  v1TeamsModelsList: { method: "GET", path: "/api/v1/teams/models" },
  v1TeamsModelsCreate: { method: "POST", path: "/api/v1/teams/models" },
  v1TeamsModelsUpdate: { method: "PUT", path: "/api/v1/teams/models/{0}" },
  v1TeamsModelsDelete: { method: "DELETE", path: "/api/v1/teams/models/{0}" },
  v1TeamsModelsHealthCheckCreate: {
    method: "POST",
    path: "/api/v1/teams/models/health-check",
  },
  v1TeamsModelsHealthCheckDetail: {
    method: "GET",
    path: "/api/v1/teams/models/{0}/health-check",
  },

  // Login methods (OIDC / OAuth providers) / audit
  v1TeamsLoginMethodsList: { method: "GET", path: "/api/v1/teams/login-methods" },
  v1TeamsLoginMethodsCreate: { method: "POST", path: "/api/v1/teams/login-methods" },
  v1TeamsLoginMethodsUpdate: { method: "PUT", path: "/api/v1/teams/login-methods/{0}" },
  v1TeamsLoginMethodsDelete: { method: "DELETE", path: "/api/v1/teams/login-methods/{0}" },
  v1TeamsLoginMethodsTestCreate: { method: "POST", path: "/api/v1/teams/login-methods/test" },
  v1TeamsAuditsList: { method: "GET", path: "/api/v1/teams/audits" },

  // ---- Team-scoped resource lists (MonkeyCode manager 团队视图) ------------
  // These console pages want a team-wide view. The backend exposes the same
  // resources as user-scoped routes; the admin role is privileged there and
  // returns every row, so we point the team-list methods at the user routes
  // and reshape ``{rows}`` into the key each page reads. Cursor pagination
  // degrades to page-based (no ``page.cursor`` ⇒ single page) until the
  // backend grows real cursor endpoints. Task is the "conversation" unit, so
  // conversations reuses the tasks route.
  v1TeamsProjectsList: {
    method: "GET",
    path: "/api/v1/users/projects",
    transform: listUnder("projects"),
  },
  v1TeamsTasksList: {
    method: "GET",
    path: "/api/v1/users/tasks",
    transform: listUnder("tasks"),
  },
  v1TeamsConversationsList: {
    method: "GET",
    path: "/api/v1/users/tasks",
    transform: taskConversations,
  },
  // Agent / 聊天 对话（管理端）：数据存 ClickHouse，走 ai-lubricant 的 /admin/* 端点
  // （admin token Bearer 鉴权，executeMapped 已带上）。后端直接返回
  // {conversations, page}，listUnder 提取 conversations 并透传 page 游标。
  v1AdminAgentConversationsList: {
    method: "GET",
    path: "/admin/agent/conversations",
    transform: listUnder("conversations"),
  },
  v1AdminChatConversationsList: {
    method: "GET",
    path: "/admin/chat/conversations",
    transform: listUnder("conversations"),
  },
  // 管理端单条对话详情：与列表同走 /admin/*（admin token Bearer 鉴权，
  // executeMapped 已带上），可跨用户读取。user_id 由列表接口提供。
  v1AdminAgentConversationsDetail: {
    method: "GET",
    path: "/admin/agent/conversations/{0}",
  },
  v1AdminChatConversationsDetail: {
    method: "GET",
    path: "/admin/chat/conversations/{0}",
  },
  // Team skills are team-owned resources; group binding has dedicated endpoints above.
};

export interface ResolvedEndpoint {
  spec: EndpointSpec;
  url: string;
}

/** Fill ``{0}``/``{1}`` placeholders from the positional ``extrax`` array. */
function fillPath(template: string, extrax: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_m, idx) => {
    const value = extrax[Number(idx)];
    return value != null ? encodeURIComponent(String(value)) : "";
  });
}

/**
 * Resolve a method name to a concrete request, or ``null`` when unmapped.
 * Callers treat ``null`` as "not implemented" and return a clean envelope.
 */
export function resolveEndpoint(methodName: string, extrax: string[]): ResolvedEndpoint | null {
  const spec = ENDPOINT_MAP[methodName];
  if (!spec) return null;
  return { spec, url: fillPath(spec.path, extrax) };
}
