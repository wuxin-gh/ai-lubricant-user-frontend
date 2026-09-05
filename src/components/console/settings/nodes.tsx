import { useMemo, useState } from "react"
import { Copy, RefreshCw, Server, Terminal as TerminalIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  canOpenTerminal,
  fromMyNode,
  groupIntoTree,
  type NodeView,
} from "@/components/nodes/node-view"
import { NodeTreeTable } from "@/components/nodes/node-tree-table"
import { NodeTerminalDialog } from "@/components/nodes/node-terminal-dialog"
import { useCommonData } from "@/components/console/data-provider"
import { EnvironmentPanel } from "@/components/console/environment/environment-panel"
import { SystemEnvPanel } from "@/components/console/environment/system-env-panel"
import { nodeAvailability, nodeCapacityLabel, type NodeInfo } from "@/api/nodes"
import {
  formatBytes,
  machineFactRows,
  machineInfoLine,
  nodeEditorVersions,
  nodeNetwork,
  ROLE_LABEL,
  STATUS_META,
} from "@/pages/manager/platform/nodes/types"

// 用户侧「节点」分区。列表骨架与管理端共用 NodeTreeTable（管理节点父行 + 执行节点
// 子行 + 末尾「未受管」组），数据来自 GET /api/v1/teams/my-nodes——只含自己所属分组
// 被授权的节点，以及为了画出归属关系而附带的父管理节点（display_only）。
//
// 使用侧能力与管理端一致：详情、终端（终端内含文件浏览器与 AI 助手）。治理侧不给：
// 入驻 / 审批 / 移动分组 / 设为不可用 / 删除只在管理端，这里连按钮都不注入。服务端
// 同样按 GroupNode 授权把关，不依赖前端隐藏。
//
// 列表直接展示：节点 / 系统 / CPU / 内存 / 节点客户端版本 / 编辑器 / 状态，
// 用户无需打开详情即可核对接口返回的机器字段。

/** 容器节点（纯分组容器）不暴露客户端版本、编辑器、容量等客户端字段。 */
function isContainer(node: NodeInfo): boolean {
  return Boolean(node.is_passive)
}

/** 一个节点是否为管理节点（含纯分组容器）。role 已把两类管理节点都投影成 management。 */
function isManagement(node: NodeInfo): boolean {
  return node.node_role === "management"
}

/** 审批通过后按服务端心跳口径显示在线状态；连接存在不等于心跳仍新鲜。 */
function NodeStatus({ node }: { node: NodeInfo }) {
  const { t } = useTranslation()
  // 仅归属展示的管理节点：用户没被授权它本身，不暴露其在线/机器状态，只作树形归属。
  if (node.display_only) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("consoleSettings.nodes.contextOnlyHint", "仅用于归属展示")}
      </span>
    )
  }
  if (isContainer(node)) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("consoleSettings.nodes.container", "即用 · 无需安装")}
      </span>
    )
  }
  if (node.status === "approved") {
    const liveness = node.node_role === "execution"
      ? nodeAvailability(node).liveness
      : (node.online ?? node.connected)
        ? "online"
        : node.connected
          ? "heartbeat_timeout"
          : node.last_heartbeat_at
            ? "offline"
            : "awaiting"
    const labels: Record<string, string> = {
      online: t("consoleSettings.nodes.online", "在线"),
      heartbeat_timeout: t("consoleSettings.nodes.heartbeatTimeout", "连接存在 · 心跳超时"),
      offline: t("consoleSettings.nodes.offline", "离线"),
      awaiting: t("consoleSettings.nodes.awaiting", "待连接"),
    }
    return (
      <Badge
        variant={liveness === "online" ? "outline" : "secondary"}
        className={liveness === "online" ? "text-green-600 dark:text-green-400" : undefined}
      >
        {labels[liveness] || t("consoleSettings.nodes.offline", "离线")}
      </Badge>
    )
  }
  const meta = STATUS_META[node.status] || STATUS_META.unknown
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

