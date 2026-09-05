/**
 * 用户侧任务环境 API。
 *
 * 环境是用户在创建任务前先选的东西：它决定编辑器跑在哪个 HOME 上，共用档还带一套
 * 可复用的 skill/MCP/插件配置。只有共用档有记录——系统档用节点操作者的真实 HOME、
 * 隔离档是每次一次性的初始环境，都由档位名直接解析，没有可管理的东西。
 *
 * 两个真相源：`resources` 是用户配的期望状态，`extras` 是节点回报磁盘上有、但配置里
 * 没有的（多半是从维护终端手装的）。服务端已经把两边 diff 好，每条带 state。
 *
 * 「改环境资源」是真装真卸（`syncEnvironment` 下发到节点）；任务里取消某个资源只是
 * 那一次运行不激活它，不动环境的文件。
 */

/** 环境档位：系统内置 / 隔离 / 共用。空视为隔离（初始环境）。 */
export type EnvTier = "system" | "isolated" | "shared"

/** 环境里一条配置的资源，state 已由服务端与节点清单 diff 得出。 */
export interface EnvResource {
  id: string
  kind: "skill" | "mcp" | "plugin"
  resource_id: string
  name: string
  version: string
  /**
   * installed=节点上已装；pending=已配置但节点还没装（改完没同步/节点离线）；
   * config=MCP，不是文件所以无所谓装没装，每个任务用自己的 token 现取。
   */
  state?: "installed" | "pending" | "config"
  installed_version?: string
}

/** 节点上有、配置里没有的条目（手动装的），只展示不自动删。 */
export interface EnvExtra {
  kind: string
  name: string
  version: string
  state: "extra"
}

export interface TaskEnvironment {
  id: string
  name: string
  description?: string | null
  node_id: string
  revision: number
  synced_revision: number
  /** 配置改了还没同步到节点。改完/节点离线时为 true。 */
  needs_sync: boolean
  last_synced_at?: string | null
  last_sync_error?: string | null
}

export interface TaskEnvironmentDetail extends TaskEnvironment {
  resources: EnvResource[]
  extras: EnvExtra[]
}

async function envFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
  const rawBody = await response.text()
  let body: any = null
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = rawBody
    }
  }
  if (!response.ok) {
    const message =
      (body && (body.error?.message || body.detail || body.message)) ||
      (typeof body === "string" ? body : "") ||
      `HTTP ${response.status}`
    throw new Error(typeof message === "string" ? message : JSON.stringify(message))
  }
  return body as T
}

const base = "/api/v1/teams/environments"
const idPath = (envId: string) => `${base}/${encodeURIComponent(envId)}`

/** GET /api/v1/teams/environments —— 我的共用环境；传 nodeId 只看该节点上的。 */
export async function listEnvironments(nodeId?: string): Promise<TaskEnvironment[]> {
  const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ""
  const res = await envFetch<{ environments: TaskEnvironment[] }>(`${base}${query}`)
  return res.environments ?? []
}

/** POST /api/v1/teams/environments —— 新建共用环境（id 由数据库生成）。 */
export function createEnvironment(payload: {
  node_id: string
  name: string
  description?: string
}): Promise<TaskEnvironment> {
  return envFetch<TaskEnvironment>(base, { method: "POST", body: JSON.stringify(payload) })
}

/** GET /api/v1/teams/environments/{id} —— 环境 + 配置资源 + 节点清单（已 diff）。 */
export function getEnvironment(envId: string): Promise<TaskEnvironmentDetail> {
  return envFetch<TaskEnvironmentDetail>(idPath(envId))
}

/** PATCH /api/v1/teams/environments/{id} —— 改名/改描述，节点目录不动。 */
export function updateEnvironment(
  envId: string,
  payload: { name?: string; description?: string },
): Promise<TaskEnvironment> {
  return envFetch<TaskEnvironment>(idPath(envId), { method: "PATCH", body: JSON.stringify(payload) })
}

/** DELETE /api/v1/teams/environments/{id} —— 删环境并回收节点目录。 */
export function deleteEnvironment(envId: string): Promise<{ deleted: boolean }> {
  return envFetch<{ deleted: boolean }>(idPath(envId), { method: "DELETE" })
}

/** POST .../resources —— 往环境加一个已授权资源。 */
export function addEnvironmentResource(
  envId: string,
  payload: { kind: "skill" | "mcp" | "plugin"; resource_id: string },
): Promise<EnvResource> {
  return envFetch<EnvResource>(`${idPath(envId)}/resources`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** DELETE .../resources/{entryId} —— 从环境移除（下次同步时真卸）。 */
export function removeEnvironmentResource(
  envId: string,
  entryId: string,
): Promise<{ deleted: boolean }> {
  return envFetch<{ deleted: boolean }>(`${idPath(envId)}/resources/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  })
}

/** POST .../sync —— 把配置的 skill/插件真安装到节点上（真装真卸）。 */
export function syncEnvironment(envId: string): Promise<TaskEnvironment> {
  return envFetch<TaskEnvironment>(`${idPath(envId)}/sync`, { method: "POST" })
}

/** POST .../inventory —— 重新读一次节点上该环境实际装了什么。 */
export async function refreshEnvironmentInventory(envId: string): Promise<EnvExtra[]> {
  const res = await envFetch<{ installed: EnvExtra[] }>(`${idPath(envId)}/inventory`, {
    method: "POST",
  })
  return res.installed ?? []
}
