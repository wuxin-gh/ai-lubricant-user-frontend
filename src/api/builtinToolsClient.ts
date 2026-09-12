/**
 * 用户侧「内置工具」API 客户端（CDP 浏览器 / 邮箱 / 设备控制）。
 *
 * 鉴权（`credentials: "include"`），不携带 admin token。后端严格按
 * `owner_user_id == 当前用户` 隔离——用户只能看/改自己拥有的资源。
 *
 * 资源一级模型：浏览器客户端（cdp_client）、邮箱服务（mail_account + 别名）、
 * 设备（device）直接归属用户，无实例层。token 明文只在签发/轮换时一次性返回。
 */

const BASE = "/api/v1/users/builtin-tools"

async function toolFetch<T>(path: string, init?: RequestInit & { baseOverride?: string }): Promise<T> {
  const base = init?.baseOverride ?? BASE
  const { baseOverride, ...fetchInit } = init ?? {}
  const r = await fetch(`${base}${path}`, {
    ...fetchInit,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(fetchInit?.headers || {}) },
  })
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const data = await r.json()
      // 后端统一信封 {error:{message,...}}；FastAPI HTTPException 直接 {detail};
      // 兼容两种形态，取最深处的可读 message 给用户看。
      const err = data?.error
      if (err && typeof err === "object") {
        detail = err.message || err.detail || JSON.stringify(err)
      } else {
        detail = data?.detail || data?.message || detail
      }
    } catch {
      // ignore parse error, keep default detail
    }
    throw new Error(detail)
  }
  const text = await r.text()
  return (text ? JSON.parse(text) : {}) as T
}

// ==================== 类型 ====================

export type ToolKind = "cdp" | "mail" | "android" | "ios"
export type ResourceType = "cdp_client" | "mail_account" | "mail_address" | "device"
export type TokenTargetType = "agent" | "node" | "user" | "external"
export type TokenStatus = "active" | "disabled"

export interface BuiltinToolResource {
  id: number
  owner_user_id: string
  resource_type: ResourceType
  detail_type: ResourceType
  revision: number
  _secrets?: Record<string, { state: "set" | "unset" }>
  [key: string]: unknown
}

export interface BuiltinToolToken {
  id: number
  resource_id: number | null
  service_id: number | null
  token_hint?: string | null
  target_type: TokenTargetType
  target_id?: string | null
  display_token: boolean
  status: TokenStatus
  expires_at?: string | null
  created_at?: string
  updated_at?: string
}

// ==================== 资源 CRUD（唯一用户 API；无实例层） ====================

export function listResources(resourceType?: ResourceType): Promise<{ resources: BuiltinToolResource[] }> {
  const q = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ""
  return toolFetch(`/resources${q}`)
}

export function getResource(resourceId: number): Promise<BuiltinToolResource> {
  return toolFetch(`/resources/${resourceId}`)
}

export function createResource(resourceType: ResourceType, data: Record<string, unknown>): Promise<BuiltinToolResource> {
  return toolFetch(`/resources`, { method: "POST", body: JSON.stringify({ data: { ...data, resource_type: resourceType } }) })
}

export function updateResource(resourceId: number, data: Record<string, unknown>, expectedRevision?: number | null): Promise<BuiltinToolResource> {
  return toolFetch(`/resources/${resourceId}`, { method: "PATCH", body: JSON.stringify({ data, expected_revision: expectedRevision ?? null }) })
}

export function deleteResource(resourceId: number): Promise<{ deleted: boolean }> {
  return toolFetch(`/resources/${resourceId}`, { method: "DELETE" })
}

// ==================== CDP 客户端资源 ====================

export interface CdpClientResource extends BuiltinToolResource {
  name?: string
  enabled?: boolean
  token_hint?: string
  client_id?: string
  connected?: boolean
  pages?: Array<{ id: string; url?: string; title?: string; active: boolean; status?: string }>
}

export function listCdpClientResources(): Promise<{ clients: CdpClientResource[] }> {
  return toolFetch(`/resources/cdp-clients`)
}

export function createCdpClientResource(name: string): Promise<{ client: CdpClientResource; token: string }> {
  return toolFetch(`/resources/cdp-clients`, { method: "POST", body: JSON.stringify({ name }) })
}

export function rotateCdpToken(resourceId: number): Promise<{ client: CdpClientResource; token: string }> {
  return toolFetch(`/resources/cdp-clients/${resourceId}/rotate-token`, { method: "POST" })
}

export function revokeCdpToken(resourceId: number): Promise<{ client: CdpClientResource }> {
  return toolFetch(`/resources/cdp-clients/${resourceId}/revoke-token`, { method: "POST" })
}

