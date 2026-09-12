import { type DomainStackProfile } from "@/api/Api"
import { invalidateMarketCache } from "@/api/marketplaceRaw"

export type MarketplaceModule = "mcp" | "plugins" | "skills" | "channels" | "prompts" | "node-versions" | "mobile-versions" | "device-control-versions"

export type MarketplaceItem = {
  id: string
  module?: MarketplaceModule
  kind?: string
  name?: string
  display_name?: string
  summary?: string
  publisher?: string
  category?: string
  tags?: string[]
  latest_version?: string
  status?: string
}

export type MarketplaceManifest = MarketplaceItem & {
  version?: string
  description?: string
  source_url?: string
  download_url?: string
  digest?: string
  resource?: Record<string, unknown>
  compatibility?: { providers?: string[] }
  versions?: Array<Record<string, unknown>>
  /** 下载方式：github_clone=节点直连 Git；server_mirror=优先服务端镜像下发。缺省=服务端自动。 */
  install_method?: "" | "github_clone" | "server_mirror"
  // node-versions 专属字段（顶层平铺，与服务端 validator 一致）
  component?: "node" | "agent-compose" | "editor-cli"
  platform?: "windows" | "linux" | "darwin"
  arch?: "amd64" | "arm64"
  channel?: "stable" | "beta" | "rc" | "dev"
  minimum_node_version?: string
  release_notes?: string
}

export type MarketplaceStatus = {
  /** 市场可看：仓库地址已配好。读公开仓库 raw 不需要凭据。 */
  enabled: boolean
  /** 市场可管：额外配了 github_token。只有市场管理员需要，决定管理页/导航是否出现。 */
  writable: boolean
  modules: MarketplaceModule[]
  owner?: string
  repo?: string
  branch?: string
  /** 规范化后的仓库主页地址，用于展示与跳转。 */
  repo_url?: string
}

const BASE = "/api/v1/marketplace"

/**
 * 解析后端错误体——两种信封都认：
 *  - FastAPI 原生：`{detail: "..."}`（字符串）或 `{detail: {...}}`（对象，如 manifest
 *    校验带 errors，或 RequestValidationError 的 detail 数组）；
 *  - 全局 OpenAI 风格信封：`{error: {message, type, code}}`（main.openai_http_exception_handler
 *    把所有 HTTPException 转成这个形状，没有 detail 字段）。
 * 只看 detail 时信封错误会丢真实消息、只剩「HTTP xxx」。
 */
function adminErrorMessage(body: any, status: number): string {
  const detail = body?.detail
  if (typeof detail === "string") return detail
  if (detail && typeof detail === "object") {
    const errs = Array.isArray(detail.errors) && detail.errors.length > 0
      ? detail.errors.map((e: unknown) => typeof e === "string" ? e : JSON.stringify(e)).join("；")
      : ""
    let head: string
    if (typeof detail.error === "object" && typeof detail.error?.message === "string") head = detail.error.message
    else if (typeof detail.error === "string") head = detail.error
    else if (typeof detail.message === "string") head = detail.message
    else head = JSON.stringify(detail)
    return errs ? `${head}：${errs}` : head
  }
  if (typeof body?.error?.message === "string") return body.error.message
  if (typeof body?.message === "string") return body.message
  return `HTTP ${status}`
}

/**
 * 上传 job 已被服务端清掉（进程重启或超 30 分钟过期）。前端据此改走整包重传，
 * 用本组件仍持有的表单与文件重新 POST，而不是把用户卡在失败态让他重开弹框。
 */
export class UploadJobGoneError extends Error {
  constructor(message: string) { super(message); this.name = "UploadJobGoneError" }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body as T
}

export function fetchMarketplaceStatus(): Promise<MarketplaceStatus> {
  return request<MarketplaceStatus>("/status")
}

// ── 节点公网 IP 探测备份（市场管理 → 节点公网 IP tab）──────────────────────────
//
// 备份存 DB 主配置 blob（node_public_ip key），与「全局配置 → 节点网络」互不关联——
// 全局配置仍是节点在用的唯一真相源。「同步市场数据」按钮与 diff 在全局配置 →
// 节点网络 tab 内（那里拿节点在用配置与本备份比对，点击把备份追加进编辑器）。

