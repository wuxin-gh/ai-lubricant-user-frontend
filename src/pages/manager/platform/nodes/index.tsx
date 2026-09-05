/**
 * 节点管理页 —— shadcn 版，融入 /manager 管理端。
 *
 * 三类节点、两种管理节点形态：
 * - 纯分组容器（passive_management）：只归拢执行节点、方便按分组授权；无凭证、不安装、
 *   不拨号。列表里 role="management" 且 is_passive=true。
 * - 管理节点客户端（management）：既是分组容器又是真实客户端，拨号连回、在本机启停
 *   执行节点。有一次性凭证 + 安装命令，生命周期 pending→审批。role="management" 且
 *   is_passive=false。
 * - 执行节点（execution）：唯一的任务客户端，必须归属某个管理节点。
 *
 * 数据层复用 `@/@admin-port/api/nodes`（纯 axios，代理进程内 NodeService）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Terminal as TerminalIcon } from "lucide-react"
import { AdminPage, SectionCard } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  canOpenTerminal,
  fromAdminNode,
  groupIntoTree,
  type NodeView,
} from "@/components/nodes/node-view"
import { NodeTreeTable } from "@/components/nodes/node-tree-table"
import { NodeTerminalDialog } from "@/components/nodes/node-terminal-dialog"
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
import { toast } from "sonner"
import {
  approveNode,
  bindGroupNode,
  deleteNode,
  listGroups,
  listNodes,
  moveNode,
  onboardNode,
  revokeNode,
  revokeOnboardNode,
  type NodeInfo,
  type OnboardResult,
  type TeamGroupLite,
} from "@/@admin-port/api/nodes"
import { NodeInstallGuide, useNodeBinaries } from "./install-guide"
import { OnboardNodeModal, type ManageChoice, type OnboardKind } from "./onboard-node"
import { AssignModal } from "./assign-groups"
import { MoveNodeModal } from "./move-node"
import { NodeDetailModal } from "./node-detail"
import { ApproveNodeModal } from "./approve-node"

/**
 * 待审批 / 已入驻节点的「安装方式」弹窗。
 *
 * secret 无法再次获取，只展示公开字段 + 命令模板 + 运行程序下载。节点的
 * role / startup_method 来自 ListNodes 的实时状态。
 */
