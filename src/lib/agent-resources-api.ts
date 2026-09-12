// Thin typed wrapper around the public /api/v1/skills and /api/v1/plugins
// endpoints that power the task-creation pickers. The mcai-gh frontend does
// not surface any of the resource-management CRUD (rules / repos / agents):
// those live on the admin console (mcai-admin-new) per the agent-resources
// slim spec §7.4. This module only exposes the read-only listing types that
// the task-input components consume.

import i18n from "@/i18n"

function agentResourcesText(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`agentResourcesApi.${key}`, options))
}

// Backend response envelope used by GoYoko/v1 routes.
type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...(init ?? {}),
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    if (
      window.location.pathname.includes("/console") ||
      window.location.pathname.includes("/manager")
    ) {
      window.location.href = "/login"
    }
    throw new Error(agentResourcesText("unauthorized"))
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  if (json.code !== 0) {
    throw new Error(json.message || agentResourcesText("requestFailed"))
  }
  return json.data
}

// ---- Task-creation pickers (skills / plugins listing) ----
//
// The /api/v1/skills and /api/v1/plugins listing endpoints (mcai-backend, see
// agent-resources slim spec §7.4) return a flat array of "ready-to-pick"
// items: only active, non-orphan resources.

/** Item returned by GET /api/v1/plugins (task-creation picker). */
export type PluginListItem = {
  id: string
  name: string
  description: string
  entry: string
  active_version?: string
  is_force_delivery: boolean
  /** 来源：github | upload | npm | bare；source_url 为 GitHub 仓库或下载地址。 */
  source_type?: string | null
  source_url?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export function fetchPluginListing(): Promise<PluginListItem[]> {
  return request<PluginListItem[] | null>(`/api/v1/plugins`).then(
    (data) => data ?? []
  )
}

export function fetchManagedPluginListing(): Promise<PluginListItem[]> {
  return request<PluginListItem[] | null>(`/api/v1/plugins?manage=true`).then((data) => data ?? [])
}

export type ManagedResourcePayload = {
  name: string
  description?: string
  enabled?: boolean
  is_force_delivery?: boolean
}

export type ResourceImportPayload = {
  name?: string
  description?: string
  enabled?: boolean
  is_force_delivery?: boolean
  /** 技能包：显式指定 zip 内要用的 SKILL.md 路径（覆盖服务端默认最短路径 finder）。 */
  skill_md_path?: string
}

async function importResourceUpload<T>(resource: "skills" | "plugins", file: File, payload: ResourceImportPayload): Promise<T> {
  const form = new FormData()
  form.set("file", file)
  if (payload.name) form.set("name", payload.name)
  if (payload.description !== undefined) form.set("description", payload.description)
  form.set("enabled", String(payload.enabled ?? true))
  form.set("is_force_delivery", String(payload.is_force_delivery ?? false))
  if (payload.skill_md_path) form.set("skill_md_path", payload.skill_md_path)
  return request<T>(`/api/v1/${resource}/import/upload`, { method: "POST", body: form })
}

async function importResourceUrl<T>(resource: "skills" | "plugins", url: string, payload: ResourceImportPayload): Promise<T> {
  return request<T>(`/api/v1/${resource}/import/url`, {
    method: "POST",
    body: JSON.stringify({ url, ...payload }),
  })
}

export function importPluginUpload(file: File, payload: ResourceImportPayload): Promise<PluginListItem> {
  return importResourceUpload("plugins", file, payload)
}

export function importPluginUrl(url: string, payload: ResourceImportPayload): Promise<PluginListItem> {
  return importResourceUrl("plugins", url, payload)
}

export function updatePluginResource(id: string, payload: Partial<ManagedResourcePayload>): Promise<PluginListItem> {
  return request<PluginListItem>(`/api/v1/plugins/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) })
}
export function deletePluginResource(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/plugins/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** Item returned by GET /api/v1/skills (task-creation picker). */
export type SkillListItem = {
  id: string
  name: string
  description?: string
  tags?: string[]
  categories?: string[]
  args_schema?: Record<string, unknown>
  content?: string
  /** Skill ID surfaced by the swagger model — kept for backward compatibility. */
  skill_id?: string
  is_force_delivery?: boolean
  /** 来源：github | upload；source_url 为 GitHub 归档或仓库地址。 */
  source_type?: string | null
  source_url?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export function fetchSkillListing(): Promise<SkillListItem[]> {
  return fetch("/api/v1/skills", { credentials: "include" }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    return (body?.data || body?.skills || body || []) as SkillListItem[]
  })
}

export function fetchManagedSkillListing(): Promise<SkillListItem[]> {
  return fetch("/api/v1/skills?manage=true", { credentials: "include" }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    return (body?.data || body?.skills || body || []) as SkillListItem[]
  })
}

export function importSkillUpload(file: File, payload: ResourceImportPayload): Promise<SkillListItem> {
  return importResourceUpload("skills", file, payload)
}

export function importSkillUrl(url: string, payload: ResourceImportPayload): Promise<SkillListItem> {
  return importResourceUrl("skills", url, payload)
}

export type ParsedResource = {
  kind: "skill" | "plugin"
  filename: string
  name: string
  description: string
  tags?: string[]
  entry?: string
  root?: string
  extra?: Record<string, unknown>
}

export function parseSkillUpload(file: File): Promise<ParsedResource> {
  const form = new FormData()
  form.set("file", file)
  return request<ParsedResource>(`/api/v1/skills/parse`, { method: "POST", body: form })
}

export function parseSkillUrl(url: string): Promise<ParsedResource> {
  return request<ParsedResource>(`/api/v1/skills/parse`, { method: "POST", body: JSON.stringify({ url }) })
}

export function parsePluginUpload(file: File): Promise<ParsedResource> {
  const form = new FormData()
  form.set("file", file)
  return request<ParsedResource>(`/api/v1/plugins/parse`, { method: "POST", body: form })
}

export function parsePluginUrl(url: string): Promise<ParsedResource> {
  return request<ParsedResource>(`/api/v1/plugins/parse`, { method: "POST", body: JSON.stringify({ url }) })
}

export function updateSkillResource(id: string, payload: Partial<ManagedResourcePayload>): Promise<SkillListItem> {
  return request<SkillListItem>(`/api/v1/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) })
}
export function deleteSkillResource(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/skills/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ---- GitHub 市场合并 ----
//
// 编辑器资源选择器 / 任务创建选择器在本地 /api/v1/skills、/api/v1/plugins 之外，
// 再合并 GitHub 市场 modules/skills、modules/plugins（前端直读 raw）。市场项带
// `__source: "marketplace"` 标记；选中后由调用方映射成 SkillSpec / NodePluginSpec。
// 本地项优先，避免重复。市场不可用（未配置/限流）时静默回退到本地列表。

import {
  fetchMarketIndex,
  MARKET_SOURCE,
  type MarketItem,
} from "@/api/marketplaceRaw"

export type SkillListingItem = SkillListItem & { __source?: string; market_id?: string }
export type PluginListingItem = PluginListItem & { __source?: string; market_id?: string }

function dedupeByLocal<T extends { id?: string; name?: string; __source?: string }>(
  local: T[],
  market: MarketItem[],
): MarketItem[] {
  const localKeys = new Set<string>()
  local.forEach((it) => {
    if (it.id) localKeys.add(it.id)
    if (it.name) localKeys.add(it.name)
  })
  return market.filter((it) => (!it.id || !localKeys.has(it.id)) && (!it.name || !localKeys.has(it.name)))
}

/** 本地 skills + GitHub 市场 skills（modules/skills），合并去重。 */
export async function fetchSkillListingWithMarket(): Promise<SkillListingItem[]> {
  const local = await fetchSkillListing().catch(() => [] as SkillListItem[])
  const market = await fetchMarketIndex("skills").catch(() => [] as MarketItem[])
  const fresh = dedupeByLocal(local, market)
  const marketItems: SkillListingItem[] = fresh.map((it) => ({
    id: it.id,
    name: it.name || it.id,
    description: it.summary,
    tags: it.tags,
    is_force_delivery: false,
    __source: MARKET_SOURCE,
    market_id: it.id,
  }))
  return [...local, ...marketItems]
}

/** 本地 plugins + GitHub 市场 plugins（modules/plugins），合并去重。 */
export async function fetchPluginListingWithMarket(): Promise<PluginListingItem[]> {
  const local = await fetchPluginListing().catch(() => [] as PluginListItem[])
  const market = await fetchMarketIndex("plugins").catch(() => [] as MarketItem[])
  const fresh = dedupeByLocal(local, market)
  const marketItems: PluginListingItem[] = fresh.map((it) => ({
    id: it.id,
    name: it.name || it.id,
    description: it.summary || "",
    entry: "",
    is_force_delivery: false,
    __source: MARKET_SOURCE,
    market_id: it.id,
  }))
  return [...local, ...marketItems]
}
