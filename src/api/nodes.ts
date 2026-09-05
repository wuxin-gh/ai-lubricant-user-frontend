/**
 * Console-side node types.
 *
 * The task runtime is a chosen agent-compose node (hosts/images/VMs were
 * removed). Users see the nodes their groups were granted via the read-only
 * aggregate endpoint ``GET /api/v1/teams/my-nodes`` (mapped to the
 * ``v1UsersNodesList`` method in endpointMap). The shape mirrors the backend
 * ``_binding_dict`` from ``nodes_service``.
 *
 * This is distinct from the admin-port ``@/@admin-port/api/nodes`` client,
 * which speaks the admin axios instance and the daemon control-plane shape;
 * here we only consume the user-facing binding view through ``apiRequest``.
 */

import type { NodeCaps } from "@/pages/manager/platform/nodes/types";

/** A node bound to one of the user's groups, enriched with live daemon state. */
export interface NodeInfo {
  group_id: string;
  node_id: string;
  node_name: string;
  /** Snapshot of the node role at bind time: execution | management. */
  node_role: string;
  /** Same live role field returned by the admin node listing. */
  role?: string;
  /** Installation/startup method, aligned with the admin node listing. */
  startup_method?: string;
  /**
   * A management node with no dial-in client (pure grouping container):
   * surfaced so the tree view can distinguish it from a manageable management
   * client. Execution nodes are always false.
   */
  is_passive?: boolean;
  /** Live daemon status: pending | approved | revoked | unknown. */
  status: string;
  connected: boolean;
  /** Heartbeat-fresh liveness verdict; distinct from a registered connection. */
  online?: boolean;
  manager_node_id: string;
  last_heartbeat_at: string;
  /** Active session ids, aligned with the admin node listing. */
  active_session_ids?: string[];
  /** Live machine labels (os/arch/cpu/memory/providers/client_version/…). */
  capabilities?: NodeCaps;
  /**
   * Operator-configured placement capacity (max concurrent sessions +
   * allocatable CPU cores / memory bytes). Absent/empty = unlimited.
   */
  capacity?: { max_sessions?: number; cpu_total?: number; memory_total?: number };
  /** Live count of sessions currently placed on this node (concurrency). */
  active_sessions?: number;
  /** Static count of non-deleted editors assigned to this node. */
  editor_occupancy?: number;
  bound_at: number;
  /**
   * Display-only tree context: a management node surfaced ONLY so its granted
   * execution child has a visible parent row. The user was NOT granted this
   * management node — it carries no binding and no management rights, so the UI
   * must render it as read-only grouping context, never as a controllable node.
   */
  display_only?: boolean;
}

/** Availability combines persisted approval with live heartbeat state. */
export type NodeLiveness = "online" | "awaiting" | "heartbeat_timeout" | "offline" | "not_execution" | "unknown";

export interface NodeAvailability {
  liveness: NodeLiveness;
  usable: boolean;
  reason: string;
}

/** Shared approval + liveness verdict for all user-side node consumers. */
export function nodeAvailability(node: NodeInfo): NodeAvailability {
  if (node.node_role !== "execution" || node.display_only) {
    return { liveness: "not_execution", usable: false, reason: "非执行节点" };
  }
  if (node.status === "pending") return { liveness: "offline", usable: false, reason: "节点待审批" };
  if (node.status === "revoked") return { liveness: "offline", usable: false, reason: "节点已吊销" };
  if (node.status !== "approved") return { liveness: "unknown", usable: false, reason: "节点状态未知" };

  // `online` is the server heartbeat verdict. Fall back to `connected` only for
  // old server responses that do not carry the field yet.
  if (node.online ?? node.connected) return { liveness: "online", usable: true, reason: "" };
  if (node.connected) return { liveness: "heartbeat_timeout", usable: false, reason: "节点心跳超时" };
  if (node.last_heartbeat_at) return { liveness: "offline", usable: false, reason: "节点离线" };
  return { liveness: "awaiting", usable: false, reason: "节点待连接" };
}

/** A node is selectable only when approved, heartbeat-online, and not full. */
export function isNodeUsable(node: NodeInfo): boolean {
  if (!nodeAvailability(node).usable) return false;
  const maxSessions = node.capacity?.max_sessions || 0;
  if (maxSessions > 0 && (node.active_sessions || 0) >= maxSessions) return false;
  return true;
}

/** Node role → human label (execution/management). */
export const NODE_ROLE_LABEL: Record<string, string> = {
  execution: "执行节点",
  management: "管理节点",
};

