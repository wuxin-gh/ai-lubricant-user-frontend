/**
 * 系统内置环境（env_mode=system）的节点级资源客户端。
 *
 * 与 environmentClient 的区别：共用环境按 env_id 寻址（用户建的命名环境），系统环境
 * 按 node_id 寻址——它就是节点操作者的真实 HOME，一个节点只有一个，没有 env_id。
 *
 * 语义上也不同：共用环境是“配置期望集合再同步”，系统环境是“先看清单，再按需增量
 * 装/卸/归档”。平台不会 prune 操作者自己装的东西，卸载只允许平台装过的条目。
 */
/** 系统环境里可安装/归档的资源类型（MCP 是配置，不落盘，故只展示不写）。 */
export type SystemEnvFileKind = "skill" | "plugin"

/** 一条节点本机 HOME 里观测到的资源。 */
export interface SystemEnvEntry {
  id: string
  kind: "skill" | "plugin" | "mcp"
  name: string
  version: string
  /**
   * 来自哪个 provider 的发现路径（声明方）：.claude/skills→claude、
   * .agents 树→空（无单一属主）、claude 插件→claude、MCP→声明它的那份编辑器
   * 配置（~/.mcp.json 也是 claude 的项目级配置）。
   */
  provider: string
  /**
   * 会加载这条资源的编辑器集合（节点上报的事实，与运行时读取范围一致）。
   * 一条资源被多个编辑器读到就列多个——控制台按它分组编辑器 tab。
   */
  readers: string[]
  /** 相对 HOME 的路径，用来向用户解释这条资源来自哪里。 */
  path: string
  /** 技能 SKILL.md frontmatter / 插件 manifest 里的描述；MCP 无，恒空。 */
  description: string
  /** true = 平台装的（可卸载）；false = 节点操作者自有（只读，可归档入库）。 */
  platform_managed: boolean
  /** 已归档进平台资源库时指向那条引用，用于展示「已入库」。 */
  archived_reference_id: string | null
  reported_at: string | null
}

export interface SystemEnvDetail {
  node_id: string
  /** 节点是否开启系统内置环境；false 时清单必然为空，需要提示如何开启。 */
  system_env_enabled: boolean
  /** 节点当前是否在线；离线时刷新/安装会失败，面板据此禁用按钮。 */
  online: boolean
  resources: Record<string, SystemEnvEntry[]>
  last_reported_at: string | null
}

/** 一次 install/remove 调用里每条资源的实际结果（installed/skipped/removed）。 */
export interface SystemEnvTouched {
  kind: string
  name: string
  version: string
  /** 节点回报的动作：installed | skipped | removed。 */
  path: string
  platform_managed: boolean
}

async function sysEnvFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) {
    const detail = body as { error?: { message?: string }; detail?: string; message?: string } | null
    throw new Error(
      detail?.error?.message || detail?.detail || detail?.message || `请求失败（${response.status}）`,
    )
  }
  return body as T
}

const base = "/api/v1/teams/nodes"
const nodePath = (nodeId: string) => `${base}/${encodeURIComponent(nodeId)}/system-env`

/** GET —— 读已存的清单快照（不打节点，离线也能看到上次的结果）。 */
export async function getSystemEnv(nodeId: string): Promise<SystemEnvDetail> {
  return sysEnvFetch<SystemEnvDetail>(nodePath(nodeId))
}

/** POST /refresh —— 让节点重新扫描本机 HOME，整体替换快照。 */
export async function refreshSystemEnv(nodeId: string, provider = ""): Promise<SystemEnvEntry[]> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : ""
  const data = await sysEnvFetch<{ installed: SystemEnvEntry[] }>(
    `${nodePath(nodeId)}/refresh${query}`,
    { method: "POST" },
  )
  return data.installed || []
}

/** POST /install —— 把一个已授权的平台资源增量装进本机 HOME。 */
export async function installSystemEnvResource(
  nodeId: string,
  payload: { kind: SystemEnvFileKind; resource_id: string; overwrite: boolean },
): Promise<SystemEnvTouched[]> {
  const data = await sysEnvFetch<{ touched: SystemEnvTouched[] }>(`${nodePath(nodeId)}/install`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return data.touched || []
}

/** POST /archive —— 把本机自有的资源打包上传，归档为平台资源库条目。 */
export async function archiveSystemEnvResource(
  nodeId: string,
  payload: { kind: SystemEnvFileKind; name: string },
): Promise<{ archived: boolean; reference_id: string; reference_name?: string }> {
  return sysEnvFetch(`${nodePath(nodeId)}/archive`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** DELETE —— 节点级卸载：删本机文件 + 删平台侧记录（仅平台装过的可删）。 */
export async function removeSystemEnvResource(
  nodeId: string,
  kind: string,
  name: string,
): Promise<{ removed: boolean }> {
  return sysEnvFetch(
    `${nodePath(nodeId)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  )
}
