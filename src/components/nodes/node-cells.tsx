/**
 * 节点列表的单元格与徽标——管理端与用户侧共用。
 *
 * 全部只认 {@link NodeView}，所以两侧接口形状的差异在适配器就摊平了。三种"没内容
 * 可显示"的原因分开表达，不能混成一个短横：
 * - `displayOnly`：用户未被授权该节点，不该让他从这里推断出机器信息 → 「未授权查看」
 * - `isPassive`：纯分组容器，压根没有客户端会上报 → 「无客户端」
 * - 字段缺失：节点还没上报（旧版本或探测失败）→ 「尚未上报」
 */
import { Badge } from "@/components/ui/badge"
import {
  machineFactRows,
  machineInfoLine,
  nodeEditors,
  STATUS_META,
} from "@/pages/manager/platform/nodes/types"
import { preferredNodeIP, type NodeView } from "./node-view"

/** 容量占用标签：「会话 n/m」；未配置容量时按实际占用退化，全空返回 ""。 */
export function nodeCapacityLabel(view: NodeView): string {
  const maxSessions = view.capacity?.max_sessions || 0
  const active = view.activeSessions || 0
  if (maxSessions > 0) return `会话 ${active}/${maxSessions}`
  return active > 0 ? `会话 ${active}` : ""
}

/** 编辑器占用标签：「编辑器 n」；无绑定返回 ""。 */
export function nodeEditorOccupancyLabel(view: NodeView): string {
  const count = view.editorOccupancy || 0
  return count > 0 ? `编辑器 ${count}` : ""
}

/** 机器字段单元格。位置固定，缺失时明说原因，避免误读成「页面不支持这个字段」。 */
export function MachineFactCell({
  view,
  fact,
}: {
  view: NodeView | null
  fact: "system" | "cpu" | "memory"
}) {
  if (!view) return null
  if (view.displayOnly) return <span className="text-xs text-muted-foreground">未授权查看</span>
  if (view.isPassive) return <span className="text-xs text-muted-foreground">无客户端</span>
  const row = machineFactRows(view.capabilities).find((item) => item.key === fact)
  return (
    <span className={row?.reported ? "text-xs whitespace-normal" : "text-xs text-muted-foreground"}>
      {row?.value || "尚未上报"}
    </span>
  )
}

/** 节点客户端版本列（编辑器版本只在详情里展开）。 */
export function VersionCell({ view }: { view: NodeView | null }) {
  if (!view) return null
  if (view.displayOnly) return <span className="text-xs text-muted-foreground">未授权查看</span>
  if (view.isPassive) return <span className="text-xs text-muted-foreground">无客户端</span>
  const version = (view.capabilities?.client_version || "").trim()
  if (!version) return <span className="text-xs text-muted-foreground">尚未上报</span>
  return <span className="font-mono text-xs break-all">v{version.replace(/^v/i, "")}</span>
}

/** 已安装编辑器 tag 列。容器 / 无节点 → 空。 */
export function EditorsCell({
  view,
  align = "center",
}: {
  view: NodeView | null
  align?: "center" | "start"
}) {
  if (!view || view.isPassive) return null
  const editors = nodeEditors(view.capabilities)
  if (editors.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className={`flex flex-wrap items-center gap-1 ${align === "center" ? "justify-center" : ""}`}>
      {editors.map((editor) => (
        <Badge key={editor} variant="secondary" className="text-[11px]">
          {editor}
        </Badge>
      ))}
    </div>
  )
}

/**
 * 状态徽标。只显示一个结论：
 * 未授权 / 无客户端 / 未审批·不可用优先；只有审批通过的节点才显示在线态，此时不再
 * 显示「可用」——能上线就代表可用。「心跳超时」与「离线」分开：连接还在但心跳不新鲜
 * 是另一种故障，混成「离线」会让人误判成节点掉了。
 */
export function NodeStatusBadge({ view }: { view: NodeView }) {
  if (view.displayOnly) {
    return <span className="text-xs text-muted-foreground">仅用于归属展示</span>
  }
  if (view.isPassive) {
    return <span className="text-xs text-muted-foreground">即用 · 无需安装</span>
  }
  if (view.status === "approved") {
    const stale = view.connected && !view.online
    return (
      <Badge
        variant={view.online ? "outline" : "secondary"}
        className={
          view.online
            ? "text-green-600 dark:text-green-400"
            : stale
              ? "text-orange-600 dark:text-orange-400"
              : undefined
        }
      >
        {view.online ? "在线" : stale ? "心跳超时" : view.lastHeartbeatAt ? "离线" : "待连接"}
      </Badge>
    )
  }
  const meta = STATUS_META[view.status] || STATUS_META.unknown
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

/** 名称 + 角色徽标 + 机器信息副行 + 容量占用。系统/CPU/内存/版本走各自独立列。 */
export function NodeCell({
  view,
  kindLabel,
  badgeClass,
  subTag,
  align = "center",
}: {
  view: NodeView
  kindLabel: string
  badgeClass: string
  subTag?: { label: string; className: string }
  align?: "center" | "start"
}) {
  const machineLine = machineInfoLine(view.capabilities)
  const ip = preferredNodeIP(view.capabilities)
  // 仅归属展示的管理节点不暴露容量/占用——用户未被授权它本身。
  const occupancyTags = view.displayOnly
    ? []
    : [nodeCapacityLabel(view), nodeEditorOccupancyLabel(view)].filter(Boolean)
  const alignClass = align === "center" ? "items-center text-center" : "items-start text-left"
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${alignClass}`}>
      <div className={`flex min-w-0 flex-wrap items-center gap-2 ${align === "center" ? "justify-center" : "justify-start"}`}>
        <span className="min-w-0 font-medium break-words">{view.nodeName}</span>
        <Badge variant="outline" className={badgeClass}>
          {kindLabel}
        </Badge>
        {subTag ? (
          <Badge variant="secondary" className={subTag.className}>
            {subTag.label}
          </Badge>
        ) : null}
      </div>
      <div className={`flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground ${alignClass}`}>
        {view.displayOnly ? (
          <span>机器信息未授权查看</span>
        ) : machineLine ? (
          <span className="min-w-0 break-all">{machineLine}</span>
        ) : (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono break-all">{view.nodeId}</code>
        )}
        {!view.displayOnly && ip ? (
          <span className="min-w-0 font-mono break-all">IP: {ip}</span>
        ) : null}
      </div>
      {occupancyTags.length > 0 ? (
        <div className={`flex flex-wrap items-center gap-1 ${align === "center" ? "justify-center" : ""}`}>
          {occupancyTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[11px]">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
