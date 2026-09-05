/** 节点详情 — 内网穿透总览 tab。
 *
 * 列出该节点上所有穿透绑定(跨项目 + 独立),并支持在此添加「独立穿透」(不属任何项目)。
 * 调 /api/v1/users/nodes/{id}/tunnels。
 */
import { useEffect, useState } from "react"
import { Plus, Trash2, ExternalLink, Play, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import {
  createNodeTunnel, deleteNodeTunnel, listNodeTunnels, listTunnelSchemes,
  startTunnel, stopTunnel,
} from "@/api/tunnelClient"
import type { TunnelBinding, TunnelScheme } from "@/api/tunnelClient"

const STATUS_META: Record<string, { label: string; cls: string }> = {
  running: { label: "运行中", cls: "bg-emerald-500/15 text-emerald-600" },
  pending: { label: "启动中", cls: "bg-amber-500/15 text-amber-600" },
  failed: { label: "失败", cls: "bg-destructive/15 text-destructive" },
  stopped: { label: "已停止", cls: "bg-muted text-muted-foreground" },
}

/** cloudflared managed 方案:公网地址 = 绑定填的子域名 + 方案根域名。 */
function isManagedCloudflared(scheme: TunnelScheme | undefined): boolean {
  return scheme?.kind === "cloudflared" && scheme.config?.mode === "managed"
}

function schemeDomain(scheme: TunnelScheme | undefined): string {
  return String(scheme?.config?.domain || "")
}

export function NodeTunnels({ nodeId }: { nodeId: string }) {
  const [loading, setLoading] = useState(true)
  const [bindings, setBindings] = useState<TunnelBinding[]>([])
  const [schemes, setSchemes] = useState<TunnelScheme[]>([])
  const [error, setError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ scheme_id: "", local_port: "", local_host: "127.0.0.1", subdomain: "", description: "" })
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<TunnelBinding | null>(null)
  const [deleting, setDeleting] = useState(false)

  const selectedScheme = schemes.find((s) => s.id === form.scheme_id)
  const needsSubdomain = isManagedCloudflared(selectedScheme)
  const domain = schemeDomain(selectedScheme)
  // 历史 managed 方案可能没配根域名,此时无法拼公网地址,先去方案页补。
  const missingDomain = needsSubdomain && !domain

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [bs, ss] = await Promise.all([listNodeTunnels(nodeId), listTunnelSchemes()])
      setBindings(bs)
      setSchemes(ss.filter((s) => s.enabled))
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载穿透绑定失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchData() }, [nodeId])

  const openAdd = () => {
    setForm({ scheme_id: schemes[0]?.id || "", local_port: "", local_host: "127.0.0.1", subdomain: "", description: "" })
    setFormError(null)
    setAddOpen(true)
  }

  const submit = async () => {
    const port = Number(form.local_port)
    if (!form.scheme_id) { setFormError("请选择方案"); return }
    if (!port || port < 1 || port > 65535) { setFormError("本地端口需为 1-65535"); return }
    if (missingDomain) { setFormError("该方案未配置根域名,请先到「内网穿透」页编辑方案"); return }
    if (needsSubdomain && !form.subdomain.trim()) { setFormError("请填写子域名"); return }
    setSaving(true); setFormError(null)
    try {
      await createNodeTunnel(nodeId, {
        scheme_id: form.scheme_id,
        node_id: nodeId,
        local_port: port,
        local_host: form.local_host || "127.0.0.1",
        ...(needsSubdomain ? { subdomain: form.subdomain.trim() } : {}),
        description: form.description.trim() || undefined,
      })
      toast.success("已创建穿透绑定,节点正在启动客户端")
      setAddOpen(false)
      await fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败")
    } finally { setSaving(false) }
  }

  const changeState = async (binding: TunnelBinding, action: "start" | "stop") => {
    try {
      await (action === "start" ? startTunnel(binding.id) : stopTunnel(binding.id))
      toast.success(action === "start" ? "已启动" : "已停止")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }

  const confirmDelete = async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteNodeTunnel(nodeId, confirmDel.id)
      toast.success("已删除穿透绑定")
      setConfirmDel(null)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally { setDeleting(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (error) return <div className="text-sm text-destructive py-4 text-center">{error}</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">该节点上所有穿透绑定(跨项目 + 独立)。</p>
        <Button size="sm" onClick={openAdd} disabled={schemes.length === 0}>
          <Plus className="mr-1 h-4 w-4" /> 添加独立穿透
        </Button>
      </div>
      {schemes.length === 0 ? (
        <p className="text-xs text-amber-600">没有启用的穿透方案,请先到「内网穿透」页配置。</p>
      ) : null}
      {bindings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">该节点还没有穿透绑定。</p>
      ) : (
        <div className="rounded border divide-y">
          {bindings.map((b) => {
            const scheme = schemes.find((s) => s.id === b.scheme_id)
            const st = STATUS_META[b.client_status] || { label: b.client_status, cls: "bg-muted text-muted-foreground" }
            return (
              <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {(b.description || "").trim() || (scheme ? `${scheme.name} (${scheme.kind})` : b.scheme_id)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {(b.description || "").trim() && scheme ? `${scheme.name} · ` : ""}
                    {b.local_host}:{b.local_port} · {b.public_addr ? (
                      <a href={b.public_addr.startsWith("http") ? b.public_addr : `http://${b.public_addr}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        {b.public_addr} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : "地址生成中…"}
                    {b.project_id ? <span className="ml-2">· 绑定项目</span> : <span className="ml-2">· 独立</span>}
                    {b.error ? <span className="ml-2 text-destructive">· {b.error}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={b.client_status === "running" || b.client_status === "pending" ? "停止" : "启动"}
                    onClick={() => void changeState(b, b.client_status === "running" || b.client_status === "pending" ? "stop" : "start")}
                  >
                    {b.client_status === "running" || b.client_status === "pending" ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDel(b)} title="删除">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加独立穿透</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>方案</Label>
              <select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={form.scheme_id} onChange={(e) => setForm({ ...form, scheme_id: e.target.value })}>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
              </select>
            </div>
            {needsSubdomain && (
              <div className="space-y-1">
                <Label>子域名</Label>
                <div className="flex items-center gap-1">
                  <Input
                    value={form.subdomain}
                    onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
                    placeholder="app"
                    disabled={missingDomain}
                  />
                  <span className="whitespace-nowrap text-sm text-muted-foreground">.{domain || "?"}</span>
                </div>
                {missingDomain ? (
                  <p className="text-xs text-amber-600">该方案未配置根域名,请先到「内网穿透」页编辑方案补上。</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    公网地址:https://{form.subdomain.trim() || "app"}.{domain}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>本地端口</Label>
                <Input type="number" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} placeholder="8000" />
              </div>
              <div className="space-y-1">
                <Label>本地地址</Label>
                <Input value={form.local_host} onChange={(e) => setForm({ ...form, local_host: e.target.value })} placeholder="127.0.0.1" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="如:线上预览"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">作为代理的名称显示在列表,便于区分用途。</p>
            </div>
            {formError ? <div className="text-sm text-destructive">{formError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={submit} disabled={saving || missingDomain}>{saving ? <Spinner className="mr-2 h-4 w-4" /> : null}创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此穿透绑定?</AlertDialogTitle>
            <AlertDialogDescription>将停止节点上的客户端并回收公网地址。此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner className="mr-2 h-4 w-4" /> : null}删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