export type NodeIpBackupConfig = {
  ipv4_urls: string[]
  ipv6_urls: string[]
  default_ipv4_urls: string[]
  default_ipv6_urls: string[]
}

function _toStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

function _normalizeNodeIpBackup(raw: unknown): NodeIpBackupConfig {
  const d = (raw ?? {}) as Record<string, unknown>
  return {
    ipv4_urls: _toStringList(d.ipv4_urls),
    ipv6_urls: _toStringList(d.ipv6_urls),
    default_ipv4_urls: _toStringList(d.default_ipv4_urls),
    default_ipv6_urls: _toStringList(d.default_ipv6_urls),
  }
}

export async function getNodeIpBackupConfig(): Promise<NodeIpBackupConfig> {
  return _normalizeNodeIpBackup(await request<unknown>("/admin/node-ip-config"))
}

/** 保存市场备份（只落 blob，不下发、不动全局配置）。未传的地址族不动。 */
export async function updateNodeIpBackupConfig(
  payload: { ipv4_urls?: string[]; ipv6_urls?: string[] },
): Promise<NodeIpBackupConfig> {
  const data = await request<unknown>("/admin/node-ip-config", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
  return _normalizeNodeIpBackup(data)
}

/**
 * 管理页目录读取：走服务端 ``/admin/catalog``（q 交给服务端过滤——前端再做一遍
 * JSON.stringify 全量序列化会在大目录时把每次搜索都拖成卡顿）。store 路径下保存
 * 即生效，GitHub 由后台 publisher 异步镜像；响应附带的 ``publish`` 计数用于工具栏的
 * 「发布中 / 发布失败」徽标。管理视图保留 hidden 项（管理员要能看到并改回
 * published），只剔除 deleted——服务端 ``/admin/catalog`` 已按此口径返回。
 */
export type PublishCounts = { pending: number; pushing: number; failed: number }

export async function fetchMarketplaceCatalog(
  module: MarketplaceModule,
  query = "",
): Promise<{ items: MarketplaceItem[]; publish?: PublishCounts }> {
  const qs = new URLSearchParams({ module })
  if (query.trim()) qs.set("q", query.trim())
  const data = await request<{ items: MarketplaceItem[]; publish?: PublishCounts } & Record<string, unknown>>(
    `/admin/catalog?${qs}`,
  )
  return { items: Array.isArray(data?.items) ? (data.items as MarketplaceItem[]) : [], publish: data?.publish }
}

/** 单条 manifest：走服务端 ``/admin/items/{module}/{item}``。 */
export async function fetchMarketplaceManifest(module: MarketplaceModule, id: string): Promise<MarketplaceManifest> {
  const safe = id.replaceAll("/", ".")
  const m = await request<MarketplaceManifest>(`/admin/items/${encodeURIComponent(module)}/${encodeURIComponent(safe)}`)
  if (!m) throw new Error("市场 manifest 不存在或读取失败")
  return m
}

/** 清掉浏览器侧市场缓存（管理页刷新按钮用）。 */
export function refreshMarketplaceCache(): void {
  invalidateMarketCache()
}

export function exportMarketplace(module?: MarketplaceModule): Promise<unknown> {
  return request(`/admin/export${module ? `?module=${encodeURIComponent(module)}` : ""}`)
}

export type MarketplaceWriteResult = {
  ok?: boolean
  item?: MarketplaceItem
  publish?: PublishCounts
}

export function upsertMarketplaceItem(
  module: MarketplaceModule,
  manifest: MarketplaceManifest,
): Promise<MarketplaceWriteResult> {
  return request("/admin/items", { method: "POST", body: JSON.stringify({ module, manifest }) })
}

export function importMarketplace(body: unknown, mode: "merge" | "replace"): Promise<{ written: string[]; deleted: string[]; failed: Array<{ module: string; id: string; errors: string[] }>; count: number; publish?: PublishCounts }> {
  return request("/admin/import", { method: "POST", body: JSON.stringify({ ...(body as object), mode }) })
}

export function deleteMarketplaceItem(module: MarketplaceModule, id: string, hard = false): Promise<MarketplaceWriteResult> {
  return request(`/admin/items/${encodeURIComponent(module)}/${encodeURIComponent(id.replaceAll("/", "."))}${hard ? "?hard=true" : ""}`, { method: "DELETE" })
}

export type MarketplacePublishJob = {
  id: number
  module: MarketplaceModule | "leaderboard"
  item_id: string
  action: "upsert" | "delete" | "refresh" | "publish"
  status: "pending" | "pushing" | "failed"
  attempts: number
  last_error: string
  available_at?: string
  created_at?: string
  started_at?: string
}

export type MarketplacePublishJobs = {
  pending: MarketplacePublishJob[]
  pushing: MarketplacePublishJob[]
  failed: MarketplacePublishJob[]
  counts: PublishCounts
}

/** 发布队列面板：只列 pending/pushing/failed，done 历史不拉。module 可传
 *  'leaderboard' 只看榜单推送（外部榜单发布复用同一 outbox 队列）。 */
export function getMarketplacePublishJobs(module?: MarketplaceModule | "leaderboard"): Promise<MarketplacePublishJobs> {
  return request(`/admin/publish-jobs${module ? `?module=${encodeURIComponent(module)}` : ""}`)
}

/** 手动重试所有 failed 发布任务。 */
export function retryMarketplacePublish(): Promise<{ retried: number; publish: PublishCounts }> {
  return request("/admin/publish-jobs/retry", { method: "POST" })
}

/** 采纳 GitHub 仓库直改（merge 进 store；仓库没有的本地条目保留）。 */
export function resyncMarketplaceFromRepo(): Promise<{ ok: boolean; merged: number }> {
  return request("/admin/resync-from-repo", { method: "POST" })
}

export type ExportableChannel = {
  provider: string
  display_name: string
  builtin_type: string
  base_url: string
  enabled: boolean
  template_id: string
  published: boolean
}

/** 当前平台可发布为模板的渠道清单（只读基础配置，不碰账号），供多选导入弹框。 */
export function fetchExportableChannels(): Promise<{ items: ExportableChannel[] }> {
  return request("/admin/channels/exportable")
}

export type ChannelImportItemState = "pending" | "importing" | "written" | "skipped" | "failed"

export interface ChannelImportJob {
  job_id: string
  status: "queued" | "importing" | "finalizing_index" | "finalizing_marker" | "refreshing_catalog" | "done" | "failed"
  phase: string
  overwrite: boolean
  total: number
  completed: number
  current_provider: string
  written: string[]
  skipped: string[]
  failed: Array<{ provider: string; errors: string[] }>
  items: Array<{ provider: string; state: ChannelImportItemState; template_id: string; error: string }>
  error: string
  warning: string
}

export function startChannelImportJob(providers: string[], overwrite: boolean): Promise<{ job_id: string; status: string; total: number }> {
  return request("/admin/channels/import-jobs", {
    method: "POST",
    body: JSON.stringify({ providers, overwrite }),
  })
}

export function getChannelImportJob(jobId: string): Promise<ChannelImportJob> {
  return request(`/admin/channels/import-jobs/${encodeURIComponent(jobId)}`)
}

export interface ChannelBatchDeleteResult {
  ok: boolean
  phase?: string
  requested: number
  deleted: string[]
  failed: Array<{ id: string; error: string; phase: string }>
  results: Array<{ id: string; ok: boolean; error?: string; phase?: string }>
  count: number
  index_updated: boolean
  marker_updated: boolean
  catalog_refreshed: boolean
  warnings: string[]
}

export function batchDeleteChannelTemplates(ids: string[]): Promise<ChannelBatchDeleteResult> {
  return request("/admin/channels/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })
}

/** 上传进度回调，loaded/bytes 已传，total 为 -1 表示不可测（分块编码等）。 */
export type UploadProgress = (loaded: number, total: number) => void

/**
 * 上传节点版本（二进制 + runtime tar.gz）——第①阶段：文件从前端传到服务器并暂存。
 * 用 XHR 而非 fetch，唯一原因是要拿上传进度：fetch 的 Request 拿不到上传 byte 进度，
 * XHR 的 upload.onprogress 能拿到。返回 job_id，随后前端轮询 getNodeVersionUploadJob 看第②阶段。
 */
export function uploadNodeVersion(form: FormData, onProgress?: UploadProgress): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${BASE}/admin/node-versions/upload`)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : -1)
    }
    xhr.onload = () => {
      let body: any = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body?.job_id ? { job_id: body.job_id } : reject(new Error("服务器未返回 job_id")))
      } else {
        const detail = adminErrorMessage(body, xhr.status)
        reject(new Error(detail))
      }
    }
    xhr.onerror = () => reject(new Error("网络错误：上传失败"))
    xhr.send(form)
  })
}

/** 一个文件在第②阶段的状态。 */
export type UploadFileState = "pending" | "uploading" | "done" | "failed"

/** 上传 job 的整体状态（轮询返回）。 */
export interface UploadJob {
  job_id: string
  version: string
  status: "uploading" | "to_github" | "finalizing" | "done" | "failed"
  phase: "to_server" | "to_github" | "done"
  total_files: number
  github_done: number
  error: string
  files: Array<{
    filename: string
    role: string
    platform: string
    arch: string
    size: number
    state: UploadFileState
    error: string
    // 移动端 URL 模式（外链 APK 不入仓）标 "url"；文件模式与节点侧恒为空串。
    source?: string
  }>
}

/** GET /admin/node-versions/upload/{jobId} —— 轮询第②阶段进度。job 已清（404）抛 UploadJobGoneError。 */
export async function getNodeVersionUploadJob(jobId: string): Promise<UploadJob> {
  const response = await fetch(`${BASE}/admin/node-versions/upload/${encodeURIComponent(jobId)}`, { credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body as UploadJob
}

/** POST /admin/node-versions/upload/{jobId}/retry —— 只补传 failed 文件。job 已清（404）抛 UploadJobGoneError。 */
export async function retryNodeVersionUpload(jobId: string): Promise<{ retried: boolean }> {
  const response = await fetch(`${BASE}/admin/node-versions/upload/${encodeURIComponent(jobId)}/retry`, { method: "POST", credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body
}

// ── 移动端（控制 App）版本上传：与节点同构、单 APK，复用同一套 UploadJob ──────

/**
 * 上传移动端版本（单个 Android APK）——第①阶段。与 uploadNodeVersion 同骨架，
 * 只是端点和多了 ios_store_url 字段。返回 job_id 后轮询 getMobileVersionUploadJob。
 */
export function uploadMobileVersion(form: FormData, onProgress?: UploadProgress): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${BASE}/admin/mobile-versions/upload`)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : -1)
    }
    xhr.onload = () => {
      let body: any = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body?.job_id ? { job_id: body.job_id } : reject(new Error("服务器未返回 job_id")))
      } else {
        const detail = adminErrorMessage(body, xhr.status)
        reject(new Error(detail))
      }
    }
    xhr.onerror = () => reject(new Error("网络错误：上传失败"))
    xhr.send(form)
  })
}