export default function Nodes() {
  const { t } = useTranslation()
  const { nodes, loadingNodes, nodesInited, reloadNodes } = useCommonData()
  const [detailNode, setDetailNode] = useState<NodeInfo | null>(null)
  const [terminalNode, setTerminalNode] = useState<NodeInfo | null>(null)

  // 未审批的节点不出现在用户侧：授权发生在审批之后，pending 只可能是竞态残留，
  // 用户对它既不能操作也无从判断，列出来只会造成困惑。
  const visibleNodes = useMemo(
    () => nodes.filter((node) => node.status !== "pending"),
    [nodes],
  )

  // 两套后端投影先归一成 NodeView，再交给共享的 groupIntoTree 建父子树。
  const views = useMemo(() => visibleNodes.map(fromMyNode), [visibleNodes])
  const nodeGroups = useMemo(() => groupIntoTree(views), [views])

  const openTerminal = (view: NodeView) => {
    setTerminalNode(view.raw as NodeInfo)
  }

  /**
   * 用户侧只有「详情」+「终端」两个动作。
   *
   * 入驻/审批/移动分组/设为不可用/删除都属于管理端职责，这里根本不注入——不是禁用，
   * 而是不存在。仅归属展示的父管理节点（未被授权本体）连详情都不给，它只是树的标签。
   */
  const renderActions = (view: NodeView) => {
    if (view.displayOnly) return null
    const node = view.raw as NodeInfo
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setDetailNode(node)}>
          {t("consoleSettings.nodes.details", "详情")}
        </Button>
        {canOpenTerminal(view) ? (
          <Button size="sm" variant="outline" onClick={() => openTerminal(view)}>
            <TerminalIcon />
            {t("consoleSettings.nodes.terminal", "终端")}
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Server className="size-4" />
            {t("consoleSettings.nodes.title", "节点")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "consoleSettings.nodes.description",
              "你所属分组被授权的节点。管理节点归拢执行节点，创建任务时选择一个空闲执行节点运行。",
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loadingNodes} onClick={() => void reloadNodes().catch((error) => toast.error(error instanceof Error ? error.message : "刷新节点失败"))}>
          <RefreshCw className={loadingNodes ? "animate-spin" : undefined} />
          {t("consoleSettings.nodes.refresh", "刷新")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <NodeTreeTable
          groups={nodeGroups}
          columns={["system", "cpu", "memory", "version", "editors", "status"]}
          loading={loadingNodes && !nodesInited}
          emptyHint={t("consoleSettings.nodes.empty", "暂无可用节点，请联系管理员分配。")}
          noExecutionHint={t("consoleSettings.nodes.noExecution", "该管理节点下暂无执行节点。")}
          renderManagerActions={renderActions}
          renderExecutionActions={renderActions}
          actionsWidth="w-[200px]"
        />
      </div>

      <NodeDetailDialog
        open={detailNode !== null}
        node={detailNode}
        nodes={nodes}
        onClose={() => setDetailNode(null)}
      />

      {terminalNode ? (
        <NodeTerminalDialog
          open
          onOpenChange={(next) => {
            if (!next) setTerminalNode(null)
          }}
          scope="user"
          nodeId={terminalNode.node_id}
          nodeName={terminalNode.node_name || terminalNode.node_id}
        />
      ) : null}
    </div>
  )
}

function DetailField({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={mono ? "break-all rounded bg-muted px-2 py-1 font-mono text-xs" : "break-words text-sm"}>
        {children}
      </div>
    </div>
  )
}

function NodeDetailDialog({
  open,
  node,
  nodes,
  onClose,
}: {
  open: boolean
  node: NodeInfo | null
  nodes: NodeInfo[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!node) return null

  const container = isContainer(node)
  const status = STATUS_META[node.status] || STATUS_META.unknown
  const notReported = t("consoleSettings.nodes.detail.notReported", "尚未上报")
  const facts = machineFactRows(node.capabilities, notReported)
  const network = nodeNetwork(node.capabilities)
  const editorVersions = container ? [] : nodeEditorVersions(node.capabilities)
  const manager = node.manager_node_id
    ? nodes.find((candidate) => candidate.node_id === node.manager_node_id) || null
    : null
  const children = isManagement(node)
    ? nodes.filter((candidate) => candidate.node_role === "execution" && candidate.manager_node_id === node.node_id)
    : []
  const capacity = node.capacity
  const capacityItems = [
    capacity?.max_sessions
      ? t("consoleSettings.nodes.detail.maxSessionsValue", { count: capacity.max_sessions, defaultValue: `最多 ${capacity.max_sessions} 个并发会话` })
      : t("consoleSettings.nodes.detail.unlimitedSessions", "会话数不限"),
    capacity?.cpu_total
      ? t("consoleSettings.nodes.detail.allocatableCpuValue", { count: capacity.cpu_total, defaultValue: `可分配 CPU ${capacity.cpu_total} 核` })
      : null,
    capacity?.memory_total
      ? t("consoleSettings.nodes.detail.allocatableMemoryValue", { value: formatBytes(capacity.memory_total), defaultValue: `可分配内存 ${formatBytes(capacity.memory_total)}` })
      : null,
  ].filter(Boolean)

  const copyNodeId = async () => {
    try {
      await navigator.clipboard.writeText(node.node_id)
      toast.success(t("consoleSettings.nodes.detail.copied", "节点 ID 已复制"))
    } catch {
      toast.error(t("consoleSettings.nodes.detail.copyFailed", "复制失败"))
    }
  }

  const overview = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{node.node_name || node.node_id}</span>
        <Badge variant="outline">{ROLE_LABEL[node.node_role] || node.node_role}</Badge>
        {node.display_only ? (
          <Badge variant="secondary">{t("consoleSettings.nodes.contextOnly", "仅归属展示")}</Badge>
        ) : node.status === "approved" ? (
          <NodeStatus node={node} />
        ) : (
          <Badge variant="outline" className={status.className}>{status.label}</Badge>
        )}
      </div>

      {node.display_only ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t("consoleSettings.nodes.detail.contextOnlyTelemetry", "该管理节点仅用于展示执行节点归属；你未获授权查看它的机器和运行时信息。")}
        </p>
      ) : container ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t("consoleSettings.nodes.detail.containerTelemetry", "这是纯分组容器，没有节点客户端，因此不会上报 CPU、内存、系统或客户端版本。")}
        </p>
      ) : Object.keys(node.capabilities || {}).length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t("consoleSettings.nodes.detail.noTelemetry", "尚未收到该节点的机器信息上报；节点连接并完成上报后会在这里显示。")}
        </p>
      ) : !(node.online ?? node.connected) ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t("consoleSettings.nodes.detail.lastReportedTelemetry", "节点当前不在线，以下为最近一次上报的机器信息。")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("consoleSettings.nodes.detail.nodeId", "节点 ID")}</span>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{node.node_id}</code>
            <Button size="icon-xs" variant="ghost" onClick={() => void copyNodeId()} aria-label={t("consoleSettings.nodes.detail.copyNodeId", "复制节点 ID")}>
              <Copy />
            </Button>
          </div>
        </div>
        {node.node_role === "execution" ? (
          <DetailField label={t("consoleSettings.nodes.detail.manager", "归属管理节点")}>
            {manager?.node_name || manager?.node_id || node.manager_node_id || t("consoleSettings.nodes.detail.unmanaged", "未受管 / 直连")}
          </DetailField>
        ) : null}
        {!node.display_only && !container
          ? facts.map((fact) => (
              <DetailField key={fact.key} label={fact.label}>
                <span className={fact.reported ? undefined : "text-muted-foreground"}>
                  {fact.key === "client_version" && fact.reported
                    ? `v${fact.value.replace(/^v/i, "")}`
                    : fact.value}
                </span>
              </DetailField>
            ))
          : null}
        {!container && !node.display_only ? (
          <>
            <DetailField label={t("consoleSettings.nodes.detail.activeSessions", "运行中会话")}>
              {t("consoleSettings.nodes.detail.sessionCount", { count: node.active_sessions || 0, defaultValue: `${node.active_sessions || 0} 个` })}
            </DetailField>
            <DetailField label={t("consoleSettings.nodes.detail.editorOccupancy", "绑定的编辑器")}>
              {t("consoleSettings.nodes.detail.editorCount", { count: node.editor_occupancy || 0, defaultValue: `${node.editor_occupancy || 0} 个` })}
            </DetailField>
            <DetailField label={t("consoleSettings.nodes.detail.capacity", "调度容量")}>
              {capacityItems.join(" · ")}
            </DetailField>
          </>
        ) : null}
        {!node.display_only ? (
          <DetailField label={t("consoleSettings.nodes.detail.lastHeartbeat", "最近心跳")}>
            {node.last_heartbeat_at || notReported}
          </DetailField>
        ) : null}
        {!node.display_only && !container
          ? network.map((row) => (
              <DetailField key={row.label} label={row.label} mono>{row.value}</DetailField>
            ))
          : null}
        {node.capabilities?.docker ? (
          <DetailField label="Docker">
            {node.capabilities.docker === "true"
              ? t("consoleSettings.nodes.detail.supported", "支持")
              : t("consoleSettings.nodes.detail.unsupported", "不支持")}
          </DetailField>
        ) : null}
        {!container && node.node_role === "execution" ? (
          <DetailField label={t("consoleSettings.nodes.detail.systemEnv", "系统内置环境")}>
            {node.capabilities?.system_env === "true"
              ? t("consoleSettings.nodes.detail.systemEnvEnabled", "已开启")
              : t("consoleSettings.nodes.detail.systemEnvDisabled", "未开启")}
          </DetailField>
        ) : null}
      </div>

      {!container && !node.display_only ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("consoleSettings.nodes.detail.installedEditors", "已安装编辑器")}</span>
          <div className="overflow-hidden rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">{t("consoleSettings.nodes.detail.editor", "编辑器")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("consoleSettings.nodes.detail.version", "版本")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("consoleSettings.nodes.detail.installStatus", "安装状态")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {editorVersions.map((editor) => (
                  <tr key={editor.editor}>
                    <td className="px-3 py-2 font-medium">{editor.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {editor.version ? `v${editor.version.replace(/^v/i, "")}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={editor.installed ? "outline" : "secondary"}>
                        {editor.installed
                          ? t("consoleSettings.nodes.detail.installed", "已安装")
                          : t("consoleSettings.nodes.detail.notInstalled", "未安装")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("consoleSettings.nodes.detail.readonlyHint", "这里只展示节点上报的信息；安装和升级由管理员操作。")}
          </p>
        </div>
      ) : null}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      {/* 尺寸与管理端节点详情（node-detail.tsx）一致：固定高 + 内部各 tab 独立滚动，
          避免共用环境面板等长内容把头部和页签一起顶出视口。 */}
      <DialogContent className="flex h-[720px] max-h-[90vh] flex-col overflow-hidden sm:max-w-[820px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("consoleSettings.nodes.detail.title", "节点详情")}</DialogTitle>
        </DialogHeader>
        {isManagement(node) ? (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="overview">{t("consoleSettings.nodes.detail.overview", "概览")}</TabsTrigger>
              <TabsTrigger value="executions">{t("consoleSettings.nodes.detail.executionNodes", "执行节点")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-4">{overview}</TabsContent>
            <TabsContent value="executions" className="min-h-0 flex-1 overflow-y-auto pt-4">
              {children.length > 0 ? (
                <div className="flex flex-col divide-y rounded border">
                  {children.map((child) => (
                    <div key={child.node_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{child.node_name || child.node_id}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {machineInfoLine(child.capabilities) || child.node_id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary">{nodeCapacityLabel(child) || t("consoleSettings.nodes.detail.idle", "空闲")}</Badge>
                        <NodeStatus node={child} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("consoleSettings.nodes.noExecution", "该管理节点下暂无执行节点。")}
                </p>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="overview">{t("consoleSettings.nodes.detail.overview", "概览")}</TabsTrigger>
              <TabsTrigger value="environments">{t("consoleSettings.nodes.detail.environments", "环境")}</TabsTrigger>
              <TabsTrigger value="system-env">{t("consoleSettings.nodes.detail.systemEnv", "系统内置环境")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-4">{overview}</TabsContent>
            <TabsContent value="environments" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <EnvironmentPanel nodeId={node.node_id} />
            </TabsContent>
            {/* 系统内置环境 = 节点操作者的真实 HOME。与「环境」（用户建的命名共用环境）
                是两回事，故并列而非合并：一个按 env_id 管，一个按节点管。 */}
            <TabsContent value="system-env" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <SystemEnvPanel nodeId={node.node_id} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
