export type EditorProvider = "claude" | "codex" | "opencode"
export type EditorBranchMode = "default" | "existing" | "auto"

export interface ParentKeyItem {
  id: number
  key_masked: string
  name: string
  source: "self" | "platform" | string
  disabled?: boolean
  editor_provider_whitelist?: EditorProvider[]
  editor_provider_blacklist?: EditorProvider[]
}

export interface EditorInstance {
  id: string
  owner_user_id?: string
  name?: string
  provider: EditorProvider
  project_id?: string | null
  branch?: string | null
  branch_mode?: EditorBranchMode | null
  workdir?: string | null
  node_id?: string | null
  api_key_id?: number | null
  mcp_config?: unknown[]
  skill_config?: unknown[]
  plugin_config?: unknown[]
  prompt_id?: string | null
  status: string
  created_at?: string
  updated_at?: string
  api_key_copy?: {
    id: number
    key?: string
    key_masked?: string
    name?: string
    version?: number
    expires_at?: number | null
    usage_limit?: Record<string, unknown>
    disabled?: boolean
  }
  sessions?: EditorSession[]
}

export interface EditorSession {
  id: string
  editor_id: string
  node_session_id?: string | null
  provider_thread_id?: string | null
  model?: string | null
  models?: string[]
  api_key_id?: number | null
  api_key_copy?: {
    id: number
    key?: string
    key_masked?: string
    name?: string
    version?: number
    expires_at?: number | null
    usage_limit?: Record<string, unknown>
    disabled?: boolean
  }
  status: string
  expected_client_id?: string | null
  first_request_seen?: boolean
  first_request_id?: string | null
  last_request_at?: string | null
  closed_at?: string | null
  created_at?: string
  updated_at?: string
  provider?: EditorProvider
  editor_name?: string | null
  editor_provider?: EditorProvider | null
  editor_project_id?: string | null
  total_tokens?: number
  task_name?: string | null
  task_type?: string | null
  task_role?: string | null
  sub_type?: string | null
  issue_id?: string | null
  // Provider-native permission/approval mode (codex read-only/workspace-write/…,
  // claude default/plan/acceptEdits/bypassPermissions). Empty = provider default.
  mode?: string | null
  // Derived API-key limits for this session (from the session's own child key).
  usage_limit?: SessionUsageLimit
  expires_at?: number | null
}

export interface CreateEditorPayload {
  provider: EditorProvider
  project_id?: string
  branch?: string
  branch_mode?: EditorBranchMode
  workdir?: string
  node_id?: string
  name?: string
  mcp_config?: unknown[]
  skill_config?: unknown[]
  plugin_config?: unknown[]
  prompt_id?: string
}

export interface SessionUsageLimit {
  max_requests?: number
  max_total_tokens?: number
}

export interface CreateEditorSessionPayload {
  // Key 归属反转：建 session 时选父 Key 并派生一把子 Key（一 session 一 key）。
  parent_api_key_id: number
  // 一个 session 携带一组可用模型，运行时在其中切换；model 为当前激活模型。
  models?: string[]
  model?: string
  usage_limit?: SessionUsageLimit
  expires_at?: number
  expected_client_id?: string
  first_content?: string
  first_content_hash?: string
  task_name?: string
  task_type?: string
  task_role?: string
  sub_type?: string
  issue_id?: string
  mode?: string
}

async function editorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers || {}) as Record<string, string>),
    }
    // Manager editor endpoints accept the same emergency admin Bearer token as
    // the rest of /manager. User-side calls keep using the session cookie.
    const adminToken = localStorage.getItem("admin_access_token")
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers,
    })
  } catch {
    throw new Error("无法连接到编辑器接口：请确认后端服务已启动。")
  }

  const text = await response.text()
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new Error(String(body?.detail || body?.message || body?.error?.message || `HTTP ${response.status}`))
  }
  return (body ?? {}) as T
}

export function listParentKeys(): Promise<ParentKeyItem[]> {
  return editorFetch<ParentKeyItem[]>("/api/v1/users/model-gateway/parent-keys")
}