export function updateCdpClient(resourceId: number, body: { name?: string; enabled?: boolean }): Promise<CdpClientResource> {
  return updateResource(resourceId, body) as Promise<CdpClientResource>
}

export function deleteCdpClient(resourceId: number): Promise<{ deleted: boolean }> {
  return deleteResource(resourceId)
}

export interface CdpConnectionInfo { ws_session_url: string; extension_download_url: string; extension_file_name: string }
export function getCdpConnectionInfo(): Promise<CdpConnectionInfo> { return toolFetch(`/cdp/connection-info`) }

// ==================== 邮箱服务资源 ====================

export interface MailAddress extends BuiltinToolResource {
  address?: string
  source_address?: string
  parent_resource_id?: number
}

export interface MailServiceResource extends BuiltinToolResource {
  resource_id: number
  display_name?: string
  mailbox_type?: string
  base_url?: string
  username?: string
  mail_suffix?: string
  enabled?: boolean
  addresses?: MailAddress[]
}

export function listMailServiceResources(): Promise<{ services: MailServiceResource[] }> {
  return toolFetch(`/resources/mail-services`)
}

export function createMailServiceResource(body: Record<string, unknown>): Promise<MailServiceResource> {
  return toolFetch(`/resources/mail-services`, { method: "POST", body: JSON.stringify(body) })
}

export function deleteMailServiceResource(resourceId: number): Promise<{ deleted: boolean }> {
  return toolFetch(`/resources/mail-services/${resourceId}`, { method: "DELETE" })
}

export function createMailAddress(resourceId: number, body: { address: string; source_address?: string }): Promise<MailAddress> {
  return toolFetch(`/resources/mail-services/${resourceId}/addresses`, { method: "POST", body: JSON.stringify(body) })
}

export interface MailMessage { [key: string]: unknown; id?: string | number; subject?: string; title?: string; from?: string; sender?: string; date?: string; received_address?: string; requested_address?: string; html_content?: string; text_content?: string; raw_content?: string }
export interface MailQueryResult { requested_address: string; received_address: string; messages: MailMessage[]; count: number; limit: number; offset: number }
export function queryMailMessages(resourceId: number, body: Record<string, unknown> = {}): Promise<MailQueryResult> {
  return toolFetch(`/resources/mail-services/${resourceId}/query`, { method: "POST", body: JSON.stringify(body) })
}

// ==================== 设备控制资源 ====================

export interface DeviceHostNode { node_id: string; name: string; role: string; online: boolean; client_version: string; needs_upgrade: boolean; can_upgrade: boolean }
export interface DeviceResource extends BuiltinToolResource {
  device_id: string
  name: string
  enabled: boolean
  token_hint: string
  device_info: Record<string, unknown>
  platform: "android" | "ios" | string
  online: boolean
  capabilities: string[]
  /** ISO 时间：在线=心跳实时点，离线=断连时刻（服务端落库兜底）。 */
  last_seen_at?: string
  node_id?: string
  node?: DeviceHostNode
}

export function listDeviceResources(): Promise<{ devices: DeviceResource[] }> { return toolFetch(`/resources/devices`) }
export function mintDevicePairingCodeResource(label: string): Promise<{ code: string; ttl: number }> { return toolFetch(`/resources/device-pairing-codes`, { method: "POST", body: JSON.stringify({ label }) }) }
export function revokeDevice(resourceId: number): Promise<{ device: DeviceResource }> { return toolFetch(`/resources/${resourceId}/revoke-device`, { method: "POST" }) }

// ==================== 控制端 App 发行 ====================

export interface MobileAppRelease {
  version: string
  version_notes: string
  release_tag: string
  android: { version: string; download_url: string; proxy_download_url: string; digest: string; size_bytes: number }
  ios: { version: string; store_url: string }
  updated_at: string
  stale: boolean
}

export async function getMobileAppRelease(): Promise<MobileAppRelease | null> {
  try {
    const r = await fetch("/api/v1/marketplace/consumer/mobile-version", { credentials: "include", cache: "no-store" })
    return r.ok ? (await r.json()) as MobileAppRelease : null
  } catch {
    return null
  }
}

// 设备控制 App（被控端）发行信息：Android 为 APK、iOS 为侧载 IPA（不上 App Store）。
// 下载直链指向 ai-lubricant-device-control 独立仓库的 GitHub Release 资产；
// proxy_download_url 是站内服务端代理下载路径（带平台参数），优先于
// download_url（手机/浏览器无需直连 GitHub）。
export interface DeviceControlAppRelease {
  version: string
  version_notes: string
  release_tag: string
  android: { version: string; download_url: string; proxy_download_url: string; digest: string; size_bytes: number }
  ios: { version: string; download_url: string; proxy_download_url: string; digest: string; size_bytes: number }
  updated_at: string
  stale: boolean
}