/** "占用 n / 容量 m" for an execution node; "" when no capacity configured. */
export function nodeCapacityLabel(node: NodeInfo): string {
  const maxSessions = node.capacity?.max_sessions || 0
  const active = node.active_sessions || 0
  if (maxSessions > 0) return `会话 ${active}/${maxSessions}`
  return active > 0 ? `会话 ${active}` : ""
}

/** "编辑器 n" occupancy label; "" when no editor is assigned. */
export function nodeEditorOccupancyLabel(node: NodeInfo): string {
  const count = node.editor_occupancy || 0
  return count > 0 ? `编辑器 ${count}` : ""
}

/** Live daemon status → badge label + tone className. */
export const NODE_STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "待审批", className: "text-orange-600 dark:text-orange-400" },
  approved: { label: "已审批", className: "text-green-600 dark:text-green-400" },
  revoked: { label: "已吊销", className: "text-muted-foreground" },
  unknown: { label: "未知", className: "text-muted-foreground" },
};

/**
 * 编辑器绑定节点的健康状况。编辑器本身只记 node_id 快照，节点被删除/吊销/掉线后
 * 编辑器行不会自动更新，所以要在展示侧按用户可见的节点列表实时对账：
 *
 * - `missing`：编辑器指定了 node_id，但该节点已不在用户可见列表里（被删除、被吊销，
 *   或授权被收回）——编辑器跑不起来，属于异常。
 * - `offline`：节点还在，但 daemon 侧没有连接（`connected === false`）——同样是异常。
 * - `pending` / `revoked`：节点在列表里但未审批 / 已吊销，一样不可用。
 * - `auto`：编辑器没绑节点（node_id 为空），由调度自动挑选，不算异常。
 * - `ok`：节点存在、已审批且在线。
 */
export type EditorNodeHealthState =
  | "ok"
  | "auto"
  | "missing"
  | "offline"
  | "awaiting"
  | "heartbeat_timeout"
  | "pending"
  | "revoked";

export interface EditorNodeHealth {
  state: EditorNodeHealthState;
  /** 命中的节点；`missing` / `auto` 时为 null。 */
  node: NodeInfo | null;
  /** 是否异常（列表/详情用来决定是否红色告警）。 */
  abnormal: boolean;
  /** 异常原因短语，如「节点不存在」「节点离线」；正常时为空串。 */
  reason: string;
  /** 直接可展示的状态文案：异常时为「异常 · 节点离线」，正常时为「正常」/「自动节点」。 */
  label: string;
}

/**
 * 按编辑器绑定的 node_id 在用户可见节点列表里对账，得出展示用的节点健康状态。
 * 编辑器列表与编辑器详情共用，保证两处口径一致。状态判定复用
 * {@link nodeAvailability}：审批状态与心跳在线分开判定，不再把“连接存在”当成在线。
 */
export function editorNodeHealth(
  nodeId: string | null | undefined,
  nodes: NodeInfo[],
): EditorNodeHealth {
  if (!nodeId) return { state: "auto", node: null, abnormal: false, reason: "", label: "自动节点" };

  const node = nodes.find((item) => item.node_id === nodeId) || null;
  if (!node) return { state: "missing", node: null, abnormal: true, reason: "节点不存在", label: "异常 · 节点不存在" };
  if (node.status === "revoked") return { state: "revoked", node, abnormal: true, reason: "节点已吊销", label: "异常 · 节点已吊销" };
  if (node.status === "pending") return { state: "pending", node, abnormal: true, reason: "节点待审批", label: "异常 · 节点待审批" };
  if (node.status !== "approved") return { state: "offline", node, abnormal: true, reason: "节点状态未知", label: "异常 · 节点状态未知" };

  const { liveness, reason } = nodeAvailability(node);
  if (liveness === "online") return { state: "ok", node, abnormal: false, reason: "", label: "正常" };
  if (liveness === "heartbeat_timeout") return { state: "heartbeat_timeout", node, abnormal: true, reason, label: `异常 · ${reason}` };
  if (liveness === "awaiting") return { state: "awaiting", node, abnormal: true, reason, label: `异常 · ${reason}` };
  return { state: "offline", node, abnormal: true, reason: reason || "节点离线", label: `异常 · ${reason || "节点离线"}` };
}

export interface EditorLike {
  id: string
  status?: string
  node_id?: string | null
}

export interface EditorSelectableResult {
  /** true 时可在选择器中选中；false 时仅展示并禁用。 */
  selectable: boolean
  /** 不可选时的原因短语（可直接展示）；可选时为空串。 */
  reason: string
  /** 直接可展示的状态文案：可选时为“正常”/“自动节点”，不可选时为“异常 · …”。 */
  label: string
  /** 命中的节点（用于显示容量等附加信息）；auto/missing 时为 null。 */
  node: NodeInfo | null
  /** 复用的节点健康结果。 */
  health: EditorNodeHealth
}