/**
 * 网关真实模型目录（/v1/models，OpenAI list 格式）。编辑器任务的「可用模型」取这里，
 * 不读团队模型表（/api/v1/users/models）——后者可能为空，导致创建任务时模型列表为空。
 */
export interface GatewayModelOption {
  value: string
  label: string
}

// 运行时模型目录一律按执行 Key 取（agentClient.listRuntimeModelOptions →
// /agent/chat/models?api_key_id=）。这里不再提供无 Key 范围的 /v1/models 拉取：
// /v1/models 只服务带 Authorization / x-api-key 头的网关客户端，控制台用 session
// cookie 调它拿不到任何 Key 级过滤，会把不该给的模型露给用户。

// 编辑器一律归属项目：全局 /api/v1/users/editors 的 list/get/create/update/delete/session
// 用户侧入口已下线，改走项目级 /projects/{id}/editors 接口（见下方 project-scoped 区块）。
// 这里保留 session/api-key/log/model-switch 这类以 editor_id 为主键、与作用域无关的操作。
export type UpdateEditorPayload = Partial<Omit<CreateEditorPayload, "provider">>

/**
 * 编辑器的对外显示名——所有面向用户的位置都该走这里，别各自写 `name || id`。
 *
 * 优先用 name；没起名时不甩一串裸 UUID 给用户看，而是回落成「类型 · 节点」或
 * 「类型 · id 前 8 位」这种还能认人的形式。provider 只作辅助，绝不顶替名字：
 * 否则一堆编辑器全叫 "claude / codex / opencode"，根本分不清是哪一台。
 */
export function editorDisplayName(
  editor: Pick<EditorInstance, "id" | "name" | "provider" | "node_id"> | null | undefined,
): string {
  if (!editor) return "未选择编辑器"
  const name = editor.name?.trim()
  if (name) return name
  const provider = editor.provider || "编辑器"
  if (editor.node_id) return `${provider} · ${editor.node_id}`
  return `${provider} · ${editor.id.slice(0, 8)}`
}

export interface EditorRequestLog {
  id: number
  request_id?: string | null
  attempt_key?: string | null
  attempt_no?: number
  time?: number
  api_key_name?: string | null
  provider_name?: string | null
  model?: string | null
  actual_model?: string | null
  endpoint?: string | null
  success?: boolean
  status?: string | null
  stream?: boolean
  duration_ms?: number | null
  first_token_ms?: number | null
  client_type?: string | null
  session_id?: string | null
  editor_id?: string | null
  editor_session_id?: string | null
  api_key_version?: number | null
  upstream_status?: number | null
  total_tokens?: number | null
  has_error?: boolean
  error_preview?: string | null
  request_body?: unknown
  response_body?: unknown
  [key: string]: unknown
}

export interface EditorRequestLogPage {
  total: number
  rows: EditorRequestLog[]
}

export function disableEditorSessionApiKey(editorId: string, sessionId: string): Promise<{ disabled: boolean; key_id: number; version?: number }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/api-key/disable`, { method: "POST" })
}

export function rotateEditorSessionApiKey(editorId: string, sessionId: string): Promise<{ key_id: number; key: string; version?: number; key_masked: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/api-key/rotate`, { method: "POST" })
}

export function listEditorRequestLogs(
  editorId: string,
  params: { editor_session_id?: string; limit?: number; offset?: number } = {},
): Promise<EditorRequestLogPage> {
  const query = new URLSearchParams()
  if (params.editor_session_id) query.set("editor_session_id", params.editor_session_id)
  if (params.limit != null) query.set("limit", String(params.limit))
  if (params.offset != null) query.set("offset", String(params.offset))
  const suffix = query.toString() ? `?${query.toString()}` : ""
  return editorFetch<EditorRequestLogPage>(`/api/v1/users/editors/${encodeURIComponent(editorId)}/logs${suffix}`)
}

export function getEditorRequestLog(editorId: string, logId: number): Promise<EditorRequestLog> {
  return editorFetch<EditorRequestLog>(
    `/api/v1/users/editors/${encodeURIComponent(editorId)}/logs/${encodeURIComponent(String(logId))}`,
  )
}

export interface ProjectEditorResponse {
  project_id: string
  editor: EditorInstance | null
  access_role?: string
}

