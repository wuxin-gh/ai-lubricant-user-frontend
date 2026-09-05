/**
 * 节点列表的归一化视图模型。
 *
 * 管理端和用户侧从两个不同接口拿节点：
 * - 管理端 `GET /api/v1/admin/nodes`（`@/@admin-port/api/nodes`）：全量、字段名 `role`
 * - 用户侧 `GET /api/v1/teams/my-nodes`（`@/api/nodes`）：只含被授权的，字段名
 *   `node_role`，且多一个 `display_only`（仅归属展示的父管理节点）与容量占用
 *
 * 两套投影各有历史包袱，直接让渲染组件同时认两种形状会把 `role ?? node_role`
 * 这类分支散到每个单元格里。这里收成一个 {@link NodeView}：适配器负责摊平差异，
 * 渲染层只认 NodeView。后续接口再加字段，只改适配器，不动渲染。
 */
import type { NodeInfo as AdminNodeInfo } from "@/@admin-port/api/nodes"
import type { NodeInfo as MyNodeInfo } from "@/api/nodes"
import type { NodeCaps } from "@/pages/manager/platform/nodes/types"

/** 列表投影后的顶层角色（两类管理节点都归一成 management）。 */
export type NodeViewRole = "execution" | "management" | "ios_host" | ""

/** 渲染层唯一认识的节点形状。 */
export interface NodeView {
  nodeId: string
  nodeName: string
  role: NodeViewRole
  /** 纯分组容器（passive_management）：无客户端、不拨号、没有机器信息可看。 */
  isPassive: boolean
  /**
   * 仅归属展示：用户侧被授权了某执行节点、但没被授权它的父管理节点时，父行只用来
   * 画树，不暴露状态与机器信息，也不给任何操作。管理端恒为 false。
   */
  displayOnly: boolean
  status: string
  connected: boolean
  online: boolean
  lastHeartbeatAt: string
  managerNodeId: string
  capabilities: NodeCaps
  capacity?: { max_sessions?: number; cpu_total?: number; memory_total?: number }
  activeSessions: number
  editorOccupancy: number
  /** 原始行，供薄壳做自己那侧的操作（审批要 admin NodeInfo，任务选节点要 MyNodeInfo）。 */
  raw: AdminNodeInfo | MyNodeInfo
}

/** 管理端节点行 → NodeView。管理端看的是全量，没有"仅归属展示"这回事。 */
export function fromAdminNode(node: AdminNodeInfo): NodeView {
  return {
    nodeId: node.node_id,
    nodeName: node.node_name || node.node_id,
    role: (node.role || "") as NodeViewRole,
    isPassive: Boolean(node.is_passive),
    displayOnly: false,
    status: node.status || "unknown",
    connected: Boolean(node.connected),
    online: Boolean(node.online ?? node.connected),
    lastHeartbeatAt: node.last_heartbeat_at || "",
    managerNodeId: node.manager_node_id || "",
    capabilities: (node.capabilities || {}) as NodeCaps,
    capacity: undefined,
    activeSessions: (node.active_session_ids || []).length,
    editorOccupancy: 0,
    raw: node,
  }
}

/** 用户侧节点行 → NodeView。`node_role` 是绑定时快照，`role` 是实时值，优先实时。 */
export function fromMyNode(node: MyNodeInfo): NodeView {
  return {
    nodeId: node.node_id,
    nodeName: node.node_name || node.node_id,
    role: ((node.role || node.node_role || "") as NodeViewRole),
    isPassive: Boolean(node.is_passive),
    displayOnly: Boolean(node.display_only),
    status: node.status || "unknown",
    connected: Boolean(node.connected),
    online: Boolean(node.online ?? node.connected),
    lastHeartbeatAt: node.last_heartbeat_at || "",
    managerNodeId: node.manager_node_id || "",
    capabilities: (node.capabilities || {}) as NodeCaps,
    capacity: node.capacity,
    activeSessions: node.active_sessions || 0,
    editorOccupancy: node.editor_occupancy || 0,
    raw: node,
  }
}

/** 是否管理节点（含纯分组容器）。 */
export function isManagement(view: NodeView): boolean {
  return view.role === "management"
}

/**
 * 能否进终端：必须有客户端进程（非分组容器）、被授权（非仅归属展示）、已审批且在线。
 * 服务端对管理端与用户侧两条终端通道都做同样校验，这里只是不给无效入口。
 */
export function canOpenTerminal(view: NodeView): boolean {
  return (
    !view.displayOnly &&
    !view.isPassive &&
    view.status === "approved" &&
    view.online
  )
}

/** 首选展示地址：公网 IPv4 → 公网 IPv6 → 内网 IPv4。 */
export function preferredNodeIP(caps: NodeCaps | undefined | null): string {
  return [caps?.public_ip, caps?.public_ipv6, caps?.internal_ip]
    .map((value) => (value || "").trim())
    .find(Boolean) || ""
}

/** 一个管理节点父行 + 它下面的执行节点子行。manager 为 null 即「未受管」合成组。 */
export interface NodeGroup {
  key: string
  manager: NodeView | null
  children: NodeView[]
}

/**
 * 摊平的节点列表 → 父子树。
 *
 * 每个管理节点（分组容器或管理客户端）是一个父行，其下按 managerNodeId 归拢执行
 * 节点；管理节点缺失（未受管 / 直连）的执行节点落进末尾一个 manager=null 的合成组。
 */
export function groupIntoTree(views: NodeView[]): NodeGroup[] {
  const managers = views.filter(isManagement)
  const executions = views.filter((view) => view.role === "execution")
  const childrenByManager = new Map<string, NodeView[]>()
  for (const exe of executions) {
    const key = exe.managerNodeId || ""
    const list = childrenByManager.get(key) || []
    list.push(exe)
    childrenByManager.set(key, list)
  }
  const managerIds = new Set(managers.map((manager) => manager.nodeId))
  const groups: NodeGroup[] = managers.map((manager) => ({
    key: manager.nodeId,
    manager,
    children: childrenByManager.get(manager.nodeId) || [],
  }))
  const orphans = executions.filter(
    (exe) => !exe.managerNodeId || !managerIds.has(exe.managerNodeId),
  )
  if (orphans.length > 0) {
    groups.push({ key: "__unmanaged__", manager: null, children: orphans })
  }
  return groups
}
