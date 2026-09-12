import { uploadFileWithProgress, type UploadProgressCallback } from "@/api/uploadProgress"

export type TaskProvider = "claude" | "codex" | "opencode"

export interface UserTaskKeyMetadata {
  key_id: number
  name?: string
  key_masked: string
  version?: number
  disabled: boolean
  expires_at?: number | string | null
  usage_limit?: Record<string, number>
}

export interface UserTaskSummary {
  id: string
  user_id?: string
  kind: string
  sub_type?: string | null
  task_role?: string | null
  title?: string | null
  content: string
  summary?: string | null
  status: string
  provider: TaskProvider | string
  cli_name?: string | null
  node_id?: string | null
  node_session_id?: string | null
  /** 环境档位（isolated/shared/system）+ 共用 env id。任务详情顶部只读展示。 */
  env_mode?: "isolated" | "shared" | "system" | null
  env_id?: string | null
  env_name?: string | null
  project_id?: string | null
  model_id?: string | null
  models?: string[]
  git_identity_id?: string | null
  repo_url?: string | null
  branch?: string | null
  mode?: string | null
  mode_label?: string | null
  reasoning_effort?: "" | "low" | "medium" | "high" | "xhigh"
  workspace_state?: string | null
  dispatch_error?: string | null
  /**
   * 节点上报的环境准备进度。任务派发后并不是立刻就能对话——节点要先建工作目录、
   * 拉代码、检查并启动运行环境，这几步才是真正耗时的部分。服务端把当前步骤投影
   * 到这里，页面据此显示进度并在准备完成前禁用输入。
   *
   * 从未派发过的任务为 null。`preparing=false` 且 `ok=true` 表示已就绪；
   * `ok=false` 表示卡在 `label` 这一步，原因在 `detail`。
   */
  runtime_stage?: {
    /**
     * 步骤标识：dispatching（创建已受理、正在连接节点；虚拟第 0 步）/
     * workspace_prepare / git_clone / resource_sync / runtime_preflight /
     * runtime_start / running。仅用于调试定位，展示一律用 label + index/total，
     * 顺序与文案都由服务端给，前端不要自己映射（新增步骤时才不用改前端）。
     */
    stage?: string | null
    /** 可直接展示的中文步骤名，服务端已翻译，前端不要自己映射。 */
    label?: string | null
    ok?: boolean
    /** 成功时是补充说明（如分支名），失败时是失败原因。已由节点脱敏。 */
    detail?: string | null
    /** 当前是第几步（1 起）。 */
    index?: number
    /** 准备阶段总步数，用于渲染「2/4」。 */
    total?: number
    /** 仍在准备中：有步骤在进行且没有失败。就绪与失败都为 false。 */
    preparing?: boolean
  } | null
  api_key_id?: number | null
  parent_api_key_id?: number | null
  api_key?: UserTaskKeyMetadata | null
  usage_limit?: Record<string, number>
  created_at?: string | null
  last_active_at?: string | null
  completed_at?: string | null
}

export interface UserTaskDetail extends UserTaskSummary {
  log_store?: string | null
  /**
   * 任务侧 MCP principal 只读视图（id/enabled/params）；token 永不返回。
   * params 是 principal 绑定的内置资源实例（param_key=cdp_client_id/
   * mail_account_id/device_id，param_value=builtin_tool_resources 行 id）。
   * grants（含 service 授权行）编辑走统一授权端点
   * （PUT /users/mcp-principals/{id}/grants）；诊断区服务行需另调
   * listMcpPrincipalGrants（本 DTO 不含 service 行）。
   */
  mcp_principal?: {
    principal_id: number
    usage_type: "task"
    enabled: boolean
    params: Array<{ param_key: string; param_value: string }>
    /** 预留：后端 detail DTO 之后的版本若直接下发 grants 视图则填充。 */
    grants?: Array<{ grant_key: string; grant_value: string }>
  } | null
  /** 创建时勾选的 MCP 服务 wire spec（服务端已脱敏/去密）；详情页诊断区渲染。 */
  mcp_config?: Array<Record<string, unknown>>
  skill_config?: Array<Record<string, unknown>>
  plugin_config?: Array<Record<string, unknown>>
}

