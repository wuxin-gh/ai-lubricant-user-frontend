/**
 * 用户自助命令审批策略 C 端客户端。
 *
 * 复用与 editorClient 相同的 fetch 约定（session cookie / 管理端 Bearer），
 * 直接走 /api/v1/users/shell-approval。后端返回裸 dict/list，前端 endpoint
 * map 在外层包 {code,message,data} 信封；本客户端只关心 data 层，由
 * shellApprovalFetch 解出。
 */
export type ShellFlavor = "posix" | "powershell" | "cmd" | "unknown"

export interface PresetCatalogItem {
  shell: ShellFlavor
  key: string
  label: string
  description: string
  default: boolean
}

export interface MyShellPolicy {
  command_key: string
  shell_flavor: ShellFlavor
  note?: string | null
  created_at?: string
  updated_at?: string
}

async function shellApprovalFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new Error("无法连接到审批策略接口：请确认后端服务已启动。")
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

export function getShellApprovalCatalog(): Promise<{ catalog: Record<ShellFlavor, PresetCatalogItem[]> }> {
  return shellApprovalFetch("/api/v1/users/shell-approval/catalog")
}

export function listMyShellPolicies(): Promise<{ policies: MyShellPolicy[] }> {
  return shellApprovalFetch("/api/v1/users/shell-approval")
}

export function putMyShellPolicy(
  commandKey: string,
  shell: ShellFlavor,
  note?: string,
): Promise<MyShellPolicy> {
  return shellApprovalFetch(`/api/v1/users/shell-approval/${encodeURIComponent(commandKey)}`, {
    method: "PUT",
    body: JSON.stringify({ shell, note: note ?? null }),
  })
}

export function deleteMyShellPolicy(commandKey: string, shell: ShellFlavor): Promise<{ deleted: boolean }> {
  const qs = new URLSearchParams({ shell })
  return shellApprovalFetch(
    `/api/v1/users/shell-approval/${encodeURIComponent(commandKey)}?${qs}`,
    { method: "DELETE" },
  )
}

export function clearMyShellPolicies(): Promise<{ deleted: number }> {
  return shellApprovalFetch("/api/v1/users/shell-approval", { method: "DELETE" })
}
