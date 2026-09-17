/**
 * 代理池管理页 —— 从 admin-frontend 的 antd 版重写为 shadcn。
 * 数据层沿用 `@/@admin-port/api/proxyPool`（纯 axios），仅重写 view 层。
 */
import { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import {
  AdminPage,
  SectionCard,
  SimpleTable,
} from "@/components/manager/platform-page"
import type { SimpleTableColumn } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert"
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
  addProxy,
  deleteProxy,
  getProxies,
  updateProxies,
} from "@/@admin-port/api/proxyPool"
import type { ProxyEntry, ProxyInput, ProxyMode } from "@/@admin-port/api/proxyPool"
import { listNodes } from "@/@admin-port/api/nodes"
import type { NodeInfo } from "@/@admin-port/api/nodes"
import { parseProxyUrl } from "@/utils/proxy-url"

interface ProxyFormValues {
  name: string
  mode: ProxyMode
  url: string
  username?: string
  password?: string
  nodeId?: string
}

interface ProxyRow extends Record<string, unknown> {
  id: string
  name: string
  mode: ProxyMode
  url: string
  protocol: string
  auth: boolean
  nodeId: string
}

function extractProtocol(url: string): string {
  const match = url.match(/^([a-z]+):\/\//i)
  return match ? match[1].toUpperCase() : "HTTP"
}

const EMPTY_FORM: ProxyFormValues = { name: "", mode: "network", url: "", username: "", password: "", nodeId: "" }

export function ProxyPool() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingProxy, setEditingProxy] = useState<ProxyEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const [form, setForm] = useState<ProxyFormValues>(EMPTY_FORM)
  const [nameError, setNameError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)

  // 删除确认框状态
  const [confirmRow, setConfirmRow] = useState<ProxyRow | null>(null)

  // node 模式的可选节点：只列已批准的执行节点（唯一能出网转发的角色）。
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)

  const isEdit = !!editingProxy

  const loadNodes = async () => {
    setNodesLoading(true)
    try {
      const all = await listNodes("approved")
      setNodes(all.filter((n) => n.role === "execution"))
    } catch {
      setNodes([])
    } finally {
      setNodesLoading(false)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getProxies()
      setProxies(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  const openAddModal = () => {
    setEditingProxy(null)
    setModalError(null)
    setNameError(null)
    setUrlError(null)
    setForm(EMPTY_FORM)
    void loadNodes()
    setModalOpen(true)
  }

  const openEditModal = (proxy: ProxyEntry) => {
    setEditingProxy(proxy)
    setModalError(null)
    setNameError(null)
    setUrlError(null)
    setForm({
      name: proxy.name,
      mode: proxy.mode || "network",
      url: proxy.url,
      username: proxy.username,
      password: proxy.password,
      nodeId: proxy.node_id || "",
    })
    void loadNodes()
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingProxy(null)
    setModalError(null)
  }

  const handleSubmit = async () => {
    setModalError(null)
    // 手动校验（对齐 antd Form 的 required 规则）
    let ok = true
    if (!form.name.trim()) {
      setNameError("请输入名称")
      ok = false
    } else {
      setNameError(null)
    }
    // direct（强制直连）/ node（走节点转发）模式无需 URL；其余模式必填。
    const isDirect = form.mode === "direct"
    const isNode = form.mode === "node"
    if (!isDirect && !isNode && !form.url.trim()) {
      setUrlError("请输入 URL")
      ok = false
    } else {
      setUrlError(null)
    }
    // node 模式必须选一个节点。
    if (isNode && !(form.nodeId || "").trim()) {
      setModalError("请选择一个转发节点")
      ok = false
    }
    if (!ok) return

    // url_prefix 前缀基址即请求目标、direct 不走代理、node 走节点转发：均不使用 URL 认证，提交时清空。
    const isPrefix = form.mode === "url_prefix"
    const noAuth = isPrefix || isDirect || isNode
    // 网络代理只留一个地址框，凭据可能就粘在里面（scheme://user:pass@host:port）。
    // 拆出来提交：后端存的仍是 地址/用户名/密码 三个字段，运行时再拼回去。
    // 地址里没凭据时回退到 state——编辑既有条目、用户没碰地址框的场景靠这条保住原凭据。
    // 仅 network 模式做拆分：url_prefix 的基址不走认证，其 path 里若有 @ 不应被当凭据摘掉。
    const parsed = form.mode === "network" ? parseProxyUrl(form.url) : null
    const useParsed = !!parsed?.hasCredentials
    const payload: ProxyInput = {
      ...(editingProxy ? { id: editingProxy.id } : {}),
      name: form.name.trim(),
      mode: form.mode,
      url: isDirect || isNode ? "" : parsed ? parsed.url : form.url.trim(),
      username: noAuth ? "" : useParsed ? parsed!.username : (form.username || "").trim(),
      password: noAuth ? "" : useParsed ? parsed!.password : (form.password || ""),
      ...(isNode ? { node_id: (form.nodeId || "").trim() } : {}),
    }

    setSaving(true)
    try {
      if (editingProxy) {
        const current = await getProxies()
        // 未变更条目原样携带 id/mode 全量 PUT，避免后端按 name|mode|url 重算 id 使账号引用失效。
        await updateProxies(
          current.map((proxy) =>
            proxy.id === editingProxy.id
              ? payload
              : {
                  id: proxy.id,
                  name: proxy.name,
                  mode: proxy.mode,
                  url: proxy.url,
                  username: proxy.username,
                  password: proxy.password,
                  // node 模式条目原样携带 node_id，避免全量 PUT 丢失其他节点绑定。
                  ...(proxy.mode === "node" ? { node_id: proxy.node_id || "" } : {}),
                },
          ),
        )
        toast.success("代理已更新")
      } else {
        await addProxy(payload)
        toast.success("代理已添加")
      }
      await fetchData()
      setModalOpen(false)
      setEditingProxy(null)
    } catch (err) {
      const action = isEdit ? "保存" : "添加"
      setModalError(
        err instanceof Error ? `${action}代理失败: ${err.message}` : `${action}代理失败`,
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: ProxyRow) => {
    setDeleteLoadingId(row.id)
    try {
      await deleteProxy(row.id)
      toast.success("代理已删除")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? `删除代理失败: ${err.message}` : "删除代理失败")
    } finally {
      setDeleteLoadingId(null)
    }
  }

  // 地址框里粘的凭据（若有）。仅 network 模式参与，url_prefix 的基址不走认证。
  const parsedUrl = useMemo(
    () => (form.mode === "network" ? parseProxyUrl(form.url) : { url: form.url, username: "", password: "", hasCredentials: false }),
    [form.mode, form.url],
  )

  const rows: ProxyRow[] = useMemo(
    () =>
      proxies.map((p) => ({
        id: p.id,
        name: p.name,
        mode: p.mode || "network",
        url: p.url,
        protocol: extractProtocol(p.url),
        auth: !!p.username,
        nodeId: p.node_id || "",
      })),
    [proxies],
  )

  const authCount = rows.filter((r) => r.auth).length
  const noAuthCount = rows.length - authCount

  const columns: SimpleTableColumn<ProxyRow>[] = [
    { key: "name", label: "名称", width: 160 },
    {
      key: "mode",
      label: "模式",
      width: 120,
      render: (_v, row) =>
        row.mode === "url_prefix" ? (
          <Badge variant="outline" className="text-purple-600 dark:text-purple-400">
            URL 前缀
          </Badge>
        ) : row.mode === "direct" ? (
          <Badge variant="outline" className="text-slate-600 dark:text-slate-400">
            强制直连
          </Badge>
        ) : row.mode === "node" ? (
          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
            节点转发
          </Badge>
        ) : (
          <Badge variant="secondary">网络代理</Badge>
        ),
    },
    {
      key: "url",
      label: "端点",
      width: 360,
      render: (_v, row) =>
        row.mode === "direct" ? (
          <span className="text-muted-foreground">—（不走代理）</span>
        ) : row.mode === "node" ? (
          <span className="text-muted-foreground">节点 {row.nodeId || "—"}</span>
        ) : (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.url}</code>
        ),
    },
    {
      key: "protocol",
      label: "协议",
      width: 90,
      render: (_v, row) =>
        row.mode === "direct" || row.mode === "node" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Badge variant="outline" className="text-blue-600 dark:text-blue-400">
            {row.protocol}
          </Badge>
        ),
    },
    {
      key: "auth",
      label: "认证",
      width: 110,
      render: (_v, row) =>
        row.auth ? (
          <Badge variant="outline" className="text-green-600 dark:text-green-400">
            已配置
          </Badge>
        ) : (
          <Badge variant="secondary">无认证</Badge>
        ),
    },
    {
      key: "id",
      label: "ID",
      width: 200,
      render: (_v, row) => <span className="text-muted-foreground">{row.id}</span>,
    },
    {
      key: "actions",
      label: "操作",
      width: 160,
      render: (_v, row) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEditModal(proxies.find((p) => p.id === row.id)!)}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={deleteLoadingId === row.id}
            onClick={() => setConfirmRow(row)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <AdminPage
      title="代理池"
      description="管理账号访问上游时的代理服务器"
      primaryActions={
        <>
          <ManagerRefreshButton loading={loading} onClick={() => void fetchData()} />
          <Button onClick={openAddModal}>
            <Plus />
            添加代理
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
        title="代理列表"
        extra={
          <span className="text-sm text-muted-foreground">
            共 {rows.length} 个代理 · 需认证 {authCount} · 无认证 {noAuthCount}
          </span>
        }
      >
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <SimpleTable<ProxyRow>
            rowKey="id"
            columns={columns}
            rows={rows}
            emptyText="暂无代理配置"
          />
        )}
      </SectionCard>

      <Dialog open={modalOpen} onOpenChange={(o) => (o ? undefined : closeModal())}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{isEdit ? "编辑代理" : "添加代理"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proxy-name">名称</Label>
              <Input
                id="proxy-name"
                autoFocus
                disabled={saving}
                placeholder="如：本地代理1"
                value={form.name}
                aria-invalid={!!nameError}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {nameError ? <span className="text-xs text-destructive">{nameError}</span> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>模式</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.mode === "network" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, mode: "network" }))}
                >
                  网络代理
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.mode === "url_prefix" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, mode: "url_prefix" }))}
                >
                  URL 前缀转发
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.mode === "direct" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, mode: "direct" }))}
                >
                  不走代理
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.mode === "node" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, mode: "node" }))}
                >
                  节点转发
                </Button>
              </div>
            </div>

            {form.mode !== "direct" && form.mode !== "node" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proxy-url">
                  {form.mode === "url_prefix" ? "前缀地址" : "代理地址"}
                </Label>
                <Input
                  id="proxy-url"
                  disabled={saving}
                  placeholder={
                    form.mode === "url_prefix"
                      ? "https://proxy.example.com"
                      : "http://127.0.0.1:7890（可整行粘贴 http://用户名:密码@主机:端口）"
                  }
                  value={form.url}
                  aria-invalid={!!urlError}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                />
                {urlError ? <span className="text-xs text-destructive">{urlError}</span> : null}
                {/* 网络代理的凭据直接粘在地址里即可：这里当场回显拆到了什么，避免用户
                    以为没生效。编辑既有条目时地址框是裸地址，凭据来自 state，同样要显示。 */}
                {form.mode === "network" ? (
                  <CredentialHint
                    parsed={parsedUrl}
                    fallbackUsername={form.username}
                    fallbackPassword={form.password}
                    onClear={() => setForm((f) => ({ ...f, url: parsedUrl.url, username: "", password: "" }))}
                  />
                ) : null}
              </div>
            ) : null}

            {form.mode === "node" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proxy-node">转发节点</Label>
                <select
                  id="proxy-node"
                  disabled={saving || nodesLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={form.nodeId ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, nodeId: e.target.value }))}
                >
                  <option value="">{nodesLoading ? "加载节点中…" : "请选择一个执行节点"}</option>
                  {nodes.map((n) => (
                    <option key={n.node_id} value={n.node_id}>
                      {n.node_name || n.node_id}
                      {n.connected ? "" : "（离线）"}
                    </option>
                  ))}
                </select>
                {!nodesLoading && nodes.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    暂无已批准的执行节点。请先在「节点」页入驻并批准一个执行节点。
                  </span>
                ) : null}
              </div>
            ) : null}

            {form.mode === "network" ? (
              <p className="mb-0 text-xs text-muted-foreground">
                认证信息直接写在代理地址里即可（如 http://用户名:密码@主机:端口），系统会自动拆分保存；
                用户名/密码会在运行时自动拼回代理 URL。账号只能从代理池绑定代理。
              </p>
            ) : null}

            {form.mode === "url_prefix" ? (
              <p className="mb-0 text-xs text-muted-foreground">
                前缀服务会收到「前缀地址 + 完整原始 URL」形式的请求（如
                https://proxy.example.com/https://api.openai.com/v1/chat/completions），
                覆盖模型请求与登录 / OAuth / token 刷新等全部出站流量，不是传统 CONNECT/SOCKS 代理。
                此模式忽略用户名 / 密码。
              </p>
            ) : form.mode === "direct" ? (
              <p className="mb-0 text-xs text-muted-foreground">
                强制直连：绑定此条目的账号一律不走任何代理，直接访问上游。
                无需填写地址；可用于在代理池统一管理下把个别账号显式排除出代理。
              </p>
            ) : form.mode === "node" ? (
              <p className="mb-0 text-xs text-muted-foreground">
                节点转发：绑定此条目的账号出站请求下发给所选执行节点，由节点用自己的
                网络发出，请求从节点 IP 出网。节点只做纯 I/O 转发（含 TLS），不处理业务。
                覆盖模型请求与登录 / OAuth / token 刷新等全部出站流量。
              </p>
            ) : null}

            {modalError ? (
              <Alert variant="destructive">
                <AlertDescription>{modalError}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={closeModal}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSubmit()}>
              {saving ? <Spinner /> : null}
              {isEdit ? "保存" : "添加代理"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRow !== null}
        onOpenChange={(o) => (o ? undefined : setConfirmRow(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmRow ? `确定删除代理 ${confirmRow.name}？` : "确定删除代理？"}
            </AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmRow ? deleteLoadingId === confirmRow.id : false}
              onClick={() => {
                if (confirmRow) void handleDelete(confirmRow)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  )
}


/**
 * 「已识别认证」提示行：告诉用户地址里粘的凭据被拆到了什么。
 *
 * 地址里没有凭据时回退显示 state 里的凭据（编辑既有条目、地址框仍是裸地址的场景）——
 * 否则用户会以为打开编辑框后认证丢了。密码只报「已设置」，不回显也不报长度。
 */
function CredentialHint({
  parsed,
  fallbackUsername,
  fallbackPassword,
  onClear,
}: {
  parsed: { url: string; username: string; password: string; hasCredentials: boolean }
  fallbackUsername?: string
  fallbackPassword?: string
  onClear: () => void
}) {
  const username = parsed.hasCredentials ? parsed.username : (fallbackUsername || "")
  const hasPassword = parsed.hasCredentials ? !!parsed.password : !!fallbackPassword
  if (!username && !hasPassword) return null

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="text-green-600 dark:text-green-400">已识别认证：</span>
      {username ? <span>用户名 {username}</span> : null}
      {hasPassword ? <span>密码已设置</span> : null}
      <button
        type="button"
        className="text-primary hover:underline"
        onClick={onClear}
        aria-label="清除代理认证"
      >
        清除
      </button>
    </div>
  )
}


export default ProxyPool
