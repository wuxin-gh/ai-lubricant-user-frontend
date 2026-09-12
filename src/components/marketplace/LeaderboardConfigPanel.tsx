/**
 * Agent-Leaderboard 外部榜单同步配置面板（市场管理 → 配置 → Agent-Leaderboard tab）。
 *
 * 简化：不再配仓库地址/榜单类型/专用 agent——仓库用内置默认，全量 board 同步。
 * 同步信息与配置在同一张卡里（同步是配置的直接结果，拆成两张卡读起来割裂）。
 * 一个 tab 一个保存：只发 leaderboard_* 字段。
 *
 * 「立即同步」是后台异步任务：POST 立即返回，前端轮询 status 端点拿实时进度与
 * 执行日志；已在跑时后端 409，toast 提示「已有同步在运行中」。重启后内存进度
 * 没了——status 端点内部回落 DB 执行记录，面板仍显示最近一次的日志与时间。
 */
import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, RefreshCw, Save, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { SyncOverwriteDialog } from "./SyncOverwriteDialog"
import { getMarketplaceSourceConfig, getProxyPoolTabConfig, updateMarketplaceSourceConfig } from "@/@admin-port/api/globalConfig"
import type { ProxyEntry } from "@/@admin-port/api/proxyPool"
import {
  fetchLeaderboardStatus,
  purgeLeaderboardItems,
  triggerLeaderboardSync,
  type LeaderboardStatus,
} from "@/api/marketplaceAdmin"
import { INTERVAL_OPTIONS, fmtSyncAt } from "./leaderboard-labels"
import { useSourceSyncPoll } from "./useSourceSyncPoll"
import { toast } from "sonner"

