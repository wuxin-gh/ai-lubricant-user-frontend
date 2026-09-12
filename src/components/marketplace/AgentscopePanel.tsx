/**
 * agentscope 技能源同步面板（市场管理 → 配置 → agentscope tab）。
 * agentscope 平台（https://platform.agentscope.io）的技能是公开 API，无需鉴权。
 * 配置与同步信息在同一张卡里，一个 tab 一个保存。
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
import { syncAgentscope, fetchAgentscopeLastSync, type SourceSyncStatus } from "@/api/marketplaceAdmin"
import { INTERVAL_OPTIONS, fmtSyncAt } from "./leaderboard-labels"
import { SyncOverwriteDialog } from "./SyncOverwriteDialog"
import { useSourceSyncPoll } from "./useSourceSyncPoll"
import { toast } from "sonner"

export function AgentscopePanel({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getMarketplaceSourceConfig>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 同步状态由 useSourceSyncPoll 统一管理：running 认后端 _progress.running 真值
  // （刷新后/load 时发现后端在跑也认），按钮禁用、进度条、轮询都由它驱动。
  const { last, setLast, syncing, setSyncing, running } = useSourceSyncPoll<SourceSyncStatus>(
    () => fetchAgentscopeLastSync(),
    (st) => !!st?.progress?.running,
    (st) => {
      if (st.ok === false) toast.error("同步失败", { description: st.detail })
      else if (st.ok === true) { toast.success(st.detail || "同步完成"); onSaved?.() }
    },
  )
  // 打开面板默认展开执行日志（重启后靠 DB 记录也能直接看到最近一次）
  const [showLogs, setShowLogs] = useState(true)
  // 「立即同步」弹框：覆盖策略勾选（与 Agent-Leaderboard 同一套语义）
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [interval, setInterval] = useState(24)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [src, lastSync] = await Promise.all([
        getMarketplaceSourceConfig(),
        fetchAgentscopeLastSync().catch(() => null),
      ])
      setConfig(src)
      setLast(lastSync)
      setEnabled(!!src.agentscope_enabled)
      const iv = src.agentscope_interval_hours || 24
      setInterval(INTERVAL_OPTIONS.some((o) => o.value === iv) ? iv : 24)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载配置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleSync = async (opts: { overwriteDraft: boolean; overwritePublished: boolean }) => {
    setSyncing(true)
    setShowLogs(true)
    setSyncDialogOpen(false)
    try {
      // 后端异步执行：POST 立即返回 {started: true}，不等同步完成
      const res = await syncAgentscope(
        opts.overwritePublished || opts.overwriteDraft
          ? { overwrite_published: opts.overwritePublished, overwrite_draft: opts.overwriteDraft }
          : undefined,
      )
      if (!res.started) {
        toast.error(res.detail || "启动同步失败")
        setSyncing(false)
        return
      }
      // 后端已起任务，_progress.running 马上变 true，轮询 hook 接管实时进度。
      // 立即拉一次，避免等 2s 才显示进度（也覆盖 create_task 还没置 running 的空窗）。
      try { setLast(await fetchAgentscopeLastSync()) } catch { /* 静默，hook 继续轮询 */ }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败")
      setSyncing(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateMarketplaceSourceConfig({
        agentscope_enabled: enabled,
        agentscope_interval_hours: interval,
      })
      toast.success("agentscope 配置已保存")
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
        <CardHeader className="pb-3"><CardTitle className="text-base">agentscope 技能源</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-muted-foreground">仓库 <span className="font-mono text-foreground">platform.agentscope.io</span></span>
              <span className="text-muted-foreground">每 {interval} 小时同步</span>
              {last?.ran_at ? (
                <span className="text-muted-foreground">
                  上次 {fmtSyncAt(last.ran_at)}
                  {last.ok === false ? <span className="text-destructive"> 失败</span> : null}
                  {last.detail ? <span className="ml-1">· {last.detail}</span> : null}
                </span>
              ) : config?.agentscope_last_sync_at ? (
                // 重启后内存没了：回落配置里持久化的上次同步时间
                <span className="text-muted-foreground">
                  上次 {fmtSyncAt(config.agentscope_last_sync_at)}（历史记录）
                </span>
              ) : <span className="text-muted-foreground">尚未同步</span>}
              {/* 同步中：实时进度条（认后端 running 真值，刷新后仍在跑也显示） */}
              {last?.progress?.running ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {last.progress.phase === "fetch_list" ? "拉取列表…"
                      : last.progress.phase === "download" ? `${last.progress.current}/${last.progress.total}`
                      : "准备中…"}
                  </span>
                  {last.progress.total > 0 && last.progress.phase === "download" ? (
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
            <Button size="sm" variant="outline" disabled={syncing || running} onClick={() => setSyncDialogOpen(true)}>
              <RefreshCw className={`mr-1 h-4 w-4 ${syncing || running ? "animate-spin" : ""}`} />
              {syncing || running ? "同步中..." : "立即同步"}
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
                {(syncing || running) ? <Spinner className="ml-auto size-3" /> : null}
              </button>
              {showLogs ? (
                <div className="max-h-64 overflow-y-auto border-t bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5">
                  {last.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground/60">{log.ts.slice(11, 19)}</span>
                      <span className={`shrink-0 ${log.phase === "fail" || log.phase === "error" ? "text-destructive" : log.phase === "done" ? "text-emerald-600" : "text-muted-foreground"}`}>
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
          <Alert><AlertDescription>agentscope 平台的技能是公开 API，无需鉴权。同步时分页拉全量列表，逐个下载 zip，转 skill manifest 落库（category_label→分类，tags→标签）。</AlertDescription></Alert>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用 agentscope 同步
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

      {/* 「立即同步」弹框：覆盖策略勾选（所有内容源共用同一套语义），默认不勾=不覆盖。 */}
      <SyncOverwriteDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onConfirm={(opts) => void handleSync(opts)}
        busy={syncing}
        title="立即同步 agentscope"
      />
    </div>
  )
}
