import { useMemo } from "react"
import { IconChevronDown, IconChevronRight, IconServer, IconSitemap } from "@tabler/icons-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  isNodeUsable,
  nodeAvailability,
  NODE_ROLE_LABEL,
  NODE_STATUS_META,
  nodeCapacityLabel,
  nodeEditorOccupancyLabel,
  type NodeInfo,
} from "@/api/nodes"
import { machineInfoLine, machineSpecs, nodeEditorVersions, OS_LABEL, ARCH_LABEL, formatBytes } from "@/pages/manager/platform/nodes/types"
import type { EditorProvider } from "@/api/editorClient"

/**
 * 执行节点树选择器。层级与管理端节点列表一致：管理节点（分组容器 / 管理客户端）为
 * 父节点，其下执行节点为子节点；未归属任何管理节点的执行节点落入末尾「未受管」组。
 *
 * 管理节点只作归属展示，永远不可选（`isNodeUsable` 只认已审批且在线的执行节点），
 * 点父行只做展开/收起。
 */
type NodeGroup = { key: string; manager: NodeInfo | null; children: NodeInfo[] }

function groupNodes(nodes: NodeInfo[]): NodeGroup[] {
  const managers = nodes.filter((node) => node.node_role === "management")
  const executions = nodes.filter((node) => node.node_role === "execution")
  const childrenByManager = new Map<string, NodeInfo[]>()
  for (const node of executions) {
    const key = node.manager_node_id || ""
    childrenByManager.set(key, [...(childrenByManager.get(key) || []), node])
  }
  const managerIds = new Set(managers.map((node) => node.node_id))
  const groups: NodeGroup[] = managers.map((manager) => ({
    key: manager.node_id,
    manager,
    children: childrenByManager.get(manager.node_id) || [],
  }))
  const orphans = executions.filter((node) => !node.manager_node_id || !managerIds.has(node.manager_node_id))
  if (orphans.length > 0) groups.push({ key: "__unmanaged__", manager: null, children: orphans })
  return groups
}

function nodeTags(node: NodeInfo): string[] {
  return [nodeCapacityLabel(node), nodeEditorOccupancyLabel(node)].filter(Boolean)
}

function nodeStatus(node: NodeInfo): { label: string; className: string } {
  if (node.status !== "approved") {
    return NODE_STATUS_META[node.status] || NODE_STATUS_META.unknown
  }
  const availability = nodeAvailability(node)
  if (availability.liveness === "online") {
    return { label: "在线", className: "text-green-600 dark:text-green-400" }
  }
  if (availability.liveness === "heartbeat_timeout") {
    return { label: "心跳超时", className: "text-orange-600 dark:text-orange-400" }
  }
  return { label: availability.liveness === "awaiting" ? "待连接" : "离线", className: "text-muted-foreground" }
}

/** 该编辑器类型（provider）是否已在节点上安装。未传 provider 时不做此过滤。 */
function providerInstalled(node: NodeInfo, provider?: EditorProvider): boolean {
  if (!provider) return true
  return nodeEditorVersions(node.capabilities).some((entry) => entry.editor === provider && entry.installed)
}

/** 该节点是否开启了系统内置环境（env_mode=system 需要节点上报此能力位）。未上报视为未开启。 */
export function nodeSystemEnvAllowed(node: NodeInfo | null | undefined): boolean {
  return (node?.capabilities || {}).system_env === "true"
}

/**
 * 执行节点为什么不可选。返回空串表示可选。管理节点由调用方单独处理（父行只作
 * 归属，不参与这里的判定）。
 */
function unusableReason(node: NodeInfo, provider?: EditorProvider, requireSystemEnv?: boolean): string {
  const availability = nodeAvailability(node)
  if (!availability.usable) return availability.reason
  if (!isNodeUsable(node)) return "容量已满"
  // 系统内置档要求节点显式开启该模式；离线/容量原因优先，所以放在它们之后。
  if (requireSystemEnv && !nodeSystemEnvAllowed(node)) return "未开启系统环境"
  if (!providerInstalled(node, provider)) {
    const label = provider === "codex" ? "Codex" : provider === "opencode" ? "OpenCode" : "Claude"
    return `未安装 ${label}`
  }
  return ""
}

