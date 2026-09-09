/**
 * 用户侧 MCP 服务 API 客户端（个人外部 SSE MCP）。
 *
 * 直连后端 `/mcp/my-services/*` 路由，用 monkeycode C 端 session cookie 鉴权。
 * 后端把个人 MCP 存为 mcp_services 行（kind=sse, user_id=自己），鉴权统一为
 * `headers: {"Authorization": "Bearer <token>"}`；提交时前端只传明文 token，
 * 由后端组装成标准 Bearer header 存储。自定义 headers 与请求参数（query）也在此提交。
 *
 * 管理端 / 内置服务对用户只读，不在此处改动。
 */

export interface MyMcpService {
  id: number
  name: string
  display_name: string
  description: string
  kind: string
  url: string
  /** 展示用 token（后端已脱敏，如 `sk-***1234`）；has_token 表示是否已配置。 */
  token: string
  has_token: boolean
  /** 自定义请求头（脱敏视图，不含 Authorization；敏感值已部分遮蔽）。 */
  headers: Record<string, string>
  enabled: boolean
  runtime_status: string | null
  runtime_last_error: string | null
  tool_count: number
  tools: Array<{ name: string; description: string }>
}

export interface CreateMyMcpPayload {
  name: string
  display_name?: string
  description?: string
  url: string
  /** 明文 token；后端组装为 Authorization: Bearer。空串表示无鉴权。 */
  token?: string
  /** 自定义请求头（不含 Authorization，由 token 字段承载）。 */
  headers?: Record<string, string>
  enabled?: boolean
}

export interface UpdateMyMcpPayload {
  display_name?: string
  description?: string
  url?: string
  /** 传非空才更新；未传字段不动已有 token。 */
  token?: string
  /** 自定义请求头；未传字段不动已有 headers。 */
  headers?: Record<string, string>
  enabled?: boolean
}

async function mcpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/mcp${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    })
  } catch {
    // fetch 本身抛错（网络层）：通常是后端未启动 / dev server 代理未生效。
    throw new Error("无法连接到 /mcp 接口：请确认后端服务已启动（接口未改，重启后端开发服务即可）。")
  }
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const data = await r.json()
      detail = data?.detail || data?.message || detail
    } catch {
      // ignore parse error
    }
    throw new Error(detail)
  }
  const text = await r.text()
  return (text ? JSON.parse(text) : {}) as T
}

export function listMyMcpServices(): Promise<MyMcpService[]> {
  return mcpFetch<MyMcpService[]>("/my-services")
}

export function createMyMcpService(payload: CreateMyMcpPayload): Promise<MyMcpService> {
  return mcpFetch<MyMcpService>("/my-services", { method: "POST", body: JSON.stringify(payload) })
}

