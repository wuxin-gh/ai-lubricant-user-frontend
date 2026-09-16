/**
 * 「接入节点」引导（首页快捷导航）—— 完整接入流程，与「运维 → 执行节点」同一套步骤。
 *
 * 步骤（不省）：
 *   ① 选方式
 *      · 创建自管理环境 —— 平台起一个 docker 管理节点（用户自己没有机器时选这个）
 *      · 引用自己的     —— 用自己的机器（拿一次性凭证 + 安装命令去目标机器执行）
 *   ② 填分组名 —— 分组是节点归属容器；建分组时把创建者加为成员，故「只能看到自己的」。
 *   ③ 结果 —— 展示一次性凭证 / 一键安装命令 / 安装引导，并轮询等节点连回。
 *      （管理节点会自己拉起执行节点，不需要用户动手。）
 *
 * 复用管理端同款组件（NodeInstallGuide / NodeInfoPanel），保证两处步骤一致、
 * 不产生第二套实现。
 *
 * 后端：POST /api/v1/teams/groups 建分组（自动加创建者为成员），
 *       POST /teams/groups/{gid}/management-nodes 建管理节点（自管理环境），
 *       POST /teams/groups/{gid}/execution-nodes 建执行节点（引用自己的机器）。
 */
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLeft, ArrowRight, Layers, MonitorSmartphone, Plus } from "lucide-react"
import { toast } from "sonner"

import {
  createGroupExecutionNode,
  createGroupManagementNode,
  createTeamGroup,
  listTeamProxies,
  type CreateGroupExecutionNodeResult,
  type TeamProxyEntry,
} from "@/api/reviewClient"
import type { NodeInfo as AdminNodeInfo } from "@/@admin-port/api/nodes"
import { useCommonData } from "@/components/console/data-provider"
import { NodeInstallGuide } from "@/pages/manager/platform/nodes/install-guide"
import { NodeInfoPanel } from "@/pages/manager/platform/nodes/approve-node"
import { Button } from "@/components/ui/button"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

/** 两种接入方式。 */
type ConnectMode = "selfManaged" | "own"

type Step = "mode" | "name" | "result"