/** GET /admin/mobile-versions/upload/{jobId} —— 轮询第②阶段进度。job 已清（404）抛 UploadJobGoneError。 */
export async function getMobileVersionUploadJob(jobId: string): Promise<UploadJob> {
  const response = await fetch(`${BASE}/admin/mobile-versions/upload/${encodeURIComponent(jobId)}`, { credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body as UploadJob
}

/** POST /admin/mobile-versions/upload/{jobId}/retry —— 只补传 failed 文件。job 已清（404）抛 UploadJobGoneError。 */
export async function retryMobileVersionUpload(jobId: string): Promise<{ retried: boolean }> {
  const response = await fetch(`${BASE}/admin/mobile-versions/upload/${encodeURIComponent(jobId)}/retry`, { method: "POST", credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body
}

// ── 设备控制 App（被控端）版本上传：与移动端同构，发布到独立仓库 GitHub Release ──

/**
 * 上传设备控制 App 版本（单个 Android APK）——第①阶段。与 uploadMobileVersion
 * 同骨架，只是端点不同（服务端第②阶段把二进制传到 ai-lubricant-device-control
 * 仓库的 GitHub Release）。返回 job_id 后轮询 getDeviceControlVersionUploadJob。
 */
export function uploadDeviceControlVersion(form: FormData, onProgress?: UploadProgress): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${BASE}/admin/device-control-versions/upload`)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : -1)
    }
    xhr.onload = () => {
      let body: any = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body?.job_id ? { job_id: body.job_id } : reject(new Error("服务器未返回 job_id")))
      } else {
        const detail = adminErrorMessage(body, xhr.status)
        reject(new Error(detail))
      }
    }
    xhr.onerror = () => reject(new Error("网络错误：上传失败"))
    xhr.send(form)
  })
}

/** GET /admin/device-control-versions/upload/{jobId} —— 轮询第②阶段进度。job 已清（404）抛 UploadJobGoneError。 */
export async function getDeviceControlVersionUploadJob(jobId: string): Promise<UploadJob> {
  const response = await fetch(`${BASE}/admin/device-control-versions/upload/${encodeURIComponent(jobId)}`, { credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body as UploadJob
}

/** POST /admin/device-control-versions/upload/{jobId}/retry —— 只补传 failed 文件。job 已清（404）抛 UploadJobGoneError。 */
export async function retryDeviceControlVersionUpload(jobId: string): Promise<{ retried: boolean }> {
  const response = await fetch(`${BASE}/admin/device-control-versions/upload/${encodeURIComponent(jobId)}/retry`, { method: "POST", credentials: "include" })
  const body = await response.json().catch(() => null)
  if (response.status === 404) throw new UploadJobGoneError(adminErrorMessage(body, response.status))
  if (!response.ok) throw new Error(adminErrorMessage(body, response.status))
  return body
}

export function rebuildMarketplaceIndex(module: MarketplaceModule): Promise<unknown> {
  return request("/admin/rebuild-index", { method: "POST", body: JSON.stringify({ module }) })
}

// ── 外部榜单候选池（Agent-Leaderboard 同步）──────────────────────────────────
// 同步进来的一律是 draft,要管理员显式点发布才对用户可见。前端只做候选池浏览 +
// 收口归类 + 触发 agent 补启动方式 + 批量发布/撤回。

export type LeaderboardModule = "mcp" | "skill" | "prompt" | "plugin"

export interface LeaderboardItem {
  id: number
  source: string
  board: string
  repo_full_name: string
  repo_url: string
  /** 摘要（资源字段，管理员可改；同步只在新条目时预填上游描述）。 */
  description: string
  stars: number
  forks: number
  language: string
  /** 资源字段（同步预填，管理员可改）。 */
  name?: string
  display_name?: string
  publisher?: string
  version?: string
  /** 子分类（多选，源=上游 use_cases）。 */
  categories?: string[]
  /** 标签（多选，源=上游 topics）。 */
  tags?: string[]
  /** 技术栈 profile（规则引擎识别，attach_probe 写入；空对象=未扫）。 */
  stack?: DomainStackProfile
  /** 技术栈扁平 tag（主语言+框架+形态，小写去重，专供 stack_tag 过滤）。 */
  stack_tags?: string[]
  /** 上游投影缓存（列表/搜索用；真相在 external_data）。 */
  topics: string[]
  use_cases: string[]
  upstream_category: string
  target_module: string
  /** 分类（多选）：一条榜单项可同时是 MCP+Skill+插件。target_module 是主分类（第一个）。 */
  target_modules?: string[]
  /** skill/plugin/prompt 的安装配置（人工草稿，与 launch_spec 同级；同步不覆盖）。 */
  install_spec?: Record<string, unknown>
  /** 上游原始事实快照（唯一上游真相，只读；编辑弹框逐项「同步」按钮从这里取值）。 */
  external_data?: Record<string, unknown>
  installable: boolean
  labels: string[]
  /** 排序（资源中心索引）。数字=固定位置；null=排最后按热度。 */
  sort_order?: number | null
  /** 旧名次列（迁移兼容，读取侧用 sort_order）。 */
  display_rank?: number | null
  upstream_rank?: number | null
  rank_overridden?: boolean
  launch_spec: Record<string, unknown>
  launch_spec_status: string
  launch_spec_error: string
  status: "draft" | "published" | "hidden"
  published_at?: string | null
  published_by?: string
  upstream_updated_at?: string | null
  first_synced_at?: string | null
  last_synced_at?: string | null
}

export interface LeaderboardListResult {
  items: LeaderboardItem[]
  total: number
  draft_count: number
  published_count: number
}

export interface LeaderboardStatus {
  enabled: boolean
  configured: boolean
  interval_hours: number
  repo: string
  boards: string[]
  launch_agent_id: number
  /** 上次同步结果 + 实时进度 + 执行日志（重启后由后端回落 DB 执行记录）。 */
  last_sync: SourceSyncStatus
  draft_count: number
  published_count: number
}

/** 榜单推送（异步队列）的入队响应：202 立即返回，worker 校验门禁后翻 published；
 * 失败进发布队列面板（module=leaderboard）的 failed 列表，可手动重试。 */
export interface LeaderboardPublishResult {
  queued: number[]
  skipped: number[]
  requested: number
  detail?: string
}

export function fetchLeaderboardItems(params: {
  board?: string
  status?: "draft" | "published"
  source?: string
  target_module?: LeaderboardModule
  installable?: boolean
  /** 启动方式状态过滤：unfilled=没补过或失败（可重试）；pending/filled/failed/verified=精确匹配。 */
  launch_status?: "unfilled" | "pending" | "filled" | "failed" | "verified"
  /** 技术栈 tag 过滤（python/typescript/web_frontend…，后端 stack_tags @> 匹配）。 */
  stack_tag?: string
  q?: string
  limit?: number
  offset?: number
}): Promise<LeaderboardListResult> {
  const qs = new URLSearchParams()
  if (params.board) qs.set("board", params.board)
  if (params.status) qs.set("status", params.status)
  if (params.source) qs.set("source", params.source)
  if (params.target_module) qs.set("target_module", params.target_module)
  if (typeof params.installable === "boolean") qs.set("installable", String(params.installable))
  if (params.launch_status) qs.set("launch_status", params.launch_status)
  if (params.stack_tag) qs.set("stack_tag", params.stack_tag)
  if (params.q) qs.set("q", params.q)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.offset) qs.set("offset", String(params.offset))
  return request<LeaderboardListResult>(`/admin/leaderboard/items?${qs}`)
}

export function fetchLeaderboardStatus(): Promise<LeaderboardStatus> {
  return request<LeaderboardStatus>("/admin/leaderboard/status")
}

/** 手动触发一次同步（后台异步执行，立即返回 {started:true}；已在跑→409）。仍只写草稿,不发布任何条目。
 *
 * 覆盖模式（默认全不传 = 不覆盖）：overwrite_published / overwrite_draft 控制已存在行的
 * 资源字段是否被上游+探针最新值覆盖（管理员手改让位）。覆盖只刷新数据，永不翻状态。 */
export function triggerLeaderboardSync(opts?: {
  overwrite_published?: boolean
  overwrite_draft?: boolean
}): Promise<{ started?: boolean; detail?: string }> {
  const body: Record<string, boolean> = {}
  if (opts?.overwrite_published) body.overwrite_published = true
  if (opts?.overwrite_draft) body.overwrite_draft = true
  return request("/admin/leaderboard/sync", {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  })
}

/** 管理员编辑资源字段（与市场资源同一套）+ 安装配置。**含直改状态**——status 走
 * update_curation 直翻库（与列表页发布队列/撤回并存的捷径）。 */
export function updateLeaderboardItem(
  itemId: number,
  patch: {
    /** 分类多选：[] = 仅浏览。 */
    target_modules?: string[]
    target_module?: LeaderboardModule | ""
    installable?: boolean
    /** 直改状态（draft|published|hidden）；发布队列路径仍是正式发布口径。 */
    status?: "draft" | "published" | "hidden"
    /** skill/plugin/prompt 安装配置，整体替换（只送勾选分类对应的部分）。 */
    install_spec?: Record<string, unknown>
    /** 手改 MCP 启动方式；服务端会把 launch_spec_status 置 filled（人工已核对）。 */
    launch_spec?: Record<string, unknown>
    /** 资源字段：直接写列（同步已存在条目只更新 external_data，不会冲掉）。 */
    name?: string
    display_name?: string
    publisher?: string
    description?: string
    version?: string
    categories?: string[]
    tags?: string[]
    /** 排序（资源中心索引）。数字=固定位置；null=排最后按热度。 */
    sort_order?: number | null
  },
): Promise<LeaderboardItem> {
  return request(`/admin/leaderboard/items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) })
}

