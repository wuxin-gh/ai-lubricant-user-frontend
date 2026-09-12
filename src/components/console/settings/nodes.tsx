import { useEffect, useMemo, useState } from "react"
import { Copy, Plus, RefreshCw, Server, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  canOpenTerminal,
  fromMyNode,
  groupIntoTree,
  type NodeView,
} from "@/components/nodes/node-view"
import { NodeTreeTable, NODE_LIST_COLUMNS } from "@/components/nodes/node-tree-table"
import { NodeTerminalDialog } from "@/components/nodes/node-terminal-dialog"
import { UserNodeRuntime } from "@/components/nodes/user-node-runtime"
import { useCommonData } from "@/components/console/data-provider"
import { EnvironmentPanel } from "@/components/console/environment/environment-panel"
import { SystemEnvPanel } from "@/components/console/environment/system-env-panel"
import { NodeTunnels } from "@/pages/manager/platform/nodes/node-tunnels"
import { nodeAvailability, nodeEditorOccupancyLabel, type NodeInfo } from "@/api/nodes"
import {
  approveGroupNode,
  createGroupExecutionNode,
  deleteUserNode,
  getLatestUserNodeRelease,
  getUserNodeDetail,
  listTeamProxies,
  type CreateGroupExecutionNodeResult,
  type TeamProxyEntry,
  type UserNodeDetailNode,
  type UserNodeLatestRelease,
  type UserNodeUpgradeStatus,
} from "@/api/reviewClient"
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
// 使用侧能力：详情、终端（终端内含文件浏览器与 AI 助手）、执行节点的删除与
// 运行时管理（详情「运行时」tab：节点程序/Runtime 统一升级、编辑器安装/升级、
// 升级代理绑定）。治理侧仍不给：入驻/审批管理节点/移动分组/设为不可用只在管理端。
// 服务端按 GroupNode 授权 + 「仅执行节点」硬闸把关，不依赖前端隐藏。
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