export function updateMyMcpService(id: number, payload: UpdateMyMcpPayload): Promise<MyMcpService> {
  return mcpFetch<MyMcpService>(`/my-services/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
}

export function deleteMyMcpService(id: number): Promise<{ ok: boolean }> {
  return mcpFetch<{ ok: boolean }>(`/my-services/${id}`, { method: "DELETE" })
}

export function syncMyMcpService(id: number): Promise<{ ok: boolean; tool_count: number; error?: string }> {
  return mcpFetch(`/my-services/${id}/sync`, { method: "POST" })
}

export interface McpPrincipal {
  id: number
  name: string
  description: string
  enabled: boolean
  chat_enabled?: boolean
  token: string
  token_hint?: string
  token_status?: "active" | "disabled"
  expires_at?: string | null
  owner_user_id?: string | null
  masked?: boolean
  created_at?: string | null
  updated_at?: string | null
  /** 用途：用户侧创建只能是 external；agent/task 只读。 */
  usage_type?: "agent" | "external" | "task"
}

export interface McpPrincipalParam {
  param_key: string
  param_value: string
  created_at?: string | null
}

/**
 * principal 的统一授权行（mcp_grants 表）。
 * - grant_key='service' → grant_value=mcp_services.id（服务授权）
 * - grant_key=cdp_client_id/mail_account_id/device_id 等 → grant_value=builtin_tool_resources.id（实例绑定）
 * 一个 principal 可同时有 service 行与 param 行；同一 grant_key 可多行（多实例绑定）。
 */
export interface McpGrant {
  grant_key: string
  grant_value: string
  created_at?: string | null
}

/** authorization/options 下发的 param 类型目录（替代前端硬编码 PARAM_KINDS）。 */
export interface McpAuthorizationParamKind {
  key: string
  label: string
  resource_type: string
}

export interface McpAuthorizationResource {
  // service 项为 "service"；内置资源实例为 "builtin_resource"。放宽为 string 以兼容旧来源。
  resource_kind: string
  resource_id: number
  resource_type: string
  name: string
  url?: string
  description?: string
  tool_count?: number
  transport?: string
  /** service 项来源（builtin=内置/admin=平台/upstream=个人），用于卡片徽章。 */
  source?: string
  /** service 项：执行器 kind（stdio/sse/…）；stdio=true 时前端标灰禁用（执行器未实装）。 */
  kind?: string
  stdio?: boolean
  /** service 项：声明所需 param key（cdp_client_id 等），用于关联实例区。 */
  required_param?: string
  children: Array<{ child_kind: string; child_id: number; name: string }>
}

const principalFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1/users/mcp-principals${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const data = await response.json()
      detail = data?.detail || data?.message || detail
    } catch {
      // ignore parse error
    }
    throw new Error(detail)
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

export function listMcpPrincipals(): Promise<{ principals: McpPrincipal[] }> {
  return principalFetch("", undefined)
}

export function getMcpRuntimeAddress(): Promise<{ port: number; display_host: string; connection_base: string }> {
  return principalFetch("/runtime-address", undefined)
}

export function createMcpPrincipal(payload: { name: string; description?: string; enabled?: boolean; usage_type?: "agent" | "external" }): Promise<McpPrincipal> {
  return principalFetch("", { method: "POST", body: JSON.stringify(payload) })
}

export function updateMcpPrincipal(id: number, payload: { name?: string; description?: string; enabled?: boolean }): Promise<McpPrincipal> {
  return principalFetch(`/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
}

export function rotateMcpPrincipalToken(id: number): Promise<McpPrincipal> {
  return principalFetch(`/${id}/rotate-token`, { method: "POST" })
}

export function deleteMcpPrincipal(id: number): Promise<{ deleted: boolean }> {
  return principalFetch(`/${id}`, { method: "DELETE" })
}

export function listMcpPrincipalParams(id: number): Promise<{ params: McpPrincipalParam[] }> {
  return principalFetch(`/${id}/params`)
}

export function replaceMcpPrincipalParams(id: number, params: McpPrincipalParam[]): Promise<{ params: McpPrincipalParam[] }> {
  return principalFetch(`/${id}/params`, { method: "PUT", body: JSON.stringify({ params }) })
}

/** 统一授权（mcp_grants）：service 行 + param 行一次读写。新前端一律走这组，替代 /params。 */
export function listMcpPrincipalGrants(id: number): Promise<{ grants: McpGrant[] }> {
  return principalFetch(`/${id}/grants`)
}

export function replaceMcpPrincipalGrants(id: number, grants: McpGrant[]): Promise<{ grants: McpGrant[] }> {
  return principalFetch(`/${id}/grants`, { method: "PUT", body: JSON.stringify({ grants }) })
}

export function listMcpAuthorizationOptions(): Promise<{
  resources: McpAuthorizationResource[]
  /** param 类型目录（key/label/resource_type）；旧后端未下发时前端按空目录处理。 */
  param_kinds?: McpAuthorizationParamKind[]
}> {
  return principalFetch("/authorization/options")
}

export interface McpInstanceAuthorization {
  principal_id: number
  name: string
  param_key: string
  param_value: string
}

export function listMcpInstanceAuthorizations(): Promise<{ instances: Record<string, McpInstanceAuthorization[]> }> {
  return principalFetch("/instance-authorizations")
}