/** 按所选类型重跑探针并重派生安装配置（编辑弹框「重新识别」）。type 空=自动判定。 */
export function reprobeLeaderboardItem(itemId: number, type?: string): Promise<LeaderboardItem> {
  return request(`/admin/leaderboard/items/${itemId}/reprobe`, {
    method: "POST",
    body: JSON.stringify(type ? { type } : {}),
  })
}

/** 推送发布：入队即返回（202），pending/failed 在发布队列（module=leaderboard）可见。 */
export function publishLeaderboardItems(ids: number[]): Promise<LeaderboardPublishResult> {
  return request<LeaderboardPublishResult>("/admin/leaderboard/publish", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })
}

export function unpublishLeaderboardItems(ids: number[]): Promise<{ unpublished: number[]; count: number }> {
  return request("/admin/leaderboard/unpublish", { method: "POST", body: JSON.stringify({ ids }) })
}

/** 批量硬删除候选池条目（含已发布行，用户侧立即不可见）。破坏性，不可恢复。 */
export function deleteLeaderboardItems(ids: number[]): Promise<{ deleted: number[]; count: number }> {
  return request("/admin/leaderboard/delete", { method: "POST", body: JSON.stringify({ ids }) })
}

/** 手动添加 GitHub 项目为榜单草稿；后端自动拉仓库元数据并预分类。 */
export function createLeaderboardItem(repo: string): Promise<LeaderboardItem> {
  return request("/admin/leaderboard/items", {
    method: "POST",
    body: JSON.stringify({ repo }),
  })
}

