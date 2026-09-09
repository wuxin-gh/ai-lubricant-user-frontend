/** 内网穿透方案池 —— 配置 frpc / cloudflared / npc 代理服务器的连接信息。
 *
 * 一个方案 = 一套可复用的代理服务器配置(连接信息 + 端口段/域名),绑定(暴露端口)
 * 时选用。后端:monkeycode_compat/routes_tunnel.py。客户端:src/api/tunnelClient.ts。
 *
 * 一张表(同款于执行节点表格):按方案分组(父行=方案,子行=代理)或按节点分组
 * (父行=节点,子行=代理)。节点筛选 + 刷新 + 状态(部署中/连接中/连接成功/暂停/失败)
 * hover 显示原因 + 重试。
 *
 * 安全提醒:绑定后的公网地址即凭证,泄漏等同开放访问,使用者自负。
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import { Plus, Trash2, Pencil, AlertTriangle, ExternalLink, CircleQuestionMark, Play, Square, RotateCcw, Server, Layers } from "lucide-react"
import { AdminPage, SectionCard } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
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
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
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
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import {
  createTunnelScheme,
  createTunnel,
  deleteTunnelScheme,
  deleteTunnel,
  listAllTunnels,
  listTunnelSchemes,
  startTunnel,
  stopTunnel,
  updateTunnel,
  updateTunnelScheme,
} from "@/api/tunnelClient"
import type { TunnelBinding, TunnelKind, TunnelScheme, TunnelSchemeConfig } from "@/api/tunnelClient"
import { listNodes } from "@/@admin-port/api/nodes"
import type { NodeInfo as AdminNodeInfo } from "@/@admin-port/api/nodes"

const ALL = "__all__"

interface SchemeFormValues {
  name: string
  kind: TunnelKind
  // frpc / npc
  server_addr: string
  server_port: string
  token: string
  port_range_lo: string
  port_range_hi: string
  /** frpc/npc:可选对外访问域名。cloudflared managed:必填根域名。 */
  domain: string
  /** frpc:可选客户端 user(frp [common].user);代理名会带 user. 前缀。 */
  user: string
  // cloudflared
  cf_mode: "quick" | "managed"
  cf_api_token: string
  cf_account_id: string
  cf_zone_id: string
  enabled: boolean
}

const EMPTY_FORM: SchemeFormValues = {
  name: "",
  kind: "frpc",
  server_addr: "",
  server_port: "",
  token: "",
  port_range_lo: "",
  port_range_hi: "",
  domain: "",
  user: "",
  cf_mode: "quick",
  cf_api_token: "",
  cf_account_id: "",
  cf_zone_id: "",
  enabled: true,
}

const CF_MODE_HELP: Record<"quick" | "managed", string> = {
  quick:
    "免登录。节点启动 cloudflared 后由 Cloudflare 随机分配一个 *.trycloudflare.com 域名,无需账号和域名,适合临时调试。地址每次重启都会变。",
  managed:
    "使用你自己的 Cloudflare 账号和域名。方案里存一次账号凭证 + 根域名,之后每条绑定只填子域名,平台自动创建 Tunnel、配置 ingress、建 DNS 记录,删除绑定时自动回收。",
}

/** 必填标记。 */
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>
}

function formFromConfig(s: TunnelScheme): SchemeFormValues {
  const c = s.config || {}
  const rng = Array.isArray(c.port_range) ? (c.port_range as number[]) : []
  return {
    name: s.name,
    kind: s.kind,
    server_addr: String(c.server_addr || ""),
    server_port: String(c.server_port || ""),
    token: String(c.token || ""),
    port_range_lo: rng[0] != null ? String(rng[0]) : "",
    port_range_hi: rng[1] != null ? String(rng[1]) : "",
    domain: String(c.domain || ""),
    user: String(c.user || ""),
    cf_mode: (c.mode as "quick" | "managed") || "quick",
    cf_api_token: String(c.api_token || ""),
    cf_account_id: String(c.account_id || ""),
    cf_zone_id: String(c.zone_id || ""),
    enabled: s.enabled,
  }
}

function configFromForm(v: SchemeFormValues): TunnelSchemeConfig {
  if (v.kind === "frpc" || v.kind === "npc") {
    const cfg: TunnelSchemeConfig = {
      server_addr: v.server_addr.trim(),
      server_port: Number(v.server_port) || 0,
      token: v.token.trim(),
      domain: v.domain.trim(),
    }
    // 端口段选填:留空(或填了起点没填终点)则不写 port_range,该方案不做
    // 端口限制 —— 每条代理创建时必须手填远端端口。
    const lo = Number(v.port_range_lo)
    const hi = Number(v.port_range_hi)
    if (v.port_range_lo.trim() && v.port_range_hi.trim() && lo > 0 && hi >= lo) {
      cfg.port_range = [lo, hi]
    }
    // user 仅 frpc 写入 config(npc [common] 无 user);空串不发键。
    if (v.kind === "frpc" && v.user.trim()) {
      cfg.user = v.user.trim()
    }
    return cfg
  }
  // cloudflared
  if (v.cf_mode === "quick") {
    return { mode: "quick" }
  }
  return {
    mode: "managed",
    api_token: v.cf_api_token.trim(),
    account_id: v.cf_account_id.trim(),
    zone_id: v.cf_zone_id.trim(),
    domain: v.domain.trim(),
  }
}

