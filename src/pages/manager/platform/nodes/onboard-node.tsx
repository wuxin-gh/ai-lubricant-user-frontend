/**
 * 节点入驻弹窗（管理节点 & 执行节点共用）。
 *
 * 两个入口：
 * - management（顶部「新建管理节点」）：弹窗内选「执行节点是否可管理」——
 *   · 可管理 → 有客户端，拨号连回、能在本机启停执行节点，有一次性凭证 + 安装引导；
 *   · 不可管理 → 纯分组容器（passive），即建即用，无凭证、无安装，直接关闭。
 * - execution（父行「添加执行节点」）：必须归属某个管理节点，有凭证 + 安装引导。
 *
 * 有客户端的流程：表单 → 生成凭证 → 结果页突出展示 secret + 一键命令 + 安装引导 →
 * 轮询 ListNodes 等待上线（未上线时用「吊销节点」替代关闭，避免丢失一次性凭证）→
 * 节点连回且仍待审批时自动打开审批弹窗。
 */
import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  listNodes,
  type NodeInfo,
  type OnboardResult,
} from "@/@admin-port/api/nodes"
import { getProxies, type ProxyEntry } from "@/@admin-port/api/proxyPool"
import { NodeInstallGuide } from "./install-guide"
import { NodeInfoPanel } from "./approve-node"

const DIRECT_ONBOARD = "__direct__"

/** 弹窗要入驻的节点种类（execution 从父行进入；management 从顶部进入）。 */
export type OnboardKind = "execution" | "management"

/** 管理节点的「执行节点是否可管理」——决定它是有客户端还是纯分组。 */
export type ManageChoice = "manageable" | "grouping"

