/**
 * 市场消费侧客户端（服务端代理读取）。
 *
 * 设计要点：
 * - 不再直读 ``raw.githubusercontent.com``——浏览器走不到服务端代理，国内必断。
 *   改为调服务端公开端点（``/api/v1/marketplace/consumer/*``），服务端经
 *   proxy_manager 用资源中心配置的 proxy_id 出网，把 raw JSON 加工后返回。
 * - 进程内 TTL 缓存（3 秒）：既要实时（管理页刚发布的版本能立刻看到），又防抖
 *   （同一秒内并发只打一次服务端）。``flush=true`` 跳过缓存。
 * - 失败返回空并 console.warn，不抛：市场不可用不影响主功能。
 * - ``manifestTo*`` 映射保留：服务端返回原样 manifest，前端按页面需要映射。
 */
import { type DomainStackProfile } from "@/api/Api"
import { useEffect, useState } from "react"

// ---------- 类型 ----------

export type MarketItem = {
  id: string
  module?: string
  kind?: string
  name?: string
  display_name?: string
  summary?: string
  publisher?: string
  category?: string
  tags?: string[]
  item_path?: string
  latest_version?: string
  status?: "published" | "hidden" | "draft" | "deleted"
  /** node-versions 摘要扩展字段。 */
  test_version?: boolean
  node_assets?: number
  runtime_assets?: number
}

export type MarketManifest = {
  schema?: string
  id: string
  kind?: string
  name?: string
  display_name?: string
  summary?: string
  description?: string
  publisher?: string
  category?: string
  tags?: string[]
  version?: string
  status?: string
  source_url?: string
  download_url?: string
  digest?: string
  compatibility?: { providers?: string[] }
  resource?: {
    type?: string
    transport?: string
    url?: string
    headers_schema?: Array<{ key: string; type: string; required?: boolean }>
    entry?: string
    provider?: string
    package_format?: string
    path?: string
    ref?: string
    username?: string
    password?: string
    token?: string
    source?: string
  }
  versions?: Array<{
    version?: string
    download_url?: string
    digest?: string
    released_at?: string
    notes?: string
  }>
}

export type MarketModule =
  | "mcp"
  | "plugins"
  | "skills"
  | "prompts"
  | "channels"
  | "node-versions"
  | "mobile-versions"
  | "device-control-versions"

// ---------- 缓存 ----------

const TTL_MS = 3 * 1000
const cache = new Map<string, { expiresAt: number; value: unknown }>()
const pending = new Map<string, Promise<unknown>>()

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.value as T
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value })
}

/** 清空全部市场缓存，或只清某个模块/单条 manifest。 */
export function invalidateMarketCache(module?: MarketModule, itemId?: string): void {
  if (!module) {
    cache.clear()
    pending.clear()
    return
  }
  const keys = itemId
    ? [`manifest:${module}:${itemId}`]
    : [`idx:${module}`, `idxall:${module}`, ...Array.from(cache.keys()).filter((key) => key.startsWith(`manifest:${module}:`))]
  for (const key of keys) {
    cache.delete(key)
    pending.delete(key)
  }
}

async function deduped<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key) as Promise<T> | undefined
  if (existing) return existing
  const request = load().finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

// ---------- 服务端可用性 ----------

let statusPromise: Promise<boolean> | null = null

/**
 * 市场是否可用（运行时判定）：调服务端 ``/consumer/status``，要求 enabled 且 verified。
 * 结果按进程缓存，多个页面并发调用只发一次请求。
 */
export function isMarketplaceEnabled(): Promise<boolean> {
  if (!statusPromise) {
    statusPromise = fetch("/api/v1/marketplace/consumer/status", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled?: boolean; verified?: boolean } | null) => !!(data?.enabled && data.verified))
      .catch(() => false)
  }
  return statusPromise
}

/**
 * 市场是否可用的 React 读法。返回 undefined 表示仍在探测中，
 * 页面据此区分「加载中」与「未启用」，不要一上来就显示未启用。
 */
