/**
 * 用户侧 Agent / 聊天 API 客户端。
 *
 * 直连后端 `/agent/*` 路由（vite 开发期 proxy，生产同源），用 monkeycode
 * C 端 session cookie 鉴权（`credentials: "include"`），不携带 admin token。
 * 后端 `get_agent_caller` 依赖据此把数据按 user_id 隔离：普通用户只看/管自己的
 * Agent、对话，以及平台公共 Agent（user_id 为空）。
 *
 * 聊天/媒体发送不再直连 `/v1/*`，也不暴露 api key 明文：前端只传 api_key_id
 * （整数），后端校验该 key 归属当前用户后取明文调主链路。
 */

import { uploadFileWithProgress, type UploadProgressCallback } from "@/api/uploadProgress"

const AGENT_BASE = "/agent"

async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${AGENT_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const data = await r.json()
      detail = data?.detail || data?.message || detail
    } catch {
      // ignore parse error, keep default detail
    }
    throw new Error(detail)
  }
  // 204 / 空响应容错
  const text = await r.text()
  return (text ? JSON.parse(text) : {}) as T
}

// ==================== 类型 ====================

export interface AgentInstance {
  id: number
  name: string
  display_name: string
  description: string
  api_key_masked?: string
  model: string
  system_prompt: string
  max_turns: number
  enabled: boolean
  memory_enabled: boolean
  skill_auto_learn: boolean
  scheduler_enabled: boolean
  mcp_user_id?: number | null
  workspace_root: string
  allowed_roots: string[]
  denied_patterns: string[]
  guardian_enabled: boolean
  guardian_interval: number
  autonomous_enabled: boolean
  thinking_enabled?: boolean
  reasoning_effort?: string
  // agent 层 429 自动重试次数（仅瞬时码；0=关闭）
  llm_retry_429?: number
  // 需确认工具挂起等人裁决的上限（秒）；0=不过期。超时中止本轮而非自动拒绝后继续。
  approval_timeout_seconds?: number
  /** 浏览器（CDP 网页对话）能否执行 code_run。默认关；开启后走审批卡流程。 */
  browser_code_run_enabled?: boolean
  // 网关秘钥绑定：主/子 Agent 各自的网关 api_keys.id + 模型名（LLM 走网关闭环）。
  main_api_key_id?: number | null
  main_model?: string
  subagent_api_key_id?: number | null
  subagent_model?: string
  /** 定时任务默认绑定；留空则回退主 Agent。任务级 api_key_id/model 再覆盖这一层。 */
  scheduled_api_key_id?: number | null
  scheduled_model?: string
  user_id?: string | null
  /** 所属团队；团队共享时用于判定可见范围。 */
  team_id?: string | null
  /** true=同团队成员可见可用（只有 owner 能改配置）；false=仅自己可见。 */
  is_team_shared?: boolean
  created_at: string
  updated_at: string
  stats?: {
    conversations: number
    insights: number
    facts: number
    skills: number
    scheduled_tasks: number
  }
}

export interface CreateAgentPayload {
  name: string
  display_name?: string
  description?: string
  system_prompt?: string
  max_turns?: number
  enabled?: boolean
  memory_enabled?: boolean
  skill_auto_learn?: boolean
  scheduler_enabled?: boolean
  workspace_root?: string
  allowed_roots?: string[]
  denied_patterns?: string[]
  guardian_enabled?: boolean
  guardian_interval?: number
  autonomous_enabled?: boolean
  main_api_key_id?: number | null
  main_model?: string
  subagent_api_key_id?: number | null
  subagent_model?: string
  scheduled_api_key_id?: number | null
  scheduled_model?: string
  thinking_enabled?: boolean
  reasoning_effort?: string
  llm_retry_429?: number
  /** 审批挂起上限（秒）；0=不过期。后端校验 0 或 [60, 7 天]。 */
  approval_timeout_seconds?: number
  /** 浏览器（CDP 网页对话）能否执行 code_run。默认关。 */
  browser_code_run_enabled?: boolean
  mcp_user_id?: number | null
  /** true=同团队成员可见可用；false=仅自己可见。仅 owner 可改。 */
  is_team_shared?: boolean
}

export type UpdateAgentPayload = Partial<Omit<CreateAgentPayload, "name">>

export interface ManagedAgentSop {
  id: string
  name: string
  description: string
  filename: string
  enabled?: boolean
  is_builtin?: boolean
  revision?: number
  updated_at?: string | null
  exists?: boolean
}

export interface AgentSopsResponse {
  available: ManagedAgentSop[]
}

export function getAgentSops(agentId: number): Promise<AgentSopsResponse> {
  return agentFetch<AgentSopsResponse>(`/agents/${agentId}/sops`)
}

