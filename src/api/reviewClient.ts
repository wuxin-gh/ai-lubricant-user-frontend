import type { NodeInfo } from "@/api/nodes"

export interface ReviewToolState {
  installed: boolean
  version?: string | null
  capability_key?: string
}

export interface ReviewNodeInfo extends NodeInfo {
  review_capabilities: Record<string, ReviewToolState>
  review_missing: string[]
  review_capacity: number
  review_in_use: number
  review_ready: boolean
  review_schedulable: boolean
  review_reason: string
}

export interface ReviewFrameworkInfo {
  name: string
  label: string
  description: string
  base_tools: string[]
  supported_editors: string[]
}

export interface ProjectWebhookConfig {
  id: string
  project_id: string
  platform: string
  hook_id?: string | null
  callback_url: string
  secret_masked?: string | null
  has_secret?: boolean
  events: string[]
  active: boolean
  review_executor: string
  review_framework: string
  /** Canonical review CLI/provider (claude/opencode; codex requires bootstrap identity). */
  review_provider?: string | null
  /** Manual candidate execution nodes; empty when review_auto is true. */
  review_node_ids: string[]
  /** Optional session overlays; the worker adds its review skill/MCP automatically. */
  review_skill_config: Array<Record<string, unknown>>
  review_mcp_config: Array<Record<string, unknown>>
  review_plugin_config: Array<Record<string, unknown>>
  /** Legacy editor-template picks kept only while deployed rows are lazily drained. */
  review_editor_ids?: string[]
  /** Automatic mode: worker picks among the user's available execution nodes. */
  review_auto: boolean
  review_enabled: boolean
  review_model_id?: string | null
  /** Per-review runtime prompt id, resolved to content at dispatch time. */
  review_prompt_id?: string | null
  review_api_key_id?: number | null
  review_model_limits: Record<string, number>
  /** Per-review child-key rate limits (rpm/tpm/concurrent/max_ips …). */
  review_rate_limit?: Record<string, number>
  /** Per-review child-key expiry, epoch seconds; null = inherit parent. */
  review_expires_at?: number | null
  review_max_concurrency: number
  review_latest_only: boolean
  last_error?: string | null
}

export interface ReviewEventSummary {
  id: string
  event_type: string
  delivery_id: string
  status: string
  pr_number?: string | null
  commit_sha?: string | null
  source_branch?: string | null
  target_branch?: string | null
  task_id?: string | null
  attempts: number
  last_error?: string | null
  finding_count: number
  review_summary?: string | null
  created_at?: number | null
  review_completed_at?: number | null
}

export interface ProjectWebhookStatus {
  /** null until the project has a webhook configured. */
  webhook: ProjectWebhookConfig | null
  inflight: number
  max_concurrency: number
  events: ReviewEventSummary[]
}

async function reviewFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.detail
    const message = typeof detail === "string"
      ? detail
      : detail?.code === "review_nodes_unavailable"
        ? "review_nodes_unavailable"
        : body?.message || `HTTP ${response.status}`
    const error = new Error(message)
    ;(error as Error & { detail?: unknown }).detail = detail
    throw error
  }
  return body as T
}

export function getProjectWebhook(projectId: string): Promise<ProjectWebhookConfig | null> {
  return reviewFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook`)
}

export function getProjectWebhookStatus(projectId: string): Promise<ProjectWebhookStatus> {
  return reviewFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook/status`)
}

export function listReviewFrameworks(projectId: string): Promise<{ frameworks: ReviewFrameworkInfo[] }> {
  return reviewFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook/frameworks`)
}

export function saveProjectWebhook(
  projectId: string,
  config: Partial<ProjectWebhookConfig>,
  exists: boolean,
): Promise<ProjectWebhookConfig> {
  return reviewFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook`, {
    method: exists ? "PATCH" : "POST",
    body: JSON.stringify(config),
  })
}

/** 重新计算当前回调地址并同步到 Git 平台，持久化新 URL（修复 origin 变更等场景）。 */
export function resyncProjectWebhookCallback(projectId: string): Promise<ProjectWebhookConfig> {
  return reviewFetch(
    `/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook/resync-callback`,
    { method: "POST" },
  )
}

export function listProjectReviewNodes(
  projectId: string,
  framework: string,
  editorProvider: string,
): Promise<{ framework: ReviewFrameworkInfo; editor_provider: string; nodes: ReviewNodeInfo[] }> {
  const query = new URLSearchParams({ framework, editor_provider: editorProvider })
  return reviewFetch(`/api/v1/users/projects/${encodeURIComponent(projectId)}/webhook/review-nodes?${query}`)
}

export function installNodeEditor(nodeId: string, editor: string): Promise<unknown> {
  return reviewFetch(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/install`, { method: "POST" })
}

export function installNodeTool(nodeId: string, tool: string): Promise<unknown> {
  return reviewFetch(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/tools/${encodeURIComponent(tool)}/install`, { method: "POST" })
}

/** 在分组的管理节点下新增执行节点：服务端 onboard + dispatch 自动拉起。 */
export interface CreateGroupExecutionNodeResult {
  node_id: string
  secret?: string
  install_command?: string
  launched?: boolean
  node?: unknown
}

export function createGroupExecutionNode(
  groupId: string,
  body: { startup_method?: string; node_name?: string; proxy_config_id?: string },
): Promise<CreateGroupExecutionNodeResult> {
  return reviewFetch(`/api/v1/teams/groups/${encodeURIComponent(groupId)}/execution-nodes`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** 成员侧审批节点（权限：user_can_use_node 派生管理权）。 */
export function approveGroupNode(nodeId: string): Promise<unknown> {
  return reviewFetch(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/approve`, { method: "POST" })
}

/** 节点上一个命名共享环境（用户侧只读视图，归属该节点）。 */
export interface MyNodeEnvironment {
  env_id: string
  name: string
}

/** 列出某节点上已命名的共享环境，供任务表单在 shared 档选择。 */
export function listMyNodeEnvironments(nodeId: string): Promise<MyNodeEnvironment[]> {
  return reviewFetch<{ environments: MyNodeEnvironment[] }>(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/environments`)
    .then((res) => res.environments ?? [])
}
