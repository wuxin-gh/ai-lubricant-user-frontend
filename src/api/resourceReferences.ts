export type ResourceType = "skill" | "plugin" | "mcp" | "project_prompt"
export type ResourceModule = "skills" | "plugins" | "mcp" | "prompts"

export interface ResourceReference {
  id: string
  team_id: string
  resource_type: ResourceType
  market_module: ResourceModule
  market_id: string
  name: string
  display_name: string
  version: string
  manifest: Record<string, unknown>
  owned_entity_type?: string | null
  owned_entity_id?: string | null
  status: string
  group_ids: string[]
}

type Envelope<T> = { code: number; message: string; data: T }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/resources${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
  const body = await response.json().catch(() => null) as Envelope<T> | { detail?: unknown } | null
  if (!response.ok) {
    const detail = body && "detail" in body ? body.detail : undefined
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail || body || `HTTP ${response.status}`))
  }
  const envelope = body as Envelope<T>
  if (envelope.code !== 0) throw new Error(envelope.message || "请求失败")
  return envelope.data
}

export function listResourceReferences(resourceType?: ResourceType): Promise<ResourceReference[]> {
  const query = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ""
  return request<ResourceReference[]>(`/references${query}`)
}

export function createResourceReference(module: ResourceModule, marketId: string): Promise<ResourceReference> {
  return request<ResourceReference>("/references", {
    method: "POST",
    body: JSON.stringify({ module, market_id: marketId }),
  })
}

// ── v2（统一资源池：resources + resource_references）────────────────────────

export type ResourceReferenceV2 = {
  id: string
  team_id: string
  resource_id: number
  params: Record<string, unknown>
  display_name: string
  description: string
  version: string
  enabled: boolean
  resource: {
    id: number
    resource_type: "skills" | "skill" | "plugin" | "mcp" | "prompt"
    resource_data: Record<string, any>
    association: string[]
    editors: string[]
    source_type: string
    source_data: Record<string, any>
    name: string
    display_name: string
    description: string
    version: string
    status: string
  }
}

/** 列团队引用（新表）。resourceType 兼容旧枚举：skill → skill+skills 集合并集。 */
export function listReferencesV2(resourceType?: string): Promise<ResourceReferenceV2[]> {
  const q = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ""
  return request<ResourceReferenceV2[]>(`/v2/references${q}`)
}

/** 取消团队引用（新表）。有分组授权时 409。 */
export function deleteReferenceV2(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/v2/references/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** GitHub 识别 v2：先落池（resources upsert by repo）再建引用（FK 池行）。 */
export function createReferenceFromGithubV2(payload: {
  repo: string
  ref?: string
  kind: "skills" | "skill" | "plugin" | "mcp"
  params?: { token?: string; headers?: Record<string, string>; env?: Record<string, string>; url?: string; transport?: string }
  name?: string
  display_name?: string
  description?: string
  entry_index?: number
  pin_commit?: string
}): Promise<ResourceReferenceV2> {
  return request<ResourceReferenceV2>("/references/from-github-v2", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** 新表分组授权：列某分组的引用（resource_grants）。 */
export function listGroupReferencesV2(groupId: string, resourceType?: string): Promise<ResourceReferenceV2[]> {
  const q = resourceType ? `?resource_type=${encodeURIComponent(resourceType)}` : ""
  return request<ResourceReferenceV2[]>(`/v2/groups/${encodeURIComponent(groupId)}/references${q}`)
}

/** 新表分组授权：按类型整组替换引用（skill 覆盖 skill+skills 集合）。 */
export function setGroupReferencesV2(
  groupId: string,
  referenceIds: string[],
  resourceType?: string,
): Promise<ResourceReferenceV2[]> {
  return request<ResourceReferenceV2[]>(`/v2/groups/${encodeURIComponent(groupId)}/references`, {
    method: "PUT",
    body: JSON.stringify({
      reference_ids: referenceIds,
      ...(resourceType ? { resource_type: resourceType } : {}),
    }),
  })
}

/** 引用一个 GitHub 仓库为团队资源引用（服务器零拷贝，节点 setup 时 git clone / 取 zip）。

 * 服务端再探一次取坐标（不信任客户端字段）。kind="skills" 建技能集合引用（一条 skill
 * 引用带 entries 全量清单）；"skill" 单条目（entryIndex 选）；"plugin" 插件。
 * ref 为 commit sha 即钉死；分支则浮动。pin_commit（head_sha）只在 kind=skills 生效。 */
export function createReferenceFromGithub(
  repo: string,
  ref: string,
  kind: "skills" | "skill" | "plugin",
  entryIndex?: number,
  overrides?: { name?: string; display_name?: string; description?: string; pin_commit?: string },
): Promise<ResourceReference> {
  return request<ResourceReference>("/references/from-github", {
    method: "POST",
    body: JSON.stringify({ repo, ref, kind, entry_index: entryIndex, ...overrides }),
  })
}

export function deleteResourceReference(resourceId: string): Promise<{ deleted: boolean }> {
  return request(`/references/${encodeURIComponent(resourceId)}`, { method: "DELETE" })
}

export function listEffectiveResources(resourceType: ResourceType): Promise<ResourceReference[]> {
  return request<ResourceReference[]>(`/effective/${encodeURIComponent(resourceType)}`)
}

export function listGroupResources(groupId: string, resourceType: ResourceType): Promise<ResourceReference[]> {
  return request<ResourceReference[]>(
    `/groups/${encodeURIComponent(groupId)}/${encodeURIComponent(resourceType)}`,
  )
}

export function setGroupResources(
  groupId: string,
  resourceType: ResourceType,
  resourceIds: string[],
): Promise<ResourceReference[]> {
  return request<ResourceReference[]>(
    `/groups/${encodeURIComponent(groupId)}/${encodeURIComponent(resourceType)}`,
    { method: "PUT", body: JSON.stringify({ resource_ids: resourceIds }) },
  )
}