/** 重新验证一条条目的 launch_spec（可选 install_spec），写回 verified/failed。幂等。 */
export function verifyLeaderboardItem(
  itemId: number,
  includeInstall = false,
): Promise<{ id: number; launch: { ok: boolean; status: string; error: string }; install?: unknown }> {
  return request(`/admin/leaderboard/items/${itemId}/verify`, {
    method: "POST",
    body: JSON.stringify({ include_install: includeInstall }),
  })
}

/** agency-agents 提示词源同步报告：转换/校验/导入结果。
 *  同步路由是后台异步执行——POST 立即返回 ``{started: true, detail}``，
 *  完整报告通过 last-sync 端点轮询获取。 */
export interface AgencyAgentsSyncReport {
  /** 后台异步路由的立即返回形态 */
  started?: boolean
  converted: number
  failed: Array<{ path: string; id?: string; errors: string[] }>
  skipped: Array<{ path: string; reason: string }>
  divisions: Record<string, number>
  ref: string
  dry_run: boolean
  ran_at: string
  written?: number
  import_failed?: Array<Record<string, unknown>>
  detail: string
  logs?: Array<{ ts: string; phase: string; detail: string }>
}

/** 手动同步 agency-agents 提示词源到 prompts 模块（merge）。默认 pinned commit。
 *  ``chinese=true`` 走 agency-agents-zh 中文社区源。 */
