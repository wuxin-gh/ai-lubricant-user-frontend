// 市场资源镜像（Phase 2）。
//
// admin 点「镜像」后服务端把市场 skill/插件从原始来源 clone 下来打成 tar.gz 存档；
// 节点在会话启动时不再直连 GitHub，改从我们服务端拉。收益：预下载、跨会话共享缓存、
// 不依赖外网、可鉴权。
//
// 走 monkeycode 风格的 {code,message,data} 信封（见 project-monkeycode-routes-web-resp-envelope）。

export type MirrorModule = "skills" | "plugins"

export type ResourceMirror = {
  id: number
  module: MirrorModule
  market_id: string
  name: string
  version: string
  source_url: string
  source_ref: string
  source_path: string
  digest: string
  archive_path: string
  size_bytes: number
  /** pending=已建待拉 downloading=拉取中 ready=可用 error=失败 */
  status: "pending" | "downloading" | "ready" | "error"
  error: string
  has_token?: boolean
  created_at?: string
  updated_at?: string
  last_fetched_at?: string | null
}

export type MirrorRequest = {
  market_id: string
  name?: string
  version?: string
  source_url?: string
  source_ref?: string
  source_path?: string
}

type Envelope<T> = { code: number; message: string; data: T }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...(init ?? {}),
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  const json = (await res.json()) as Envelope<T>
  if (json.code !== 0) throw new Error(json.message || "请求失败")
  return json.data
}

export function listMirrors(module: MirrorModule): Promise<ResourceMirror[]> {
  return request<ResourceMirror[] | null>(`/api/v1/resources/${module}/mirrors`).then((d) => d ?? [])
}

export function createMirror(module: MirrorModule, body: MirrorRequest): Promise<ResourceMirror> {
  return request<ResourceMirror>(`/api/v1/resources/${module}/mirror`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function refreshMirror(module: MirrorModule, mirrorId: number): Promise<{ id: number; status: string }> {
  return request(`/api/v1/resources/${module}/mirror/${mirrorId}/refresh`, { method: "POST" })
}

export function deleteMirror(module: MirrorModule, mirrorId: number): Promise<{ deleted: boolean }> {
  return request(`/api/v1/resources/${module}/mirror/${mirrorId}`, { method: "DELETE" })
}

/** 人类可读的存档大小。 */
export function formatSize(bytes: number): string {
  if (!bytes) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function mirrorStatusLabel(status?: string): string {
  return ({ pending: "待拉取", downloading: "拉取中", ready: "已镜像", error: "镜像失败" } as Record<string, string>)[
    status || ""
  ] || ""
}

/**
 * 取「引用已镜像资源」的 spec：url 指向服务端存档、带 fetch_token、source='archive'。
 *
 * 为什么要单独一个端点：fetch_token 是明文凭据，列表接口只回 has_token（见后端
 * row_to_dict），所以复制 spec 时必须按需向服务端取一次。
 */
export function getMirrorSpec(
  module: MirrorModule,
  marketId: string,
  version = "",
): Promise<{ spec: Record<string, unknown>; digest: string }> {
  const q = version ? `?version=${encodeURIComponent(version)}` : ""
  return request(`/api/v1/resources/${module}/spec/${encodeURIComponent(marketId)}${q}`)
}

/** 从市场 manifest 取镜像所需的来源字段（resource.url/ref/path）。 */
export function mirrorRequestFromManifest(manifest: {
  id: string
  name?: string
  version?: string
  source_url?: string
  download_url?: string
  resource?: { url?: string; ref?: string; path?: string }
}): MirrorRequest {
  const r = manifest.resource || {}
  return {
    market_id: manifest.id,
    name: manifest.name || manifest.id,
    version: manifest.version || "",
    // 镜像要的是可 clone 的仓库地址；manifest 里 source_url 通常就是 GitHub 仓库
    source_url: manifest.source_url || r.url || manifest.download_url || "",
    source_ref: r.ref || "",
    source_path: r.path || "",
  }
}