/**
 * 编辑器是否可被选中下发任务。统一所有用户侧选择编辑器的地方（创建任务、
 * 任务输入、Review 配置）。口径只看绑定节点的状态：执行节点 + 已审批 + 在线 +
 * 尚有会话余量。Review 框架/能力不再作为门槛，因为 review 是隔离的 skill。
 *
 * 节点未绑定（node_id 为空）的“自动节点”编辑器：正常任务调度可由后端挑选节点，
 * 但 Review 调度需要具体节点承接租约，调用方应按场景自行决定是否禁用。
 */
export function editorSelectable(editor: EditorLike, nodes: NodeInfo[]): EditorSelectableResult {
  const health = editorNodeHealth(editor.node_id, nodes)
  if (editor.status && editor.status !== "active") {
    return { selectable: false, reason: "编辑器已停用", label: "异常 · 编辑器已停用", node: health.node, health }
  }
  if (health.abnormal) {
    return { selectable: false, reason: health.reason, label: health.label, node: health.node, health }
  }
  const node = health.node
  if (node && !isNodeUsable(node)) {
    return { selectable: false, reason: "节点已满载", label: "异常 · 节点已满载", node, health }
  }
  return { selectable: true, reason: "", label: health.label || "正常", node, health }
}

// ==================== 节点宿主机文件浏览（用户侧）====================
//
// 与管理端 `@/@admin-port/api/nodes` 的 nodeHostFile/nodeHostFileUpload 同形，
// 但打用户侧路径 `/api/v1/teams/my-nodes/{id}/files*`：服务端按 GroupNode 授权
// 校验，并要求节点已审批、在线、非分组容器（与用户侧终端 WS 同一套判定）。
// 走原生 fetch + C 端 session cookie，不带 admin token。

export interface NodeHostFileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
}

export interface NodeHostFileResult {
  path: string
  entries?: NodeHostFileEntry[]
  content?: string
  truncated?: boolean
  ok?: boolean
}

/** 用户侧文件操作返回的错误优先取 FastAPI 的 detail，便于直接展示。 */
async function nodeFileError(response: Response): Promise<Error> {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === "string" && detail) return new Error(detail)
  } catch {
    /* 非 JSON 响应，落回状态码 */
  }
  return new Error(`HTTP ${response.status}`)
}

/** POST /api/v1/teams/my-nodes/{nodeId}/files —— 列目录 / 读文件 / 增删改。 */
export async function userNodeHostFile(
  nodeId: string,
  payload: { path: string; operation: string; content?: string; destination?: string },
): Promise<NodeHostFileResult> {
  const response = await fetch(
    `/api/v1/teams/my-nodes/${encodeURIComponent(nodeId)}/files`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) throw await nodeFileError(response)
  return response.json()
}

/**
 * POST /api/v1/teams/my-nodes/{nodeId}/files/upload —— 上传单文件到节点目录。
 *
 * 用 XMLHttpRequest 而不是 fetch：需要上传进度回调（fetch 没有 upload progress）。
 * 不设 Content-Type，交给浏览器按 FormData 自动补 multipart boundary。
 */
export async function userNodeHostFileUpload(
  nodeId: string,
  params: { path: string; file: File; overwrite?: boolean; onProgress?: (percent: number) => void },
): Promise<{ ok: boolean; path: string; bytes_written: number }> {
  const form = new FormData()
  form.append("path", params.path)
  form.append("overwrite", params.overwrite ? "true" : "false")
  form.append("file", params.file, params.file.name)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/v1/teams/my-nodes/${encodeURIComponent(nodeId)}/files/upload`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (!params.onProgress || !event.lengthComputable || !event.total) return
      params.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      let body: { detail?: unknown; ok?: boolean; path?: string; bytes_written?: number } = {}
      try {
        body = JSON.parse(xhr.responseText || "{}")
      } catch {
        /* 保留空对象，下面按状态码判定 */
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = typeof body.detail === "string" && body.detail ? body.detail : `HTTP ${xhr.status}`
        reject(new Error(detail))
        return
      }
      resolve({
        ok: Boolean(body.ok),
        path: String(body.path ?? params.path),
        bytes_written: Number(body.bytes_written ?? 0),
      })
    }
    xhr.onerror = () => reject(new Error("上传失败"))
    xhr.send(form)
  })
}