export function syncAgencyAgents(
  options: {
    ref?: string
    flush?: boolean
    dryRun?: boolean
    chinese?: boolean
    /** 覆盖模式（弹框勾选；缺省=不覆盖，已存在行只刷上游元数据）。 */
    overwrite_draft?: boolean
    overwrite_published?: boolean
  } = {},
): Promise<AgencyAgentsSyncReport> {
  const path = options.chinese
    ? "/admin/marketplace/agency-agents-zh/sync"
    : "/admin/marketplace/agency-agents/sync"
  return request(path, {
    method: "POST",
    body: JSON.stringify({
      ref: options.ref || undefined,
      flush: options.flush || undefined,
      dry_run: options.dryRun || undefined,
      overwrite_draft: options.overwrite_draft || undefined,
      overwrite_published: options.overwrite_published || undefined,
    }),
  })
}

/** 同步任务实时进度（后台执行中由 last-sync 端点附带返回）。 */
export interface SourceSyncProgress {
  running: boolean
  phase: string
  current: number
  total: number
  current_item: string
}

/** last-sync 端点返回：上次结果 + 实时进度 + 执行日志。 */
export interface SourceSyncStatus {
  ran_at: string
  ok: boolean | null
  detail: string
  progress?: SourceSyncProgress
  logs?: Array<{ ts: string; phase: string; detail: string }>
}