export default function NodeTree({
  nodes,
  value,
  onChange,
  provider,
  allowAuto = true,
  requireSystemEnv = false,
}: {
  nodes: NodeInfo[]
  /**
   * 选中的执行节点 id。空串在 allowAuto=true 时表示「自动选择」；allowAuto=false
   * 时表示「尚未选择」，由调用方自行校验必选（如创建任务弹框要求显式选节点）。
   */
  value: string
  onChange: (nodeId: string) => void
  /** 当前编辑器类型：用于过滤出「该节点没装这个编辑器」的执行节点。 */
  provider?: EditorProvider
  /**
   * 是否展示顶部「自动选择」按钮。编辑器创建流程允许由调度挑空闲节点（默认 true）；
   * 创建任务弹框已要求显式选节点（提交时 !nodeId 会拦截），故传 false 隐藏该项，
   * 避免选了自动却被校验挡回的体验。
   */
  allowAuto?: boolean
  /**
   * 只允许已开启系统内置环境的节点（env_mode=system 时用）：未开启的仍然显示，
   * 但禁用并标注「未开启系统环境」。默认 false 不影响现有调用方。
   */
  requireSystemEnv?: boolean
}) {
  const groups = useMemo(() => groupNodes(nodes), [nodes])

  return (
    <div className="max-h-56 overflow-auto rounded-md border p-1">
      {allowAuto && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
            value ? "hover:bg-muted" : "bg-primary/10 font-medium"
          )}
        >
          <IconSitemap className="size-3.5 shrink-0 opacity-50" />
          <span>自动选择</span>
          <span className="ml-auto text-xs text-muted-foreground">由调度挑选空闲节点</span>
        </button>
      )}

      {groups.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground">暂无可用节点，请联系管理员分配。</div>
      )}

      {groups.map((group) => (
        <Collapsible key={group.key} defaultOpen>
          <CollapsibleTrigger className="group/manager flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
            <IconChevronDown className="size-3.5 shrink-0 opacity-50 group-data-closed/manager:hidden" />
            <IconChevronRight className="hidden size-3.5 shrink-0 opacity-50 group-data-closed/manager:block" />
            {group.manager ? (
              <>
                <span className="min-w-0 flex-1 truncate">{group.manager.node_name || group.manager.node_id}</span>
                <Badge variant="outline" className="shrink-0 text-[11px] text-purple-600 dark:text-purple-400">
                  {NODE_ROLE_LABEL.management}
                </Badge>
                <span className="shrink-0 text-[11px] text-muted-foreground">不可选</span>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">未受管 / 直连</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">未归属管理节点</span>
              </>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {group.children.length === 0 ? (
              <div className="py-1.5 pl-9 text-xs text-muted-foreground">该管理节点下暂无执行节点。</div>
            ) : (
              group.children.map((node) => {
                const reason = unusableReason(node, provider, requireSystemEnv)
                const tags = nodeTags(node)
                const specs = machineSpecs(node.capabilities)
                const caps = node.capabilities || {}
                const os = OS_LABEL[caps.os || ""] || caps.os || "尚未上报"
                const arch = ARCH_LABEL[caps.arch || ""] || caps.arch || "尚未上报"
                const cpu = specs.find((item) => item.label === "CPU")?.value || "尚未上报"
                const memory = caps.memory_total
                  ? (() => {
                      const bytes = Number(caps.memory_total)
                      return Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : caps.memory_total
                    })()
                  : "尚未上报"
                const info = machineInfoLine(node.capabilities)
                const status = nodeStatus(node)
                return (
                  <button
                    key={node.node_id}
                    type="button"
                    disabled={Boolean(reason)}
                    onClick={() => onChange(node.node_id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded py-1.5 pr-2 pl-9 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
                      value === node.node_id ? "bg-primary/10 font-medium" : "hover:bg-muted"
                    )}
                  >
                    <IconServer className="mt-0.5 size-3.5 shrink-0 opacity-50" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{node.node_name || node.node_id}</span>
                        <Badge variant="outline" className={cn("shrink-0 text-[11px]", status.className)}>
                          {status.label}
                        </Badge>
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="shrink-0 text-[11px]">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                      {info && <span className="truncate text-[11px] text-muted-foreground">{info}</span>}
                      <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="truncate"><span className="text-muted-foreground">系统：</span>{os} / {arch}</span>
                        <span className="truncate"><span className="text-muted-foreground">CPU：</span>{cpu}</span>
                        <span className="truncate"><span className="text-muted-foreground">内存：</span>{memory}</span>
                        <span className="truncate"><span className="text-muted-foreground">版本：</span>{specs.find((item) => item.label === "客户端版本")?.value || "尚未上报"}</span>
                      </div>
                      {reason && <span className="text-[11px] text-destructive">不可选 · {reason}</span>}
                    </span>
                  </button>
                )
              })
            )}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
