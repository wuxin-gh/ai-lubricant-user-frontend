/**
 * 节点审批弹窗（列表「审批」与入驻弹窗连接成功后共用同一个入口）。
 *
 * 审批不再是列表里点一下就直接生效：无论从列表进入，还是节点刚连回服务端，都先进
 * 这个弹窗核对节点上报的详细信息（机器规格、已装编辑器、客户端内网/公网 IP、服务端
 * 看到的连接地址），确认无误后再点「通过审批」。
 *
 * 面板本体 NodeInfoPanel 是内联组件（不是 Dialog），所以可以被入驻弹窗直接嵌进去，
 * 不会出现双层 Dialog。
 */
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { listNodes, installNodeEditor, type NodeInfo } from "@/@admin-port/api/nodes"
import { NodeJSInstallButton, NodePrerequisiteGuide } from "./node-prerequisite-guide"
import {
  ROLE_LABEL,
  STATUS_META,
  machineInfoLine,
  machineSpecs,
  nodeEditorVersions,
  nodeEditors,
  nodeNetwork,
  nodeBelowFloor,
  npmBelowFloor,
  NODE_FLOOR_MAJOR,
  NPM_FLOOR_MAJOR,
} from "./types"

/** 审批硬门禁缺失项；与服务端 NodeService.approve_node 保持一致。 */
function missingApprovalEnvironment(node: NodeInfo): string[] {
  if (node.is_passive || node.role === "management") return []
  const caps = node.capabilities || {}
  const missing: string[] = []
  if (nodeBelowFloor(caps)) {
    missing.push(`Node.js（需 ≥ v${NODE_FLOOR_MAJOR}）`)
  }
  if (npmBelowFloor(caps)) {
    missing.push(`npm（需 ≥ v${NPM_FLOOR_MAJOR}）`)
  }
  if (!(caps.runtime_version || "").trim()) missing.push("agent-compose runtime")
  // 编辑器「是否已装」真相源是 capabilities.editors 数组（节点注册探测）；
  // 回退 providers 逗号串、再回退 editor_version_*。任一信号非空即视为已装，
  // 不能只读 providers——某些节点漏报 providers 串导致装了仍被判未装。
  const rawEditors = (caps as Record<string, unknown>).editors
  const hasEditor = Array.isArray(rawEditors) && rawEditors.length > 0
  const hasProviders = Boolean((caps.providers || "").trim())
  if (!hasEditor && !hasProviders) missing.push("至少一个编辑器客户端")
  return missing
}

function cleanVersion(v: string): string {
  return v.replace(/^v/i, "")
}