/** 上次 agency-agents 同步结果（ran_at / ok / detail + 进度 + 日志）。chinese=true 查中文源端点。 */
export function fetchAgencyAgentsLastSync(chinese = false): Promise<SourceSyncStatus> {
  return request(
    chinese
      ? "/admin/marketplace/agency-agents-zh/last-sync"
      : "/admin/marketplace/agency-agents/last-sync",
  )
}

/** agentscope 技能源同步报告。同步路由后台异步执行——POST 立即返回 ``{started, detail}``。 */
export interface AgentscopeSyncReport {
  /** 后台异步路由的立即返回形态 */
  started?: boolean
  converted: number
  failed: Array<{ id?: string; code?: string; errors: string[] }>
  ran_at: string
  detail: string
  logs?: Array<{ ts: string; phase: string; detail: string }>
}

/** 手动同步 agentscope 技能源到 skills 模块。公开 API，无需鉴权。
 * 覆盖模式（弹框勾选；缺省=不覆盖）：overwrite_* 控制已存在行资源字段是否被上游
 * 最新值重写（管理员手改让位）。覆盖只刷新数据，永不翻状态。 */
export function syncAgentscope(opts?: {
  overwrite_draft?: boolean
  overwrite_published?: boolean
}): Promise<AgentscopeSyncReport> {
  const body: Record<string, boolean> = {}
  if (opts?.overwrite_published) body.overwrite_published = true
  if (opts?.overwrite_draft) body.overwrite_draft = true
  return request("/admin/marketplace/agentscope/sync", {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  })
}