export interface EditorSessionPage {
  total: number
  rows: EditorSession[]
  limit: number
  offset: number
}

export function listUserEditorSessions(params: { limit?: number; offset?: number } = {}): Promise<EditorSessionPage> {
  const query = new URLSearchParams()
  if (params.limit != null) query.set("limit", String(params.limit))
  if (params.offset != null) query.set("offset", String(params.offset))
  const suffix = query.toString() ? `?${query}` : ""
  return editorFetch<EditorSessionPage>(`/api/v1/users/editors/sessions${suffix}`)
}

export function listProjectEditors(projectId: string): Promise<EditorInstance[]> {
  return editorFetch<EditorInstance[]>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors`)
}

/** 编辑器级详情（不依赖路由里的 projectId；编辑器与项目一对一，project_id 从返回体取）。 */
export function getEditorDetail(editorId: string): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/users/editors/${encodeURIComponent(editorId)}`)
}

export function getProjectEditorDetail(projectId: string, editorId: string): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}`)
}

export function duplicateProjectEditor(projectId: string, editorId: string): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}/duplicate`, { method: "POST" })
}

export function deleteProjectEditor(projectId: string, editorId: string): Promise<{ deleted: boolean; editor_id: string }> {
  return editorFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}`, { method: "DELETE" })
}

export function listProjectEditorsSummary(projectId: string): Promise<EditorInstance[]> {
  return listProjectEditors(projectId)
}

export function createProjectEditorSession(
  projectId: string,
  editorId: string,
  payload: CreateEditorSessionPayload,
): Promise<EditorSession> {
  return editorFetch<EditorSession>(
    `/api/v1/users/projects/${encodeURIComponent(projectId)}/editors/${encodeURIComponent(editorId)}/sessions`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  )
}

export function getProjectEditor(projectId: string): Promise<ProjectEditorResponse> {
  return editorFetch<ProjectEditorResponse>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`)
}

export function createProjectEditor(projectId: string, payload: CreateEditorPayload): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`, {
    method: "POST",
    body: JSON.stringify({ ...payload, project_id: projectId }),
  })
}

export function listProjectEditorSessions(projectId: string): Promise<EditorSession[]> {
  return editorFetch<EditorSession[]>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor/sessions`)
}

export function getManagerEditors(params: { project_id?: string; provider?: string; status?: string; node_id?: string } = {}): Promise<{ total: number; rows: EditorInstance[] }> {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value) })
  const suffix = query.toString() ? `?${query.toString()}` : ""
  return editorFetch<{ total: number; rows: EditorInstance[] }>(`/api/v1/teams/editors${suffix}`)
}

export function getManagerEditor(editorId: string): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/teams/editors/${encodeURIComponent(editorId)}`)
}

export function closeManagerEditorSession(editorId: string, sessionId: string): Promise<{ closed: boolean }> {
  return editorFetch<{ closed: boolean }>(`/api/v1/teams/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/close`, { method: "POST" })
}

export function listManagerEditorLogs(editorId: string, params: { limit?: number; offset?: number } = {}): Promise<EditorRequestLogPage> {
  const query = new URLSearchParams()
  if (params.limit != null) query.set("limit", String(params.limit))
  if (params.offset != null) query.set("offset", String(params.offset))
  const suffix = query.toString() ? `?${query.toString()}` : ""
  return editorFetch<EditorRequestLogPage>(`/api/v1/teams/editors/${encodeURIComponent(editorId)}/logs${suffix}`)
}

export function updateProjectEditor(projectId: string, payload: UpdateEditorPayload): Promise<EditorInstance> {
  return editorFetch<EditorInstance>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/editor`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function sendEditorSessionMessage(editorId: string, sessionId: string, content: string): Promise<{ accepted: boolean; session_id: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })
}

/** Interrupt the turn currently running in the session runtime; session stays alive. */
export function cancelEditorSessionTurn(editorId: string, sessionId: string): Promise<{ accepted: boolean; session_id: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
  })
}