// ==================== GA 一级工具 schema（动态加载 + fallback）====================
// 来源单一：优先 GET /agent/tools/schema（agent/tools.py ToolRegistry.get_schema）。
// 仅当后端不可用时回退到 FALLBACK_BUILTIN_TOOLS——该列表与
// agent/tools.py._register_phase1 + tests/test_agent_tools.py 的固定一级工具集一致，
// 不得凭记忆增删。capability_call 是二级能力（MCP 方法 / scheduler）入口，
// 不把二级方法伪装成一级工具。
export interface BuiltinToolSchema {
  name: string
  description: string
}

export const FALLBACK_BUILTIN_TOOLS: BuiltinToolSchema[] = [
  { name: "code_run", description: "Execute Python or PowerShell code in a subprocess." },
  {
    name: "file_read",
    description:
      "Read a file with line numbers. Paths resolve under the Agent's working directory; memory files live under memory/ (e.g. memory/sop/x.md). Pass keyword to jump to the first matching line in a large file.",
  },
  { name: "file_write", description: "Write or append to a file." },
  { name: "file_patch", description: "Replace a unique old_content block with new_content." },
  {
    name: "web",
    description:
      "Unified web tool. operation=scan reads a URL (plain HTTP by default; routes through the bound browser MCP when a tab is given). operation=execute/tabs/screenshot require a browser-class MCP service.",
  },
  {
    name: "update_working_checkpoint",
    description: "Update the working-memory anchor; related_files are file_read paths for later re-reading.",
  },
  {
    name: "start_long_term_update",
    description:
      "Distill a verified experience into long-term memory. The backend decides whether it lands as a stable fact (L2) or a reusable procedure (L3) and adds a short L1 pointer.",
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question or present something for them to see. Pass attachments to register workspace files or public URLs as media the client renders inline.",
  },
  {
    name: "capability_call",
    description:
      "Invoke dynamic MCP or scheduler capabilities by dotted name. Examples: capability_call(name='mail.search_messages') or capability_call(name='scheduler.create'). Available methods are listed in the system prompt.",
  },
]

export async function fetchBuiltinToolsSchema(): Promise<BuiltinToolSchema[]> {
  try {
    const r = await fetch(`${AGENT_BASE}/tools/schema`, { credentials: "include" })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = (await r.json()) as { tools?: Array<{ function?: { name?: string; description?: string } }> }
    const tools: BuiltinToolSchema[] = (data.tools || [])
      .map((t) => ({ name: t.function?.name || "", description: t.function?.description || "" }))
      .filter((t) => t.name)
    if (tools.length === 0) throw new Error("empty schema")
    return tools
  } catch {
    return FALLBACK_BUILTIN_TOOLS
  }
}

export interface AgentConversation {
  id: string
  title: string
  system_prompt: string
  model: string
  llm_model_id?: number | null
  /** Agent bound when the conversation was created; used to build agent submenus. */
  agent_id?: number | null
  /** 会话级设置（node_id、reasoning_effort 等）。 */
  chat_settings?: Record<string, unknown> | null
  status: string
  created_at: string
  updated_at: string
}

export interface AttachmentMediaPart {
  type: "attachment"
  attachment_id?: number
  url?: string
  /** 服务端签发的短时签名 URL（无需登录态）。前端优先用此字段。 */
  content_url?: string
  thumbnail_url?: string
  name?: string
  mime_type?: string
  size?: number
  status?: "active" | "expired" | "purged"
  expires_at?: string
}

export interface AttachmentMeta extends AttachmentMediaPart {
  id: number
  created_at?: string
  last_renewed_at?: string
  renewed_count?: number
  renewable?: boolean
  download_url?: string
  thumbnail_url?: string
}

export interface AgentMessage {
  id: number
  conversation_id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  tool_calls: unknown[] | null
  tool_results: unknown[] | null
  media?: AttachmentMediaPart[] | null
  turn_number: number
  status: "pending" | "streaming" | "done" | "error"
  error: string | null
  /** 该条消息实际使用的模型；历史消息可能为空 */
  model?: string
  /** 模型思考(reasoning)全文；未开思考或旧消息为空。 */
  reasoning?: string
  /** 该轮归一化后的 token usage（输入/输出/缓存/推理）。 */
  usage?: Record<string, number> | null
  created_at: string
}

export type ChatMode = "chat" | "image" | "video" | "tts"

export interface ChatMediaItem {
  type: "image" | "video" | "audio"
  url?: string
  b64?: string
  mimeType?: string
}