/** 上次 agentscope 同步结果。 */
export function fetchAgentscopeLastSync(): Promise<SourceSyncStatus> {
  return request("/admin/marketplace/agentscope/last-sync")
}

/** skillhub 技能源同步报告。同步路由后台异步执行——POST 立即返回 ``{started, detail}``。 */
export interface SkillhubSyncReport {
  /** 后台异步路由的立即返回形态 */
  started?: boolean
  converted: number
  failed: Array<{ id?: string; code?: string; errors: string[] }>
  ran_at: string
  detail: string
  logs?: Array<{ ts: string; phase: string; detail: string }>
}

/** 手动同步 skillhub 技能源到 skills 模块。公开 API，无需鉴权。 */
/** 手动同步 skillhub 技能源到 skills 模块。公开 API，无需鉴权。
 * 覆盖模式（弹框勾选；缺省=不覆盖）：overwrite_* 控制已存在行资源字段是否被上游
 * 最新值重写（管理员手改让位）。覆盖只刷新数据，永不翻状态。 */
export function syncSkillhub(opts?: {
  overwrite_draft?: boolean
  overwrite_published?: boolean
}): Promise<SkillhubSyncReport> {
  const body: Record<string, boolean> = {}
  if (opts?.overwrite_published) body.overwrite_published = true
  if (opts?.overwrite_draft) body.overwrite_draft = true
  return request("/admin/marketplace/skillhub/sync", {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  })
}

/** 上次 skillhub 同步结果。 */
export function fetchSkillhubLastSync(): Promise<SourceSyncStatus> {
  return request("/admin/marketplace/skillhub/last-sync")
}

/** 清空整个榜单候选池。破坏性——需带 {confirm: "purge"} 二次确认。 */
export function purgeLeaderboardItems(): Promise<{ purged: number; detail: string }> {
  return request("/admin/leaderboard/purge", {
    method: "POST",
    body: JSON.stringify({ confirm: "purge" }),
  })
}

/**
 * 下载候选条目的安装数据（管理员实测下载地址用）。
 *
 * 后端代理：skill 直接下载 zip / prompt 回传 .md；失败时后端回 JSON 错误信封
 * （同 request 的两种信封都解析），调用方 toast 显示。成功返回 {blob, filename}。
 */
export async function downloadLeaderboardItem(
  itemId: number,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${BASE}/admin/leaderboard/items/${itemId}/download`, {
    credentials: "include",
  })
  if (!response.ok) {
    const text = await response.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    throw new Error(adminErrorMessage(body, response.status))
  }
  const disposition = response.headers.get("Content-Disposition") || ""
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const filename = m ? decodeURIComponent(m[1].trim()) : `item-${itemId}`
  return { blob: await response.blob(), filename }
}