export interface CreateUserTaskPayload {
  content: string
  node_id?: string
  provider?: TaskProvider
  cli_name?: TaskProvider
  model_id?: string
  models?: string[]
  // 执行环境隔离档位：isolated（默认，一次性 home）/ shared（节点上命名的持久
  // 环境，需 env_id）/ system（节点操作者真实 home，需节点已开启 system 模式）。
  env_mode?: "isolated" | "shared" | "system"
  env_id?: string
  env_name?: string
  // 环境自带资源的激活子集（环境清单里的名字）：只激活列出的技能/插件，
  // 其余环境已装项本次任务不启用。省略/空 = 全激活。节点侧 skill 真正生效；
  // plugin 已随协议下发但节点暂不消费（物理存在的插件 runner 直读）。
  active_skills?: string[]
  active_plugins?: string[]
  git_identity_id?: string
  repo?: { repo_url?: string; branch?: string; commit?: string; branch_mode?: "default" | "existing" | "auto" }
  // skill_ids / plugin_ids：普通项传引用 id 字符串；技能集合/新表引用传
  // {resource_id|reference_id, entries:[子技能名…]}（服务端按 entries 过滤，
  // 只下发勾选的子技能；缺省=整个集合）。插件同样支持新表引用 {reference_id}。
  extra?: {
    project_id?: string
    issue_id?: string
    skill_ids?: Array<string | { resource_id?: string; reference_id?: string; entries?: string[] }>
    plugin_ids?: Array<string | { resource_id?: string; reference_id?: string; entries?: string[] }>
  }
  mode?: string
  reasoning_effort?: "" | "low" | "medium" | "high" | "xhigh"
  parent_api_key_id?: number
  usage_limit?: Record<string, number>
  expires_at?: number
  // 子 Key 收窄参数（复用既有 api_keys 列，不加新 schema）。省略=继承父级。
  // model_whitelist 与 models 同源，让派生子 Key 只允许所选模型。
  rate_limit?: Record<string, number>
  model_whitelist?: string[]
  editor_provider_whitelist?: string[]
  selection_strategy?: string
  expected_client_id?: string
  bootstrap_content?: string
  prompt_id?: string
  skill_config?: Array<Record<string, unknown>>
  mcp_config?: Array<Record<string, unknown>>
  plugin_config?: Array<Record<string, unknown>>
  task_type?: string
  sub_type?: string
  task_role?: string
}

export interface UserTaskList {
  total: number
  page: number
  page_size: number
  rows: UserTaskSummary[]
}

export interface UserTaskStats {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export interface UserTaskLog {
  id: number
  request_id?: string
  request_path?: string
  model?: string
  status_code?: number
  total_tokens?: number
  created_at?: string | number
  [key: string]: unknown
}

/** One persisted structured event row (mc_task_events) for replay. */
export interface UserTaskEventRow {
  seq: number
  kind: string
  event_type?: string
  /** Envelope: `{item, agent_id, subagent_id?, logical_event_id?, tool_name?, …}`. */
  payload?: unknown
  /** Join key to ClickHouse content; on `item_ref` rows the payload is null. */
  logical_event_id?: string | null
  client_message_id?: string | null
  delivery_status?: string | null
  delivery_attempt?: number
  failure_reason?: string | null
  created_at?: string | null
}

export interface UserTaskEventHistory {
  rows: UserTaskEventRow[]
  next_before?: number | null
}

export interface UserTaskFileEntry {
  name?: string
  path?: string
  size?: number
  is_dir?: boolean
  [key: string]: unknown
}

export interface UserTaskFileResponse {
  path: string
  is_dir: boolean
  entries?: UserTaskFileEntry[]
  count?: number
  content?: string
  encoding?: "utf-8" | "base64"
  truncated?: boolean
}

export interface UserTaskTerminal {
  id: string
  current_command?: string
  running?: boolean
  created_at?: string | number | null
  [key: string]: unknown
}

async function taskFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
  const rawBody = await response.text()
  let body: any = null
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = rawBody
    }
  }
  if (!response.ok) {
    // 后端 HTTPException 被全局 handler 包成 OpenAI 风格 envelope
    // {error: {message, type, code}}；500 等未处理异常可能只返回纯文本。
    // 两种响应都保留真实错误，只有无法提取时才回退到 HTTP 状态码。
    const message =
      (body && (body.error?.message || body.detail || body.message)) ||
      (typeof body === "string" ? body : "") ||
      `HTTP ${response.status}`
    throw new Error(typeof message === "string" ? message : JSON.stringify(message))
  }
  return body as T
}