export default function Nodes({ showHeader = false }: { showHeader?: boolean }) {
  const { t } = useTranslation()
  const { nodes, loadingNodes, nodesInited, reloadNodes } = useCommonData()
  const [detailNode, setDetailNode] = useState<NodeInfo | null>(null)
  const [terminalNode, setTerminalNode] = useState<NodeInfo | null>(null)
  const [createManager, setCreateManager] = useState<NodeInfo | null>(null)
  const [createNodeName, setCreateNodeName] = useState("")
  const [createProxyId, setCreateProxyId] = useState("")
  const [teamProxies, setTeamProxies] = useState<TeamProxyEntry[]>([])
  const [actionNodeId, setActionNodeId] = useState<string | null>(null)
  // 不可管理管理节点添加的执行节点无法自动拉起：需要展示手动安装凭证（一键命令）。
  const [manualInstall, setManualInstall] = useState<CreateGroupExecutionNodeResult | null>(null)
  // 删除二次确认的目标执行节点（管理节点不提供删除）。
  const [deleteTarget, setDeleteTarget] = useState<NodeInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 待审批节点必须留在用户侧列表：有管理节点权限的成员可以在此完成审批。
  const visibleNodes = useMemo(
    () => nodes.filter((node) => node.status !== "revoked"),
    [nodes],
  )

  // 两套后端投影先归一成 NodeView，再交给共享的 groupIntoTree 建父子树。
  const views = useMemo(() => visibleNodes.map(fromMyNode), [visibleNodes])
  const nodeGroups = useMemo(() => groupIntoTree(views), [views])

  const openTerminal = (view: NodeView) => {
    setTerminalNode(view.raw as NodeInfo)
  }

  const approveNode = async (node: NodeInfo) => {
    if (actionNodeId) return
    setActionNodeId(node.node_id)
    try {
      await approveGroupNode(node.node_id)
      toast.success(t("consoleSettings.nodes.approved", "节点已审批"))
      await reloadNodes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleSettings.nodes.approveFailed", "审批失败"))
    } finally {
      setActionNodeId(null)
    }
  }

  const createExecutionNode = async () => {
    if (!createManager || actionNodeId) return
    setActionNodeId(createManager.node_id)
    try {
      const result = await createGroupExecutionNode(createManager.group_id, {
        startup_method: createManager.startup_method || "docker",
        node_name: createNodeName.trim() || undefined,
        proxy_config_id: createProxyId || undefined,
      })
      setCreateManager(null)
      setCreateNodeName("")
      setCreateProxyId("")
      if (result.launched) {
        toast.success(t("consoleSettings.nodes.executionCreated", "执行节点已由管理节点自动拉起"))
      } else {
        // 不可管理（passive）管理节点没有客户端，无法自动拉起：创建成功但需要
        // 手动安装——展示一键命令让用户去目标机器执行。
        setManualInstall(result)
      }
      await reloadNodes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleSettings.nodes.createFailed", "创建执行节点失败"))
    } finally {
      setActionNodeId(null)
    }
  }

  // 删除执行节点，与管理端同口径：pending（从未上线）→ 撤销入驻；其余 → 硬删除。
  // 管理节点不给删除入口（renderActions 只对执行节点渲染按钮，服务端另有硬闸）。
  const deleteExecutionNode = async (node: NodeInfo) => {
    if (deleting) return
    setDeleting(true)
    setActionNodeId(node.node_id)
    try {
      await deleteUserNode(node.node_id)
      toast.success(t("consoleSettings.nodes.deleted", "已删除节点"))
      setDeleteTarget(null)
      await reloadNodes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleSettings.nodes.deleteFailed", "删除失败"))
    } finally {
      setDeleting(false)
      setActionNodeId(null)
    }
  }

  // 添加执行节点弹框打开时拉取代理池精简列表（只 id+name+mode）。
  useEffect(() => {
    if (!createManager) return
    if (teamProxies.length > 0) return
    void listTeamProxies()
      .then((list) => setTeamProxies(list || []))
      .catch(() => setTeamProxies([]))
  }, [createManager, teamProxies.length])

  /** 用户侧有管理节点权限时开放创建/审批；仅归属展示的父行不开放操作。
   * 不可管理（passive）的管理节点也允许添加执行节点：它仍能归拢/挂载执行节点，
   * 只是自身没有客户端、无法自动 docker run——此时后端返回 launched=false，
   * 创建出的执行节点走手动安装流程（与 admin 端对 passive manager 的口径一致）。 */
  const renderActions = (view: NodeView) => {
    if (view.displayOnly) return null
    const node = view.raw as NodeInfo
    const manager = isManagement(node)
    // 不以 is_passive 拦截：passive 管理节点也能添加执行节点，只是不能自动拉起。
    const managerCanCreate = manager && node.status === "approved" && Boolean(node.online ?? node.connected)
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setDetailNode(node)}>
          {t("consoleSettings.nodes.details", "详情")}
        </Button>
        {managerCanCreate ? (
          <Button size="sm" onClick={() => setCreateManager(node)}>
            <Plus />
            {t("consoleSettings.nodes.addExecution", "添加执行节点")}
          </Button>
        ) : manager && node.status !== "approved" ? (
          <Button size="sm" disabled title={t("consoleSettings.nodes.approveManagerFirst", "请先审批管理节点")}>
            <Plus />
            {t("consoleSettings.nodes.addExecution", "添加执行节点")}
          </Button>
        ) : null}
        {node.status === "pending" && !manager ? (
          <Button size="sm" disabled={actionNodeId === node.node_id} onClick={() => void approveNode(node)}>
            {actionNodeId === node.node_id ? <Spinner /> : null}
            {t("consoleSettings.nodes.approve", "审批")}
          </Button>
        ) : null}
        {canOpenTerminal(view) ? (
          <Button size="sm" variant="outline" onClick={() => openTerminal(view)}>
            <TerminalIcon />
            {t("consoleSettings.nodes.terminal", "终端")}
          </Button>
        ) : null}
        {!manager ? (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={actionNodeId === node.node_id}
            onClick={() => setDeleteTarget(node)}
          >
            {actionNodeId === node.node_id && deleteTarget?.node_id === node.node_id ? <Spinner /> : <Trash2 />}
            {t("consoleSettings.nodes.delete", "删除")}
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showHeader ? (
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
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <NodeTreeTable
          groups={nodeGroups}
          columns={NODE_LIST_COLUMNS}
          loading={loadingNodes && !nodesInited}
          emptyHint={t("consoleSettings.nodes.empty", "暂无可用节点，请联系管理员分配。")}
          noExecutionHint={t("consoleSettings.nodes.noExecution", "该管理节点下暂无执行节点。")}
          renderManagerActions={renderActions}
          renderExecutionActions={renderActions}
        />
      </div>

      <NodeDetailDialog
        open={detailNode !== null}
        node={detailNode}
        nodes={nodes}
        onClose={() => setDetailNode(null)}
        onChanged={() => void reloadNodes()}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("consoleSettings.nodes.deleteConfirmTitle", "删除执行节点？")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "consoleSettings.nodes.deleteConfirmDesc",
                "将删除节点记录并解除全部分组授权，不可恢复。节点上正在运行的任务会话会中断：",
              )}
              {deleteTarget ? (
                <span className="ml-1 font-medium text-foreground">
                  {deleteTarget.node_name || deleteTarget.node_id}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel", "取消")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                // 阻止默认关闭：删除完成后再由 handler 关闭，失败保留弹框。
                event.preventDefault()
                if (deleteTarget) void deleteExecutionNode(deleteTarget)
              }}
            >
              {deleting ? <Spinner /> : null}
              {t("consoleSettings.nodes.deleteConfirm", "删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={createManager !== null}
        onOpenChange={(open) => {
          if (!open && !actionNodeId) {
            setCreateManager(null)
            setCreateNodeName("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("consoleSettings.nodes.addExecutionTitle", "添加执行节点")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {createManager?.is_passive
              ? t("consoleSettings.nodes.addExecutionManual", "该管理节点是不可管理的分组容器：创建后会给出一键安装命令，需你在目标机器执行。")
              : t("consoleSettings.nodes.addExecutionAuto", "管理节点会在其主机上自动启动执行节点，不需要你手动安装或输入凭证。")}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-create-node-name">{t("consoleSettings.nodes.nodeName", "节点名称（可选）")}</Label>
            <Input
              id="team-create-node-name"
              value={createNodeName}
              onChange={(event) => setCreateNodeName(event.target.value)}
              placeholder={t("consoleSettings.nodes.nodeNamePlaceholder", "留空使用默认名称")}
              disabled={actionNodeId !== null}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("consoleSettings.nodes.downloadProxy", "下载代理")}</Label>
            <Select value={createProxyId} onValueChange={setCreateProxyId} disabled={actionNodeId !== null || teamProxies.length === 0}>
              <SelectTrigger><SelectValue placeholder={teamProxies.length === 0 ? "直连（无可选代理）" : "直连（不使用代理）"} /></SelectTrigger>
              <SelectContent>
                {teamProxies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name || p.id}（{p.mode}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("consoleSettings.nodes.proxyHint", "节点从 GitHub 下载运行程序时使用的代理；与节点绑定，可随后在节点详情修改。")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateManager(null); setCreateNodeName(""); setCreateProxyId("") }} disabled={actionNodeId !== null}>
              {t("common.cancel", "取消")}
            </Button>
            <Button onClick={() => void createExecutionNode()} disabled={actionNodeId !== null}>
              {actionNodeId === createManager?.node_id ? <Spinner /> : null}
              {createManager?.is_passive
                ? t("consoleSettings.nodes.createExecutionManual", "创建")
                : t("consoleSettings.nodes.createExecution", "创建并自动启动")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualInstall !== null}
        onOpenChange={(open) => { if (!open) setManualInstall(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("consoleSettings.nodes.manualInstallTitle", "执行节点已创建，请手动安装")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            该管理节点是不可管理的分组容器，没有客户端进程可自动启动执行节点。请在目标机器执行下面的一键命令。
          </p>
          <div className="rounded bg-muted p-3 font-mono text-xs break-all">
            {manualInstall?.install_command || "安装命令未返回，请重新创建节点。"}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                const command = manualInstall?.install_command || ""
                void copyToClipboard(command).then((ok) => ok ? toast.success("命令已复制") : toast.error("复制失败"))
              }}
              disabled={!manualInstall?.install_command}
            >
              复制命令
            </Button>
            <Button onClick={() => setManualInstall(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  onChanged,
}: {
  open: boolean
  node: NodeInfo | null
  nodes: NodeInfo[]
  onClose: () => void
  /** 运行时 tab 的升级/装编辑器成功后触发，父层据此刷新节点列表。 */
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  // 运行时 tab 的数据源：detail 接口给单节点最新快照 + 服务端版本判定（节点程序/
  // runtime 两条线），latestRelease 给升级弹窗预览将下发的资产。升级/装编辑器后
  // onChanged 会触发父层 reloadNodes，弹框重开时数据自更新。
  const [runtimeDetail, setRuntimeDetail] = useState<{
    node: UserNodeDetailNode
    upgrade: UserNodeUpgradeStatus
  } | null>(null)
  const [latestRelease, setLatestRelease] = useState<UserNodeLatestRelease | null>(null)

  const canManageRuntime = Boolean(
    node && !node.display_only && !isContainer(node) && !isManagement(node),
  )

  useEffect(() => {
    if (!open || !node || !canManageRuntime) {
      setRuntimeDetail(null)
      setLatestRelease(null)
      return
    }
    let cancelled = false
    void Promise.all([getUserNodeDetail(node.node_id), getLatestUserNodeRelease()])
      .then(([detail, release]) => {
        if (!cancelled) {
          setRuntimeDetail(detail)
          setLatestRelease(release)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeDetail(null)
          setLatestRelease(null)
        }
      })
    return () => {
      cancelled = true
    }
    // onChanged 变化 = 刚发生过一次运行时操作 → 重拉版本判定。
  }, [open, node?.node_id, canManageRuntime, onChanged])

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
    if (await copyToClipboard(node.node_id)) {
      toast.success(t("consoleSettings.nodes.detail.copied", "节点 ID 已复制"))
    } else {
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
            {t("consoleSettings.nodes.detail.readonlyHint", "这里展示节点上报的版本；安装与升级在「运行时」tab 操作。")}
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
              <TabsTrigger value="tunnels">{t("consoleSettings.nodes.detail.tunnels", "穿透")}</TabsTrigger>
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
                        <Badge variant="secondary">{nodeEditorOccupancyLabel(child) || t("consoleSettings.nodes.detail.idle", "空闲")}</Badge>
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
            <TabsContent value="tunnels" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <NodeTunnels nodeId={node.node_id} />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="overview">{t("consoleSettings.nodes.detail.overview", "概览")}</TabsTrigger>
              {canManageRuntime ? (
                <TabsTrigger value="runtime">{t("consoleSettings.nodes.detail.runtime", "运行时")}</TabsTrigger>
              ) : null}
              <TabsTrigger value="environments">{t("consoleSettings.nodes.detail.environments", "环境")}</TabsTrigger>
              <TabsTrigger value="system-env">{t("consoleSettings.nodes.detail.systemEnv", "系统内置环境")}</TabsTrigger>
              <TabsTrigger value="tunnels">{t("consoleSettings.nodes.detail.tunnels", "穿透")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-4">{overview}</TabsContent>
            {canManageRuntime ? (
              <TabsContent value="runtime" className="min-h-0 flex-1 overflow-y-auto pt-4">
                {runtimeDetail ? (
                  <UserNodeRuntime
                    node={runtimeDetail.node}
                    upgrade={runtimeDetail.upgrade}
                    release={latestRelease}
                    onChanged={onChanged}
                  />
                ) : (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                )}
              </TabsContent>
            ) : null}
            <TabsContent value="environments" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <EnvironmentPanel nodeId={node.node_id} />
            </TabsContent>
            {/* 系统内置环境 = 节点操作者的真实 HOME。与「环境」（用户建的命名共用环境）
                是两回事，故并列而非合并：一个按 env_id 管，一个按节点管。 */}
            <TabsContent value="system-env" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <SystemEnvPanel nodeId={node.node_id} />
            </TabsContent>
            <TabsContent value="tunnels" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <NodeTunnels nodeId={node.node_id} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
