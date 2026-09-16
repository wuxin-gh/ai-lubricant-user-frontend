/**
 * 「添加代理」（代理池 / 上游出口代理）弹框 —— 仅创建。
 *
 * 注意与「内网穿透」的「代理」（一条端口暴露绑定）不是同一个东西：
 *   本弹框 = 平台访问上游时用的出口代理（network / url_prefix / direct / node 四种模式）。
 *
 * 从 ProxyPool.tsx 抽出（该页保留自己的编辑弹框与列表）。字段、校验、payload 组装口径
 * 与该页完全一致；新增走 addProxy（读列表 → 追加 → 全量 PUT），后端已改为按 owner
 * 分段合并，非管理员不会冲掉他人条目。
 */
import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"

import { addProxy } from "@/@admin-port/api/proxyPool"
import type { ProxyInput, ProxyMode } from "@/@admin-port/api/proxyPool"
import { listNodes } from "@/@admin-port/api/nodes"
import type { NodeInfo } from "@/@admin-port/api/nodes"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { Spinner } from "@/components/ui/spinner"

interface ProxyFormValues {
  name: string
  mode: ProxyMode
  url: string
  username?: string
  password?: string
  nodeId?: string
}

// 默认 URL 前缀转发：这是最常见的用法（CF Workers 反代等），故置为默认而非网络代理。
const EMPTY_FORM: ProxyFormValues = { name: "", mode: "url_prefix", url: "", username: "", password: "", nodeId: "" }

export function ProxyPoolCreateDialog({
  open,
  onOpenChange,
  onCreated,
  onOpenCommunity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  /** URL 前缀转发没有搭建文档，提供「加入社区」入口（社区有免费方案）。 */
  onOpenCommunity?: () => void
}) {
  const [form, setForm] = useState<ProxyFormValues>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)

  // 打开时重置表单并拉取可转发的执行节点（node 模式要用）。
  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setModalError(null)
    setUrlError(null)
    setShowPassword(false)
    setNodesLoading(true)
    void listNodes("approved")
      .then((all) => setNodes(all.filter((n) => n.role === "execution")))
      .catch(() => setNodes([]))
      .finally(() => setNodesLoading(false))
  }, [open])

  const submit = async () => {
    setModalError(null)
    let ok = true
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
    const payload: ProxyInput = {
      name: form.name.trim(),
      mode: form.mode,
      url: isDirect || isNode ? "" : form.url.trim(),
      username: noAuth ? "" : (form.username || "").trim(),
      password: noAuth ? "" : (form.password || ""),
      ...(isNode ? { node_id: (form.nodeId || "").trim() } : {}),
    }

    setSaving(true)
    try {
      await addProxy(payload)
      toast.success("代理已添加")
      onCreated?.()
      onOpenChange(false)
    } catch (err) {
      setModalError(err instanceof Error ? `添加代理失败: ${err.message}` : "添加代理失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onOpenChange(false) }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>添加代理</DialogTitle>
          <DialogDescription>
            平台访问上游（模型供应商等）时使用的出口代理。与「内网穿透」里的代理不同——那个是把本机端口暴露到公网。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proxy-name">名字（可选）</Label>
            <Input
              id="proxy-name"
              disabled={saving}
              placeholder="如：本地代理"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* 代理类型常驻显示（不折叠）：这是决定填什么的关键信息，藏起来用户没法填。 */}
          <div className="flex flex-col gap-1.5">
            <Label>代理类型</Label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: "url_prefix" as const, label: "URL 前缀转发" },
                { value: "network" as const, label: "网络代理" },
                { value: "direct" as const, label: "不走代理" },
                { value: "node" as const, label: "节点转发" },
              ]).map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  size="sm"
                  variant={form.mode === item.value ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, mode: item.value }))}
                >
                  {item.label}
                </Button>
              ))}
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
                    : "http://127.0.0.1:7890（例如本机 Clash / V2Ray 的混合端口）"
                }
                value={form.url}
                aria-invalid={!!urlError}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
              {urlError ? <span className="text-xs text-destructive">{urlError}</span> : null}
              {/* 前缀转发没有现成文档，给一条可操作的去处（社区有免费方案）。 */}
              {form.mode === "url_prefix" ? (
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>不知道怎么搭建？</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenCommunity?.()
                    }}
                  >
                    加入社区
                  </button>
                  <span>，社区有免费的方案。</span>
                </div>
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
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proxy-username">用户名</Label>
                <Input
                  id="proxy-username"
                  disabled={saving}
                  autoComplete="off"
                  placeholder="代理认证用户名（可选）"
                  value={form.username ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proxy-password">密码</Label>
                <div className="relative">
                  <Input
                    id="proxy-password"
                    type={showPassword ? "text" : "password"}
                    disabled={saving}
                    autoComplete="new-password"
                    placeholder="代理认证密码（可选）"
                    className="pr-9"
                    value={form.password ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </>
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
          ) : (
            <p className="mb-0 text-xs text-muted-foreground">
              用户名/密码会在运行时自动拼入代理 URL；账号只能从代理池绑定代理。
            </p>
          )}

          {modalError ? (
            <Alert variant="destructive">
              <AlertDescription>{modalError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? <Spinner /> : null}
            添加代理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