/** Restart the session runtime process, clearing its in-process context. */
export function restartEditorSessionRuntime(editorId: string, sessionId: string): Promise<{ restarted: boolean; session_id: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/restart`, {
    method: "POST",
  })
}

export interface UpdateEditorSessionPayload {
  task_name?: string
  model?: string
  models?: string[]
  mode?: string
  usage_limit?: SessionUsageLimit
  expires_at?: number | null
}

export function updateEditorSession(
  editorId: string,
  sessionId: string,
  payload: UpdateEditorSessionPayload,
): Promise<EditorSession> {
  return editorFetch<EditorSession>(
    `/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  )
}

export function switchEditorSessionModel(
  editorId: string,
  sessionId: string,
  model: string,
): Promise<EditorSession> {
  return updateEditorSession(editorId, sessionId, { model })
}

export function switchEditorSessionMode(
  editorId: string,
  sessionId: string,
  mode: string,
): Promise<EditorSession> {
  return updateEditorSession(editorId, sessionId, { mode })
}

/**
 * Provider-native permission/approval mode options. The runtime maps these onto
 * each provider's own knobs (codex sandbox/approval, claude permissionMode,
 * opencode --dangerously-skip-permissions), so the list is provider-specific.
 */
export function editorModeOptions(provider?: string | null): Array<{ value: string; label: string }> {
  switch ((provider || "").toLowerCase()) {
    case "codex":
      return [
        { value: "", label: "编辑器默认" },
        { value: "read-only", label: "只读" },
        { value: "workspace-write", label: "可写工作区" },
        { value: "danger-full-access", label: "完全访问" },
      ]
    case "claude":
      return [
        { value: "", label: "编辑器默认" },
        { value: "default", label: "默认（逐次确认）" },
        { value: "plan", label: "仅计划" },
        { value: "acceptEdits", label: "自动接受编辑" },
        { value: "bypassPermissions", label: "跳过权限确认" },
      ]
    case "opencode":
      return [
        { value: "", label: "编辑器默认" },
        { value: "skip-permissions", label: "跳过权限确认" },
      ]
    default:
      return [{ value: "", label: "编辑器默认" }]
  }
}

/**
 * 权限方式选项来自节点在注册握手时上报的 ``capabilities.editors``（Go 客户端
 * 探测每个 CLI 的 ``--help``/``agent list`` 得到）。返回该节点为指定 provider
 * 实际支持的 modes；节点未上报 editors 或该 provider 无匹配时返回 ``null``，
 * 调用方回落到 ``editorModeOptions``（硬编码）并提示"节点未上报"。
 *
 * 第一个元素始终是空值「客户端默认」，与 ``editorModeOptions`` 一致。
 */
export function nodeModeOptions(
  node: { capabilities?: { editors?: Array<{ provider: string; modes: Array<{ id: string; label?: string }> }> } } | null | undefined,
  provider?: string | null,
): Array<{ value: string; label: string }> | null {
  const editors = node?.capabilities?.editors
  if (!Array.isArray(editors) || editors.length === 0) return null
  const match = editors.find((editor) => editor.provider === (provider || "").toLowerCase())
  if (!match || !Array.isArray(match.modes) || match.modes.length === 0) return null
  return [
    { value: "", label: "客户端默认" },
    ...match.modes.map((mode) => ({ value: mode.id, label: mode.label || mode.id })),
  ]
}

export function stopEditorSession(
  editorId: string,
  sessionId: string,
): Promise<{ stopped: boolean; session_id: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  })
}

