import { useEffect, useMemo, useState } from "react"
import { Copy } from "lucide-react"
import { IconPlayerStop, IconPlugConnected, IconTerminal2, IconTrash, IconHelp } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import {
  closeNodeTerminal,
  getLatestNodeRelease,
  getNode,
  getNodeProxyConfig,
  installNodeEditor,
  interruptNodeTerminal,
  listNodeTerminals,
  updateNodeProxyConfig,
  upgradeNodeEditor,
  type NodeInfo,
  type NodeLatestRelease,
  type NodeTerminalStatus,
  type NodeUpgradeStatus,
  type NodeVersionLine,
} from "@/@admin-port/api/nodes"
import { getProxies, type ProxyEntry } from "@/@admin-port/api/proxyPool"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ROLE_LABEL,
  STATUS_META,
  machineInfoLine,
  machineSpecs,
  nodeEditorVersions,
  nodeNetwork,
} from "./types"
import { copyText } from "./install-guide"
import { NodeShellApproval } from "./node-shell-approval"
import { NodeTunnels } from "./node-tunnels"
import { NodePrerequisiteGuide } from "./node-prerequisite-guide"
import { NodeUpgradeDialog } from "../NodeUpgradeDialog"

/** 机器信息主行（带兜底文案），用于客户端列表的子项副行。 */
function machineInfo(node: NodeInfo) {
  return machineInfoLine(node.capabilities) || "尚未上报"
}

/** 一个管理节点是否为纯分组容器（无客户端）。 */
function isContainer(node: NodeInfo): boolean {
  return Boolean(node.is_passive)
}

/** 去掉版本串前缀 v，统一展示。 */
function cleanVersion(v: string): string {
  return v.replace(/^v/i, "")
}

/**
 * 编辑器版本 + 在线安装/升级，作为概览底部的编辑器管理区。表格三列：编辑器 / 当前版本 / 操作。
 * 已装显示版本号 + 「升级」；未装显示「未安装」+ 「安装」。安装/升级是同步阻塞调用
 * （后端等节点跑完官方命令再回 ack），成功后回调父层刷新，版本号随之更新。
 */