const base = "/api/v1/users/tasks"
const idPath = (taskId: string) => `${base}/${encodeURIComponent(taskId)}`

export function listUserTasks(params: { page?: number; page_size?: number; project_id?: string } = {}): Promise<UserTaskList> {
  const query = new URLSearchParams()
  if (params.page) query.set("page", String(params.page))
  if (params.page_size) query.set("page_size", String(params.page_size))
  if (params.project_id) query.set("project_id", params.project_id)
  return taskFetch(`${base}${query.size ? `?${query}` : ""}`)
}

export function getUserTask(taskId: string): Promise<UserTaskDetail> {
  return taskFetch(idPath(taskId))
}

export function createUserTask(payload: CreateUserTaskPayload): Promise<UserTaskDetail> {
  return taskFetch(base, { method: "POST", body: JSON.stringify(payload) })
}

export function updateUserTask(taskId: string, payload: { title?: string; summary?: string; mode?: string; mode_label?: string; reasoning_effort?: string }): Promise<{ ok: boolean }> {
  return taskFetch(idPath(taskId), { method: "PUT", body: JSON.stringify(payload) })
}

export function stopUserTask(taskId: string): Promise<{ ok: boolean }> {
  return taskFetch(`${base}/stop?task_id=${encodeURIComponent(taskId)}`, { method: "PUT" })
}

export function batchStopUserTasks(taskIds: string[]): Promise<{ stopped: number; failed: Array<{ id: string; error: string }> }> {
  return taskFetch(`${base}/batch-stop`, { method: "POST", body: JSON.stringify({ task_ids: taskIds }) })
}

export function deleteUserTask(taskId: string): Promise<{ deleted: boolean }> {
  return taskFetch(idPath(taskId), { method: "DELETE" })
}

export function batchDeleteUserTasks(taskIds: string[]): Promise<{ deleted: number; failed: Array<{ id: string; error: string }> }> {
  return taskFetch(`${base}/batch-delete`, { method: "POST", body: JSON.stringify({ task_ids: taskIds }) })
}

export interface UserTaskAttachment {
  url: string
  filename: string
  path?: string
  size?: number
}

/** Ack for one user turn. `client_message_id` is the end-to-end idempotency key. */
export interface UserTaskMessageAck {
  accepted: boolean
  task_id?: string
  client_message_id: string
  delivery_status?: string | null
  delivery_attempt?: number
}

/**
 * Mint the sender-side idempotency key for one user turn.
 *
 * The same id rides the POST body, the optimistic bubble, and the persisted
 * row (its `logical_event_id` / `item.id`), so a live frame and its replay twin
 * collapse on `byId` instead of stacking as two bubbles. A retry must reuse the
 * original id so the backend's `failed → pending` (attempt+1) path fires instead
 * of creating a second message row.
 */
export function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `cmid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function sendUserTaskMessage(
  taskId: string,
  content: string,
  attachments?: UserTaskAttachment[],
  clientMessageId?: string,
): Promise<UserTaskMessageAck> {
  // Mint before the fetch leaves so the caller can attach the optimistic bubble
  // before the await resolves — the bubble and the persisted row then share id.
  const cmid = clientMessageId || newClientMessageId()
  return taskFetch<UserTaskMessageAck>(`${idPath(taskId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      client_message_id: cmid,
      ...(attachments?.length ? { attachments } : {}),
    }),
  })
}

