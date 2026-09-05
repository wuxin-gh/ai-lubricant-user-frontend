/** 项目详情 — 穿透配置 tab。绑定不挂任务/会话,只挂项目 + 节点。 */
import { useEffect, useState } from "react"
import { ExternalLink, Plus, Trash2, Play, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { createProjectTunnel, deleteProjectTunnel, listProjectTunnels, listTunnelSchemes, startTunnel, stopTunnel } from "@/api/tunnelClient"
import type { TunnelBinding, TunnelScheme } from "@/api/tunnelClient"
import type { NodeInfo } from "@/api/nodes"

const STATUS: Record<string, string> = { running: "运行中", pending: "启动中", failed: "失败", stopped: "已停止" }

/** cloudflared managed 方案:公网地址 = 绑定填的子域名 + 方案根域名。 */
function isManagedCloudflared(scheme: TunnelScheme | undefined): boolean {
  return scheme?.kind === "cloudflared" && scheme.config?.mode === "managed"
}

function schemeDomain(scheme: TunnelScheme | undefined): string {
  return String(scheme?.config?.domain || "")
}

export default function ProjectTunnelsTab({ projectId, nodes }: { projectId: string; nodes: NodeInfo[] }) {
  const [bindings, setBindings] = useState<TunnelBinding[]>([])
  const [schemes, setSchemes] = useState<TunnelScheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ scheme_id: "", local_port: "", local_host: "127.0.0.1", subdomain: "", description: "" })
  const [remove, setRemove] = useState<TunnelBinding | null>(null)
  const [removing, setRemoving] = useState(false)

  const selectedScheme = schemes.find((s) => s.id === form.scheme_id)
  const needsSubdomain = isManagedCloudflared(selectedScheme)
  const domain = schemeDomain(selectedScheme)
  const missingDomain = needsSubdomain && !domain

  const reload = async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const [bs, ss] = await Promise.all([listProjectTunnels(projectId), listTunnelSchemes()])
      setBindings(bs); setSchemes(ss.filter((s) => s.enabled))
    } catch (e) { if (!silent) setError(e instanceof Error ? e.message : "加载项目穿透失败") }
    finally { if (!silent) setLoading(false) }
  }
  useEffect(() => { void reload() }, [projectId])

  // 有 pending 绑定时 3s 轮询,地址/状态(启动中→运行中/失败)自动刷新;全部落定后停。
  const hasPending = bindings.some((b) => b.client_status === "pending")
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => { void reload(true) }, 3000)
    return () => clearInterval(timer)
  }, [hasPending, projectId])

  const openAdd = () => {
    setForm({ scheme_id: schemes[0]?.id || "", local_port: "", local_host: "127.0.0.1", subdomain: "", description: "" })
    setFormError(null); setOpen(true)
  }
  const submit = async () => {
    const port = Number(form.local_port)
    if (!form.scheme_id) { setFormError("请选择方案"); return }
    if (!port || port < 1 || port > 65535) { setFormError("本地端口需为 1-65535"); return }
    if (missingDomain) { setFormError("该方案未配置根域名,请先到管理端编辑方案"); return }
    if (needsSubdomain && !form.subdomain.trim()) { setFormError("请填写子域名"); return }
    setSaving(true); setFormError(null)
    try {
      // 不传 node_id:后端解析为该项目运行中任务占据的节点。
      await createProjectTunnel(projectId, {
        scheme_id: form.scheme_id,
        local_port: port,
        local_host: form.local_host || "127.0.0.1",
        ...(needsSubdomain ? { subdomain: form.subdomain.trim() } : {}),
        description: form.description.trim() || undefined,
      })
      toast.success("项目穿透已创建"); setOpen(false); await reload()
    } catch (e) { setFormError(e instanceof Error ? e.message : "创建失败") }
    finally { setSaving(false) }
  }
  const changeState = async (binding: TunnelBinding, action: "start" | "stop") => {
    try {
      await (action === "start" ? startTunnel(binding.id) : stopTunnel(binding.id))
      toast.success(action === "start" ? "已启动" : "已停止"); await reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : "操作失败") }
  }
  const deleteBinding = async () => {
    if (!remove) return
    setRemoving(true)
    try { await deleteProjectTunnel(projectId, remove.id); toast.success("已删除"); setRemove(null); await reload() }
    catch (e) { toast.error(e instanceof Error ? e.message : "删除失败") }
    finally { setRemoving(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (error) return <div className="py-4 text-center text-sm text-destructive">{error}</div>
  return <div className="space-y-3 min-h-0 overflow-y-auto">
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">选择方案与本地端口即可,穿透会落在项目当前运行任务所在的节点。</p>
      <Button size="sm" onClick={openAdd} disabled={!schemes.length}><Plus className="mr-1 h-4 w-4" />添加穿透</Button>
    </div>
    {!schemes.length && <p className="text-xs text-amber-600">请先在管理端配置启用的穿透方案。</p>}
    {bindings.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">本项目暂无穿透。</p> : <div className="divide-y rounded border">
      {bindings.map((b) => {
        const running = b.client_status === "running" || b.client_status === "pending"
        const nodeLabel = b.node_id === "__main__" ? "主服务" : (nodes.find((n) => n.node_id === b.node_id)?.node_name || b.node_id)
        // 备注即名称;没填备注回退方案名。host:port 固定在摘要行,不进名称位。
        const note = (b.description || "").trim()
        const sname = schemes.find((s) => s.id === b.scheme_id)?.name || b.scheme_id
        return <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0"><div className="truncate text-sm font-medium">{note || sname}</div><div className="truncate text-xs text-muted-foreground">{note ? `${sname} · ` : ""}节点 {nodeLabel} · {b.local_host}:{b.local_port} · {b.public_addr ? <a className="inline-flex items-center gap-1 text-blue-600 hover:underline" target="_blank" rel="noreferrer" href={b.public_addr.startsWith("http") ? b.public_addr : `http://${b.public_addr}`}>{b.public_addr}<ExternalLink className="h-3 w-3" /></a> : "地址生成中…"}</div>{b.client_status === "failed" && b.error ? <div className="truncate text-xs text-destructive" title={b.error}>{b.error}</div> : null}</div>
          <div className="flex items-center gap-1"><Badge variant="outline">{STATUS[b.client_status] || b.client_status}</Badge><Button variant="ghost" size="icon" title={running ? "停止" : "启动"} onClick={() => void changeState(b, running ? "stop" : "start")}>{running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button><Button variant="ghost" size="icon" onClick={() => setRemove(b)}><Trash2 className="h-4 w-4" /></Button></div>
        </div>
      })}
    </div>}

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>添加项目穿透</DialogTitle></DialogHeader><div className="space-y-3 py-2">
      <div className="space-y-1"><Label>方案</Label><select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={form.scheme_id} onChange={(e) => setForm({ ...form, scheme_id: e.target.value })}>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}</select></div>
      {needsSubdomain && <div className="space-y-1"><Label>子域名</Label><div className="flex items-center gap-1"><Input value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} placeholder="app" disabled={missingDomain} /><span className="whitespace-nowrap text-sm text-muted-foreground">.{domain || "?"}</span></div>{missingDomain ? <p className="text-xs text-amber-600">该方案未配置根域名,请先到管理端「内网穿透」页编辑方案。</p> : <p className="text-xs text-muted-foreground">公网地址:https://{form.subdomain.trim() || "app"}.{domain}</p>}</div>}
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>本地端口</Label><Input type="number" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} placeholder="8000" /></div><div className="space-y-1"><Label>本地地址</Label><Input value={form.local_host} onChange={(e) => setForm({ ...form, local_host: e.target.value })} /></div></div>
      <p className="text-xs text-muted-foreground">穿透会落在项目当前运行任务所在的节点;若项目没有运行中的任务,创建会失败。</p>
      <div className="space-y-1"><Label>备注</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="如:线上预览" rows={2} /><p className="text-xs text-muted-foreground">作为代理的名称显示在列表,便于区分用途。</p></div>
      {formError && <div className="text-sm text-destructive">{formError}</div>}
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>取消</Button><Button onClick={submit} disabled={saving || missingDomain}>{saving && <Spinner className="mr-2 h-4 w-4" />}创建</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={(o) => !o && setRemove(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除项目穿透?</AlertDialogTitle><AlertDialogDescription>会停止节点上的客户端并回收这条绑定。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={removing}>取消</AlertDialogCancel><AlertDialogAction onClick={deleteBinding} disabled={removing}>{removing && <Spinner className="mr-2 h-4 w-4" />}删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