/** 节点上报信息只读面板：状态、ID、机器规格、编辑器、网络地址。 */
export function NodeInfoPanel({ node }: { node?: NodeInfo | null }) {
  if (!node) {
    return <p className="text-sm text-muted-foreground">节点信息尚未上报，请稍候。</p>
  }
  const status = STATUS_META[node.status] || STATUS_META.unknown
  const specs = machineSpecs(node.capabilities)
  const editors = nodeEditors(node.capabilities)
  const network = nodeNetwork(node.capabilities)
  const machine = machineInfoLine(node.capabilities)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{node.node_name || node.node_id}</span>
        <Badge variant="outline">{ROLE_LABEL[node.role] || node.role}</Badge>
        {node.connected ? (
          <Badge variant="outline" className="text-green-600 dark:text-green-400">
            已连回
          </Badge>
        ) : null}
        <Badge variant="outline" className={status.className}>
          {status.label}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">节点 ID</span>
          <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{node.node_id}</code>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">机器信息</span>
          <span className="text-sm">{machine || "尚未上报"}</span>
        </div>
        {specs.map((spec) => (
          <div key={spec.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{spec.label}</span>
            <span className="text-sm">{spec.value}</span>
          </div>
        ))}
        {network.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{row.value}</code>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">最近心跳</span>
          <span className="text-sm">{node.last_heartbeat_at || "尚未上报"}</span>
        </div>
        {editors.length > 0 ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">已安装的支持编辑器</span>
            <div className="flex flex-wrap gap-1">
              {editors.map((editor) => (
                <Badge key={editor} variant="secondary">
                  {editor}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 节点运行环境只读表：Go 客户端、Node.js/npm、runtime 与已安装编辑器。 */
function NodeEnvironmentPanel({
  node,
  onRefresh,
}: {
  node: NodeInfo
  onRefresh?: (node: NodeInfo) => void
}) {
  const caps = node.capabilities || {}
  const runtimeVersion = (caps.runtime_version || "").trim()
  const clientVersion = (caps.client_version || "").trim()
  const editors = nodeEditors(caps)
  const editorRows = nodeEditorVersions(caps)
  const nodeStale = nodeBelowFloor(caps)      // 缺失或低于下限：都给升级按钮
  const npmStale = npmBelowFloor(caps)
  const [installingEditor, setInstallingEditor] = useState<string | null>(null)

  const installEditor = async (editor: string) => {
    if (installingEditor) return
    setInstallingEditor(editor)
    try {
      await installNodeEditor(node.node_id, editor)
      const fresh = (await listNodes()).find((item) => item.node_id === node.node_id)
      if (fresh) onRefresh?.(fresh)
    } catch (err) {
      // 审批弹窗内直接呈现失败原因，而不是只留下「缺少编辑器」的静态门禁。
      const message = err instanceof Error ? err.message : "编辑器安装失败"
      window.alert(`安装 ${editor} 失败：${message}`)
    } finally {
      setInstallingEditor(null)
    }
  }

  const isManagement = node.role === "management" || node.is_passive
  return (
    <div className="flex flex-col gap-4">
      {isManagement ? (
        <Alert>
          <AlertDescription>
            管理节点只负责在本机调度和启动执行节点，不运行 agent-compose runtime 或编辑器客户端；审批不需要安装这些组件。
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="overflow-hidden rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">组件</th>
                  <th className="px-3 py-2 text-left font-medium">当前版本</th>
                  <th className="px-3 py-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-3 py-2 font-medium">Go 节点程序</td>
                  <td className={`px-3 py-2 ${clientVersion ? "font-mono" : "text-destructive"}`}>
                    {clientVersion ? `v${cleanVersion(clientVersion)}` : "未安装或未上报"}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">
                    Node.js
                    {nodeStale ? (
                      <Badge variant="outline" className="ml-1.5 border-destructive text-destructive">需升级 ≥ v{NODE_FLOOR_MAJOR}</Badge>
                    ) : null}
                  </td>
                  <td className={`px-3 py-2 ${nodeStale ? "text-destructive" : "font-mono"}`}>
                    {(caps.node_version || "").trim() ? `v${cleanVersion(caps.node_version || "")}${nodeStale ? "（过低）" : ""}` : "未安装或未上报"}
                  </td>
                  <td className="px-3 py-2">{nodeStale ? <NodeJSInstallButton node={node} onRefresh={onRefresh} compact /> : null}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">
                    npm
                    {npmStale ? (
                      <Badge variant="outline" className="ml-1.5 border-destructive text-destructive">需升级 ≥ v{NPM_FLOOR_MAJOR}</Badge>
                    ) : null}
                  </td>
                  <td className={`px-3 py-2 ${npmStale ? "text-destructive" : "font-mono"}`}>
                    {(caps.npm_version || "").trim() ? `v${cleanVersion(caps.npm_version || "")}${npmStale ? "（过低）" : ""}` : "未安装或未上报"}
                  </td>
                  <td className="px-3 py-2">{npmStale ? <NodeJSInstallButton node={node} onRefresh={onRefresh} compact /> : null}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">agent-compose runtime</td>
                  <td className={`px-3 py-2 ${runtimeVersion ? "font-mono" : "text-destructive"}`}>
                    {runtimeVersion ? `v${cleanVersion(runtimeVersion)}` : "未安装"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">由节点安装脚本自动下载</td>
                </tr>
              </tbody>
            </table>
          </div>
          {editors.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">已安装的支持编辑器</span>
              <div className="flex flex-wrap gap-1">{editors.map((editor) => <Badge key={editor} variant="secondary">{editor}</Badge>)}</div>
            </div>
          ) : <p className="text-xs text-destructive">尚未安装任何编辑器客户端</p>}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              编辑器客户端{editors.length === 0 ? <span className="ml-1 text-destructive">（审批必装至少一个）</span> : null}
            </span>
            <div className="overflow-hidden rounded border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {editorRows.map((e) => (
                    <tr key={e.editor}>
                      <td className="px-3 py-2 font-medium">{e.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {e.installed ? (e.version ? <span className="font-mono">v{cleanVersion(e.version)}</span> : "已安装 · 版本未知") : "未安装"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button size="sm" variant="outline" disabled={!node.connected || installingEditor !== null} onClick={() => void installEditor(e.editor)}>
                          {installingEditor === e.editor ? <Spinner /> : null}
                          {e.installed ? "已装" : installingEditor === e.editor ? "安装中（可能数分钟）…" : "安装"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              安装会在节点上执行该编辑器的官方命令（npm 全局安装），可能耗时数分钟；装完版本上报后审批门禁自动解除。
            </p>
          </div>
          <NodePrerequisiteGuide node={node} onRefresh={onRefresh} />
        </>
      )}
    </div>
  )
}

export function ApproveNodeModal({
  open,
  node,
  submitting,
  onApprove,
  onClose,
}: {
  open: boolean
  node: NodeInfo | null
  submitting?: boolean
  onApprove: (nodeId: string) => void
  onClose: () => void
}) {
  // 安装按钮触发后，服务端把版本折进 capabilities；父级传入的是快照，这里自己
  // 轮询拉最新，按钮状态与「通过审批」禁用态随之自动刷新。与入驻弹窗同口径。
  const [liveNode, setLiveNode] = useState<NodeInfo | null>(node)
  useEffect(() => {
    setLiveNode(node)
  }, [node])
  useEffect(() => {
    if (!open || !node?.node_id) return
    const id = node.node_id
    let cancelled = false
    const poll = () =>
      void listNodes()
        .then((list) => {
          if (cancelled) return
          const fresh = list.find((n) => n.node_id === id) || null
          setLiveNode((prev) => (fresh ? fresh : prev))
        })
        .catch(() => {
          // 单次失败静默。
        })
    void poll()
    const timer = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, node?.node_id])

  if (!liveNode) return null
  const alreadyApproved = liveNode.status === "approved"
  const missingEnvironment = missingApprovalEnvironment(liveNode)
  const approvalBlocked = missingEnvironment.length > 0
  // 离线不可审批：审批要等在线上报的环境齐备，且审批动作本身要经控制面派发；
  // 节点掉线时按钮置灰，并明确告知「离线不可审批」，避免「看着能审批但点了失败」。
  const nodeOffline = !liveNode.connected
  const offlineApprovalBlocked = alreadyApproved ? false : nodeOffline
  // 缺项时默认开「环境」Tab：管理员一眼看到「必装」与「安装」按钮，不用再找。
  const defaultTab = !alreadyApproved && (approvalBlocked || offlineApprovalBlocked) ? "environment" : "overview"

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>{alreadyApproved ? "节点信息" : "审批节点"}</DialogTitle>
        </DialogHeader>

        {/* 布局契约同入驻弹窗：滚动区必须 flex-1 min-h-0，否则内容一长页脚被裁。 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {alreadyApproved ? (
            <Alert>
              <AlertDescription>
                该节点已审批通过，下面是它上报的详细信息。
              </AlertDescription>
            </Alert>
          ) : offlineApprovalBlocked ? (
            <Alert variant="destructive">
              <AlertDescription>
                节点当前离线，不可审批。请先让节点重新连接；连接恢复后此处会自动刷新。
              </AlertDescription>
            </Alert>
          ) : approvalBlocked ? (
            /* 缺项警告放最上方核对信息处：进门第一眼看到缺什么、去哪补，而不是
               挡在 Tab 和页脚之间的底部红框或按钮悬浮提示。 */
            <Alert variant="destructive">
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <span>基础环境未完成，暂不能审批。缺少：</span>
                  <div className="flex flex-wrap gap-1">
                    {missingEnvironment.map((item) => (
                      <Badge key={item} variant="outline" className="border-destructive text-destructive">
                        缺少 {item}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs">
                    逐项在下方「环境」Tab 点「安装」补齐：Node.js/npm 与编辑器客户端均可在线安装，装完版本上报后此处自动消除、审批解锁。
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                核对节点上报的机器信息与来源地址后再通过审批。审批通过后该节点即可接受派活。
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue={defaultTab} className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="environment">环境</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <NodeInfoPanel node={liveNode} />
            </TabsContent>
            <TabsContent value="environment" className="mt-4">
              <NodeEnvironmentPanel node={liveNode} onRefresh={setLiveNode} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t p-6 pt-4">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {alreadyApproved ? "关闭" : "暂不审批"}
          </Button>
          {alreadyApproved ? null : (
            <Button
              disabled={submitting || approvalBlocked || offlineApprovalBlocked}
              onClick={() => onApprove(liveNode.node_id)}
            >
              {submitting ? <Spinner /> : null}
              通过审批
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