function summarizeConfig(s: TunnelScheme): string {
  const c = s.config || {}
  const domain = String(c.domain || "")
  if (s.kind === "cloudflared") {
    if (c.mode === "managed") {
      return domain ? `managed · *.${domain}` : "managed · 未配根域名(需补)"
    }
    return "quick · trycloudflare(免登录随机域名)"
  }
  const rng = Array.isArray(c.port_range) ? (c.port_range as number[]) : []
  const host = domain || String(c.server_addr || "")
  const via = domain ? ` (连 ${c.server_addr || ""})` : ""
  const range = rng.length === 2 && rng[0]
    ? ` · 端口段 ${rng[0] ?? "?"}-${rng[1] ?? "?"}`
    : " · 端口不限(代理手填远端端口)"
  return `${host}:${c.server_port || ""}${via}${range}`
}

function targetLabel(binding: TunnelBinding, nodes: AdminNodeInfo[]): string {
  if (binding.node_id === "__main__") return "主服务"
  const node = nodes.find((item) => item.node_id === binding.node_id)
  return node?.node_name || binding.node_id
}

function formatBindingTime(timestamp?: number): string {
  if (!timestamp) return "未知"
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false })
}

/** 从 client_status + 已有字段派生更细的展示状态(pure,无后端改动)。 */
interface DerivedStatus {
  key: "deploying" | "connecting" | "running" | "stopped" | "failed"
  label: string
  cls: string
}

function deriveStatus(b: TunnelBinding): DerivedStatus {
  if (b.client_status === "failed") {
    return { key: "failed", label: "失败", cls: "bg-destructive/15 text-destructive" }
  }
  if (b.client_status === "stopped") {
    return { key: "stopped", label: "已暂停", cls: "bg-muted text-muted-foreground" }
  }
  if (b.client_status === "running") {
    return { key: "running", label: "连接成功", cls: "bg-emerald-500/15 text-emerald-600" }
  }
  // pending:地址/运行id 尚未拿到 → 还在部署;拿到 → 正在连穿透服务。
  if (b.public_addr || b.run_id) {
    return { key: "connecting", label: "连接穿透服务中", cls: "bg-amber-500/15 text-amber-600" }
  }
  return { key: "deploying", label: "部署环境中", cls: "bg-amber-500/15 text-amber-600" }
}