export interface ChatSettings {
  mode: ChatMode
  model: string
  apiKeyId: number | null
  temperature: number
  maxTokens: number
  stream: boolean
  systemPrompt: string
  reasoningEffort: "" | "low" | "medium" | "high" | "xhigh"
  imageSize: string
  imageN: number
  videoSize: string
  videoSeconds: number
  ttsVoice: string
  ttsFormat: string
  ttsSpeed: number
}

/**
 * 聊天会话的默认参数。聊天页与「智能任务」快捷入口共用：快捷入口建会话时要写入
 * 完整的 chat_settings（ChatSettings 是全量字段），只覆盖用户选中的 Key/模型。
 */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  mode: "chat",
  model: "",
  apiKeyId: null,
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  systemPrompt: "",
  reasoningEffort: "medium",
  imageSize: "1024x1024",
  imageN: 1,
  videoSize: "1280x720",
  videoSeconds: 8,
  ttsVoice: "alloy",
  ttsFormat: "mp3",
  ttsSpeed: 1.0,
}

export interface ChatConversation {
  id: string
  title: string
  system_prompt: string
  model: string
  status: string
  kind: string
  chat_settings: ChatSettings | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  conversation_id: string
  role: "user" | "assistant" | "system"
  content: string
  status: "pending" | "streaming" | "done" | "error"
  error: string | null
  media: ChatMediaItem[] | null
  /** 该条消息实际使用的模型；历史消息可能为空 */
  model?: string
  created_at: string
}

export interface AvailableModel {
  id: string
  object?: string
  owned_by?: string
  type?: string
  models?: string[]
  name?: string
  remark?: string
  /** 模型最大上下文 token（后端模型元数据透传）。 */
  max_context_tokens?: number
  /** 后端合成的一段说明（上下文窗口 + 能力），用于模型 ID 下方展示。 */
  description?: string
  input_modalities?: string[]
  output_modalities?: string[]
  [k: string]: unknown
}

export interface RuntimeKeyItem {
  id: number
  key_masked: string
  name: string
  vm_id: string | null
  disabled: boolean
  created_at: number | null
}

// ==================== Agent CRUD ====================

export function listAgents(): Promise<AgentInstance[]> {
  return agentFetch<AgentInstance[]>("/agents")
}

export function getAgent(agentId: number): Promise<AgentInstance> {
  return agentFetch<AgentInstance>(`/agents/${agentId}`)
}

export function createAgent(payload: CreateAgentPayload): Promise<AgentInstance> {
  return agentFetch<AgentInstance>("/agents", { method: "POST", body: JSON.stringify(payload) })
}

export function updateAgent(agentId: number, payload: UpdateAgentPayload): Promise<AgentInstance> {
  return agentFetch<AgentInstance>(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(payload) })
}

export function deleteAgent(agentId: number): Promise<{ ok: boolean }> {
  return agentFetch<{ ok: boolean }>(`/agents/${agentId}`, { method: "DELETE" })
}

export function toggleAgent(agentId: number): Promise<{ id: number; enabled: boolean }> {
  return agentFetch<{ id: number; enabled: boolean }>(`/agents/${agentId}/toggle`, { method: "POST" })
}

export function getAgentByMcpUser(principalId: number): Promise<{ agent_id: number | null }> {
  return agentFetch<{ agent_id: number | null }>(`/agents/by-mcp-user/${principalId}`)
}

/** 会话诊断：Agent 生效的 MCP 服务 + 绑定 principal + 参数 + token 类型。 */
export interface AgentMcpDiagnostics {
  agent_id: number
  agent_name: string
  agent_owner_user_id: string | null
  mcp_user_id: number | null
  principal: {
    id: number
    name: string
    usage_type?: "agent" | "external" | "task"
    enabled?: boolean
    token_hint?: string
    token_status?: "active" | "disabled"
    owner_user_id?: string | null
  } | null
  params: Array<{ param_key: string; param_value: string }>
  token_kind: "identity" | "service"
  effective_services: Array<{
    id: number | null
    name: string
    display_name: string
    kind: string | null
    builtin: boolean
    enabled: boolean
    auth_enabled: boolean
    /** 本服务鉴权用的 param_key（cdp-bridge→cdp_client_id 等）；无则 null。 */
    param_key: string | null
    /** 本服务能操控的资源（cdp→浏览器客户端、mail→邮箱账户）。 */
    resources: Array<{ id: number; kind: string; name: string; enabled: boolean }>
    tools: Array<{ name: string; description: string }>
  }>
}

export function getAgentMcpDiagnostics(agentId: number): Promise<AgentMcpDiagnostics> {
  return agentFetch<AgentMcpDiagnostics>(`/agents/${agentId}/mcp-diagnostics`)
}

// ==================== Agent 对话 ====================

export interface ConversationPage<T> {
  items: T[]
  page: { next_cursor: string | null; has_next_page: boolean }
}