function InstallGuideModal({
  open,
  node,
  serverUrl,
  onClose,
}: {
  open: boolean
  node: NodeInfo | null
  serverUrl?: string
  onClose: () => void
}) {
  // Keep the binary list warm while open (NodeInstallGuide loads its own copy).
  useNodeBinaries(open && Boolean(node))
  if (!node) return null
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>节点安装与启动方式</DialogTitle>
        </DialogHeader>
        <NodeInstallGuide nodeId={node.node_id} role={node.role} serverUrl={serverUrl} />
        <div className="text-right">
          <Button onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function Nodes() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [groups, setGroups] = useState<TeamGroupLite[]>([])

  // 节点入驻弹窗（管理节点 / 执行节点共用）。
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [onboardKind, setOnboardKind] = useState<OnboardKind>("management")
  // 执行节点入口预填的归属管理节点 id（管理客户端入口时为 null）。
  const [presetManagerId, setPresetManagerId] = useState<string | null>(null)
  const [onboardSubmitting, setOnboardSubmitting] = useState(false)
  const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null)
  const [onboardRevoking, setOnboardRevoking] = useState(false)

  const [assignNode, setAssignNode] = useState<NodeInfo | null>(null)
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<NodeInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NodeInfo | null>(null)
  const [installGuideNode, setInstallGuideNode] = useState<NodeInfo | null>(null)
  const [detailNode, setDetailNode] = useState<NodeInfo | null>(null)
  const [moveTarget, setMoveTarget] = useState<NodeInfo | null>(null)
  const [moveSubmitting, setMoveSubmitting] = useState(false)
  // 「审批」不再点击即生效：先弹这个只读详情+确认弹窗，通过后才真正调用 approveNode。
  const [approveTarget, setApproveTarget] = useState<NodeInfo | null>(null)
  // 终端弹框的目标节点（管理端 scope=admin）。null 即弹框关闭。
  const [terminalNode, setTerminalNode] = useState<NodeInfo | null>(null)
  // 从详情「终端」Tab 点「续接」时带上的具体 terminal_id；直接开终端时为空。
  const [terminalAttachId, setTerminalAttachId] = useState("")

  // NodeService 是进程内能力，默认常在，无需先读「服务器配置」。
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nodeList, groupList] = await Promise.all([
        listNodes(),
        listGroups().catch(() => []),
      ])
      setNodes(nodeList)
      setGroups(groupList)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const managementNodes = useMemo(() => nodes.filter((n) => n.role === "management"), [nodes])

  // 摊平的两套后端投影先归一成 NodeView，再让共享的 groupIntoTree 建父子树。
  // 这里只做"节点有哪些"，"怎么画"和"能做什么"分别交给 NodeTreeTable 与下方 action 注入。
  const views = useMemo(() => nodes.map(fromAdminNode), [nodes])
  const nodeGroups = useMemo(() => groupIntoTree(views), [views])

  // ── create entrypoints ────────────────────────────────────────────────────
  const openOnboardManagement = useCallback(() => {
    setOnboardKind("management")
    setPresetManagerId(null)
    setOnboardResult(null)
    setOnboardOpen(true)
  }, [])

  const openAddExecutionNode = useCallback((managerId: string) => {
    setOnboardKind("execution")
    setPresetManagerId(managerId)
    setOnboardResult(null)
    setOnboardOpen(true)
  }, [])

  const openTerminal = useCallback((node: NodeInfo, terminalId = "") => {
    setTerminalAttachId(terminalId)
    setTerminalNode(node)
  }, [])

  // ── actions ───────────────────────────────────────────────────────────────
  // One onboard entry for both kinds. A management node with manage="grouping"
  // is a pure grouping container (passive): no credential, no install — it is
  // created and the dialog closes straight away. Everything else (a manageable
  // management client, or an execution node) mints a credential and shows the
  // install result page.
  const handleOnboard = async (
    nodeName: string,
    manage: ManageChoice,
    proxyConfigId: string,
  ) => {
    const grouping = onboardKind === "management" && manage === "grouping"
    setOnboardSubmitting(true)
    try {
      const result = await onboardNode({
        role:
          onboardKind === "execution"
            ? "execution"
            : grouping
              ? "passive_management"
              : "management",
        startup_method: onboardKind === "execution" ? "standalone" : "docker",
        node_name: nodeName || undefined,
        manager_node_id:
          onboardKind === "execution" ? presetManagerId || undefined : undefined,
        // 纯分组容器不安装、无下载，不传代理；其余节点绑定所选下载代理。
        proxy_config_id: grouping ? "" : proxyConfigId,
      })
      if (grouping) {
        // No credential/install for a grouping container — close and refresh.
        toast.success("已创建管理节点（不可管理）")
        setOnboardOpen(false)
        setOnboardResult(null)
      } else {
        setOnboardResult(result)
      }
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "入驻失败")
    } finally {
      setOnboardSubmitting(false)
    }
  }

  const handleApprove = async (node: NodeInfo) => {
    setActingId(node.node_id)
    try {
      await approveNode(node.node_id)
      toast.success("已审批")
      setApproveTarget(null)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "审批失败")
    } finally {
      setActingId(null)
    }
  }

  const handleRevoke = async (node: NodeInfo) => {
    setActingId(node.node_id)
    try {
      await revokeNode(node.node_id)
      toast.success("已吊销")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "吊销失败")
    } finally {
      setActingId(null)
      setRevokeTarget(null)
    }
  }

  const handleDelete = async (node: NodeInfo) => {
    setActingId(node.node_id)
    try {
      if (node.status === "pending") {
        await revokeOnboardNode(node.node_id)
      } else {
        await deleteNode(node.node_id)
      }
      toast.success("已删除节点")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setActingId(null)
      setDeleteTarget(null)
    }
  }

  // Revoke a just-onboarded node from inside the result modal (never came online).
  const handleRevokeOnboardById = async (nodeId: string) => {
    setOnboardRevoking(true)
    try {
      const res = await revokeOnboardNode(nodeId)
      toast.success(res.deleted ? "已删除未上线的入驻记录" : "已吊销")
      setOnboardOpen(false)
      setOnboardResult(null)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "撤销入驻失败")
    } finally {
      setOnboardRevoking(false)
    }
  }

  const handleAssign = async (groupIds: string[]) => {
    if (!assignNode) return
    setAssignSubmitting(true)
    try {
      await Promise.all(groupIds.map((gid) => bindGroupNode(gid, assignNode.node_id)))
      toast.success("已分配给所选分组")
      setAssignNode(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分配失败")
    } finally {
      setAssignSubmitting(false)
    }
  }

  const handleMove = async (managerNodeId: string) => {
    if (!moveTarget) return
    setMoveSubmitting(true)
    try {
      await moveNode(moveTarget.node_id, managerNodeId)
      toast.success("已移动节点")
      setMoveTarget(null)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移动失败")
    } finally {
      setMoveSubmitting(false)
    }
  }

  // ── action renderers ────────────────────────────────────────────────────────
  // 表格渲染由 NodeTreeTable 负责；这里只注入"能做什么"。所有写操作都要原始
  // NodeInfo（弹窗/接口都按 admin 形状写的），所以先从 NodeView 取回原始行。
  const asNode = (view: NodeView) => view.raw as NodeInfo

  const renderManagerActions = (view: NodeView) => {
    const manager = asNode(view)
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setDetailNode(manager)}>
          详情
        </Button>
        <Button size="sm" onClick={() => openAddExecutionNode(manager.node_id)}>
          <Plus />
          添加执行节点
        </Button>
        {canOpenTerminal(view) ? (
          <Button size="sm" variant="outline" onClick={() => openTerminal(manager)}>
            <TerminalIcon />
            终端
          </Button>
        ) : null}
        {/* 管理客户端才有安装/审批（分组容器即用、无客户端）。 */}
        {!view.isPassive ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setInstallGuideNode(manager)}>
              安装方式
            </Button>
            {manager.status === "pending" ? (
              <Button
                size="sm"
                disabled={actingId === manager.node_id}
                onClick={() => setApproveTarget(manager)}
              >
                审批
              </Button>
            ) : null}
          </>
        ) : null}
        {manager.status === "approved" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={actingId === manager.node_id}
            onClick={() => setRevokeTarget(manager)}
          >
            设为不可用
          </Button>
        ) : null}
        {manager.status === "revoked" ? (
          <Button
            size="sm"
            disabled={actingId === manager.node_id}
            onClick={() => void handleApprove(manager)}
          >
            设为可用
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={actingId === manager.node_id}
          onClick={() => setDeleteTarget(manager)}
        >
          删除
        </Button>
      </>
    )
  }

  const renderExecutionActions = (view: NodeView) => {
    const node = asNode(view)
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setDetailNode(node)}>
          详情
        </Button>
        {canOpenTerminal(view) ? (
          <Button size="sm" variant="outline" onClick={() => openTerminal(node)}>
            <TerminalIcon />
            终端
          </Button>
        ) : null}
        {node.status === "pending" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setInstallGuideNode(node)}>
              安装方式
            </Button>
            <Button size="sm" disabled={actingId === node.node_id} onClick={() => setApproveTarget(node)}>
              审批
            </Button>
          </>
        ) : null}
        {node.status === "approved" ? (
          <>
            <Button size="sm" variant="outline" disabled={actingId === node.node_id} onClick={() => setMoveTarget(node)}>
              移动到其他管理节点
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actingId === node.node_id}
              onClick={() => setRevokeTarget(node)}
            >
              设为不可用
            </Button>
          </>
        ) : null}
        {node.status === "revoked" ? (
          <Button size="sm" disabled={actingId === node.node_id} onClick={() => void handleApprove(node)}>
            设为可用
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={actingId === node.node_id} onClick={() => setDeleteTarget(node)}>
          删除
        </Button>
      </>
    )
  }

  return (
    <AdminPage
      title="节点管理"
      description="管理 agent-compose 分布式节点：管理节点归拢执行节点，可选是否可管理（在宿主机启停执行节点），审批、吊销，并把节点分配给用户分组"
      primaryActions={
        <>
          <ManagerRefreshButton loading={loading} onClick={() => void fetchData()} />
          <Button variant="outline" size="sm" onClick={openOnboardManagement}>
            <Plus />
            新建管理节点
          </Button>
        </>
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void fetchData()}>
              重试
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <SectionCard
        title="节点列表"
        extra={<span className="text-sm text-muted-foreground">共 {nodes.length} 个节点</span>}
      >
        {loading && nodes.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <NodeTreeTable
            groups={nodeGroups}
            columns={["version", "editors", "status"]}
            emptyHint="暂无节点。先「新建管理节点」，再在其下添加执行节点"
            noExecutionHint="该管理节点下暂无执行节点，点击「添加执行节点」创建。"
            renderManagerActions={renderManagerActions}
            renderExecutionActions={renderExecutionActions}
          />
        )}
      </SectionCard>

      <OnboardNodeModal
        open={onboardOpen}
        kind={onboardKind}
        managerNode={
          onboardKind === "execution" && presetManagerId
            ? managementNodes.find((n) => n.node_id === presetManagerId)
            : null
        }
        nodes={nodes}
        managementNodes={managementNodes}
        submitting={onboardSubmitting}
        result={onboardResult}
        onRevoke={(nodeId) => void handleRevokeOnboardById(nodeId)}
        revoking={onboardRevoking}
        onSubmit={handleOnboard}
        onApprove={(node) => {
          setOnboardOpen(false)
          setOnboardResult(null)
          setPresetManagerId(null)
          setApproveTarget(node)
        }}
        onClose={() => {
          setOnboardOpen(false)
          setOnboardResult(null)
          setPresetManagerId(null)
        }}
      />

      <InstallGuideModal
        open={installGuideNode !== null}
        node={installGuideNode}
        onClose={() => setInstallGuideNode(null)}
      />

      <AssignModal
        open={assignNode !== null}
        node={assignNode}
        groups={groups}
        submitting={assignSubmitting}
        onSubmit={handleAssign}
        onClose={() => setAssignNode(null)}
      />

      <NodeDetailModal
        open={detailNode !== null}
        node={detailNode}
        nodes={nodes}
        onClose={() => setDetailNode(null)}
        onChanged={() => void fetchData()}
        onOpenTerminal={(nodeId, terminalId) => {
          // 详情本身是弹框，两层叠加会别扭：先关详情再开终端。
          const target = nodes.find((item) => item.node_id === nodeId)
          setDetailNode(null)
          if (target) openTerminal(target, terminalId || "")
        }}
      />

      <ApproveNodeModal
        open={approveTarget !== null}
        node={approveTarget}
        submitting={actingId === approveTarget?.node_id}
        onApprove={() => {
          if (approveTarget) void handleApprove(approveTarget)
        }}
        onClose={() => setApproveTarget(null)}
      />

      <MoveNodeModal
        open={moveTarget !== null}
        node={moveTarget}
        managers={managementNodes}
        submitting={moveSubmitting}
        onSubmit={(managerId) => void handleMove(managerId)}
        onClose={() => setMoveTarget(null)}
      />

      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => (o ? undefined : setRevokeTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认将该节点设为不可用？</AlertDialogTitle>
            <AlertDialogDescription>
              节点将立即断连并停止派活，记录保留供审计，后续可再次设为可用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (revokeTarget) void handleRevoke(revokeTarget)
              }}
            >
              设为不可用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => (o ? undefined : setDeleteTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该节点？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.status === "pending"
                ? "该节点尚未审批，删除将作废其一次性凭证并移除记录。"
                : "删除后该节点记录将从列表彻底消失、不可恢复。若为管理节点，须先删除或移交其下的执行节点。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {terminalNode ? (
        <NodeTerminalDialog
          open
          onOpenChange={(next) => {
            if (!next) setTerminalNode(null)
          }}
          scope="admin"
          nodeId={terminalNode.node_id}
          nodeName={terminalNode.node_name || terminalNode.node_id}
          terminalId={terminalAttachId || undefined}
        />
      ) : null}
    </AdminPage>
  )
}

export default Nodes