export function TunnelSchemes() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [schemes, setSchemes] = useState<TunnelScheme[]>([])
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TunnelScheme | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [form, setForm] = useState<SchemeFormValues>(EMPTY_FORM)
  const [confirmRow, setConfirmRow] = useState<TunnelScheme | null>(null)
  const [nodes, setNodes] = useState<AdminNodeInfo[]>([])
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyEditing, setProxyEditing] = useState<TunnelBinding | null>(null)
  const [proxySaving, setProxySaving] = useState(false)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [proxySchemeId, setProxySchemeId] = useState("")
  const [proxyForm, setProxyForm] = useState({
    node_id: "__main__",
    local_host: "127.0.0.1",
    local_port: "",
    subdomain: "",
    description: "",
    proxy_name: "",
    remote_port: "",
  })

  // 视图:按方案 / 按节点 + 节点筛选 + 全量代理(两个视图共用同一份数据,
  // listAllTunnels 一次拉齐;不再按展开态逐方案拉子表)。
  const [view, setView] = useState<"scheme" | "node">("scheme")
  const [nodeFilter, setNodeFilter] = useState("")
  const [allBindings, setAllBindings] = useState<TunnelBinding[]>([])
  const [togglingSchemeId, setTogglingSchemeId] = useState<string | null>(null)
  const [togglingBindingId, setTogglingBindingId] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const isEdit = !!editing
  const proxyScheme = schemes.find((s) => s.id === proxySchemeId)
  const proxyNeedsSubdomain = proxyScheme?.kind === "cloudflared" && proxyScheme.config?.mode === "managed"
  const proxyDomain = String(proxyScheme?.config?.domain || "")
  // 代理名/远端端口覆盖:remote_port 仅 frpc/npc,proxy_name 仅 frpc。
  const proxySupportsRemotePort = proxyScheme?.kind === "frpc" || proxyScheme?.kind === "npc"
  const proxySupportsProxyName = proxyScheme?.kind === "frpc"
  // 方案没配端口段时,远端端口从可选变必填(无法自动分配)。
  const schemeRange = Array.isArray(proxyScheme?.config?.port_range)
    ? (proxyScheme?.config?.port_range as number[])
    : []
  const schemeHasRange = !!(schemeRange[0] && schemeRange[1])
  const remotePortRequired = proxySupportsRemotePort && !schemeHasRange

  // 异步收敛:绑定创建/启停/删除后,运行时服务需要几秒才能把 client_status 从
  // pending 翻成 running/failed。有 pending 绑定时启动 3s 轮询,全部稳定后停止。
  const hasPendingBinding = allBindings.some((b) => b.client_status === "pending")

  const loadNodes = async () => {
    try {
      setNodes(await listNodes())
    } catch {
      // 拿不到节点列表也不影响主服务那条路径。
      setNodes([])
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [ss, bs] = await Promise.all([listTunnelSchemes(), listAllTunnels()])
      setSchemes(ss)
      setAllBindings(bs)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载方案失败")
    } finally {
      setLoading(false)
    }
  }

  // 轻量刷新绑定:用于启停/删除/轮询后收敛 client_status,不重拉方案。
  const refreshBindings = async () => {
    try {
      setAllBindings(await listAllTunnels())
    } catch {
      // 轮询/二次刷新失败静默,下一次再试;首次加载的错误已由 fetchData 处理。
    }
  }

  useEffect(() => {
    void fetchData()
    void loadNodes()
  }, [])

  useEffect(() => {
    if (!hasPendingBinding) return
    const timer = setInterval(() => { void refreshBindings() }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingBinding])

  const openAddProxy = (schemeId?: string) => {
    const initial = schemeId || schemes.find((s) => s.enabled)?.id || ""
    setProxyEditing(null)
    setProxySchemeId(initial)
    setProxyForm({
      node_id: "__main__", local_host: "127.0.0.1", local_port: "", subdomain: "",
      description: "", proxy_name: "", remote_port: "",
    })
    setProxyError(null)
    setProxyOpen(true)
  }

  const openEditProxy = (binding: TunnelBinding) => {
    const scheme = schemes.find((s) => s.id === binding.scheme_id)
    const domain = String(scheme?.config?.domain || "").trim()
    let subdomain = ""
    if (binding.hostname && domain && binding.hostname.endsWith(`.${domain}`)) {
      subdomain = binding.hostname.slice(0, -(domain.length + 1))
    }
    setProxyEditing(binding)
    setProxySchemeId(binding.scheme_id)
    setProxyForm({
      node_id: binding.node_id,
      local_host: binding.local_host,
      local_port: String(binding.local_port),
      subdomain,
      description: binding.description || "",
      // 回填当前生效端口:手动覆盖优先,否则自动分配值(编辑时留空=保持不变)。
      proxy_name: binding.proxy_name || "",
      remote_port: String(binding.remote_port ?? binding.allocated_value ?? ""),
    })
    setProxyError(null)
    setProxyOpen(true)
  }

  const submitProxy = async () => {
    const port = Number(proxyForm.local_port)
    if (!proxySchemeId) { setProxyError("请选择穿透方案"); return }
    if (!proxyForm.node_id) { setProxyError("请选择节点位置"); return }
    if (!port || port < 1 || port > 65535) { setProxyError("端口需为 1-65535"); return }
    if (proxyNeedsSubdomain && !proxyDomain) { setProxyError("方案未配置根域名,请先编辑方案"); return }
    if (proxyNeedsSubdomain && !proxyForm.subdomain.trim()) { setProxyError("请填写子域名"); return }
    const remotePort = Number(proxyForm.remote_port)
    if (proxySupportsRemotePort && remotePortRequired && (!remotePort || remotePort < 1 || remotePort > 65535)) {
      setProxyError("该方案未配置端口段,远端端口为必填(1-65535)")
      return
    }
    if (proxySupportsRemotePort && proxyForm.remote_port.trim() && (!remotePort || remotePort < 1 || remotePort > 65535)) {
      setProxyError("远端端口需为 1-65535")
      return
    }
    if (proxySupportsProxyName && /[^\w.\-]/.test(proxyForm.proxy_name.trim())) {
      setProxyError("代理名仅支持字母、数字、`.`、`_`、`-`")
      return
    }
    const input = {
      scheme_id: proxySchemeId,
      node_id: proxyForm.node_id,
      local_host: proxyForm.local_host.trim() || "127.0.0.1",
      local_port: port,
      ...(proxyNeedsSubdomain ? { subdomain: proxyForm.subdomain.trim() } : {}),
      ...(proxySupportsProxyName ? { proxy_name: proxyForm.proxy_name.trim() || undefined } : {}),
      ...(proxySupportsRemotePort ? { remote_port: remotePort || undefined } : {}),
      description: proxyForm.description.trim() || undefined,
    }
    setProxySaving(true); setProxyError(null)
    try {
      if (proxyEditing) {
        await updateTunnel(proxyEditing.id, input)
        toast.success("已提交修改,运行时服务处理中")
      } else {
        await createTunnel(input)
        toast.success("代理已添加")
      }
      setProxyOpen(false)
      await refreshBindings()
    } catch (err) {
      setProxyError(err instanceof Error ? err.message : (proxyEditing ? "修改代理失败" : "添加代理失败"))
    } finally {
      setProxySaving(false)
    }
  }

  const changeBindingState = async (binding: TunnelBinding, action: "start" | "stop") => {
    setTogglingBindingId(binding.id)
    try {
      await (action === "start" ? startTunnel(binding.id) : stopTunnel(binding.id))
      toast.success(action === "start" ? "已请求启动,运行时服务处理中" : "已请求停止,运行时服务处理中")
      await refreshBindings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action === "start" ? "启动" : "停止"}失败`)
    } finally {
      setTogglingBindingId(null)
    }
  }

  const retryBinding = async (binding: TunnelBinding) => {
    setRetryingId(binding.id)
    try {
      await startTunnel(binding.id)
      toast.success("已请求重试,运行时服务处理中")
      await refreshBindings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重试失败")
    } finally {
      setRetryingId(null)
    }
  }

  const removeBinding = async (binding: TunnelBinding) => {
    try {
      await deleteTunnel(binding.id)
      toast.success("已提交删除,资源回收中")
      await refreshBindings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除代理失败")
    }
  }

  const toggleScheme = async (scheme: TunnelScheme, enabled: boolean) => {
    setTogglingSchemeId(scheme.id)
    try {
      await updateTunnelScheme(scheme.id, { enabled })
      toast.success(enabled ? "方案已启用" : "方案已停用,运行中客户端将被停止")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换方案状态失败")
    } finally {
      setTogglingSchemeId(null)
    }
  }

  // 对某方案的全部代理批量启停:启动只作用于已停止/失败的;停止只作用于运行中/启动中。
  const bulkChangeState = async (items: TunnelBinding[], action: "start" | "stop") => {
    const targets = items.filter((b) =>
      action === "start"
        ? b.client_status === "stopped" || b.client_status === "failed"
        : b.client_status === "running" || b.client_status === "pending",
    )
    if (!targets.length) {
      toast.info(action === "start" ? "没有需要启动的代理" : "没有运行中的代理")
      return
    }
    try {
      await Promise.all(targets.map((b) => (action === "start" ? startTunnel(b.id) : stopTunnel(b.id))))
      toast.success(`已${action === "start" ? "启动" : "停止"} ${targets.length} 条代理`)
      await refreshBindings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量操作失败")
    }
  }

  // 方案行「全部启动/全部停止」:从已缓存的全量代理里取该方案的(不依赖展开态)。
  const bulkSchemeState = async (schemeId: string, action: "start" | "stop") => {
    await bulkChangeState(allBindings.filter((b) => b.scheme_id === schemeId), action)
  }

  const openAdd = () => {
    setEditing(null)
    setModalError(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (s: TunnelScheme) => {
    setEditing(s)
    setModalError(null)
    setForm(formFromConfig(s))
    setModalOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setModalError("请填写方案名称")
      return
    }
    if (form.kind === "cloudflared" && form.cf_mode === "managed") {
      if (!form.cf_api_token.trim() || !form.cf_account_id.trim() || !form.cf_zone_id.trim()) {
        setModalError("managed 模式需要填写 API Token、Account ID、Zone ID 和根域名")
        return
      }
      if (!form.domain.trim()) {
        setModalError("managed 模式需要填写根域名(如 example.com),绑定只填子域名")
        return
      }
    }
    const config = configFromForm(form)
    setSaving(true)
    setModalError(null)
    try {
      if (editing) {
        await updateTunnelScheme(editing.id, { name: form.name.trim(), config, enabled: form.enabled })
        toast.success("方案已更新,运行中客户端将用新配置重启")
      } else {
        await createTunnelScheme({ name: form.name.trim(), kind: form.kind, config, enabled: form.enabled })
        toast.success("方案已创建")
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmRow) return
    setDeleteLoadingId(confirmRow.id)
    try {
      await deleteTunnelScheme(confirmRow.id)
      toast.success("方案已删除")
      setConfirmRow(null)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteLoadingId(null)
    }
  }

  // 按方案分组的代理:apply 节点筛选;末尾「已删除方案」组收留 delete_scheme 后残留的
  // 孤儿绑定(已停止/失败的不会被同删,delete_scheme 只拒删运行中的)。
  const bindingsByScheme = useMemo(() => {
    const m = new Map<string, TunnelBinding[]>()
    for (const b of allBindings) {
      if (nodeFilter && b.node_id !== nodeFilter) continue
      const list = m.get(b.scheme_id) || []
      list.push(b)
      m.set(b.scheme_id, list)
    }
    return m
  }, [allBindings, nodeFilter])

  const orphanBindings = useMemo(
    () => Array.from(bindingsByScheme.entries())
      .filter(([id]) => !schemes.some((s) => s.id === id))
      .flatMap(([, list]) => list),
    [bindingsByScheme, schemes],
  )

  // 按节点分组:主服务固定首位,其余按节点名排序。
  const nodeGroups = useMemo(() => {
    const byNode = new Map<string, TunnelBinding[]>()
    for (const b of allBindings) {
      if (nodeFilter && b.node_id !== nodeFilter) continue
      const list = byNode.get(b.node_id) || []
      list.push(b)
      byNode.set(b.node_id, list)
    }
    const ids = Array.from(byNode.keys())
    ids.sort((a, b) => {
      if (a === "__main__") return -1
      if (b === "__main__") return 1
      const an = nodes.find((n) => n.node_id === a)?.node_name || a
      const bn = nodes.find((n) => n.node_id === b)?.node_name || b
      return an.localeCompare(bn)
    })
    return ids.map((id) => ({ nodeId: id, bindings: byNode.get(id) || [] }))
  }, [allBindings, nodeFilter, nodes])

  // ── 代理子行(两个视图共用,仅「类型」列内容不同)────────────────────────────
  const renderBindingSummary = (b: TunnelBinding): ReactNode => (
    <div className="truncate text-xs text-muted-foreground">
      {b.local_host}:{b.local_port} ·{" "}
      {b.public_addr ? (
        <a
          href={b.public_addr.startsWith("http") ? b.public_addr : `http://${b.public_addr}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
        >
          {b.public_addr} <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        "地址生成中…"
      )}
    </div>
  )

  const renderBindingStatus = (b: TunnelBinding): ReactNode => {
    const st = deriveStatus(b)
    const running = b.client_status === "running" || b.client_status === "pending"
    return (
      <div className="flex items-center justify-center gap-2">
        <Switch
          checked={running}
          disabled={togglingBindingId === b.id}
          onCheckedChange={(c) => void changeBindingState(b, c ? "start" : "stop")}
          title={running ? "点击停止" : "点击启动"}
        />
        <HoverCard openDelay={150} closeDelay={100}>
          <HoverCardTrigger asChild>
            <span
              className={cn(
                "cursor-help text-xs",
                st.key === "failed"
                  ? "text-destructive"
                  : st.key === "running"
                    ? "text-emerald-600"
                    : st.key === "stopped"
                      ? "text-muted-foreground"
                      : "text-amber-600",
              )}
            >
              {st.label}
            </span>
          </HoverCardTrigger>
          <HoverCardContent side="left" className="w-80 space-y-2 text-xs">
            <div className="font-medium">{st.label}</div>
            <p className="text-muted-foreground">最近更新：{formatBindingTime(b.updated_at)}</p>
            {b.error ? (
              <p className="break-words text-destructive">错误：{b.error}</p>
            ) : (
              <p className="text-muted-foreground">当前没有错误信息</p>
            )}
            {st.key === "failed" ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={retryingId === b.id}
                onClick={() => void retryBinding(b)}
              >
                {retryingId === b.id ? <Spinner className="mr-1 h-3.5 w-3.5" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                重试
              </Button>
            ) : null}
          </HoverCardContent>
        </HoverCard>
      </div>
    )
  }

  /** 代理子行:名称=备注(回退未命名)、类型=节点/方案徽标、摘要=ip·公网地址、状态=开关、操作=编辑·删除。 */
  const renderBindingRow = (b: TunnelBinding, typeCell: ReactNode): ReactNode => {
    const note = (b.description || "").trim()
    return (
      <TableRow key={b.id}>
        <TableCell className="align-middle pl-10 text-center whitespace-normal">
          <span className={cn("font-medium", !note && "text-muted-foreground")}>{note || "未命名"}</span>
          {b.project_id ? <Badge variant="outline" className="ml-2 text-xs">项目</Badge> : null}
        </TableCell>
        <TableCell className="align-middle text-center whitespace-normal">{typeCell}</TableCell>
        <TableCell className="align-middle text-center whitespace-normal">{renderBindingSummary(b)}</TableCell>
        <TableCell className="align-middle text-center whitespace-normal">{renderBindingStatus(b)}</TableCell>
        <TableCell className="align-middle text-center">
          <div className="flex items-center justify-center gap-1">
            <Button variant="ghost" size="icon" title="编辑代理" onClick={() => openEditProxy(b)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="删除代理" onClick={() => void removeBinding(b)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  // 方案视图「类型」列 = 目标节点;节点视图「类型」列 = 所属方案。
  const schemeTypeCell = (b: TunnelBinding): ReactNode => (
    <Badge variant="outline">{targetLabel(b, nodes)}</Badge>
  )
  const nodeTypeCell = (b: TunnelBinding): ReactNode => {
    const scheme = schemes.find((s) => s.id === b.scheme_id)
    return <Badge variant="outline">{scheme ? `${scheme.name} (${scheme.kind})` : b.scheme_id}</Badge>
  }

  // ── 方案父行 ────────────────────────────────────────────────────────────────
  const renderSchemeParent = (s: TunnelScheme): ReactNode => (
    <TableRow className="bg-muted/40">
      <TableCell className="align-middle text-center font-medium whitespace-normal">{s.name}</TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <Badge variant="secondary">{s.kind}</Badge>
      </TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <span className="text-xs text-muted-foreground">{summarizeConfig(s)}</span>
      </TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <div className="flex items-center justify-center gap-2">
          <Switch
            checked={s.enabled}
            onCheckedChange={(c) => void toggleScheme(s, c)}
            disabled={togglingSchemeId === s.id}
            title={s.enabled ? "点击停用(会停止运行中客户端)" : "点击启用"}
          />
          <span className="text-xs text-muted-foreground">{s.enabled ? "启用" : "停用"}</span>
        </div>
      </TableCell>
      <TableCell className="align-middle text-center">
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="icon" title="全部启动" onClick={() => void bulkSchemeState(s.id, "start")}>
            <Play className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="全部停止" onClick={() => void bulkSchemeState(s.id, "stop")}>
            <Square className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="添加代理" onClick={() => openAddProxy(s.id)}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="编辑" onClick={() => openEdit(s)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="删除"
            onClick={() => setConfirmRow(s)}
            disabled={!!deleteLoadingId}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )

  // 已删除方案的孤儿代理父行:无批量/添加/编辑/删除方案按钮(方案已不在)。
  const renderOrphanParent = (): ReactNode => (
    <TableRow className="bg-muted/40">
      <TableCell className="align-middle text-center font-medium whitespace-normal text-muted-foreground">已删除方案</TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <Badge variant="outline">已删除</Badge>
      </TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <span className="text-xs text-muted-foreground">方案已删除,仅剩残留代理</span>
      </TableCell>
      <TableCell className="align-middle text-center whitespace-normal">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="align-middle text-center">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
    </TableRow>
  )

  // ── 节点父行 ────────────────────────────────────────────────────────────────
  const renderNodeParent = (g: { nodeId: string; bindings: TunnelBinding[] }): ReactNode => {
    const isMain = g.nodeId === "__main__"
    const node = nodes.find((n) => n.node_id === g.nodeId)
    const offline = !isMain && (!node || !node.connected)
    return (
      <TableRow className="bg-muted/40">
        <TableCell className="align-middle text-center whitespace-normal">
          <div className="flex items-center justify-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{isMain ? "主服务" : node?.node_name || g.nodeId}</span>
            {!isMain && offline ? <Badge variant="outline" className="text-destructive">离线</Badge> : null}
          </div>
        </TableCell>
        <TableCell className="align-middle text-center whitespace-normal">
          <Badge variant="secondary">{isMain ? "主服务" : "执行节点"}</Badge>
        </TableCell>
        <TableCell className="align-middle text-center whitespace-normal">
          <span className="text-xs text-muted-foreground">{g.nodeId}</span>
        </TableCell>
        <TableCell className="align-middle text-center whitespace-normal">
          {isMain ? (
            <Badge variant="outline">本机</Badge>
          ) : offline ? (
            <Badge variant="outline" className="text-destructive">离线</Badge>
          ) : (
            <Badge variant="outline" className="text-emerald-600">在线</Badge>
          )}
        </TableCell>
        <TableCell className="align-middle text-center">
          <span className="text-xs text-muted-foreground">—</span>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <AdminPage
      // contentStyle 触发「填充布局」:内容区撑满视口高度,方案卡片吃掉剩余空间,
      // 安全提醒固定在最底部。
      contentStyle={{ gap: 16 }}
      primaryActions={
        // 注意:AdminPage 只取 primaryActions ?? actions,两者同传会丢 actions
        // (旧版刷新按钮就是这样被静默吞掉的)。刷新按钮必须放进 primaryActions。
        <>
          <ManagerRefreshButton onClick={() => void fetchData()} loading={loading} />
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> 新建方案
          </Button>
        </>
      }
    >
      <SectionCard
        title="内网穿透方案池"
        description="配置 frpc / cloudflared / npc 代理服务器的连接信息,绑定端口时选用。"
        className="flex min-h-0 flex-1 flex-col"
        bodyStyle={{ flex: 1, minHeight: 0, overflowY: "auto" }}
        extra={
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => v && setView(v as "scheme" | "node")}
            >
              <ToggleGroupItem value="scheme"><Layers className="mr-1 h-3.5 w-3.5" />按方案</ToggleGroupItem>
              <ToggleGroupItem value="node"><Server className="mr-1 h-3.5 w-3.5" />按节点</ToggleGroupItem>
            </ToggleGroup>
            <Select
              value={nodeFilter || ALL}
              onValueChange={(v) => setNodeFilter(v === ALL ? "" : v)}
            >
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="全部节点" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部节点</SelectItem>
                <SelectItem value="__main__">主服务</SelectItem>
                {nodes.filter((n) => n.role === "execution").map((n) => (
                  <SelectItem key={n.node_id} value={n.node_id}>
                    {n.node_name || n.node_id}{n.connected ? "" : "(离线)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px] text-center">名称</TableHead>
              <TableHead className="w-[120px] text-center">类型</TableHead>
              <TableHead className="text-center">摘要</TableHead>
              <TableHead className="w-[120px] text-center">状态</TableHead>
              <TableHead className="w-[200px] text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center"><Spinner /></TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-destructive">{error}</TableCell>
              </TableRow>
            ) : view === "scheme" ? (
              schemes.length === 0 && orphanBindings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    还没有方案,点「新建方案」添加一个。
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {schemes.map((s) => {
                    const items = bindingsByScheme.get(s.id) || []
                    return (
                      <Fragment key={s.id}>
                        {renderSchemeParent(s)}
                        {items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-2 pl-10 text-xs text-muted-foreground">该方案还没有代理。</TableCell>
                          </TableRow>
                        ) : items.map((b) => renderBindingRow(b, schemeTypeCell(b)))}
                      </Fragment>
                    )
                  })}
                  {orphanBindings.length > 0 ? (
                    <Fragment>
                      {renderOrphanParent()}
                      {orphanBindings.map((b) => renderBindingRow(b, <Badge variant="outline">{b.scheme_id}</Badge>))}
                    </Fragment>
                  ) : null}
                </>
              )
            ) : nodeGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">没有符合条件的代理。</TableCell>
              </TableRow>
            ) : (
              nodeGroups.map((g) => (
                <Fragment key={g.nodeId}>
                  {renderNodeParent(g)}
                  {g.bindings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-2 pl-10 text-xs text-muted-foreground">该节点还没有代理。</TableCell>
                    </TableRow>
                  ) : g.bindings.map((b) => renderBindingRow(b, nodeTypeCell(b)))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>

      <div className="flex flex-shrink-0 gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong>安全提醒:</strong> 内网穿透会把节点内网服务直接对外暴露。每条绑定生成的公网地址即访问凭证,泄漏等同开放访问。请只暴露非敏感服务(dev server 等),数据库/SSH 等敏感端口谨慎暴露,风险自担。
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="grid-rows-[auto_1fr_auto] h-[800px] max-h-[90vh] w-[800px] max-w-[calc(100%-2rem)] sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{isEdit ? "编辑方案" : "新建方案"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto py-2 pr-1">
            <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
              <div className="space-y-1">
                <Label>名称<Req /></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如:公司内网 frps" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tunnel-enabled">状态</Label>
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    id="tunnel-enabled"
                    checked={form.enabled}
                    onCheckedChange={(c) => setForm({ ...form, enabled: c })}
                  />
                  <Label htmlFor="tunnel-enabled" className="text-sm font-normal cursor-pointer">
                    {form.enabled ? "启用" : "停用"}
                  </Label>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>类型</Label>
              <div className="flex gap-2">
                {(["frpc", "cloudflared", "npc"] as TunnelKind[]).map((k) => (
                  <Button
                    key={k}
                    variant={form.kind === k ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm({ ...form, kind: k })}
                    disabled={isEdit}
                  >
                    {k}
                  </Button>
                ))}
              </div>
            </div>

            {(form.kind === "frpc" || form.kind === "npc") && (
              <>
                <div className="space-y-1">
                  <Label>服务器地址 (frps / nps 连接地址)</Label>
                  <Input value={form.server_addr} onChange={(e) => setForm({ ...form, server_addr: e.target.value })} placeholder="frps.example.com 或服务器 IP" />
                </div>
                <div className="space-y-1">
                  <Label>对外访问域名 (可选)</Label>
                  <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="tunnel.example.com" />
                  <p className="text-xs text-muted-foreground">
                    留空则显示「服务器地址:分配端口」;填写后显示「域名:分配端口」。需自行将该域名通过 A/CNAME 解析到 frps/nps 服务器,平台不会自动配置 DNS。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>服务器端口</Label>
                    <Input value={form.server_port} onChange={(e) => setForm({ ...form, server_port: e.target.value })} placeholder="7000" />
                  </div>
                  <div className="space-y-1">
                    <Label>Token (可空)</Label>
                    <Input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="鉴权 token" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>端口段起 (可选)</Label>
                    <Input value={form.port_range_lo} onChange={(e) => setForm({ ...form, port_range_lo: e.target.value })} placeholder="30000" />
                  </div>
                  <div className="space-y-1">
                    <Label>端口段止 (可选)</Label>
                    <Input value={form.port_range_hi} onChange={(e) => setForm({ ...form, port_range_hi: e.target.value })} placeholder="30100" />
                  </div>
                </div>
                {(form.kind === "frpc" || form.kind === "npc") && (
                  <p className="text-xs text-muted-foreground">
                    端口段用于给代理自动分配远端端口;两格都留空则该方案不限端口,创建代理时须手动填写远端端口。
                  </p>
                )}
                {form.kind === "frpc" && (
                  <div className="space-y-1">
                    <Label>User (可选)</Label>
                    <Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="myname" />
                    <p className="text-xs text-muted-foreground">
                      frp 客户端标识(对应 [common].user)。设置后实际代理名会带上 user. 前缀;仅支持字母、数字、`.`、`_`、`-`。
                    </p>
                  </div>
                )}
              </>
            )}

            {form.kind === "cloudflared" && (
              <>
                <div className="space-y-1">
                  <Label>模式<Req /></Label>
                  <Select value={form.cf_mode} onValueChange={(value) => setForm({ ...form, cf_mode: value as "quick" | "managed" })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quick">quick</SelectItem>
                      <SelectItem value="managed">managed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">
                    {form.cf_mode === "quick" ? "Quick Tunnel" : "Managed Tunnel"}
                  </div>
                  {CF_MODE_HELP[form.cf_mode]}
                </div>

                {form.cf_mode === "managed" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="inline-flex items-center gap-1">
                          根域名<Req />
                          <HoverCard openDelay={150} closeDelay={100}>
                            <HoverCardTrigger asChild>
                              <button type="button" aria-label="根域名说明" className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
                                <CircleQuestionMark className="h-3.5 w-3.5" />
                              </button>
                            </HoverCardTrigger>
                            <HoverCardContent className="max-w-xs">
                              每次绑定只需填写子域名,例如填 app 后得到 app.{form.domain.trim() || "example.com"}。
                            </HoverCardContent>
                          </HoverCard>
                        </Label>
                        <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" />
                      </div>
                      <div className="space-y-1">
                        <Label>Cloudflare API Token<Req /></Label>
                        <Input
                          type="password"
                          value={form.cf_api_token}
                          onChange={(e) => setForm({ ...form, cf_api_token: e.target.value })}
                          placeholder="DNS + Tunnel 编辑权限"
                        />
                      </div>
                    </div>
                    {isEdit && (
                      <p className="text-xs text-muted-foreground">Token 已预填掩码,保持不变即沿用原值;要更换则清空重输。</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>账户 ID (Account ID)<Req /></Label>
                        <Input value={form.cf_account_id} onChange={(e) => setForm({ ...form, cf_account_id: e.target.value })} placeholder="Cloudflare 账户 ID" />
                      </div>
                      <div className="space-y-1">
                        <Label>区域 ID (Zone ID)<Req /></Label>
                        <Input value={form.cf_zone_id} onChange={(e) => setForm({ ...form, cf_zone_id: e.target.value })} placeholder="根域名的区域 ID" />
                      </div>
                    </div>

                    <div className="rounded-md border border-blue-500/25 bg-blue-500/5 p-3 text-xs text-muted-foreground">
                      <div className="mb-2 font-medium text-foreground">Cloudflare 参数获取说明</div>
                      <ol className="list-decimal space-y-1 pl-4">
                        <li>
                          进入
                          <a
                            href="https://dash.cloudflare.com/profile/api-tokens"
                            target="_blank"
                            rel="noreferrer"
                            className="mx-1 inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
                          >
                            API 令牌页面 <ExternalLink className="h-3 w-3" />
                          </a>
                          ,点击「创建令牌」。
                        </li>
                        <li>为令牌添加「DNS 设置」和「Cloudflare Tunnel」权限,两项都选择「编辑」;其余范围按需选择。</li>
                        <li>保存令牌并复制 Token(Cloudflare 只显示一次),填入上方 API Token。</li>
                        <li>进入根域名页面,向下滚动到「API」卡片,复制「账户 ID」与「区域 ID」填入上方。</li>
                      </ol>
                    </div>
                  </>
                )}
              </>
            )}

            {modalError && <div className="text-sm text-destructive">{modalError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {isEdit ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={proxyOpen}
        onOpenChange={(open) => {
          setProxyOpen(open)
          if (!open) setProxyEditing(null)
        }}
      >
        <DialogContent className="w-[560px] max-w-[calc(100%-2rem)] sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{proxyEditing ? "编辑代理" : "添加代理"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {proxyEditing ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                {(() => {
                  const st = deriveStatus(proxyEditing)
                  return <Badge variant={st.key === "failed" ? "destructive" : "outline"} className={st.cls}>{st.label}</Badge>
                })()}
                <span className="truncate text-muted-foreground">
                  {proxyEditing.public_addr ? proxyEditing.public_addr : "地址生成中…"}
                </span>
                {proxyEditing.error ? (
                  <span className="truncate text-destructive">· {proxyEditing.error}</span>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>穿透方案<Req /></Label>
              <Select value={proxySchemeId} onValueChange={setProxySchemeId} disabled={!!proxyEditing}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择方案" />
                </SelectTrigger>
                <SelectContent>
                  {schemes.filter((s) => s.enabled).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({s.kind})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {proxyEditing ? (
                <p className="text-xs text-muted-foreground">方案不可修改,跨方案迁移请删除后重建。</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>节点位置<Req /></Label>
              <Select
                value={proxyForm.node_id}
                onValueChange={(value) => setProxyForm({ ...proxyForm, node_id: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择节点位置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__main__">主服务(本机)</SelectItem>
                  {nodes
                    .filter((n) => n.role === "execution")
                    .map((n) => (
                      <SelectItem key={n.node_id} value={n.node_id}>
                        {n.node_name || n.node_id}
                        {n.connected ? "" : "(离线)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                代理客户端在此位置运行,暴露的是该位置能访问到的地址和端口。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>内网 IP<Req /></Label>
                <Input
                  value={proxyForm.local_host}
                  onChange={(e) => setProxyForm({ ...proxyForm, local_host: e.target.value })}
                  placeholder="127.0.0.1"
                />
              </div>
              <div className="space-y-1">
                <Label>端口<Req /></Label>
                <Input
                  type="number"
                  value={proxyForm.local_port}
                  onChange={(e) => setProxyForm({ ...proxyForm, local_port: e.target.value })}
                  placeholder="8000"
                />
              </div>
            </div>
            {proxySupportsRemotePort && (
              <div className="space-y-1">
                <Label>
                  远端端口{remotePortRequired ? <Req /> : null}
                  {remotePortRequired ? "" : " (可选)"}
                </Label>
                <Input
                  type="number"
                  value={proxyForm.remote_port}
                  onChange={(e) => setProxyForm({ ...proxyForm, remote_port: e.target.value })}
                  placeholder={proxyEditing ? (remotePortRequired ? "必填" : "保持当前") : (remotePortRequired ? "必填(方案未配端口段)" : "自动分配")}
                />
                <p className="text-xs text-muted-foreground">
                  {remotePortRequired
                    ? "该方案未配置端口段,无法自动分配,必须手动指定(同方案内不能重复)。"
                    : proxyEditing
                      ? "留空保持当前端口;填写则改用该端口(同方案内不能重复)。"
                      : "代理服务端对外监听的端口;留空自动从方案端口段分配。"}
                </p>
              </div>
            )}
            {proxySupportsProxyName && (
              <div className="space-y-1">
                <Label>代理名 (可选)</Label>
                <Input
                  value={proxyForm.proxy_name}
                  onChange={(e) => setProxyForm({ ...proxyForm, proxy_name: e.target.value })}
                  placeholder="web"
                />
                <p className="text-xs text-muted-foreground">
                  写进 frpc 配置的代理名;留空自动生成。仅支持字母、数字、`.`、`_`、`-`,同方案内唯一。
                </p>
              </div>
            )}
            {proxyNeedsSubdomain && (
              <div className="space-y-1">
                <Label>子域名<Req /></Label>
                <div className="flex items-center gap-1">
                  <Input
                    value={proxyForm.subdomain}
                    onChange={(e) => setProxyForm({ ...proxyForm, subdomain: e.target.value })}
                    placeholder="app"
                    disabled={!proxyDomain}
                  />
                  <span className="whitespace-nowrap text-sm text-muted-foreground">.{proxyDomain || "?"}</span>
                </div>
                {!proxyDomain ? (
                  <p className="text-xs text-amber-600">该方案未配置根域名,请先编辑方案补上。</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    公网地址:https://{proxyForm.subdomain.trim() || "app"}.{proxyDomain}
                  </p>
                )}
                {proxyEditing && proxyEditing.hostname && proxyForm.subdomain.trim() &&
                  `${proxyForm.subdomain.trim()}.${proxyDomain}` !== proxyEditing.hostname ? (
                  <p className="text-xs text-amber-600">子域名变更会重建 DNS 记录,切换期间该地址可能短暂不可用。</p>
                ) : null}
              </div>
            )}
            <div className="space-y-1">
              <Label>备注</Label>
              <Textarea
                value={proxyForm.description}
                onChange={(e) => setProxyForm({ ...proxyForm, description: e.target.value })}
                placeholder="如:线上预览"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">作为代理的名称显示在列表,便于区分用途。</p>
            </div>
            {proxyError && <div className="text-sm text-destructive">{proxyError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProxyOpen(false)} disabled={proxySaving}>取消</Button>
            <Button onClick={submitProxy} disabled={proxySaving}>
              {proxySaving ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {proxyEditing ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除方案「{confirmRow?.name}」?</AlertDialogTitle>
            <AlertDialogDescription>
              仍有运行中绑定的方案不能删除,请先关闭其绑定。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deleteLoadingId}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={!!deleteLoadingId}>
              {deleteLoadingId ? <Spinner className="mr-2 h-4 w-4" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  )
}
