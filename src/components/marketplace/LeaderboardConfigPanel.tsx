/**
 * Agent-Leaderboard 外部榜单同步配置面板（市场管理 → 配置 → Agent-Leaderboard tab）。
 *
 * 简化：不再配仓库地址/榜单类型/专用 agent——仓库用内置默认，全量 board 同步。
 * 同步信息与配置在同一张卡里（同步是配置的直接结果，拆成两张卡读起来割裂）。
 * 一个 tab 一个保存：只发 leaderboard_* 字段。
 */
import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Save, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { getMarketplaceSourceConfig, updateMarketplaceSourceConfig } from "@/@admin-port/api/globalConfig"
import {
  fetchLeaderboardStatus,
  purgeLeaderboardItems,
  triggerLeaderboardSync,
  type LeaderboardStatus,
} from "@/api/marketplaceAdmin"
import { INTERVAL_OPTIONS } from "./leaderboard-labels"
import { toast } from "sonner"

export function LeaderboardConfigPanel({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getMarketplaceSourceConfig>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncStatus, setSyncStatus] = useState<LeaderboardStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [purging, setPurging] = useState(false)

  const [enabled, setEnabled] = useState(false)
  const [interval, setInterval] = useState(24)
  const [requireVerified, setRequireVerified] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [source, status] = await Promise.all([
        getMarketplaceSourceConfig(),
        fetchLeaderboardStatus().catch(() => null),
      ])
      setConfig(source)
      setSyncStatus(status)
      setEnabled(!!source.leaderboard_sync_enabled)
      const iv = source.leaderboard_sync_interval_hours || 24
      setInterval(INTERVAL_OPTIONS.some((o) => o.value === iv) ? iv : 24)
      setRequireVerified(!!source.leaderboard_require_verified)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载配置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await triggerLeaderboardSync()
      toast.success("同步完成，新条目已进候选池（草稿）")
      const st = await fetchLeaderboardStatus().catch(() => null)
      setSyncStatus(st)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败")
    } finally {
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
                  {syncStatus?.last_sync?.ran_at ? (
                    <span className="text-muted-foreground">
                      上次 {syncStatus.last_sync.ran_at}
                      {syncStatus.last_sync.ok === false ? <span className="text-destructive"> 失败</span> : null}
                      {syncStatus.last_sync.detail ? <span className="ml-1">· {syncStatus.last_sync.detail}</span> : null}
                    </span>
                  ) : null}
                </>
              )}
            </div>
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleSync()}>
              <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "同步中..." : "立即同步"}
            </Button>
          </div>

          <Separator />

          {/* 配置项 */}
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用外部榜单同步
          </label>

          <div className="grid gap-4 md:grid-cols-2">
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
    </div>
  )
}
