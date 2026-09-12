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

/** 节点升级/编辑器安装升级是节点上跑官方命令的长 RPC（数分钟），与管理端
 * axios 客户端的 620s 超时同口径——fetch 默认无超时，靠 AbortController 兜住。 */
async function reviewFetchLong<T>(path: string, init?: RequestInit, timeoutMs = 620_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await reviewFetch<T>(path, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时：节点仍在执行，请稍后刷新查看结果")
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
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

export function installNodeEditor(nodeId: string, editor: string): Promise<{ node_id: string; editor: string; action: string; version: string }> {
  return reviewFetchLong(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/install`, { method: "POST" })
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

/** 用户侧代理池精简视图：只返回 id+name+mode，不暴露地址/凭据。 */
export interface TeamProxyEntry {
  id: string
  name: string
  mode: string
}

export function listTeamProxies(): Promise<TeamProxyEntry[]> {
  return reviewFetch<TeamProxyEntry[]>(`/api/v1/teams/proxies`)
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

// ==================== 用户侧执行节点运行时管理 =====================
//
// 删除/统一升级/编辑器升级/升级代理原来只在管理端；后端已按同样口径开出
// /api/v1/teams/nodes/* 通道（user_can_use_node 派生管理权 + 仅执行节点硬闸）。
// 形状与管理端 @/@admin-port/api/nodes 的同名接口一致，方便组件按 admin 范本复刻。

/** 节点/服务端算好的版本判定里的一条版本线。 */
export interface UserNodeVersionLine {
  current: string
  latest: string
  installed: boolean
  needs_upgrade: boolean
}

/** 节点详情接口的版本判定块（节点程序与 runtime 两条独立版本线）。 */
export interface UserNodeUpgradeStatus {
  stale: boolean
  node_program: UserNodeVersionLine
  runtime: UserNodeVersionLine
  can_upgrade: boolean
}

/** detail 接口返回的节点行（管理端 admin/nodes/{id} 同形：role/capabilities/connected）。 */
export interface UserNodeDetailNode {
  node_id: string
  node_name: string
  status: string
  role: string
  is_passive?: boolean
  connected: boolean
  online?: boolean
  capabilities: Record<string, string>
}

export interface UserNodeDetailResponse {
  node: UserNodeDetailNode
  upgrade: UserNodeUpgradeStatus
}

/** GET /api/v1/teams/nodes/{id} —— 单节点详情 + 服务端版本判定。 */
export function getUserNodeDetail(nodeId: string): Promise<UserNodeDetailResponse> {
  return reviewFetch<UserNodeDetailResponse>(`/api/v1/teams/nodes/${encodeURIComponent(nodeId)}`)
}

/** version.json 里的一条发行资产（runtime 或节点程序）。 */
export interface UserNodeReleaseAsset {
  role: string
  platform: string
  arch: string
  version: string
  filename: string
  download_url: string
  digest: string
  size_bytes: number
}

/** GET /api/v1/teams/nodes/latest-release —— 服务端缓存的最新节点发行版本。 */
export interface UserNodeLatestRelease {
  version: string
  version_notes: string
  release_tag: string
  updated_at: string
  stale: boolean
  assets: UserNodeReleaseAsset[]
  coverage: UserNodeReleaseAsset[]
}

export function getLatestUserNodeRelease(): Promise<UserNodeLatestRelease> {
  return reviewFetch<UserNodeLatestRelease>(`/api/v1/teams/nodes/latest-release`).then((data) => {
    const assets = Array.isArray(data?.assets) ? data.assets : []
    const coverage = Array.isArray(data?.coverage) && data.coverage.length > 0 ? data.coverage : assets
    return { ...data, assets, coverage }
  })
}

/** GET /api/v1/teams/nodes/{id}/upgrade-defaults —— 上次成功升级用的代理预选。 */
export function getUserNodeUpgradeDefaults(nodeId: string): Promise<{ last_proxy_id: string }> {
  return reviewFetch<{ last_proxy_id: string }>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/upgrade-defaults`,
  )
}

/** 统一升级下发结果：runtime 与节点程序两步各自回报（缺资产则为 null）。 */
export interface UserUpgradeNodeResult {
  node_id: string
  accepted: boolean
  runtime: { target_version: string; download_url: string } | null
  node: { target_version: string; download_url: string } | null
}

/** POST /api/v1/teams/nodes/{id}/upgrade —— 统一升级（Runtime 热切换 + 节点程序替换）。 */
export function upgradeUserNode(
  nodeId: string,
  options: { proxyConfigId?: string } = {},
): Promise<UserUpgradeNodeResult> {
  return reviewFetchLong<UserUpgradeNodeResult>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/upgrade`,
    { method: "POST", body: JSON.stringify({ proxy_config_id: options.proxyConfigId || "" }) },
  )
}

/** POST /api/v1/teams/nodes/{id}/editors/{editor}/upgrade —— 升级已安装的编辑器 CLI。 */
export function upgradeUserNodeEditor(
  nodeId: string,
  editor: string,
): Promise<{ node_id: string; editor: string; action: string; version: string }> {
  return reviewFetchLong(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/upgrade`,
    { method: "POST" },
  )
}

/** 节点绑定的出口代理（不含地址/凭据，仅 id + 解析后的模式）。 */
export interface UserNodeProxyConfig {
  revision: string | number
  proxy_mode: string
  proxy_config_id: string
}

/** GET /api/v1/teams/nodes/{id}/proxy-config —— 读取节点升级代理绑定。 */
export function getUserNodeProxyConfig(nodeId: string): Promise<UserNodeProxyConfig> {
  return reviewFetch<UserNodeProxyConfig>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/proxy-config`,
  )
}

/** PUT /api/v1/teams/nodes/{id}/proxy-config —— 更新节点升级代理并推送在线节点。 */
export function updateUserNodeProxyConfig(
  nodeId: string,
  proxyConfigId: string,
): Promise<UserNodeProxyConfig> {
  return reviewFetch<UserNodeProxyConfig>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}/proxy-config`,
    { method: "PUT", body: JSON.stringify({ proxy_config_id: proxyConfigId || "" }) },
  )
}

/** DELETE /api/v1/teams/nodes/{id} —— 删除执行节点（pending 撤销入驻 / 其余硬删除）。 */
export function deleteUserNode(nodeId: string): Promise<{ deleted: boolean; revoked?: boolean }> {
  return reviewFetch<{ deleted: boolean; revoked?: boolean }>(
    `/api/v1/teams/nodes/${encodeURIComponent(nodeId)}`,
    { method: "DELETE" },
  )
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