export async function getDeviceControlAppRelease(): Promise<DeviceControlAppRelease | null> {
  try {
    const r = await fetch("/api/v1/marketplace/consumer/device-control-version", { credentials: "include", cache: "no-store" })
    return r.ok ? (await r.json()) as DeviceControlAppRelease : null
  } catch {
    return null
  }
}

// ==================== 外部 MCP 接入说明 ====================

export interface BuiltinMcpIntegration {
  tool_kind: string
  service_name: string
  display_name: string
  description: string
  transport: string
  sse_url: string
  token_url: string
  tools: Array<{ name: string; description?: string }>
  enabled: boolean
  runtime_status?: string
}

export function getBuiltinMcpIntegration(toolKind: string): Promise<BuiltinMcpIntegration> {
  return toolFetch(`/mcp-integration/${encodeURIComponent(toolKind)}`)
}

export function formatExternalMcpConfig(integration: BuiltinMcpIntegration, plaintext: string): string {
  return JSON.stringify({ mcpServers: { [integration.service_name]: { url: `${integration.sse_url}?token=${plaintext}`, transport: "sse" } } }, null, 2)
}

// ==================== iOS WDA 管理 ====================

export interface IosHostNode {
  node_id: string
  name: string
  online: boolean
  capabilities: Record<string, string>
}

export interface IosDiscoveredDevice {
  udid: string
  name: string
  model: string
  product_version: string
  connection_type: string
  present: boolean
  claimed: boolean
  device_id?: string
  wda_state?: string
  profile_expires_at?: string
  last_error?: string
  config_revision_applied?: number
}

export interface IosSigningProfile {
  id: number
  owner_user_id: string
  name: string
  kind: "asc" | "p12" | "apple_id"
  created_at: string
  /** p12：mobileprovision 的 ExpirationDate（服务端现解析）；asc：恒 null。 */
  expires_at?: string | null
  /** 服务端统一算，前端只渲染：valid / expiring（≤3天）/ expired / unknown。
   *  apple_id 的 expired 表示会话过期（需重新登录），非描述文件过期。 */
  status?: "valid" | "expiring" | "expired" | "unknown"
  team_id?: string | null
  profile_name?: string | null
}

/** Apple ID 两步登录中间态：login 返回 2fa_required 时拿到的令牌。 */
export interface IosAppleIdLoginResult {
  status: "authenticated" | "2fa_required"
  method?: "trusteddevice" | "sms"
  login_token?: string
  profile?: IosSigningProfile
}

export interface IosWdaJobSnapshot {
  job_id: string
  device_id: string
  udid: string
  action: "prepare" | "renew" | "reinstall"
  status: "running" | "completed" | "failed"
  stage: string
  percent: number
  message: string
  retryable: boolean
  error_code: string
  created_at: string
  updated_at: string
  completed_at: string
  events: Array<{ seq: number; stage: string; message: string; timestamp: string }>
}

export function listIosHosts(): Promise<{ hosts: IosHostNode[] }> {
  return toolFetch(`/ios-hosts`)
}

export function getIosHostDevices(nodeId: string): Promise<{ devices: IosDiscoveredDevice[] }> {
  return toolFetch(`/ios-hosts/${encodeURIComponent(nodeId)}/devices`)
}

export function claimIosDevice(body: { node_id: string; udid: string; label: string }): Promise<{ resource_id: number; device_id: string }> {
  return toolFetch(`/ios-claims`, { method: "POST", body: JSON.stringify(body) })
}

export function listIosSigningProfiles(): Promise<{ profiles: IosSigningProfile[] }> {
  return toolFetch(`/signing-profiles`, { baseOverride: "/api/v1/users/ios" })
}

export function createIosSigningProfile(body: { name: string; kind: "asc" | "p12" | "apple_id"; secret_data: Record<string, unknown> }): Promise<IosSigningProfile> {
  return toolFetch(`/signing-profiles`, { method: "POST", body: JSON.stringify(body), baseOverride: "/api/v1/users/ios" })
}

export function deleteIosSigningProfile(profileId: number): Promise<{ deleted: boolean }> {
  return toolFetch(`/signing-profiles/${profileId}`, { method: "DELETE", baseOverride: "/api/v1/users/ios" })
}