export interface ConversationPageParams {
  limit?: number
  cursor?: string | null
  agentId?: number | null
  nodeId?: string | null
  /** 标题关键字；后端做不区分大小写子串过滤，能命中非当前页的历史。 */
  search?: string | null
}

export function listConversations(limit = 50): Promise<AgentConversation[]> {
  return agentFetch<AgentConversation[]>(`/conversations?limit=${limit}`)
}

function normalizeConversationPage<T>(response: ConversationPage<T> | T[]): ConversationPage<T> {
  if (Array.isArray(response)) {
    return {
      items: response,
      page: { next_cursor: null, has_next_page: false },
    }
  }
  return {
    items: Array.isArray(response?.items) ? response.items : [],
    page: {
      next_cursor: response?.page?.next_cursor || null,
      has_next_page: Boolean(response?.page?.has_next_page),
    },
  }
}

export async function listConversationsPage(params: ConversationPageParams = {}): Promise<ConversationPage<AgentConversation>> {
  const query = new URLSearchParams({ paged: "true", limit: String(params.limit ?? 20) })
  if (params.cursor) query.set("cursor", params.cursor)
  if (params.agentId) query.set("agent_id", String(params.agentId))
  if (params.nodeId) query.set("node_id", params.nodeId)
  if (params.search && params.search.trim()) query.set("search", params.search.trim())
  const response = await agentFetch<ConversationPage<AgentConversation> | AgentConversation[]>(`/conversations?${query}`)
  return normalizeConversationPage(response)
}

export function createConversation(payload: {
  title?: string
  system_prompt?: string
  model?: string
  llm_model_id?: number | null
  agent_id?: number
  node_id?: string
  context?: "marketplace_admin" | "code_channel"
  reasoning_effort?: string
}): Promise<AgentConversation> {
  return agentFetch<AgentConversation>("/conversations", { method: "POST", body: JSON.stringify(payload) })
}

export interface ConversationMessagesPage {
  messages: AgentMessage[]
  page: { next_cursor: number | null; has_more: boolean }
}

export function listConversationMessagesPage(convId: string, cursor?: number | null, limit = 7): Promise<ConversationMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor != null) query.set("cursor", String(cursor))
  return agentFetch(`/conversations/${convId}/messages?${query}`)
}

export function listChatConversationMessagesPage(convId: string, cursor?: number | null, limit = 7): Promise<ConversationMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor != null) query.set("cursor", String(cursor))
  return agentFetch(`/chat/conversations/${convId}/messages?${query}`)
}

export function getConversationMeta(convId: string): Promise<AgentConversation> {
  return agentFetch(`/conversations/${convId}/meta`)
}

export function getChatConversationMeta(convId: string): Promise<ChatConversation> {
  return agentFetch(`/chat/conversations/${convId}/meta`)
}

export function getConversation(convId: string): Promise<{
  conversation: AgentConversation
  messages: AgentMessage[]
}> {
  return agentFetch(`/conversations/${convId}`)
}

export function deleteConversation(convId: string): Promise<{ deleted: boolean }> {
  return agentFetch(`/conversations/${convId}`, { method: "DELETE" })
}

export function batchDeleteConversations(ids: string[]): Promise<{ deleted: number; not_found: string[] }> {
  return agentFetch("/conversations/batch-delete", { method: "POST", body: JSON.stringify({ ids }) })
}

export function updateConversation(
  convId: string,
  payload: { title?: string; system_prompt?: string; model?: string; llm_model_id?: number | null; reasoning_effort?: string },
): Promise<AgentConversation> {
  return agentFetch<AgentConversation>(`/conversations/${convId}`, { method: "PATCH", body: JSON.stringify(payload) })
}

export function abortConversation(convId: string): Promise<{ aborted: boolean }> {
  return agentFetch(`/conversations/${convId}/abort`, { method: "POST" })
}

export function getAttachmentMeta(attachmentId: number): Promise<AttachmentMeta> {
  return agentFetch<AttachmentMeta>(`/attachments/${attachmentId}`)
}

export function renewAttachment(attachmentId: number): Promise<AttachmentMeta> {
  return agentFetch<AttachmentMeta>(`/attachments/${attachmentId}/renew`, { method: "POST" })
}

// ==================== 会话附件上传 ====================

export interface ConversationAttachment {
  /** 落盘相对路径（agent 会话相对其工作区；聊天相对 agent/temp）。 */
  path: string
  filename: string
  size: number
  mime?: string
  /** 图片：可直接作 OpenAI image_url content part 的 data URL（仅聊天返回）。 */
  data_url?: string
  /** 文本类文件的 UTF-8 内容（仅聊天返回）。 */
  text?: string
}