export function EditorConnectWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { nodes, reloadNodes } = useCommonData()

  const [step, setStep] = useState<Step>("mode")
  const [mode, setMode] = useState<ConnectMode>("selfManaged")
  const [groupName, setGroupName] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [proxyId, setProxyId] = useState("")
  const [proxies, setProxies] = useState<TeamProxyEntry[]>([])
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<CreateGroupExecutionNodeResult | null>(null)

  // 结果态：轮询节点，实时刷新上线/审批状态（与管理端同口径）。
  const [liveNode, setLiveNode] = useState<AdminNodeInfo | null>(null)
  const pollRequestId = useRef(0)

  const reset = () => {
    setStep("mode")
    setMode("selfManaged")
    setGroupName("")
    setNodeName("")
    setProxyId("")
    setCreating(false)
    setResult(null)
    setLiveNode(null)
  }

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const goName = (next: ConnectMode) => {
    setMode(next)
    setStep("name")
    // 下载代理只对「引用自己的机器」有意义（节点自己去 GitHub 拉运行程序）。
    if (proxies.length === 0) {
      void listTeamProxies().then((rows) => setProxies(rows || [])).catch(() => setProxies([]))
    }
  }

  /** 结果态轮询：节点连回后状态会从 pending → approved，界面自动更新。 */
  useEffect(() => {
    if (!open || !result?.node_id) {
      setLiveNode(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      const requestId = ++pollRequestId.current
      try {
        // 用户侧没有单节点查询接口，靠 reloadNodes 拉全量后从 nodes 里挑。
        await reloadNodes()
        if (cancelled || requestId !== pollRequestId.current) return
        setLiveNode((nodes.find((n) => n.node_id === result.node_id) as AdminNodeInfo | undefined) || null)
      } catch {
        // 单次轮询失败忽略，下一次再试。
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, result?.node_id, nodes, reloadNodes])

  /** 第 2 步提交：建分组 → 按方式建节点。 */
  const submit = async () => {
    const group = groupName.trim()
    if (!group) {
      toast.error(t("quickActions.editorWizard.nameRequired", "请填写分组名称"))
      return
    }
    setCreating(true)
    try {
      // ① 建分组（后端把创建者加为成员 → 节点可见性只对自己）。
      const created = await createTeamGroup(group)

      // ② 按方式建节点：自管理 = docker 管理节点；自己的 = standalone 执行节点。
      const node = mode === "selfManaged"
        ? await createGroupManagementNode(created.id, {
            startup_method: "docker",
            node_name: nodeName.trim() || group,
          })
        : await createGroupExecutionNode(created.id, {
            startup_method: "standalone",
            node_name: nodeName.trim() || group,
            proxy_config_id: proxyId || undefined,
          })

      setResult(node)
      setStep("result")
      await reloadNodes()
    } catch (err) {
      // 后端信封是 {message,...}；reviewFetch 已归一成 Error.message。
      toast.error(err instanceof Error ? err.message : t("quickActions.editorWizard.createFailed", "创建失败"))
    } finally {
      setCreating(false)
    }
  }

  const online = Boolean(liveNode?.connected)
  // 管理节点自动拉起执行节点：纯等待，不展示凭证/命令（用户什么都不用做）。
  const launching = mode === "selfManaged" && Boolean(result?.launched)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b p-6 pb-4">
          <DialogTitle>{t("quickActions.editorWizard.title", "接入节点")}</DialogTitle>
          <DialogDescription>
            {step === "mode"
              ? t(
                  "quickActions.editorWizard.modeDesc",
                  "编辑器与任务都跑在节点上。先选一种方式接入节点，两步就能准备好。iOS 连接器也在这一步接入。",
                )
              : step === "name"
                ? t(
                    "quickActions.editorWizard.nameDesc",
                    "填一个分组名称。之后你只会看到自己创建的分组和节点。",
                  )
                : t(
                    "quickActions.editorWizard.resultDesc",
                    "按下面的指引把节点接进来。连回后这里会自动更新，上线前请勿关闭，以免丢失一次性凭证。",
                  )}
          </DialogDescription>
        </DialogHeader>

        {/* 内容区：flex-1 min-h-0 + overflow-y-auto，页脚才不会被顶出可视区。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          {step === "mode" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => goName("selfManaged")}
                className="flex flex-col gap-2 rounded-xl border p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <Layers className="size-6 text-primary" />
                <span className="font-medium">{t("quickActions.editorWizard.modeIsolated", "创建自管理环境")}</span>
                <span className="text-xs text-muted-foreground">
                  {t(
                    "quickActions.editorWizard.modeIsolatedHint",
                    "平台自动开一个独立环境，不用你有机器，也不用手动安装。",
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => goName("own")}
                className="flex flex-col gap-2 rounded-xl border p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <MonitorSmartphone className="size-6 text-primary" />
                <span className="font-medium">{t("quickActions.editorWizard.modeOwn", "引用自己的")}</span>
                <span className="text-xs text-muted-foreground">
                  {t(
                    "quickActions.editorWizard.modeOwnHint",
                    "用你自己的电脑或服务器，平台给一条安装命令，执行后即接入。",
                  )}
                </span>
              </button>
            </div>
          ) : step === "name" ? (
            <>
              {/* 选中的方式：可点「换一个」退回。 */}
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                {mode === "selfManaged"
                  ? <Layers className="size-3.5 shrink-0 text-primary" />
                  : <MonitorSmartphone className="size-3.5 shrink-0 text-primary" />}
                <span className="min-w-0 flex-1 truncate">
                  {mode === "selfManaged"
                    ? t("quickActions.editorWizard.modeIsolated", "创建自管理环境")
                    : t("quickActions.editorWizard.modeOwn", "引用自己的")}
                </span>
                <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => setStep("mode")}>
                  {t("quickActions.editorWizard.changeMode", "换一个")}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ecw-group">{t("quickActions.editorWizard.groupName", "分组名称")}</Label>
                <Input
                  id="ecw-group"
                  autoFocus
                  placeholder={t("quickActions.editorWizard.groupPlaceholder", "例如：我的分组")}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ecw-node">{t("quickActions.editorWizard.nodeName", "节点名称（可选）")}</Label>
                <Input
                  id="ecw-node"
                  placeholder={t("quickActions.editorWizard.nodeNamePlaceholder", "留空使用分组名")}
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                />
              </div>

              {/* 下载代理：节点自己去 GitHub 拉运行程序时用（仅"自己的机器"有意义）。 */}
              {mode === "own" && proxies.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("quickActions.editorWizard.downloadProxy", "下载代理（可选）")}</Label>
                  <Select value={proxyId || "__direct__"} onValueChange={(v) => setProxyId(v === "__direct__" ? "" : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__direct__">{t("quickActions.editorWizard.proxyDirect", "直连（不使用代理）")}</SelectItem>
                      {proxies.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("quickActions.editorWizard.proxyHint", "机器从 GitHub 下载运行程序时用的代理。国内网络建议选一个。")}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            /* 结果态：与管理端同款——凭证 + 一键命令 + 安装引导 + 轮询连回。 */
            <>
              <Alert variant={online ? "default" : "destructive"}>
                <AlertDescription>
                  {launching
                    ? t(
                        "quickActions.editorWizard.launching",
                        "管理节点正在本机自动拉起该执行节点（下载镜像/启动容器→连回服务端），无需任何手动操作。此处会自动更新，请稍候。",
                      )
                    : online
                      ? t(
                          "quickActions.editorWizard.connected",
                          "节点已连回服务端，等待管理员审批通过后即可使用。",
                        )
                      : t(
                          "quickActions.editorWizard.waiting",
                          "等待节点在目标机器上安装并连回服务端……安装完成后此处会自动更新。上线前请勿关闭，以免丢失一次性凭证。",
                        )}
                </AlertDescription>
              </Alert>

              {online ? <NodeInfoPanel node={liveNode} /> : null}

              {/* 自动拉起的场景不给凭证/命令（用户不需要）；其余给完整安装引导。 */}
              {!launching ? (
                <NodeInstallGuide
                  nodeId={result?.node_id || ""}
                  secret={result?.secret}
                  role={mode === "selfManaged" ? "management" : "execution"}
                  launched={result?.launched}
                />
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-6 pt-4">
          {step === "mode" ? (
            <Button variant="outline" onClick={() => close(false)}>
              {t("quickActions.cancel", "取消")}
            </Button>
          ) : step === "name" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("mode")} disabled={creating}>
                <ArrowLeft className="size-4" />
                {t("quickActions.back", "上一步")}
              </Button>
              <Button onClick={() => void submit()} disabled={creating || !groupName.trim()}>
                {creating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                {t("quickActions.editorWizard.create", "创建并接入")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                {t("quickActions.done", "完成")}
              </Button>
              <Button onClick={() => { close(false); navigate("/coding/projects") }}>
                {t("quickActions.editorWizard.goProjects", "去项目里新建编辑器")}
                <ArrowRight className="size-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