export function useMarketplaceEnabled(): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void isMarketplaceEnabled().then((ok) => { if (!cancelled) setEnabled(ok) })
    return () => { cancelled = true }
  }, [])
  return enabled
}

// ---------- 读取（服务端代理） ----------

type IndexFile = { schema?: string; module?: string; updated_at?: string; items?: MarketItem[] }

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store" })
    if (!res.ok) {
      console.warn(`[marketplace] ${url} -> HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[marketplace] fetch failed: ${url}`, err)
    return null
  }
}

/**
 * 读取某模块索引的**全部** published 条目（服务端已过滤 hidden/draft/deleted）。
 * 管理页若需看 hidden/draft，请走 ``marketplaceAdmin.fetchMarketplaceCatalog``（``/admin/catalog``）。
 * @param flush 跳过缓存强制刷新
 */
export async function fetchMarketIndexAll(module: MarketModule, flush = false): Promise<MarketItem[]> {
  const key = `idxall:${module}`
  if (!flush) {
    const cached = cacheGet<MarketItem[]>(key)
    if (cached) return cached
  } else {
    cache.delete(key)
  }
  return deduped(key, async () => {
    const data = await fetchJson<IndexFile>(`/api/v1/marketplace/consumer/index/${encodeURIComponent(module)}`)
    const items = (data?.items || []).filter((it) => it.status !== "deleted")
    cacheSet(key, items)
    return items
  })
}

// ---------- 社区运营配置（技术交流群 + 社区通知） ----------
//
// 无鉴权公开端点，供用户控制台「技术交流群 / 社区信息」弹窗拉取。配置极少变，
// 弹窗打开时才调、不缓存——保证管理员刚保存的改动立即可见。

export interface CommunityGroupPublic {
  id: string
  type: string
  label: string
  qr_image: string
}

export interface CommunityNoticeEntryPublic {
  id: string
  kind: "text" | "image"
  text?: string
  image?: string
}

export interface CommunityConfigPublic {
  groups: CommunityGroupPublic[]
  notice: { enabled: boolean; entries: CommunityNoticeEntryPublic[] }
}

export async function fetchCommunityConfig(): Promise<CommunityConfigPublic | null> {
  return fetchJson<CommunityConfigPublic>("/api/v1/marketplace/community-config")
}

/**
 * 读取某模块索引（published）。与 {@link fetchMarketIndexAll} 同源，服务端已过滤。
 * @param flush 跳过缓存强制刷新
 */
export async function fetchMarketIndex(module: MarketModule, flush = false): Promise<MarketItem[]> {
  return fetchMarketIndexAll(module, flush)
}

/**
 * 读取单个资源 manifest。未配置或失败时返回 null。
 */
export async function fetchMarketManifest(
  module: MarketModule,
  itemId: string,
  flush = false,
): Promise<MarketManifest | null> {
  const key = `manifest:${module}:${itemId}`
  if (!flush) {
    const cached = cacheGet<MarketManifest>(key)
    if (cached) return cached
  } else {
    cache.delete(key)
  }
  return deduped(key, async () => {
    const safe = itemId.replaceAll("/", ".")
    const data = await fetchJson<MarketManifest>(
      `/api/v1/marketplace/consumer/item/${encodeURIComponent(module)}/${encodeURIComponent(safe)}`,
    )
    if (data) cacheSet(key, data)
    return data
  })
}

// ---------- 映射：manifest -> 现有页面所需字段 ----------

/**
 * 把市场 manifest 映射成 MCP 市场 catalog 行（McpService 形态，供 McpServiceDialog 预填）。
 * 只填安装需要的字段，其余交给对话框默认值。
 */