/**
 * Agent 会话附件：落到该 Agent 的工作区，运行时用 file 工具读。
 * Content-Type 用文件真实 mime，后端据此判断类型。
 */
export function uploadAgentConversationAttachment(
  convId: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<ConversationAttachment> {
  return uploadFileWithProgress<ConversationAttachment>(
    `${AGENT_BASE}/conversations/${convId}/attachments?filename=${encodeURIComponent(file.name)}`,
    file,
    onProgress,
  )
}

/**
 * 聊天会话附件：落到 temp 目录，并按类型回 data_url（图片）/ text（文本），
 * 供前端拼进消息一起发给 LLM——聊天没有工作区也没有文件工具。
 */
export function uploadChatConversationAttachment(
  convId: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<ConversationAttachment> {
  return uploadFileWithProgress<ConversationAttachment>(
    `${AGENT_BASE}/chat/conversations/${convId}/attachments?filename=${encodeURIComponent(file.name)}`,
    file,
    onProgress,
  )
}

/**
 * 发送 Agent 消息并通过 SSE 流式接收响应。每个 SSE data 行是一个 JSON 事件。
 * 返回 fetch Response promise + abort。
 */
/**
 * 执行模式。auto 目前的执行语义与 interact 相同（一问一答）；「哪些操作可以免审批」
 * 需要一套按操作分级的风险判定，尚在调研中，因此后端暂未放宽任何审批门槛。
 */
export type AgentExecutionMode = "interact" | "plan" | "goal" | "auto"

export interface AgentGoalConfig {
  objective: string
  budget_seconds: number
  max_turns?: number
}

export function sendMessageStream(
  convId: string,
  content: string,
  maxTurns?: number,
  terminalContext?: { cwd?: string; terminal_id?: string; recent_lines?: string[] },
  reasoningEffort?: string,
  mode: AgentExecutionMode = "interact",
  goalConfig?: AgentGoalConfig,
): { response: Promise<Response>; abort: () => void } {
  const controller = new AbortController()
  const response = fetch(`${AGENT_BASE}/conversations/${convId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      max_turns: maxTurns,
      terminal_context: terminalContext,
      reasoning_effort: reasoningEffort,
      mode,
      goal_config: goalConfig,
    }),
    signal: controller.signal,
  })
  return { response, abort: () => controller.abort() }
}

// ==================== 节点命令审批 ====================

/** 一条挂起中的节点命令审批（后端 approval_registry 的投影）。 */
export interface NodeApproval {
  confirmation_id: string
  conversation_id: string
  node_id: string
  tool_name: string
  command: string
  command_hash: string
  requester: string | null
  created_at: number
  expires_at: number
  resolved: string | null
}

/** 批准或拒绝一条挂起的节点命令；command_hash 防止批准到被改写的命令。 */
export function resolveApproval(
  convId: string,
  confirmationId: string,
  result: "allow" | "deny",
  commandHash?: string,
): Promise<{ ok: boolean; confirmation_id: string; result: string }> {
  return agentFetch(`/conversations/${convId}/approvals/${confirmationId}`, {
    method: "POST",
    body: JSON.stringify({ result, command_hash: commandHash || "" }),
  })
}

/** 断线重连后取回仍挂起的审批。 */
export function listApprovals(convId: string): Promise<{ approvals: NodeApproval[] }> {
  return agentFetch(`/conversations/${convId}/approvals`)
}

// ==================== 聊天历史（kind='chat'）====================

export function listChatConversations(limit = 50): Promise<ChatConversation[]> {
  return agentFetch<ChatConversation[]>(`/chat/conversations?limit=${limit}`)
}

export async function listChatConversationsPage(params: Pick<ConversationPageParams, "limit" | "cursor"> = {}): Promise<ConversationPage<ChatConversation>> {
  const query = new URLSearchParams({ paged: "true", limit: String(params.limit ?? 20) })
  if (params.cursor) query.set("cursor", params.cursor)
  const response = await agentFetch<ConversationPage<ChatConversation> | ChatConversation[]>(`/chat/conversations?${query}`)
  return normalizeConversationPage(response)
}

export function createChatConversation(payload: {
  title?: string
  system_prompt?: string
  model?: string
  chat_settings?: ChatSettings
}): Promise<ChatConversation> {
  return agentFetch<ChatConversation>("/chat/conversations", { method: "POST", body: JSON.stringify(payload) })
}

export function getChatConversation(convId: string): Promise<{
  conversation: ChatConversation
  messages: ChatMessage[]
}> {
  return agentFetch(`/chat/conversations/${convId}`)
}

export function deleteChatConversation(convId: string): Promise<{ deleted: boolean }> {
  return agentFetch(`/chat/conversations/${convId}`, { method: "DELETE" })
}

export function batchDeleteChatConversations(ids: string[]): Promise<{ deleted: number; not_found: string[] }> {
  return agentFetch("/chat/conversations/batch-delete", { method: "POST", body: JSON.stringify({ ids }) })
}

export function updateChatConversation(
  convId: string,
  payload: { title?: string; system_prompt?: string; model?: string; chat_settings?: ChatSettings },
): Promise<ChatConversation> {
  return agentFetch<ChatConversation>(`/chat/conversations/${convId}`, { method: "PATCH", body: JSON.stringify(payload) })
}

export function appendChatMessage(
  convId: string,
  payload: {
    role: string
    content: string
    status?: string
    error?: string | null
    media?: ChatMediaItem[] | null
    model?: string
  },
): Promise<ChatMessage> {
  return agentFetch<ChatMessage>(`/chat/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** 软删一条聊天消息。前端驱动聊天重试失败轮时清掉残留 error assistant 消息。 */
export function deleteChatMessage(convId: string, messageId: string | number): Promise<{ deleted: boolean }> {
  return agentFetch(`/chat/conversations/${convId}/messages/${messageId}`, { method: "DELETE" })
}

/** 重试一条失败的 agent 会话 assistant 消息：返回 SSE 流（同 send 形态）。 */
export function retryConversationMessage(
  convId: string,
  messageId: string | number,
): { response: Promise<Response>; abort: () => void } {
  const controller = new AbortController()
  const response = fetch(`${AGENT_BASE}/conversations/${convId}/messages/${messageId}/retry`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  })
  return { response, abort: () => controller.abort() }
}

// ==================== 可用模型（按 api_key_id 过滤，含自定义模型）====================

export async function listChatModels(apiKeyId: number, signal?: AbortSignal): Promise<AvailableModel[]> {
  const data = await agentFetch<{ object: string; data: AvailableModel[] }>(
    `/chat/models?api_key_id=${apiKeyId}`,
    signal ? { signal } : undefined,
  )
  return data.data || []
}

/** 任务/编辑器选择器统一使用的按 Key 模型选项。 */
export async function listRuntimeModelOptions(apiKeyId: number, signal?: AbortSignal): Promise<Array<{ value: string; label: string }>> {
  const models = await listChatModels(apiKeyId, signal)
  return models
    .map((item) => {
      const id = String(item.id || "").trim()
      return id ? { value: id, label: String(item.name || item.remark || id) } : null
    })
    .filter((item): item is { value: string; label: string } => item !== null)
}

// ==================== 聊天发送（服务端调主链路，前端只传 api_key_id）====================

/**
 * 文本对话流式发送。前端传 api_key_id（整数），不碰明文 key。
 * 返回 fetch Response promise + abort，SSE 与 OpenAI /v1/chat/completions 一致。
 */
export function chatSendStream(payload: {
  api_key_id: number
  model: string
  messages: Array<{ role: string; content: unknown }>
  temperature?: number
  max_tokens?: number
  reasoning_effort?: string
}): { response: Promise<Response>; abort: () => void } {
  const controller = new AbortController()
  const response = fetch(`${AGENT_BASE}/chat/send`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
    signal: controller.signal,
  })
  return { response, abort: () => controller.abort() }
}

/** 非流式文本对话（一次性 JSON）。 */
export function chatSendOnce(payload: {
  api_key_id: number
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  max_tokens?: number
  reasoning_effort?: string
}): Promise<Record<string, unknown>> {
  return agentFetch("/chat/send", {
    method: "POST",
    body: JSON.stringify({ ...payload, stream: false }),
  })
}

/** 图片 / 视频 / 语音生成。 */
export function chatMedia(payload: {
  api_key_id: number
  mode: "image" | "video" | "tts"
  model: string
  prompt?: string
  input?: string
  size?: string
  n?: number
  seconds?: number
  voice?: string
  response_format?: string
  speed?: number
}): Promise<Record<string, unknown>> {
  return agentFetch("/chat/media", { method: "POST", body: JSON.stringify(payload) })
}

// ==================== 用户 LLM 模型（Agent 用，供 Agent 管理选模型）====================
// 复用 admin 的 /agent/llm-models（enabled_only）；用户侧 Agent 管理用它选主/子模型。

export interface LlmModelOption {
  id: number
  llm_config_id: number
  model_name: string
  display_name?: string
  enabled: boolean
  config_name?: string
  config_enabled?: boolean
}

export function listLlmModels(enabledOnly = true): Promise<LlmModelOption[]> {
  return agentFetch<LlmModelOption[]>(`/llm-models?enabled_only=${enabledOnly}`)
}

// ==================== Agent 可挂载的 MCP 服务（按来源分组）====================

export type AvailableMcpSource = "builtin" | "admin" | "upstream"

export interface AvailableMcpItem {
  id: number
  name: string
  display_name: string
  source: AvailableMcpSource
  kind: string
  tool_count: number
  enabled: boolean
  description: string
}

export interface AvailableMcpResponse {
  builtin: AvailableMcpItem[]
  admin: AvailableMcpItem[]
  upstream: AvailableMcpItem[]
}

export function listAvailableMcp(): Promise<AvailableMcpResponse> {
  return agentFetch<AvailableMcpResponse>("/available-mcp")
}

// ==================== 可用 API Key（只返回 id + 脱敏，供选择器）====================
// 复用 monkeycode 已有端点 /api/v1/users/model-gateway/runtime-keys。

export async function listRuntimeKeys(): Promise<RuntimeKeyItem[]> {
  const r = await fetch("/api/v1/users/model-gateway/runtime-keys", {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  return Array.isArray(data) ? data : data?.data || data?.rows || []
}

// 平台代配的系统 Key（user_id 为 NULL，靠分组绑定授权给成员使用）。这些 Key
// 不属于个人，故不在 runtime-keys（WHERE user_id=? ）里，需单独拉取后并入选择器。
export async function listSystemKeys(): Promise<RuntimeKeyItem[]> {
  const r = await fetch("/api/v1/users/model-gateway/system-keys", {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  const rows: Array<Record<string, unknown>> = Array.isArray(data) ? data : data?.data || data?.rows || []
  // SystemKeyItem 只有 id/key_masked/name/disabled，补齐 RuntimeKeyItem 缺省字段。
  return rows.map((row) => ({
    id: Number(row.id),
    key_masked: String(row.key_masked ?? ""),
    name: String(row.name ?? ""),
    vm_id: null,
    disabled: Boolean(row.disabled),
    created_at: null,
  }))
}

// 选择器可用的全部 Key：自有 runtime key + 分组授权的系统 key（按 id 去重）。
export async function listUsableKeys(): Promise<RuntimeKeyItem[]> {
  const [own, system] = await Promise.all([
    listRuntimeKeys().catch(() => [] as RuntimeKeyItem[]),
    listSystemKeys().catch(() => [] as RuntimeKeyItem[]),
  ])
  const byId = new Map<number, RuntimeKeyItem>()
  for (const k of [...own, ...system]) {
    if (!byId.has(k.id)) byId.set(k.id, k)
  }
  return Array.from(byId.values())
}

// ==================== 定时任务（Agent Scheduled Tasks）====================
// 后端 /agent/scheduled-tasks*（agent/api.py）。任务两种：
// - prompt：到点把 task_prompt 交给 Agent 跑；
// - script：到点执行 script_code（Python/PowerShell 子进程，复用 code_run 执行体），
//   非零退出码按 on_error 触发 AI 诊断/修复/重跑。脚本任务必须人工授权（approve-script
//   写 approved_hash）才会执行——approved_hash 为空即待授权，后端拒跑。

export type ScheduledTaskKind = "prompt" | "script"
export type ScheduledTaskScriptType = "python" | "powershell"
export type ScheduledTaskOnError = "none" | "diagnose" | "diagnose_fix_retry"

/** 列表项：不含 script_code（体积大，明细走 getScheduledTask）。 */
export interface ScheduledTaskListItem {
  id: number
  name: string
  cron_expression: string
  task_kind: ScheduledTaskKind
  enabled: boolean
  agent_id?: number | null
  user_id?: string | null
  last_run_at?: string | null
  next_run_at?: string | null
  last_result?: string | null
  last_exit_code?: number | null
  consecutive_failures?: number | null
  background?: string | null
  on_error?: ScheduledTaskOnError
  script_type?: ScheduledTaskScriptType
  allow_ai_script_fix?: boolean
  /** 授权过的脚本哈希；空 = 待授权（脚本任务拒跑）。 */
  approved_hash?: string | null
  /** 有 AI 待授权的修复脚本。 */
  has_pending_fix?: boolean
  /** 任务级模型覆盖；空 = 用 Agent 的定时任务默认（再空则主 Agent）。 */
  api_key_id?: number | null
  model?: string | null
  created_at?: string
}

/** 单条明细：含脚本正文与自愈历史。 */
export interface ScheduledTaskDetail extends ScheduledTaskListItem {
  task_prompt?: string | null
  script_code?: string | null
  script_timeout?: number | null
  pending_script_code?: string | null
  pending_script_hash?: string | null
  heal_history?: Array<{ at?: string; exit_code?: number | null; diagnosis?: string; applied?: boolean }>
}

export interface CreateScheduledTaskPayload {
  name: string
  cron_expression: string
  agent_id?: number | null
  enabled?: boolean
  task_kind?: ScheduledTaskKind
  task_prompt?: string
  script_code?: string
  script_type?: ScheduledTaskScriptType
  script_timeout?: number
  background?: string
  on_error?: ScheduledTaskOnError
  allow_ai_script_fix?: boolean
  /** 任务级模型覆盖（prompt 模式）。留空 → Agent 的 scheduled_* → 主 Agent。 */
  api_key_id?: number | null
  model?: string
}

export type UpdateScheduledTaskPayload = Partial<
  Pick<
    CreateScheduledTaskPayload,
    | "name"
    | "cron_expression"
    | "enabled"
    | "task_prompt"
    | "script_code"
    | "script_type"
    | "script_timeout"
    | "background"
    | "on_error"
    | "allow_ai_script_fix"
    | "api_key_id"
    | "model"
  >
>

export interface CreateScheduledTaskResult {
  id: number
  name: string
  cron_expression: string
  task_kind: ScheduledTaskKind
  /** 脚本任务创建后必然待授权：前端据此弹授权引导。 */
  needs_approval?: boolean
}

export function listScheduledTasks(): Promise<ScheduledTaskListItem[]> {
  return agentFetch<ScheduledTaskListItem[]>("/scheduled-tasks")
}

export function getScheduledTask(jobId: number): Promise<ScheduledTaskDetail> {
  return agentFetch<ScheduledTaskDetail>(`/scheduled-tasks/${jobId}`)
}

export function createScheduledTask(payload: CreateScheduledTaskPayload): Promise<CreateScheduledTaskResult> {
  return agentFetch<CreateScheduledTaskResult>("/scheduled-tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateScheduledTask(jobId: number, payload: UpdateScheduledTaskPayload): Promise<ScheduledTaskDetail> {
  return agentFetch<ScheduledTaskDetail>(`/scheduled-tasks/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteScheduledTask(jobId: number): Promise<{ deleted: boolean }> {
  return agentFetch<{ deleted: boolean }>(`/scheduled-tasks/${jobId}`, { method: "DELETE" })
}

export function runScheduledTaskNow(jobId: number): Promise<{ triggered: boolean }> {
  return agentFetch<{ triggered: boolean }>(`/scheduled-tasks/${jobId}/run`, { method: "POST" })
}

export function toggleScheduledTask(jobId: number): Promise<{ id: number; enabled: boolean }> {
  return agentFetch<{ id: number; enabled: boolean }>(`/scheduled-tasks/${jobId}/toggle`, { method: "POST" })
}

export function approveScheduledTaskScript(jobId: number): Promise<{ approved: boolean; id: number }> {
  return agentFetch<{ approved: boolean; id: number }>(`/scheduled-tasks/${jobId}/approve-script`, { method: "POST" })
}

// ── 定时任务执行记录（agent_scheduled_task_runs）────────────────────────
// 每次执行一行：scheduler=到点、manual=立即运行、heal=脚本报错后的 AI 自愈。
// prompt/heal 执行的 Agent 对话落 ClickHouse（kind="scheduled"），详情页拿
// conversation_id 走既有 /conversations/{conv_id} 端点渲染。

export type ScheduledTaskRunTrigger = "scheduler" | "manual" | "heal"
export type ScheduledTaskRunStatus = "running" | "completed" | "failed" | "blocked" | "aborted"

/** 列表项：不含 stdout/stderr（体积大），详情走 getScheduledTaskRun。 */
export interface ScheduledTaskRunListItem {
  id: number
  run_at: string
  task_kind: ScheduledTaskKind
  triggered_by: ScheduledTaskRunTrigger
  status: ScheduledTaskRunStatus
  exit_code: number | null
  duration_ms: number | null
  /** result_text 前 200 字符摘要。 */
  result_snippet: string | null
  /** 有值 = 该次执行的 Agent 对话可回放（走 /conversations/{id}）。 */
  conversation_id: string | null
}

export interface ScheduledTaskRunDetail extends ScheduledTaskRunListItem {
  job_id: number
  /** 脚本执行的标准输出（服务端已截断到 16KB）。 */
  stdout: string | null
  stderr: string | null
  result_text: string | null
  error: string | null
}

export function listScheduledTaskRuns(
  jobId: number, cursor?: number | null, limit = 50,
): Promise<ScheduledTaskRunListItem[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor != null) query.set("cursor", String(cursor))
  return agentFetch<ScheduledTaskRunListItem[]>(`/scheduled-tasks/${jobId}/runs?${query}`)
}

export function getScheduledTaskRun(jobId: number, runId: number): Promise<ScheduledTaskRunDetail> {
  return agentFetch<ScheduledTaskRunDetail>(`/scheduled-tasks/${jobId}/runs/${runId}`)
}