function EditorManagement({ node, onChanged }: { node: NodeInfo; onChanged?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const editors = nodeEditorVersions(node.capabilities)
  const online = node.connected

  const run = async (editor: string, action: "install" | "upgrade") => {
    setBusy(editor)
    try {
      const res =
        action === "install"
          ? await installNodeEditor(node.node_id, editor)
          : await upgradeNodeEditor(node.node_id, editor)
      toast.success(
        `${action === "install" ? "已安装" : "已升级"} ${editor}${res.version ? ` → v${cleanVersion(res.version)}` : ""}`,
      )
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action === "install" ? "安装" : "升级"}失败`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">编辑器客户端</span>
      {!online ? (
        <p className="text-xs text-muted-foreground">节点离线，连接后可安装或升级编辑器。</p>
      ) : null}
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-center font-medium">编辑器</th>
              <th className="px-3 py-2 text-center font-medium">当前版本</th>
              <th className="px-3 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {editors.map((e) => (
              <tr key={e.editor}>
                <td className="px-3 py-2 text-center font-medium">{e.label}</td>
                <td className="px-3 py-2 text-center text-muted-foreground">
                  {e.installed ? (
                    e.version ? (
                      <span className="font-mono">v{cleanVersion(e.version)}</span>
                    ) : (
                      "已安装 · 版本未知"
                    )
                  ) : (
                    "未安装"
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!online || busy !== null}
                    onClick={() => void run(e.editor, e.installed ? "upgrade" : "install")}
                  >
                    {busy === e.editor ? <Spinner /> : null}
                    {e.installed ? "升级" : "安装"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        安装/升级会在节点上执行该编辑器的官方命令，可能耗时数分钟，请耐心等待。
      </p>
    </div>
  )
}

/** 一条版本线的文案：「节点程序 v1 → v2」或「Runtime 未安装 → v2」。 */
function versionLineText(label: string, line: NodeVersionLine): string {
  const current = line.installed ? `v${line.current}` : "未安装"
  if (!line.needs_upgrade) return `${label} ${current}（已最新）`
  return `${label} ${current} → v${line.latest}`
}

/**
 * 概览顶部的节点升级提示：只告诉用户「有新版本可升级」，按钮置灰不可点——
 * 真正的升级/安装动作放在「环境」tab（那里才看得到版本明细并能下发）。
 *
 * 判定完全来自服务端 upgrade 块：节点程序与 runtime 是两条独立版本线，分别比较。
 */
function NodeUpgradeIndicator({ upgrade }: { upgrade: NodeUpgradeStatus | null }) {
  if (!upgrade?.can_upgrade) return null

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">节点程序与 Runtime</span>
          {upgrade.stale ? <Badge variant="outline" className="text-amber-600">缓存可能过期</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {versionLineText("节点程序", upgrade.node_program)} · {versionLineText("Runtime", upgrade.runtime)}
          （请在「环境」tab 升级）
        </div>
      </div>
      <Button size="sm" variant="outline" disabled>升级</Button>
    </div>
  )
}

const DIRECT_EGRESS = "__direct__"

/**
 * 节点程序与 Runtime 升级入口（环境tab）：可点击下发统一升级。
 * 判定同概览——来自服务端 upgrade 块，节点程序与 runtime 各自比较。
 * 任一条线未安装即显示「安装」，否则「升级」。下发走 NodeUpgradeDialog。
 */
function NodeUpgradeCard({
  node,
  upgrade,
  release,
  onChanged,
}: {
  node: NodeInfo
  upgrade: NodeUpgradeStatus | null
  release: NodeLatestRelease | null
  onChanged?: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  if (!upgrade?.can_upgrade) return null
  const disabledReason = !node.connected ? "节点离线，连接后可升级" : ""
  const nodeMissing = !upgrade.node_program.installed || !upgrade.runtime.installed

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">节点程序与 Runtime</span>
            {upgrade.stale ? <Badge variant="outline" className="text-amber-600">缓存可能过期</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {versionLineText("节点程序", upgrade.node_program)} · {versionLineText("Runtime", upgrade.runtime)}
          </div>
        </div>
        <Button
          size="sm"
          variant={!disabledReason ? "default" : "outline"}
          disabled={Boolean(disabledReason)}
          onClick={() => setDialogOpen(true)}
        >
          {nodeMissing ? "安装" : "升级"}
        </Button>
      </div>
      <NodeUpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        node={node}
        release={release}
        onDone={(message) => {
          toast.success(message)
          onChanged?.()
        }}
      />
    </>
  )
}

/** 节点升级代理（按节点绑定）：该节点从 GitHub 下载升级/安装二进制时走的代理。
 *  等同于升级弹窗里的「下载代理」来源——直接绑定到这台节点，节点连上即由服务端推送
 *  它绑定的代理；安装时（节点未连）也走这个绑定烘焙进脚本。空=直连。 */
function NodeEgressProxyCard({ node }: { node: NodeInfo }) {
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [selected, setSelected] = useState(DIRECT_EGRESS)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const [list, cfg] = await Promise.all([
        getProxies(),
        getNodeProxyConfig(node.node_id),
      ])
      setProxies((list || []).filter((p) => p.mode !== "node"))
      setSelected(cfg.proxy_config_id || DIRECT_EGRESS)
    } catch {
      setSelected(DIRECT_EGRESS)
    }
  }
  useEffect(() => {
    void load()
  }, [node.node_id])

  const save = async () => {
    setSaving(true)
    try {
      const cfg = await updateNodeProxyConfig(node.node_id, selected === DIRECT_EGRESS ? "" : selected)
      setSelected(cfg.proxy_config_id || DIRECT_EGRESS)
      toast.success("节点升级代理已更新并下发到该在线节点")
    } catch (error) {
      toast.error("保存失败", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-sm font-medium">节点升级代理</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="节点升级代理说明">
              <IconHelp className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            该节点从 GitHub 下载升级/安装二进制时使用的代理，绑定到本节点（可与其它节点不同）。与升级弹窗里的「下载代理」同源；节点连上即由服务端推送，安装时烘焙进脚本。留空=直连。node 隧道模式不适用于节点自身下载，已自动过滤。
          </TooltipContent>
        </Tooltip>
      </div>
      <Select value={selected} onValueChange={setSelected} disabled={saving}>
        <SelectTrigger className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DIRECT_EGRESS}>直连（不使用代理）</SelectItem>
          {proxies.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name || p.id}（{p.mode}）</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={saving} onClick={() => void save()}>
        {saving ? "保存中..." : "保存"}
      </Button>
    </div>
  )
}

/** 节点运行环境：Go 客户端、Node.js/npm、runtime 与编辑器客户端。 */
function NodeEnvironment({
  node,
  upgrade,
  release,
  onChanged,
}: {
  node: NodeInfo
  upgrade: NodeUpgradeStatus | null
  release: NodeLatestRelease | null
  onChanged?: () => void
}) {
  const caps = node.capabilities || {}
  const runtimeVersion = (caps.runtime_version || "").trim()
  const clientVersion = (caps.client_version || "").trim()

  const environmentRows = [
    { label: "Go 节点程序", value: clientVersion },
    { label: "Node.js", value: (caps.node_version || "").trim() },
    { label: "npm", value: (caps.npm_version || "").trim() },
  ]

  return (
    <div className="flex flex-col gap-5">
      <NodeUpgradeCard node={node} upgrade={upgrade} release={release} onChanged={onChanged} />
      <NodeEgressProxyCard node={node} />
      <NodePrerequisiteGuide node={node} />
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">组件</th>
              <th className="px-3 py-2 text-left font-medium">当前版本</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {environmentRows.map((row) => (
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
            {/* 系统内置环境（env_mode=system）能力位：节点注册时上报，宿主机安装默认开、
                容器节点默认关（--allow-system-env / AGENT_COMPOSE_NODE_ALLOW_SYSTEM_ENV 覆盖）。 */}
            <tr>
              <td className="px-3 py-2 font-medium">系统内置环境</td>
              <td className={`px-3 py-2 ${caps.system_env === "true" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {caps.system_env === "true" ? "已开启" : "未开启"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EditorManagement node={node} onChanged={onChanged} />
    </div>
  )
}

function NodeOverview({
  node,
}: {
  node: NodeInfo
}) {
  const status = STATUS_META[node.status] || STATUS_META.unknown
  const specs = machineSpecs(node.capabilities).filter((s) => s.label !== "客户端版本")
  const network = nodeNetwork(node.capabilities)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{node.node_name || node.node_id}</span>
        <Badge variant="outline">{ROLE_LABEL[node.role] || node.role}</Badge>
        {node.status === "approved" ? (
          <Badge variant={node.connected ? "outline" : "secondary"} className={node.connected ? "text-green-600 dark:text-green-400" : ""}>
            {node.connected ? "在线" : "离线"}
          </Badge>
        ) : (
          <Badge variant="outline" className={status.className}>{status.label}</Badge>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">节点 ID</span>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{node.node_id}</code>
            <Button size="icon-xs" variant="ghost" onClick={() => void copyText(node.node_id)} aria-label="复制节点 ID"><Copy /></Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">机器信息</span>
          <span className="text-sm">{machineInfo(node)}</span>
        </div>
        {specs.map((spec) => (
          <div key={spec.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{spec.label}</span>
            <span className="text-sm">{spec.value}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">运行中会话</span>
          <span className="text-sm">{node.active_session_ids.length} 个</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">最近心跳</span>
          <span className="text-sm">{node.last_heartbeat_at || "尚未上报"}</span>
        </div>
        {network.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{row.value}</code>
          </div>
        ))}
        {node.capabilities?.docker ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Docker</span>
            <span className="text-sm">{node.capabilities.docker === "true" ? "支持" : "不支持"}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 把节点/服务端给的时间（RFC3339 或 epoch 秒）转成本地可读串。 */
function formatMoment(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

/** 运行时长（从 started_at 到现在），供「正在跑」的命令展示。 */
function formatElapsed(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return ""
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`
}

/**
 * 节点终端管理：列出该节点上所有活着的宿主机终端，看清每个在跑什么、谁在用，
 * 并提供续接 / 终止命令 / 关闭终端三个动作。
 *
 * 数据以节点为准（节点持有 PTY），服务端只补两件节点不知道的事：owner（谁开的）
 * 和 agent 归因（同一条命令行是 agent 注入还是操作者手敲）。「终止命令」发 Ctrl-C
 * 保留终端；「关闭终端」杀掉 PTY，里面跑的东西一并结束——所以关闭前二次确认。
 */
function NodeTerminals({
  node,
  onOpenTerminal,
}: {
  node: NodeInfo
  /**
   * 打开终端弹框。终端已不是独立页面，续接由父页面协调（先关详情再开终端）。
   * 传 terminalId 即续接那个已存在的 PTY，不传则复用/新建本机终端。
   */
  onOpenTerminal?: (terminalId?: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [terminals, setTerminals] = useState<NodeTerminalStatus[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const nodeId = node.node_id

  const refresh = useMemo(
    () => async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
      try {
        setTerminals(await listNodeTerminals(nodeId))
        setError("")
      } catch (err) {
        setTerminals([])
        setError(err instanceof Error ? err.message : "加载终端列表失败")
      } finally {
        if (showSpinner) setLoading(false)
      }
    },
    [nodeId],
  )

  // 打开时拉一次快照。命令状态会变，但看的人自己按刷新即可，不挂常驻轮询。
  useEffect(() => {
    void refresh(true)
  }, [refresh])

  const interrupt = async (terminal: NodeTerminalStatus) => {
    setBusy(terminal.id)
    try {
      const res = await interruptNodeTerminal(nodeId, terminal.id)
      toast.success(res.agent_command_interrupted ? "已中断该终端的 agent 命令" : "已发送中断")
      await refresh(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "中断失败")
    } finally {
      setBusy(null)
    }
  }

  const close = async (terminal: NodeTerminalStatus) => {
    const warning = terminal.running
      ? `该终端正在运行「${terminal.current_command}」，关闭会一并终止它。确认关闭？`
      : "关闭后该终端的 shell 与工作目录都会丢失。确认关闭？"
    if (!window.confirm(warning)) return
    setBusy(terminal.id)
    try {
      await closeNodeTerminal(nodeId, terminal.id)
      toast.success("已关闭终端")
      await refresh(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "关闭失败")
    } finally {
      setBusy(null)
    }
  }

  // 续接：带上这个终端的 id 打开终端弹框，服务端据此重连同一个 PTY
  // （cwd 与前台进程都还在），而不是开一个新 shell。详情本身也是弹框，所以由父层
  // 先关详情再开终端，避免两层弹框叠加。
  const attach = (terminal: NodeTerminalStatus) => {
    onOpenTerminal?.(terminal.id)
  }

  if (!node.connected) {
    return <p className="text-sm text-muted-foreground">节点离线，无法查看终端。节点重连后终端会自动恢复。</p>
  }
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void refresh(true)}>
          重试
        </Button>
      </div>
    )
  }
  if (terminals.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">该节点当前没有打开的终端。</p>
        <Button size="sm" variant="outline" onClick={() => onOpenTerminal?.()}>
          <IconTerminal2 />
          打开终端
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          共 {terminals.length} 个终端
        </span>
        <Button size="sm" variant="outline" onClick={() => void refresh(true)}>
          刷新
        </Button>
      </div>
      <div className="flex flex-col divide-y rounded border">
        {terminals.map((terminal) => (
          <div key={terminal.id} className="flex flex-col gap-2 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={terminal.source === "agent" ? "default" : "secondary"}>
                {terminal.source === "agent" ? "Agent 使用" : "个人使用"}
              </Badge>
              {terminal.running ? (
                <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                  运行中{formatElapsed(terminal.started_at) ? ` · ${formatElapsed(terminal.started_at)}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline">空闲</Badge>
              )}
              {terminal.browser_attached ? <Badge variant="outline">有人在看</Badge> : null}
              {!terminal.managed ? (
                <Badge variant="outline" className="text-muted-foreground">
                  无服务端桥
                </Badge>
              ) : null}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {terminal.id}
              </code>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="min-w-0">
                <span>当前命令：</span>
                {terminal.current_command ? (
                  <code className="break-all font-mono text-foreground">{terminal.current_command}</code>
                ) : (
                  <span>尚未执行命令</span>
                )}
              </div>
              <div>占用者：{terminal.owner || "未知"}</div>
              <div>打开时间：{formatMoment(terminal.created_at)}</div>
              <div>命令开始：{formatMoment(terminal.started_at)}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => attach(terminal)}>
                <IconPlugConnected />
                续接
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || !terminal.running}
                onClick={() => void interrupt(terminal)}
              >
                {busy === terminal.id ? <Spinner /> : <IconPlayerStop />}
                终止命令
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={busy !== null}
                onClick={() => void close(terminal)}
              >
                {busy === terminal.id ? <Spinner /> : <IconTrash />}
                关闭终端
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        「终止命令」向终端发送 Ctrl-C，终端本身保留；「关闭终端」会杀掉 shell，里面运行的任务一并结束。
        浏览器断开不会结束终端——长时间无人观看的终端由服务端按闲置策略回收。
      </p>
    </div>
  )
}

export function NodeDetailModal({
  open,
  node,
  nodes,
  onClose,
  onChanged,
  onOpenTerminal,
}: {
  open: boolean
  node: NodeInfo | null
  nodes: NodeInfo[]
  onClose: () => void
  /** 编辑器安装/升级、节点自升级成功后触发，父层据此刷新节点列表。 */
  onChanged?: () => void
  /**
   * 从「终端」Tab 打开/续接终端。详情和终端都是弹框，不能叠着开，所以由父层
   * 先关详情再开终端弹框。传 terminalId 即续接那个已存在的 PTY。
   */
  onOpenTerminal?: (nodeId: string, terminalId?: string) => void
}) {
  const [latestRelease, setLatestRelease] = useState<NodeLatestRelease | null>(null)
  const [detail, setDetail] = useState<{ node: NodeInfo; upgrade: NodeUpgradeStatus | null } | null>(null)
  // 打开弹窗时调详情接口：拿该节点最新快照 + 服务端算好的版本判定（节点程序/runtime
  // 两条线）。升级/装编辑器后 onChanged 会重新调，弹框内数据自更新，不再依赖父层
  // 列表快照。latestRelease 仍保留——NodeUpgradeDialog 预览将下发的资产需要 release。
  useEffect(() => {
    if (!open || !node) return
    let cancelled = false
    void Promise.all([getNode(node.node_id), getLatestNodeRelease()])
      .then(([d, release]) => {
        if (!cancelled) {
          setDetail(d)
          setLatestRelease(release)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null)
          setLatestRelease(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, node?.node_id, onChanged])

  const liveNode = detail?.node ?? node
  if (!liveNode) return null
  const upgrade = detail?.upgrade ?? null
  const children = liveNode.role === "management"
    ? nodes.filter((candidate) => candidate.role === "execution" && candidate.manager_node_id === liveNode.node_id)
    : []
  const hasClients = liveNode.role === "management"
  const hasShellApproval = liveNode.role === "execution"
  // 有客户端的节点才有宿主机终端可管理（纯分组容器没有进程，开不出 PTY）。
  const hasEnvironment = !isContainer(liveNode)
  const hasTerminals = !isContainer(liveNode) && liveNode.capabilities?.terminal === "true"

  const overview = (
    <div className="space-y-4">
      {!isContainer(liveNode) ? <NodeUpgradeIndicator upgrade={upgrade} /> : null}
      <NodeOverview node={liveNode} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="flex h-[720px] max-h-[90vh] flex-col overflow-hidden sm:max-w-[820px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>节点详情</DialogTitle>
        </DialogHeader>
        {hasClients || hasEnvironment || hasShellApproval || hasTerminals ? (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="overview">概览</TabsTrigger>
              {hasClients ? <TabsTrigger value="clients">客户端列表</TabsTrigger> : null}
              {hasEnvironment ? <TabsTrigger value="environment">环境</TabsTrigger> : null}
              {hasShellApproval ? <TabsTrigger value="shell-approval">授权配置</TabsTrigger> : null}
              {hasTerminals ? <TabsTrigger value="terminals">终端</TabsTrigger> : null}
              <TabsTrigger value="tunnels">穿透</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-4">{overview}</TabsContent>
            {hasClients ? (
              <TabsContent value="clients" className="min-h-0 flex-1 overflow-y-auto pt-4">
                {children.length ? (
                  <div className="flex flex-col divide-y rounded border">
                    {children.map((child) => (
                      <div key={child.node_id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0"><div className="truncate text-sm font-medium">{child.node_name || child.node_id}</div><div className="truncate text-xs text-muted-foreground">{machineInfo(child)}</div></div>
                        <Badge variant="outline" className={(STATUS_META[child.status] || STATUS_META.unknown).className}>{(STATUS_META[child.status] || STATUS_META.unknown).label}</Badge>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">该管理节点下暂无执行节点。</p>}
              </TabsContent>
            ) : null}
            {hasEnvironment ? (
              <TabsContent value="environment" className="min-h-0 flex-1 overflow-y-auto pt-4">
                <NodeEnvironment node={liveNode} upgrade={upgrade} release={latestRelease} onChanged={onChanged} />
              </TabsContent>
            ) : null}
            {hasShellApproval ? (
              <TabsContent value="shell-approval" className="min-h-0 flex-1 overflow-y-auto pt-4">
                <NodeShellApproval nodeId={liveNode.node_id} />
              </TabsContent>
            ) : null}
            {hasTerminals ? (
              <TabsContent value="terminals" className="min-h-0 flex-1 overflow-y-auto pt-4">
                <NodeTerminals
                  node={liveNode}
                  onOpenTerminal={
                    onOpenTerminal
                      ? (terminalId) => onOpenTerminal(liveNode.node_id, terminalId)
                      : undefined
                  }
                />
              </TabsContent>
            ) : null}
            <TabsContent value="tunnels" className="min-h-0 flex-1 overflow-y-auto pt-4">
              <NodeTunnels nodeId={liveNode.node_id} />
            </TabsContent>
          </Tabs>
        ) : (
          overview
        )}
      </DialogContent>
    </Dialog>
  )
}