export function LeaderboardConfigPanel({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getMarketplaceSourceConfig>> | null>(null)
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 同步状态由 useSourceSyncPoll 统一管理：running 认后端 _progress.running 真值
  // （刷新后/load 时发现后端在跑也认），按钮禁用、进度条、轮询都由它驱动。
  const { last: syncStatus, setLast: setSyncStatus, syncing, setSyncing, running } = useSourceSyncPoll<LeaderboardStatus>(
    () => fetchLeaderboardStatus(),
    (st) => !!st?.last_sync?.progress?.running,
    (st) => {
      const ls = st.last_sync
      if (ls?.ok === false) toast.error("同步失败", { description: ls.detail })
      else if (ls?.ok === true) { toast.success(ls.detail || "同步完成，新条目已进候选池（草稿）"); onSaved?.() }
    },
  )
  const [purging, setPurging] = useState(false)
  // 打开面板默认展开执行日志（重启后靠 DB 记录也能直接看到最近一次）
  const [showLogs, setShowLogs] = useState(true)

  // 「立即同步」弹框：覆盖策略勾选（状态与复位都在弹框组件内部）
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)

  const [enabled, setEnabled] = useState(false)
  const [interval, setInterval] = useState(24)
  const [requireVerified, setRequireVerified] = useState(false)
  const [proxyId, setProxyId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [source, status, proxyResp] = await Promise.all([
        getMarketplaceSourceConfig(),
        fetchLeaderboardStatus().catch(() => null),
        getProxyPoolTabConfig().catch(() => ({ proxies: [] as ProxyEntry[] })),
      ])
      setConfig(source)
      setSyncStatus(status)
      setProxies(proxyResp.proxies || [])
      setEnabled(!!source.leaderboard_sync_enabled)
      const iv = source.leaderboard_sync_interval_hours || 24
      setInterval(INTERVAL_OPTIONS.some((o) => o.value === iv) ? iv : 24)
      setRequireVerified(!!source.leaderboard_require_verified)
      setProxyId(source.leaderboard_proxy_id || "")
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
    // 关闭弹框（勾选复位由弹框组件在关闭时自清）
    setSyncDialogOpen(false)
    try {
      // 后台异步执行：POST 立即返回 {started: true}；已在跑 → 后端 409（toast 显示）
      const res = await triggerLeaderboardSync(
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
      try { setSyncStatus(await fetchLeaderboardStatus()) } catch { /* 静默，hook 继续轮询 */ }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "启动同步失败")
      setSyncing(false)
    }
  }

  const handlePurge = async () => {
    if (!confirm("清空整个候选池？已发布条目也会删除，用户侧立即不可见。清空后重新同步会按新模型 + 探针重新派生。")) return
    setPurging(true)
    try {
      const result = await purgeLeaderboardItems()
      toast.success(result.detail || `已清空 ${result.purged} 条`)
      const st = await fetchLeaderboardStatus().catch(() => null)
      setSyncStatus(st)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败")
    } finally {
      setPurging(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateMarketplaceSourceConfig({
        leaderboard_sync_enabled: enabled,
        leaderboard_sync_interval_hours: interval,
        leaderboard_require_verified: requireVerified,
        leaderboard_proxy_id: proxyId,
      })
      toast.success("外部榜单同步配置已保存")
      await load()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>
  }

  const notConfigured = syncStatus !== null && !syncStatus.configured
  const repo = config?.default_leaderboard_repo || "jaychempan/Agent-Leaderboard"
  const lastSync = syncStatus?.last_sync
  const progress = lastSync?.progress

  return (
    <div className="space-y-4">
      {/* 配置 + 同步信息同一张卡：同步是配置的直接结果 */}
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent-Leaderboard 榜单同步</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 同步信息行 */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {notConfigured ? (
                <span className="text-amber-600">同步未启用——在下方打开并保存后才会抓外部榜单</span>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    仓库 <span className="font-mono text-foreground">{syncStatus?.repo || repo}</span>
                  </span>
                  <span className="text-muted-foreground">每 {syncStatus?.interval_hours ?? interval} 小时</span>
                  <span className="text-muted-foreground">草稿池 {syncStatus?.draft_count ?? 0} 条</span>
                  <span className="text-muted-foreground">已发布 {syncStatus?.published_count ?? 0} 条</span>
                  {lastSync?.ran_at ? (
                    <span className="text-muted-foreground">
                      上次 {fmtSyncAt(lastSync.ran_at)}
                      {lastSync.ok === false ? <span className="text-destructive"> 失败</span> : null}
                      {lastSync.detail ? <span className="ml-1">· {lastSync.detail}</span> : null}
                    </span>
                  ) : config?.leaderboard_last_sync_at ? (
                    // 重启后内存没了：回落配置里持久化的上次同步时间
                    <span className="text-muted-foreground">
                      上次 {fmtSyncAt(config.leaderboard_last_sync_at)}（历史记录）
                    </span>
                  ) : null}
                  {/* 同步中：实时进度（认后端 running 真值，刷新后仍在跑也显示） */}
                  {progress?.running ? (
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        {progress.phase === "fetch" ? "拉取榜单文件…"
                          : progress.phase === "upsert" && progress.total > 0
                            ? `${progress.current}/${progress.total}`
                            : "准备中…"}
                      </span>
                      {progress.phase === "upsert" && progress.total > 0 ? (
                        <>
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full bg-primary transition-all" style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
                          </span>
                          {progress.current_item ? <span className="font-mono text-muted-foreground">{progress.current_item}</span> : null}
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </>
              )}
            </div>
            <Button size="sm" variant="outline" disabled={syncing || running} onClick={() => setSyncDialogOpen(true)}>
              <RefreshCw className={`mr-1 h-4 w-4 ${syncing || running ? "animate-spin" : ""}`} />
              {syncing || running ? "同步中..." : "立即同步"}
            </Button>
          </div>

          {/* 执行日志：折叠面板（默认展开；重启后回落 DB 记录仍有最近一份） */}
          {lastSync?.logs && lastSync.logs.length > 0 ? (
            <div className="rounded-md border">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
                onClick={() => setShowLogs((v) => !v)}
              >
                {showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                执行日志（{lastSync.logs.length} 条）
                {(syncing || running) ? <Spinner className="ml-auto size-3" /> : null}
              </button>
              {showLogs ? (
                <div className="max-h-64 overflow-y-auto border-t bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5">
                  {lastSync.logs.map((log: { ts: string; phase: string; detail: string }, i: number) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground/60">{log.ts.slice(11, 19)}</span>
                      <span className={`shrink-0 ${["fail", "error"].includes(log.phase) ? "text-destructive" : log.phase === "done" ? "text-emerald-600" : "text-muted-foreground"}`}>
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

          {/* 配置项 */}
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用外部榜单同步（每 {interval} 小时自动执行）
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>仓库（内置默认，不可改）</Label>
              <p className="mt-1.5 font-mono text-sm text-muted-foreground">{repo}</p>
            </div>
            <div>
              <Label>同步间隔</Label>
              <NativeSelect value={String(interval)} onChange={(e) => setInterval(Number(e.target.value))} disabled={!enabled}>
                {INTERVAL_OPTIONS.map((o) => (
                  <NativeSelectOption key={o.value} value={String(o.value)}>{o.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label>出网代理</Label>
              <NativeSelect value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                <NativeSelectOption value="">跟随全局代理（未配全局则直连）</NativeSelectOption>
                {proxies.map((proxy) => (
                  <NativeSelectOption key={proxy.id} value={proxy.id}>{proxy.name || proxy.id}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={requireVerified} onCheckedChange={(v) => setRequireVerified(v === true)} />
            <span>
              发布前要求 MCP 启动方式验证通过（verified）
              <span className="block text-xs text-muted-foreground">
                默认关（软门禁）：MCP 可安装条目发布要求启动方式至少已补（filled）；开启后升级为硬门禁，必须握手验证通过才能发布。
              </span>
            </span>
          </label>

          <Separator />

          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 h-4 w-4" />}保存配置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 清空候选池：旧模型数据与新设计不匹配时用。破坏性，二次确认。 */}
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs leading-4">
            候选池里的旧数据可能是按旧模型同步的（无探针、单对象 install_spec、旧覆盖机制）。
            清空后重新同步会按新模型 + 确定性探针重新派生 install_spec/launch_spec 与分类。
            <strong className="ml-1">已发布条目会一并删除，用户侧立即不可见。</strong>
          </span>
          <Button size="sm" variant="destructive" disabled={purging} onClick={() => void handlePurge()}>
            {purging ? <Spinner className="mr-2 size-4" /> : <Trash2 className="mr-1 h-4 w-4" />}
            清空候选池
          </Button>
        </AlertDescription>
      </Alert>

      {/* 「立即同步」弹框：覆盖策略勾选（所有内容源共用同一套语义），默认不勾=不覆盖。 */}
      <SyncOverwriteDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onConfirm={(opts) => void handleSync(opts)}
        busy={syncing}
        title="立即同步外部榜单"
      />
    </div>
  )
}