export function manifestToMcpService(manifest: MarketManifest, source = "marketplace"): {
  name: string
  display_name?: string
  description?: string
  category?: string
  transport?: string
  command?: string | null
  args?: string[]
  env_template?: Record<string, string>
  url?: string | null
  version?: string
  author?: string
  docs_url?: string
  source?: string
  kind?: string
  /** 部署形态：remote->server（全局），stdio->session（会话内）。见 derive_deploy_scope 注释。 */
  deploy_scope?: "server" | "session"
} {
  const r = manifest.resource || {}
  const isRemote = r.type === "remote_mcp" || !!r.url
  return {
    name: manifest.name || manifest.id,
    display_name: manifest.display_name || manifest.name,
    description: manifest.summary || manifest.description || "",
    category: manifest.category || "custom",
    transport: isRemote ? r.transport || "sse" : "stdio",
    command: isRemote ? null : r.entry || null,
    args: [],
    env_template: {},
    url: isRemote ? r.url || null : null,
    version: manifest.version,
    author: manifest.publisher,
    docs_url: manifest.source_url,
    source,
    kind: isRemote ? "sse" : "stdio",
    deploy_scope: isRemote ? "server" : "session",
  }
}

/**
 * 把市场 manifest 映射成编辑器 NodePluginSpec wire shape（name/url/version）。
 * 选中后写进 editor.plugin_config，由 routes_editors.py 透传给 node。
 */
export function manifestToPluginSpec(manifest: MarketManifest): {
  name: string
  url: string
  version?: string
} {
  return {
    name: manifest.name || manifest.id,
    url: manifest.download_url || manifest.resource?.url || manifest.source_url || "",
    version: manifest.version,
  }
}

/**
 * 把市场 manifest 映射成编辑器 SkillSpec wire shape
 * （name/source/url/path/ref/username/password/token）。
 */
export function manifestToSkillSpec(manifest: MarketManifest): {
  name: string
  source?: string
  url?: string
  path?: string
  ref?: string
  username?: string
  password?: string
  token?: string
} {
  const r = manifest.resource || {}
  return {
    name: manifest.name || manifest.id,
    source: r.source || "github",
    url: manifest.source_url || r.url || manifest.download_url || "",
    path: r.path,
    ref: r.ref,
    username: r.username,
    password: r.password,
    token: r.token,
  }
}

/** 标记来源用，便于选择器/卡片区分本地与市场项。 */
export const MARKET_SOURCE = "marketplace"

// ── 外部榜单发现视图（Agent-Leaderboard 同步后的已发布条目）──────────────────
// 与上面模块索引不同：榜单候选池存数据库,只读 published。``installable=false`` 的
// 条目（开发框架、研究程序、awesome 目录）也在这里出现,但只渲染成「仅浏览」卡片,
// 没有「加入」按钮——点开只跳 GitHub。

export interface LeaderboardDiscoverItem {
  id: number
  board: string
  repo_full_name: string
  repo_url: string
  description: string
  stars: number
  forks: number
  language: string
  topics: string[]
  use_cases: string[]
  target_module: string
  /** 分类（多选）：主分类 + 全部勾选的形态。 */
  target_modules?: string[]
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
  /** 排序（资源中心索引）。 */
  sort_order?: number | null
  /** skill/plugin/prompt 的安装配置。 */
  install_spec?: Record<string, unknown>
  installable: boolean
  labels: string[]
  launch_spec: Record<string, unknown>
  /** 我们的名次（默认=上游榜单名次，管理员可手动固定），越小越靠前；null=未上榜排最后。 */
  display_rank?: number | null
  upstream_updated_at?: string | null
  published_at?: string | null
}

export async function fetchLeaderboardDiscover(params: {
  target_module?: string
  board?: string
  installable?: boolean
  q?: string
  /** 技术栈 tag 过滤（python/typescript/web_frontend…，后端 stack_tags @> 匹配）。 */
  stack_tag?: string
  limit?: number
  offset?: number
} = {}): Promise<LeaderboardDiscoverItem[]> {
  const qs = new URLSearchParams()
  if (params.target_module) qs.set("target_module", params.target_module)
  if (params.board) qs.set("board", params.board)
  if (typeof params.installable === "boolean") qs.set("installable", String(params.installable))
  if (params.q) qs.set("q", params.q)
  if (params.stack_tag) qs.set("stack_tag", params.stack_tag)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.offset) qs.set("offset", String(params.offset))
  const data = await fetchJson<{ items: LeaderboardDiscoverItem[]; count: number }>(
    `/api/v1/marketplace/consumer/leaderboard?${qs}`,
  )
  return data?.items || []
}
