/**
 * 内容源同步面板（市场管理 → 配置 → agency-agents / agency-agents-zh tab）。
 * 每个源独立 tab：配置与同步信息在同一张卡里，一个 tab 一个保存。
 * 同步时直接拉源→转换→落库，无中间表。
 */
import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Save, ChevronDown, ChevronRight } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { getMarketplaceSourceConfig, updateMarketplaceSourceConfig } from "@/@admin-port/api/globalConfig"
import { syncAgencyAgents, fetchAgencyAgentsLastSync } from "@/api/marketplaceAdmin"
import { INTERVAL_OPTIONS } from "./leaderboard-labels"
import { toast } from "sonner"

export interface AgencyAgentsSourceDef {
  /** 配置键前缀（如 agency_agents / agency_agents_zh） */
  key: string
  title: string
  repo: string
  description: string
  /** true=中文社区源，调用 agency-agents-zh 路由 */
  chinese?: boolean
}

export function AgencyAgentsPanel({ source, onSaved }: { source: AgencyAgentsSourceDef; onSaved?: () => void }) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getMarketplaceSourceConfig>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [last, setLast] = useState<{ ran_at: string; ok: boolean | null; detail: string; progress?: { running: boolean; phase: string; current: number; total: number; current_item: string }; logs?: Array<{ ts: string; phase: string; detail: string }> } | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [interval, setInterval] = useState(24)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [src, lastSync] = await Promise.all([
        getMarketplaceSourceConfig(),
        fetchAgencyAgentsLastSync().catch(() => null),
      ])
      setConfig(src)
      setLast(lastSync)
      const cfg = src as Record<string, unknown>
      setEnabled(!!cfg[`${source.key}_enabled`])
      const iv = Number(cfg[`${source.key}_interval_hours`] || 24)
      setInterval(INTERVAL_OPTIONS.some((o) => o.value === iv) ? iv : 24)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载配置失败")
    } finally {
      setLoading(false)
    }
  }, [source.key])

  useEffect(() => { void load() }, [load])

  const handleSync = async () => {
    setSyncing(true)
    setShowLogs(true)
    try {
      // 同步启动后立即返回——后端在后台跑，前端轮询 last-sync 拿实时进度
      const poll = window.setInterval(async () => {
        try {
          const st = await fetchAgencyAgentsLastSync()
          setLast(st)
          if (!st.progress?.running) window.clearInterval(poll)
        } catch { /* 轮询失败静默 */ }
      }, 2000)
      try {
        const report = await syncAgencyAgents({
          ref: undefined,
          dryRun: false,
          chinese: source.chinese,
        })
        // 同步接口返回时（同步已完成），最后拉一次状态
        const st = await fetchAgencyAgentsLastSync().catch(() => null)
        setLast(st)
        toast.success(report.detail || `同步 ${report.converted} 条`)
        onSaved?.()
      } finally {
        window.clearInterval(poll)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败")
    } finally {
      setSyncing(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateMarketplaceSourceConfig({
        [`${source.key}_enabled`]: enabled,
        [`${source.key}_interval_hours`]: interval,
      })
      toast.success(`${source.title} 配置已保存`)
      await load()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-base">{source.title} 提示词源</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* 同步信息与配置合并在同一卡片 */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-muted-foreground">仓库 <span className="font-mono text-foreground">{source.repo}</span></span>
              <span className="text-muted-foreground">每 {interval} 小时同步</span>
              {last?.ran_at ? (
                <span className="text-muted-foreground">
                  上次 {last.ran_at}
                  {last.ok === false ? <span className="text-destructive"> 失败</span> : last.ok ? <span className="text-emerald-600"> 成功</span> : null}
                  {last.detail ? <span className="ml-1">· {last.detail}</span> : null}
                </span>
              ) : <span className="text-muted-foreground">尚未同步</span>}
              {/* 同步中：实时进度条 */}
              {syncing && last?.progress?.running ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {last.progress.phase === "fetch" ? "拉取源…"
                      : last.progress.phase === "convert" ? "转换中…"
                      : last.progress.total > 0 ? `${last.progress.current}/${last.progress.total}` : "准备中…"}
                  </span>
                  {last.progress.total > 0 && last.progress.phase === "upsert" ? (
                    <>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full bg-primary transition-all" style={{ width: `${Math.round((last.progress.current / last.progress.total) * 100)}%` }} />
                      </span>
                      {last.progress.current_item ? <span className="font-mono text-muted-foreground">{last.progress.current_item}</span> : null}
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleSync()}>
              <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "同步中..." : "立即同步"}
            </Button>
          </div>
          {/* 执行日志：折叠面板 */}
          {last?.logs && last.logs.length > 0 ? (
            <div className="rounded-md border">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
                onClick={() => setShowLogs((v) => !v)}
              >
                {showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                执行日志（{last.logs.length} 条）
                {syncing ? <Spinner className="ml-auto size-3" /> : null}
              </button>
              {showLogs ? (
                <div className="max-h-64 overflow-y-auto border-t bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5">
                  {last.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground/60">{log.ts.slice(11, 19)}</span>
                      <span className={`shrink-0 ${log.phase === "fail" || log.phase === "error" || log.phase === "upsert_fail" ? "text-destructive" : log.phase === "done" ? "text-emerald-600" : "text-muted-foreground"}`}>
                        [{log.phase}]
                      </span>
                      <span className="min-w-0 break-all">{log.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <Separator />
          <Alert><AlertDescription>{source.description}</AlertDescription></Alert>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用 {source.title} 同步
          </label>
          <div>
            <Label>同步间隔</Label>
            <NativeSelect value={String(interval)} onChange={(e) => setInterval(Number(e.target.value))} disabled={!enabled}>
              {INTERVAL_OPTIONS.map((o) => <NativeSelectOption key={o.value} value={String(o.value)}>{o.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 h-4 w-4" />}保存配置
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