export function OnboardNodeModal({
  open,
  kind,
  managerNode,
  submitting,
  result,
  serverUrl,
  onSubmit,
  onClose,
  onRevoke,
  revoking,
  onApprove,
}: {
  open: boolean
  /** execution（父行「添加执行节点」）| management（顶部「新建管理节点」）。 */
  kind: OnboardKind
  /** 执行节点入口预填的归属管理节点（只读展示）。 */
  managerNode?: NodeInfo | null
  /** 当前全量节点快照，用于结果页只读展示管理节点的执行客户端。 */
  nodes?: NodeInfo[]
  /** 当前管理节点快照，用于结果页只读展示执行节点的归属管理节点。 */
  managementNodes?: NodeInfo[]
  submitting: boolean
  result: OnboardResult | null
  serverUrl?: string
  /** management 入口带上「可管理/不可管理」的选择；execution 入口传不管。
   *  有凭证的节点（execution / 可管理 management）带上选定的下载代理 id
   *  （空=直连）；纯分组容器不需要，因为不安装、不下发。 */
  onSubmit: (nodeName: string, manage: ManageChoice, proxyConfigId: string) => void
  onClose: () => void
  /** 首次注册未上线时，用「吊销节点」替代关闭。 */
  onRevoke?: (nodeId: string) => void
  revoking?: boolean
  /** 连接成功后仍待审批时，把该节点交给审批弹窗。 */
  onApprove?: (node: NodeInfo) => void
}) {
  const isManagement = kind === "management"
  const [nodeName, setNodeName] = useState("")
  // 仅 management 入口用：默认「可管理」（有客户端）。
  const [manage, setManage] = useState<ManageChoice>("manageable")
  // 下载代理：有凭证的节点（execution / 可管理 management）下发升级/安装二进制用它。
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [proxyId, setProxyId] = useState<string>(DIRECT_ONBOARD)

  useEffect(() => {
    if (open && !result) {
      setNodeName("")
      setManage("manageable")
      setProxyId(DIRECT_ONBOARD)
    }
  }, [open, result])

  useEffect(() => {
    if (!open || result) return
    void getProxies()
      .then((list) => setProxies((list || []).filter((p) => p.mode !== "node")))
      .catch(() => setProxies([]))
  }, [open, result])

  // 纯分组容器（不可管理）无凭证、不安装——提交后不进入结果态，直接由父层关闭刷新。
  const isGroupingManagement = isManagement && manage === "grouping"

  // 结果态下轮询 ListNodes，实时刷新该节点的上线/审批状态。
  const [liveNode, setLiveNode] = useState<NodeInfo | null>(null)
  const pollRequestId = useRef(0)
  const autoApproveNodeId = useRef<string | null>(null)

  useEffect(() => {
    autoApproveNodeId.current = null
  }, [result?.node_id])

  useEffect(() => {
    if (!open || !result?.node_id) {
      setLiveNode(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      const requestId = ++pollRequestId.current
      try {
        const list = await listNodes()
        if (cancelled || requestId !== pollRequestId.current) return
        setLiveNode(list.find((n) => n.node_id === result.node_id) || null)
      } catch {
        // 忽略单次轮询失败，下一次再试。
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, result?.node_id])

  useEffect(() => {
    if (
      !open ||
      !result?.node_id ||
      !liveNode ||
      liveNode.node_id !== result.node_id ||
      !liveNode.connected ||
      liveNode.status !== "pending" ||
      !onApprove ||
      autoApproveNodeId.current === liveNode.node_id
    ) {
      return
    }
    autoApproveNodeId.current = liveNode.node_id
    onApprove(liveNode)
  }, [liveNode, onApprove, open, result?.node_id])

  const hasSecret = Boolean(result?.secret)
  // 已连回 = 节点客户端真正建好了 NodeConnect 流。审批状态单独看，不并入「在线」。
  const online = Boolean(liveNode?.connected)
  const awaitingFirstRegister = Boolean(result) && hasSecret && !online

  const title = result
    ? online
      ? "节点已连回"
      : "节点已入驻 — 安装与启动"
    : isManagement
      ? "新建管理节点"
      : "添加执行节点"

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? undefined : awaitingFirstRegister ? undefined : onClose())}
    >
      <DialogContent showCloseButton={false} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4 overflow-y-auto p-6">
            <Alert variant={online ? "default" : "destructive"}>
              <AlertDescription>
                {online
                  ? liveNode?.status === "pending"
                    ? "节点已连回服务端，正在打开审批窗口。请核对下方信息后完成审批。"
                    : "节点已连回服务端。"
                  : "等待节点在目标机器上安装并连回服务端……安装完成后此处会自动更新。上线前请勿关闭，以免丢失一次性凭证。"}
              </AlertDescription>
            </Alert>

            {online ? (
              <>
                <NodeInfoPanel node={liveNode || result.node} />
                {/* 连回后仍保留安装引导：一键命令含的一次性 secret 此时已失效，
                    但「高级：手动下载运行程序」仍需可用——离线/自定义部署时管理员
                    可能要在审批期间手动取二进制，不能因连回就丢掉这个入口。 */}
                <NodeInstallGuide
                  nodeId={result.node_id}
                  secret={result.secret}
                  otpauthUri={result.otpauth_uri}
                  role={result.node?.role || (isManagement ? "management" : "execution")}
                  launched={result.launched}
                  serverUrl={serverUrl}
                />
              </>
            ) : (
              <NodeInstallGuide
                nodeId={result.node_id}
                secret={result.secret}
                otpauthUri={result.otpauth_uri}
                role={result.node?.role || (isManagement ? "management" : "execution")}
                launched={result.launched}
                serverUrl={serverUrl}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto p-6">
            {isManagement ? (
              <Alert>
                <AlertDescription>
                  管理节点用于归拢执行节点、按分组授权。下面选它是否需要在宿主机上启停执行节点。
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>
                  正在为管理节点
                  <span className="mx-1 font-medium text-foreground">
                    {managerNode?.node_name || managerNode?.node_id}
                  </span>
                  创建一个执行节点。生成后按弹窗内的一键命令在目标机器安装并连回。
                </AlertDescription>
              </Alert>
            )}

            {isManagement ? (
              <div className="flex flex-col gap-1.5">
                <Label>执行节点是否可管理</Label>
                <RadioGroup
                  value={manage}
                  onValueChange={(v) => setManage(v as ManageChoice)}
                  disabled={submitting}
                  className="gap-2"
                >
                  <ManageOption
                    value="manageable"
                    checked={manage === "manageable"}
                    title="可管理"
                    desc="装一个客户端在宿主机上拨号连回，能在本机启停执行节点。有一次性凭证 + 安装引导，需审批。"
                  />
                  <ManageOption
                    value="grouping"
                    checked={manage === "grouping"}
                    title="不可管理"
                    desc="仅作为分组容器归拢执行节点、方便按分组授权。即建即用，无需安装、无凭证。"
                  />
                </RadioGroup>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>节点名称（可选）</Label>
              <Input
                placeholder="留空则用机器 hostname"
                disabled={submitting}
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
              />
            </div>

            {/* 有凭证的节点（execution / 可管理 management）才需要下载代理；
                纯分组容器不安装、不下载，不展示。 */}
            {!isGroupingManagement ? (
              <div className="flex flex-col gap-1.5">
                <Label>下载代理</Label>
                <Select value={proxyId} onValueChange={setProxyId} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DIRECT_ONBOARD}>直连（不使用代理）</SelectItem>
                    {proxies.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name || p.id}（{p.mode}）</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  节点从 GitHub 下载升级/安装二进制时使用的代理，与节点绑定，可随后在节点详情修改。
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t p-6 pt-4">
          {result ? (
            awaitingFirstRegister ? (
              <>
                <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  等待节点上线…
                </span>
                <Button
                  variant="destructive"
                  disabled={revoking}
                  onClick={() => onRevoke?.(result.node_id)}
                >
                  {revoking ? <Spinner /> : null}
                  撤回并退出
                </Button>
              </>
            ) : online && liveNode?.status === "pending" ? (
              <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                正在打开审批窗口…
              </span>
            ) : result ? (
              <Button onClick={onClose}>完成</Button>
            ) : null
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                取消
              </Button>
              <Button
                onClick={() => onSubmit(nodeName, manage, proxyId === DIRECT_ONBOARD ? "" : proxyId)}
                disabled={submitting}
              >
                {submitting ? <Spinner /> : null}
                {isGroupingManagement ? "创建" : "生成凭证"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 「可管理 / 不可管理」单选项：整块可点，标题 + 说明。 */
function ManageOption({
  value,
  checked,
  title,
  desc,
}: {
  value: string
  checked: boolean
  title: string
  desc: string
}) {
  return (
    <Label
      htmlFor={`manage-${value}`}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
        checked ? "border-primary/50 bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <RadioGroupItem id={`manage-${value}`} value={value} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </Label>
  )
}
