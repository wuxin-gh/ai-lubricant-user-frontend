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
