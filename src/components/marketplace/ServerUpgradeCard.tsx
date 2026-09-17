import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2, RefreshCw, Server } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { toast } from "sonner"
import {
  getServerReleaseStatus,
  upgradeServerRelease,
  type ServerReleaseStatus,
  type ServerUpgradePhase,
} from "@/api/marketplaceAdmin"
import { getProxies, type ProxyEntry } from "@/@admin-port/api/proxyPool"
import { copyToClipboard } from "@/utils/clipboard"

/** 进行中的 phase：处于这些状态时卡片轮询 + 禁用按钮。 */
const INFLIGHT: ServerUpgradePhase[] = ["requested", "pulling", "installing", "restarting", "verifying"]

const PHASE_LABEL: Record<ServerUpgradePhase, string> = {
  idle: "空闲",
  requested: "已请求，等待执行",
  pulling: "拉取代码中…",
  installing: "安装依赖 / 构建镜像中…",
  restarting: "重启服务中…",
  verifying: "健康检查中…",
  done: "升级完成",
  failed: "升级失败",
}

/**
 * 服务端升级卡片（市场管理 → 服务端 tab）。
 *
 * 展示「当前运行版本 vs 已登记最新版本」，有新版本时给升级按钮。确认后服务端
 * 后台 clone 该 tag 到 releases/ 并写标记文件，宿主侧 systemd path unit 立即
 * 触发 updater 执行（装依赖 → 翻 current 指针 → 顺序重启 → 健康验证 → 失败回切）。
 *
 * 前端只负责触发 + 轮询 phase；真正的执行在宿主侧独立进程里（web 进程不能重启
 * 自己——systemd 停服务会按 cgroup 杀掉它 spawn 的一切后代）。
 */
export function ServerUpgradeCard() {
  const [status, setStatus] = useState<ServerReleaseStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [proxyId, setProxyId] = useState("")
  const [starting, setStarting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setStatus(await getServerReleaseStatus())
    } catch (err) {
      if (!silent) toast.error(`读取服务端版本状态失败：${String(err)}`)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 进行中才轮询（2s）；到终态自动停——空闲时零请求
  useEffect(() => {
    const inflight = !!status && INFLIGHT.includes(status.phase)
    if (inflight && !timerRef.current) {
      timerRef.current = setInterval(() => void load(true), 2000)
    } else if (!inflight && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [status, load])

  async function openDialog() {
    setDialogOpen(true)
    try {
      setProxies((await getProxies()) || [])
    } catch {
      setProxies([])
    }
  }

  async function confirmUpgrade() {
    if (!status?.release_tag) return
    setStarting(true)
    try {
      await upgradeServerRelease(status.release_tag, proxyId)
      toast.success(`已接受升级到 ${status.release_tag}，正在拉取代码…`)
      setDialogOpen(false)
      void load(true)
    } catch (err) {
      toast.error(`无法开始升级：${String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const inflight = !!status && INFLIGHT.includes(status.phase)
  const current = status?.current || "dev"
  const latest = status?.latest || ""

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">服务端版本</span>
            {status?.needs_upgrade && !inflight && (
              <Badge variant="destructive">有新版本</Badge>
            )}
            {inflight && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {PHASE_LABEL[status!.phase]}
              </Badge>
            )}
            {status?.phase === "done" && !inflight && (
              <Badge variant="outline" className="gap-1 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />升级完成
              </Badge>
            )}
            {status?.phase === "failed" && !inflight && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />上次升级失败
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            当前运行 <span className="font-mono text-foreground">{current}</span>
            {latest && (
              <>
                {" · "}已登记最新 <span className="font-mono text-foreground">{latest}</span>
              </>
            )}
            {!latest && " · 尚未登记任何版本"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            disabled={!status?.needs_upgrade || inflight}
            onClick={() => void openDialog()}
          >
            <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
            升级到 {latest || "…"}
          </Button>
        </div>
      </div>

      {status?.error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-1">
          <p className="text-destructive">{status.error}</p>
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={() => void copyToClipboard("/opt/ai-lubricant/shared/logs/upgrade.log")}
          >
            复制日志路径
          </button>
        </div>
      )}

      {status?.version_notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-2">
          {status.version_notes}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>升级服务端到 {latest}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <p>
                将从 <span className="font-mono">{current}</span> 升级到{" "}
                <span className="font-mono">{latest}</span>。
              </p>
              <p className="text-muted-foreground text-xs">
                流程：拉取代码 → 安装依赖 → 切换版本 → 顺序重启服务 → 健康检查。
                任一步失败会自动回切到当前版本。升级期间服务会短暂中断。
              </p>
            </div>

            {proxies.length > 0 && (
              <div className="space-y-2">
                <Label>拉取代码所用代理</Label>
                <NativeSelect value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                  <NativeSelectOption value="">直连</NativeSelectOption>
                  {proxies.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>{p.name || p.id}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={() => void confirmUpgrade()} disabled={starting}>
                {starting ? "提交中…" : "确认升级"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