export function deleteEditorSession(
  editorId: string,
  sessionId: string,
): Promise<{ deleted: boolean; session_id: string; request_logs_retained: boolean }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/data`, {
    method: "DELETE",
  })
}

/** @deprecated Use stopEditorSession; kept for older callers. */
export function closeEditorSession(
  editorId: string,
  sessionId: string,
): Promise<{ closed: boolean; session_id: string }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  })
}

// ==================== 编辑器工作区：文件 / 终端 / 端口 ====================
// 编辑器级（非任务级）facade：终端 / 文件 / 端口关联的是编辑器绑定的节点工作区，
// 不随选中任务切换。后端取编辑器任一活跃任务的 node_session_id 作为节点句柄，
// 所有任务共享 editor_workdir 工作目录。浏览器只发 editor_id，绝不发 node_session_id
// 或节点本地路径。

export interface EditorFileEntry {
  name: string
  size?: number
  is_dir?: boolean
}

export interface EditorFileListing {
  path: string
  is_dir: boolean
  entries?: EditorFileEntry[]
  count?: number
  content?: string
  encoding?: "utf-8" | "base64"
  truncated?: boolean
}

export function listEditorFiles(
  editorId: string,
  path = "/",
): Promise<EditorFileListing> {
  const query = new URLSearchParams({ path })
  return editorFetch<EditorFileListing>(
    `/api/v1/users/editors/${encodeURIComponent(editorId)}/files?${query}`,
  )
}

export interface EditorPort {
  port?: number
  status?: string
  preview_url?: string
  error_message?: string
}

export function listEditorPorts(
  editorId: string,
): Promise<{ ports: EditorPort[]; supported: boolean }> {
  return editorFetch(
    `/api/v1/users/editors/${encodeURIComponent(editorId)}/ports`,
  )
}

export interface EditorTerminal {
  id: string
  created_at?: number
  connected_count?: number
  title?: string
}

export function listEditorTerminals(editorId: string): Promise<{ terminals: EditorTerminal[] }> {
  return editorFetch(`/api/v1/users/editors/${encodeURIComponent(editorId)}/terminals`)
}

export function deleteEditorTerminal(editorId: string, terminalId: string): Promise<{ deleted: boolean }> {
  return editorFetch(
    `/api/v1/users/editors/${encodeURIComponent(editorId)}/terminals/${encodeURIComponent(terminalId)}`,
    { method: "DELETE" },
  )
}

/** 编辑器终端 websocket 地址（已鉴权，cwd 由服务端按编辑器工作目录解析）。 */
export function editorTerminalWs(editorId: string, terminalId: string, rows = 24, cols = 80): string {
  const query = new URLSearchParams({ terminal_id: terminalId, rows: String(rows), cols: String(cols) })
  return `/api/v1/users/editors/${encodeURIComponent(editorId)}/terminal?${query}`
}

export interface ProjectPrompt {
  id: string
  name: string
  content: string
  providers: string[]
  enabled: boolean
  /** system=管理端维护的系统提示词；mine=当前用户私有提示词。 */
  scope?: "system" | "mine"
  owner_user_id?: string | null
  created_at?: string
  updated_at?: string
}

/** 列出系统启用项 + 我的私有项（带 scope）。 */
export function listProjectPrompts(): Promise<ProjectPrompt[]> {
  return editorFetch<ProjectPrompt[]>("/api/v1/users/project-prompts")
}

export interface ProjectPromptInput {
  name: string
  content: string
  providers: string[]
  enabled: boolean
}

export function createMyProjectPrompt(payload: ProjectPromptInput): Promise<ProjectPrompt> {
  return editorFetch<ProjectPrompt>("/api/v1/users/project-prompts", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateMyProjectPrompt(id: string, payload: Partial<ProjectPromptInput>): Promise<ProjectPrompt> {
  return editorFetch<ProjectPrompt>(
    `/api/v1/users/project-prompts/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  )
}

export function deleteMyProjectPrompt(id: string): Promise<{ deleted: boolean }> {
  return editorFetch(`/api/v1/users/project-prompts/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ── Remote repository creation ─────────────────────────────────────────────
export interface CreateRepositoryPayload {
  name: string
  description?: string
  private?: boolean
  /** Optional org/namespace; empty → the identity's authenticated user. */
  owner?: string
}

export interface CreatedRepository {
  full_name: string
  url: string
  description?: string
  web_url?: string
}

/**
 * 用已存 Git 身份在远端真实创建一个仓库。前端只传 identity id + 仓库元数据，
 * 访问令牌全程留在服务端（见 routes_git.create_repository）。成功后返回 canonical
 * clone URL，可直接用于建项目。
 */
export function createRepositoryForIdentity(
  identityId: string,
  payload: CreateRepositoryPayload,
): Promise<CreatedRepository> {
  return editorFetch<CreatedRepository>(
    `/api/v1/users/git-identities/${encodeURIComponent(identityId)}/repositories`,
    { method: "POST", body: JSON.stringify(payload) },
  )
}