/** 原地更新签名配置：只改名（secret_data 省略），或整包替换材料（id 不变，设备绑定不断）。 */
export function updateIosSigningProfile(
  profileId: number,
  body: { name: string; secret_data?: Record<string, unknown> },
): Promise<IosSigningProfile> {
  return toolFetch(`/signing-profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(body),
    baseOverride: "/api/v1/users/ios",
  })
}

// ── Apple ID 免费签名（两步登录；密码只在请求体内走，绝不落库）─────────────────
// 2FA 完成需重发密码（服务端引擎 complete_2fa 内部重新认证），所以 verifyAppleId2fa
// 也要带 password——不是前端缓存密码。

export function loginAppleId(body: {
  name?: string
  email: string
  password: string
  /** 重新登录已有配置（原 id 更新，设备绑定不断）。 */
  profile_id?: number
  /** 出口代理池条目 id（network 模式）：gsa.apple.com 拒数据中心 IP，被拒网络经代理登录。空 = 直连。 */
  proxy_config_id?: string
  /** 远程 anisette 服务器 URL（如 ani.sidestore.io）：取真实设备指纹，避开本地虚拟指纹被 Apple 503。空 = 本地 anisette 库。 */
  anisette_server?: string
}): Promise<IosAppleIdLoginResult> {
  return toolFetch(`/signing-profiles/apple-id/login`, {
    method: "POST",
    body: JSON.stringify(body),
    baseOverride: "/api/v1/users/ios",
  })
}

export function verifyAppleId2fa(body: {
  login_token: string
  email: string
  password: string
  code: string
  profile_id?: number
  /** 与 login 同口径：2FA 完成那步请求也经同一代理出网。 */
  proxy_config_id?: string
  /** 与 login 同口径：远程 anisette 服务器。 */
  anisette_server?: string
}): Promise<IosAppleIdLoginResult> {
  return toolFetch(`/signing-profiles/apple-id/verify-2fa`, {
    method: "POST",
    body: JSON.stringify(body),
    baseOverride: "/api/v1/users/ios",
  })
}

export function startIosWdaJob(resourceId: number, body: {
  device_id: string
  action: "prepare" | "renew" | "reinstall"
  signing_profile_id?: number
  wda_bundle_id?: string
  xctest_config_name?: string
}): Promise<{ job_id: string; device_id: string; action: string; status: string }> {
  return toolFetch(`/devices/${resourceId}/wda/${body.action}`, { method: "POST", body: JSON.stringify(body), baseOverride: "/api/v1/users/ios" })
}

export function getIosWdaJobStatus(resourceId: number, jobId: string): Promise<IosWdaJobSnapshot> {
  return toolFetch(`/devices/${resourceId}/wda/jobs/${encodeURIComponent(jobId)}`, { baseOverride: "/api/v1/users/ios" })
}

export function cancelIosWdaJob(resourceId: number, jobId: string): Promise<{ job_id: string; cancelled: boolean }> {
  return toolFetch(`/devices/${resourceId}/wda/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", baseOverride: "/api/v1/users/ios" })
}

// ==================== 项目页「构建」tab ====================
//
// 服务端渲染 steps + 一次性上传 token；本轮只 WDA 一个 recipe。构建只编译/打包、
// 绝不签名——勾选「构建后签名」时构建成功后自动串到现有 prepare_wda 流程，
// 前端轮询拿到 wda_job_id 后切到 WDA job 进度展示。

export type ProjectBuildStatus = "running" | "completed" | "failed"

export interface ProjectBuildSnapshot {
  build_id: string
  recipe_kind: string
  node_id: string
  status: ProjectBuildStatus
  stage: string
  percent: number
  message: string
  log_tail?: string
  artifact_sha256?: string
  artifact_size_bytes?: number
  updated_at?: string
}

export interface StartProjectBuildReq {
  recipe_kind: string
  node_id: string
}

export function startProjectBuild(projectId: string, body: StartProjectBuildReq): Promise<{
  build_id: string
  node_id: string
  recipe_kind: string
  status: string
}> {
  return toolFetch(`/${encodeURIComponent(projectId)}/builds`, {
    method: "POST",
    body: JSON.stringify(body),
    baseOverride: "/api/v1/users/projects",
  })
}

export function getProjectBuild(buildId: string): Promise<ProjectBuildSnapshot> {
  return toolFetch(`/builds/${encodeURIComponent(buildId)}`, {
    baseOverride: "/api/v1/users/projects",
  })
}

/** 构建产物下载地址：completed 后前端用此直链让运营方下载 ipa 拖入市场上传。 */
export function projectBuildArtifactUrl(buildId: string): string {
  return `/api/v1/users/projects/builds/${encodeURIComponent(buildId)}/artifact`
}

export function cancelProjectBuild(buildId: string): Promise<{ build_id: string; cancelled: boolean }> {
  return toolFetch(`/builds/${encodeURIComponent(buildId)}/cancel`, {
    method: "POST",
    baseOverride: "/api/v1/users/projects",
  })
}
