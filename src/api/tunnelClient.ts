/** 内网穿透方案管理器 — 客户端 (monkeycode_compat 用户侧路由 /api/v1/users)。
 *
 * 方案池 CRUD + 绑定 CRUD(项目内 / 节点总览 / 独立)。后端见
 * monkeycode_compat/routes_tunnel.py。
 *
 * 安全提醒:每条绑定的 public_addr 即凭证,泄漏等同开放访问,使用者自负。
 */
export type TunnelKind = "frpc" | "cloudflared" | "npc"

export interface TunnelScheme {
  id: string
  name: string
  kind: TunnelKind
  config: Record<string, unknown>
  enabled: boolean
  team_id?: string | null
  created_at?: number
  updated_at?: number
}

export type TunnelSchemeConfig = Record<string, unknown>

export interface TunnelBinding {
  id: string
  scheme_id: string
  project_id?: string | null
  node_id: string
  local_host: string
  local_port: number
  // 用户备注,列表显示。可空。
  description?: string | null
  hostname?: string | null
  public_addr?: string | null
  allocated_value?: string | null
  // 主服务只写期望状态后立即返回 pending；运行时服务异步收敛 client_status。
  // delete_requested=true 表示软删请求已提交、资源回收中，列表接口会隐藏该行。
  desired_state?: "running" | "stopped" | string
  delete_requested?: boolean
  run_id?: string | null
  client_status: "pending" | "running" | "failed" | "stopped" | string
  error?: string | null
  created_at?: number
  updated_at?: number
}

/** 删除响应：主服务标记软删后立即返回 pending，运行时服务回收完资源才真正删行。 */
export interface TunnelDeleteResult {
  deleted: boolean
  pending?: boolean
  id?: string
}

async function tunnelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers || {}) as Record<string, string>),
    }
    const adminToken = localStorage.getItem("admin_access_token")
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`
    response = await fetch(path, { ...init, credentials: "include", headers })
  } catch {
    throw new Error("无法连接到内网穿透接口：请确认后端服务已启动。")
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

// ── 方案池 ──────────────────────────────────────────────
export function listTunnelSchemes(): Promise<TunnelScheme[]> {
  return tunnelFetch<TunnelScheme[]>("/api/v1/users/tunnel-schemes")
}

export function createTunnelScheme(input: {
  name: string
  kind: TunnelKind
  config: TunnelSchemeConfig
  team_id?: string | null
  enabled?: boolean
}): Promise<TunnelScheme> {
  return tunnelFetch<TunnelScheme>("/api/v1/users/tunnel-schemes", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateTunnelScheme(
  id: string,
  patch: { name?: string; config?: TunnelSchemeConfig; enabled?: boolean },
): Promise<TunnelScheme> {
  return tunnelFetch<TunnelScheme>(`/api/v1/users/tunnel-schemes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })
}

export function deleteTunnelScheme(id: string): Promise<{ deleted: boolean }> {
  return tunnelFetch<{ deleted: boolean }>(`/api/v1/users/tunnel-schemes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

// ── 绑定 ───────────────────────────────────────────────
/** 主服务自身作为穿透目标时的保留 node_id(后端 tunnel_service.MAIN_SERVICE_TARGET)。 */
export const MAIN_SERVICE_TARGET = "__main__"

export interface BindingInput {
  scheme_id: string
  /** 目标:节点 id、MAIN_SERVICE_TARGET(主服务),或留空由项目运行中任务解析。 */
  node_id?: string
  local_port: number
  local_host?: string
  // cloudflared managed 模式必填:相对方案根域名的子域名(如 app),
  // 后端拼成完整 hostname 并在响应里回传。
  subdomain?: string
  /** 用户备注,列表显示。可空。 */
  description?: string
}

export function listProjectTunnels(projectId: string): Promise<TunnelBinding[]> {
  return tunnelFetch<TunnelBinding[]>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/tunnels`)
}

export function createProjectTunnel(projectId: string, input: BindingInput): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>(`/api/v1/users/projects/${encodeURIComponent(projectId)}/tunnels`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function deleteProjectTunnel(projectId: string, bindingId: string): Promise<TunnelDeleteResult> {
  return tunnelFetch<TunnelDeleteResult>(
    `/api/v1/users/projects/${encodeURIComponent(projectId)}/tunnels/${encodeURIComponent(bindingId)}`,
    { method: "DELETE" },
  )
}

export function listAllTunnels(): Promise<TunnelBinding[]> {
  return tunnelFetch<TunnelBinding[]>("/api/v1/users/tunnels")
}

export function createTunnel(input: BindingInput): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>("/api/v1/users/tunnels", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateTunnel(bindingId: string, input: BindingInput): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>(
    `/api/v1/users/tunnels/${encodeURIComponent(bindingId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  )
}

export function startTunnel(bindingId: string): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>(
    `/api/v1/users/tunnels/${encodeURIComponent(bindingId)}/start`,
    { method: "POST" },
  )
}

export function stopTunnel(bindingId: string): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>(
    `/api/v1/users/tunnels/${encodeURIComponent(bindingId)}/stop`,
    { method: "POST" },
  )
}

export function deleteTunnel(bindingId: string): Promise<TunnelDeleteResult> {
  return tunnelFetch<TunnelDeleteResult>(
    `/api/v1/users/tunnels/${encodeURIComponent(bindingId)}`,
    { method: "DELETE" },
  )
}

export function listSchemeBindings(schemeId: string): Promise<TunnelBinding[]> {
  return tunnelFetch<TunnelBinding[]>(
    `/api/v1/users/tunnel-schemes/${encodeURIComponent(schemeId)}/bindings`,
  )
}

export function listNodeTunnels(nodeId: string): Promise<TunnelBinding[]> {
  return tunnelFetch<TunnelBinding[]>(`/api/v1/users/nodes/${encodeURIComponent(nodeId)}/tunnels`)
}

export function createNodeTunnel(nodeId: string, input: BindingInput): Promise<TunnelBinding> {
  return tunnelFetch<TunnelBinding>(`/api/v1/users/nodes/${encodeURIComponent(nodeId)}/tunnels`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function deleteNodeTunnel(nodeId: string, bindingId: string): Promise<TunnelDeleteResult> {
  return tunnelFetch<TunnelDeleteResult>(
    `/api/v1/users/nodes/${encodeURIComponent(nodeId)}/tunnels/${encodeURIComponent(bindingId)}`,
    { method: "DELETE" },
  )
}