/** 上传一个附件到任务工作区的 .task-attachments 目录，返回可随消息发送的 workspace:// URL。 */
export async function uploadUserTaskAttachment(
  taskId: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<UserTaskAttachment> {
  return uploadFileWithProgress<UserTaskAttachment>(
    `${idPath(taskId)}/attachments?filename=${encodeURIComponent(file.name)}`,
    file,
    onProgress,
    "PUT",
  )
}

export function cancelUserTask(taskId: string): Promise<{ accepted: boolean }> {
  return taskFetch(`${idPath(taskId)}/cancel`, { method: "POST" })
}

export function restartUserTask(taskId: string): Promise<{ restarted: boolean }> {
  return taskFetch(`${idPath(taskId)}/restart`, { method: "POST" })
}

export function startUserTask(taskId: string): Promise<{ started: boolean; task_id?: string; node_session_id?: string }> {
  return taskFetch(`${idPath(taskId)}/start`, { method: "POST" })
}

/**
 * 切换任务的活跃模型。后端只把模型挪到 models_snapshot 头部，下一条消息/重启时
 * 才带给节点，所以**不需要活跃运行时**——存储态任务也能先把模型选好。
 */
export function switchUserTaskModel(taskId: string, modelId: string): Promise<{ task_id: string; model_id: string; models: string[] }> {
  return taskFetch(`${idPath(taskId)}/model`, { method: "POST", body: JSON.stringify({ model_id: modelId }) })
}

/** 把模型追加进任务的已添加集合（按创建时父 API Key 的允许目录校验）。 */
export function addUserTaskModels(taskId: string, models: string[]): Promise<{ task_id: string; models: string[] }> {
  return taskFetch(`${idPath(taskId)}/models`, { method: "POST", body: JSON.stringify({ models }) })
}

export function getUserTaskStats(taskId: string): Promise<UserTaskStats> {
  return taskFetch(`${idPath(taskId)}/stats`)
}

export function listUserTaskLogs(taskId: string, limit = 100, offset = 0): Promise<{ total?: number; rows?: UserTaskLog[]; logs?: UserTaskLog[] }> {
  return taskFetch(`${idPath(taskId)}/logs?limit=${limit}&offset=${offset}`)
}

export function getUserTaskLog(taskId: string, logId: number): Promise<UserTaskLog> {
  return taskFetch(`${idPath(taskId)}/logs/${logId}`)
}

export function getUserTaskFiles(taskId: string, path = "/"): Promise<UserTaskFileResponse> {
  return taskFetch(`${idPath(taskId)}/files?path=${encodeURIComponent(path)}`)
}

export function listUserTaskTerminals(taskId: string): Promise<{ terminals: UserTaskTerminal[] }> {
  return taskFetch(`${idPath(taskId)}/terminals`)
}

export interface UserTaskPort {
  port?: number
  status?: string
  preview_url?: string
  error_message?: string
}

/**
 * 任务工作区端口预览。后端目前对任务返回 `{ports: [], supported: true}`（节点侧
 * 任务端口发现还没落地），所以 UI 走正常的「无端口」空态，而不是伪造 VM 形状的数据。
 */
export function listUserTaskPorts(taskId: string): Promise<{ ports: UserTaskPort[]; supported: boolean }> {
  return taskFetch(`${idPath(taskId)}/ports`)
}

export function deleteUserTaskTerminal(taskId: string, terminalId: string): Promise<unknown> {
  return taskFetch(`${idPath(taskId)}/terminals/${encodeURIComponent(terminalId)}`, { method: "DELETE" })
}

export function disableUserTaskKey(taskId: string): Promise<unknown> {
  return taskFetch(`${idPath(taskId)}/api-key/disable`, { method: "POST" })
}

export function rotateUserTaskKey(taskId: string): Promise<unknown> {
  return taskFetch(`${idPath(taskId)}/api-key/rotate`, { method: "POST" })
}

export function resolveLegacyTaskSession(sessionId: string): Promise<{ task_id: string }> {
  return taskFetch(`${base}/legacy-session/${encodeURIComponent(sessionId)}`)
}

export function userTaskEventsUrl(taskId: string): string {
  return `${idPath(taskId)}/events`
}

/** Replay persisted structured events (mc_task_events) for a reconnecting client. */
export function listUserTaskEvents(taskId: string, before?: number, limit = 200): Promise<UserTaskEventHistory> {
  const query = new URLSearchParams()
  query.set("limit", String(limit))
  if (before) query.set("before", String(before))
  return taskFetch(`${idPath(taskId)}/events/history?${query}`)
}

export function userTaskTerminalUrl(taskId: string, terminalId?: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const query = terminalId ? `?terminal_id=${encodeURIComponent(terminalId)}` : ""
  return `${protocol}//${window.location.host}${idPath(taskId)}/terminals/connect${query}`
}

/**
 * 任务终端 websocket 相对路径，喂给共享 `<Terminal ws>`（内部自行补全协议/host）。
 * 与 editorTerminalWs 的相对路径约定一致；terminal_id 必填且 ≤128 字符（用 uuid）。
 */
export function userTaskTerminalWs(taskId: string, terminalId: string, rows = 24, cols = 80): string {
  const query = new URLSearchParams({ terminal_id: terminalId, rows: String(rows), cols: String(cols) })
  return `${idPath(taskId)}/terminal?${query}`
}
