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
import type { NodeInfo } from "@/@admin-port/api/nodes"
import { NodePrerequisiteGuide } from "./node-prerequisite-guide"
import {
  ROLE_LABEL,
  STATUS_META,
  machineInfoLine,
  machineSpecs,
  nodeEditors,
  nodeNetwork,
} from "./types"

/** 审批硬门禁缺失项；与服务端 NodeService.approve_node 保持一致。 */
function missingApprovalEnvironment(node: NodeInfo): string[] {
  if (node.is_passive) return []
  const caps = node.capabilities || {}
  const missing: string[] = []
  if (!(caps.node_version || "").trim()) missing.push("Node.js")
  if (!(caps.npm_version || "").trim()) missing.push("npm")
  if (!(caps.runtime_version || "").trim()) missing.push("agent-compose runtime")
  if (!(caps.providers || "").trim()) missing.push("至少一个编辑器客户端")
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
function NodeEnvironmentPanel({ node }: { node: NodeInfo }) {
  const caps = node.capabilities || {}
  const runtimeVersion = (caps.runtime_version || "").trim()
  const clientVersion = (caps.client_version || "").trim()
  const editors = nodeEditors(caps)
  const rows = [
    { label: "Go 节点程序", value: clientVersion },
    { label: "Node.js", value: (caps.node_version || "").trim() },
    { label: "npm", value: (caps.npm_version || "").trim() },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">组件</th>
              <th className="px-3 py-2 text-left font-medium">当前版本</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td className={`px-3 py-2 ${row.value ? "font-mono" : "text-destructive"}`}>
                  {row.value ? `v${cleanVersion(row.value)}` : "未安装或未上报"}
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-2 font-medium">agent-compose runtime</td>
              <td className={`px-3 py-2 ${runtimeVersion ? "font-mono" : "text-destructive"}`}>
                {runtimeVersion ? `v${cleanVersion(runtimeVersion)}` : "未安装"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {editors.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">已安装的支持编辑器</span>
          <div className="flex flex-wrap gap-1">
            {editors.map((editor) => (
              <Badge key={editor} variant="secondary">{editor}</Badge>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-destructive">尚未安装任何编辑器客户端</p>
      )}
      {node.is_passive ? null : <NodePrerequisiteGuide node={node} />}
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
  if (!node) return null
  const alreadyApproved = node.status === "approved"
  const missingEnvironment = missingApprovalEnvironment(node)
  const approvalBlocked = missingEnvironment.length > 0

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>{alreadyApproved ? "节点信息" : "审批节点"}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto p-6">
          <Alert>
            <AlertDescription>
              {alreadyApproved
                ? "该节点已审批通过，下面是它上报的详细信息。"
                : "核对节点上报的机器信息与来源地址后再通过审批。审批通过后该节点即可接受派活。"}
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="overview" className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="environment">环境</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <NodeInfoPanel node={node} />
            </TabsContent>
            <TabsContent value="environment" className="mt-4">
              <NodeEnvironmentPanel node={node} />
            </TabsContent>
          </Tabs>

          {!alreadyApproved && approvalBlocked ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <span>基础环境未完成，暂不能审批：</span>
                  <div className="flex flex-wrap gap-1">
                    {missingEnvironment.map((item) => (
                      <Badge key={item} variant="outline" className="border-destructive text-destructive">
                        缺少 {item}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs">
                    agent-compose runtime 由节点安装脚本自动下载；编辑器客户端可在节点详情「环境」Tab 在线安装；Node.js/npm 需在节点主机完成安装。
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t p-6 pt-4">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {alreadyApproved ? "关闭" : "暂不审批"}
          </Button>
          {alreadyApproved ? null : (
            <Button
              disabled={submitting || approvalBlocked}
              title={approvalBlocked ? `缺少：${missingEnvironment.join("、")}` : undefined}
              onClick={() => onApprove(node.node_id)}
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
