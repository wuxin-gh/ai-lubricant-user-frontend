/**
 * 数据仪表盘（平台管理页）。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/*`（纯 axios）。
 * 图表委托同目录的 shadcn + recharts 版 UsageChart（./UsageCharts）。
 * 保留原有全部指标、序列、排行榜与交互（渠道/APIKey/模型筛选、图表类型、单位、时间范围、刷新）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Clock,
  ChartColumn,
  ChartLine,
  Zap,
  Database,
  Star,
  CloudUpload,
  CloudDownload,
  Percent,
  Check,
  X,
  Lightbulb,
} from 'lucide-react'
import { AdminPage } from '@/components/manager/platform-page'
import { ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getDashboardStats } from '@/@admin-port/api/dashboard'
import { getProviders } from '@/@admin-port/api/providers'
import { getApiKeys } from '@/@admin-port/api/apiKeys'
import type { ApiKey, DashboardRankingItem, DashboardStats, ProviderLite } from '@/@admin-port/types/admin'
import { cn } from '@/lib/utils'
import { UsageChart } from './UsageCharts'
import {
  type ChartType,
  datetimeToUnix,
  formatDuration,
  formatPercent,
  formatTokenWithUnit,
  formatTokenScaled,
  type TimeUnit,
  autoGrain,
  presetToRange,
  rangeLabel,
} from '@/@admin-port/pages/shared/chartUtils'

interface QueryFilters {
  start: string
  end: string
  grain: 'hour' | 'day' | 'week'
  provider: string
  apiKey: string
  model: string
}

const PRESET_KEYS = ['today', '1d', '7d', '14d', '30d', '90d'] as const
type PresetKey = (typeof PRESET_KEYS)[number] | 'custom'

// Radix Select 不允许空字符串作为 value，用哨兵值表示「全部/清空」。
const ALL = '__all__'

function defaultFilters(): QueryFilters {
  const { start, end } = presetToRange('today')
  return { start, end, grain: autoGrain(start, end), provider: '', apiKey: '', model: '' }
}

function getSelectedPreset(start: string, end: string): PresetKey {
  for (const key of PRESET_KEYS) {
    const preset = presetToRange(key)
    if (preset.start === start && preset.end === end) return key
  }
  return 'custom'
}

function MetricTile({
  icon,
  iconColor,
  label,
  value,
  extra,
  inlineValue,
  valueColor,
}: {
  icon: ReactNode
  iconColor: string
  label: ReactNode
  value: ReactNode
  extra?: ReactNode
  inlineValue?: boolean
  valueColor?: string
}) {
  return (
    <Card size="sm" className="h-full shadow-none">
      <CardContent className="flex h-full flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center justify-between gap-2 leading-none">
          <span className="flex items-center gap-1.5">
            <span style={{ color: iconColor }} className="inline-flex items-center [&_svg]:size-3.5">{icon}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </span>
          {inlineValue ? (
            <span className="text-base font-semibold whitespace-nowrap" style={{ color: valueColor }}>{value}</span>
          ) : null}
        </div>
        {inlineValue ? null : (
          <div className="flex flex-1 items-center overflow-hidden text-lg font-semibold leading-tight whitespace-nowrap">
            <span className="truncate" style={{ color: valueColor }}>{value}</span>
          </div>
        )}
        {extra ? <div className="min-h-3">{extra}</div> : null}
      </CardContent>
    </Card>
  )
}

type RankingMetric = 'tokens' | 'requests' | 'success_rate' | 'failure_rate' | 'avg_duration_ms' | 'cache_hit_rate'

function rankingValueOf(row: DashboardRankingItem, metric: RankingMetric, timeUnit: TimeUnit): string {
  if (metric === 'tokens') return formatTokenScaled(row.tokens ?? 0, timeUnit)
  if (metric === 'requests') return Number(row.success_requests ?? row.requests ?? 0).toLocaleString('zh-CN')
  if (metric === 'success_rate') return formatPercent(row.success_rate ?? 0)
  if (metric === 'failure_rate') return formatPercent(row.failure_rate ?? 0)
  if (metric === 'avg_duration_ms') return formatDuration(row.avg_duration_ms ?? 0)
  return formatPercent(row.cache_hit_rate ?? 0)
}

function RankingTable({
  title,
  rows,
  metric,
  timeUnit,
  nameOf,
  compact,
}: {
  title: string
  rows?: DashboardRankingItem[]
  metric: RankingMetric
  timeUnit: TimeUnit
  nameOf?: (name: string) => string
  compact?: boolean
}) {
  const data = (rows ?? []).map((row) => ({ ...row, displayName: nameOf ? nameOf(row.name) : row.name }))
  // 成功率/失败率/响应时间/缓存命中率：数值本身就是占比或派生指标，不再额外显示"占比"列。
  const showShare = metric === 'tokens' || metric === 'requests'
  const shareOf = (row: DashboardRankingItem) => (metric === 'requests' ? row.request_share ?? 0 : row.token_share ?? 0)
  const valueColumnTitle =
    metric === 'tokens' ? '总tokens'
    : metric === 'requests' ? '成功请求数'
    : metric === 'success_rate' ? '成功率'
    : metric === 'failure_rate' ? '失败率'
    : metric === 'avg_duration_ms' ? '平均响应'
    : '命中率'
  const showRequestsCol = metric === 'avg_duration_ms' || metric === 'success_rate' || metric === 'failure_rate'
  const showInputTokensCol = metric === 'cache_hit_rate'
  // 响应最快榜的均值已过滤失败请求，请求数展示同口径的成功请求数；成功率/失败率榜展示尝试级请求数。
  const requestsColValue = (row: DashboardRankingItem) =>
    metric === 'avg_duration_ms'
      ? Number(row.success_requests ?? row.requests ?? 0).toLocaleString('zh-CN')
      : Number(row.requests ?? 0).toLocaleString('zh-CN')

  return (
    <Card size="sm" className="shadow-none">
      <CardContent className={compact ? 'px-2 py-2' : 'px-3 py-3'}>
        <div className="mb-2 text-sm font-medium">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[42px]">#</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-[110px] text-right">{valueColumnTitle}</TableHead>
              {showRequestsCol ? <TableHead className="w-[90px] text-right">请求数</TableHead> : null}
              {showInputTokensCol ? <TableHead className="w-[110px] text-right">输入tokens</TableHead> : null}
              {showShare ? <TableHead className="w-[120px]">占比</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3 + (showRequestsCol ? 1 : 0) + (showInputTokensCol ? 1 : 0) + (showShare ? 1 : 0)} className="h-16 text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, index) => (
                <TableRow key={row.name}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="max-w-0 truncate" title={row.displayName}>{row.displayName}</TableCell>
                  <TableCell className="text-right">{rankingValueOf(row, metric, timeUnit)}</TableCell>
                  {showRequestsCol ? <TableCell className="text-right">{requestsColValue(row)}</TableCell> : null}
                  {showInputTokensCol ? <TableCell className="text-right">{formatTokenScaled(row.prompt_tokens ?? 0, timeUnit)}</TableCell> : null}
                  {showShare ? (
                    <TableCell>
                      <div className="flex w-full flex-col gap-1">
                        <span className="text-xs">{formatPercent(shareOf(row))}</span>
                        <Progress value={shareOf(row) * 100} className="h-1.5" />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

const RANK_MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#d97706']

function MiniRanking({
  title,
  icon,
  iconColor,
  rows,
  metric,
  timeUnit,
  nameOf,
  className,
}: {
  title: string
  icon?: ReactNode
  iconColor?: string
  rows?: DashboardRankingItem[]
  metric: RankingMetric
  timeUnit: TimeUnit
  nameOf?: (name: string) => string
  className?: string
}) {
  const data = (rows ?? []).slice(0, 3)
  // 仅使用量/请求次数榜显示占比；其它派生指标本身即占比，不再叠加。
  const showShare = metric === 'tokens' || metric === 'requests'
  const shareOf = (row: DashboardRankingItem) => (metric === 'requests' ? row.request_share ?? 0 : row.token_share ?? 0)
  return (
    <Card size="sm" className={cn('shadow-none', className)}>
      <CardContent className="flex h-full flex-col px-3 py-2">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          {icon ? <span style={{ color: iconColor }} className="inline-flex items-center [&_svg]:size-4">{icon}</span> : null}
          <span>{title}</span>
        </div>
        {data.length === 0 ? (
          <span className="text-xs text-muted-foreground">暂无数据</span>
        ) : (
          <div className="flex flex-1 flex-col justify-around gap-1">
            {data.map((row, index) => (
              <div key={row.name} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="shrink-0 font-bold" style={{ color: RANK_MEDAL_COLORS[index] ?? '#94a3b8' }}>{index + 1}</span>
                  <span className="truncate">{nameOf ? nameOf(row.name) : row.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span className="font-semibold" style={{ color: iconColor ?? '#0ea5e9' }}>{rankingValueOf(row, metric, timeUnit)}</span>
                  {showShare ? (
                    <span className="min-w-11 text-right text-xs" style={{ color: '#10b981' }}>{formatPercent(shareOf(row))}</span>
                  ) : null}
                  <span className="flex items-center gap-0.5 text-xs" style={{ color: '#06b6d4' }} title="缓存命中率">
                    <Star className="size-3" />
                    {formatPercent(row.cache_hit_rate ?? 0)}
                  </span>
                  <span className="flex min-w-14 items-center justify-end gap-0.5 text-xs text-muted-foreground" title="平均响应">
                    <Clock className="size-3" />
                    {formatDuration(row.avg_duration_ms ?? 0)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function DataDashboard() {
  const initialFilters = useMemo(() => defaultFilters(), [])
  const [queryFilters, setQueryFilters] = useState<QueryFilters>(initialFilters)
  const [providerDraft, setProviderDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [tempStart, setTempStart] = useState(initialFilters.start)
  const [tempEnd, setTempEnd] = useState(initialFilters.end)
  const [tempPreset, setTempPreset] = useState<PresetKey>('today')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [providerLoading, setProviderLoading] = useState(true)
  const [apiKeyLoading, setApiKeyLoading] = useState(true)
  const [chartType, setChartType] = useState<ChartType>('line')
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('auto')
  const [timePopoverOpen, setTimePopoverOpen] = useState(false)

  const providerOptions = useMemo(() => providers.map((p) => ({ value: p.name, label: p.remark || p.name })).filter((item) => item.value).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')), [providers])
  const apiKeyOptions = useMemo(() => apiKeys.map((k) => ({ value: k.name, label: k.name })).filter((item) => item.value).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')), [apiKeys])
  const modelOptions = useMemo(() => {
    const sourceProviders = providerDraft ? providers.filter((p) => p.name === providerDraft) : providers
    return [...new Set(sourceProviders.flatMap((p) => p.models ?? []))].filter(Boolean).sort()
  }, [providerDraft, providers])

  const rangeFilters = useMemo(() => ({
    start: queryFilters.start,
    end: queryFilters.end,
    grain: queryFilters.grain,
  }), [queryFilters])

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDashboardStats({
        start: datetimeToUnix(queryFilters.start),
        end: datetimeToUnix(queryFilters.end),
        grain: queryFilters.grain,
        section: 'all',
        provider: queryFilters.provider,
        api_key: queryFilters.apiKey,
        model: queryFilters.model,
      })
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载仪表盘数据失败')
    } finally {
      setLoading(false)
    }
  }, [queryFilters])

  useEffect(() => { void fetchStats() }, [fetchStats])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      setProviderLoading(true)
      setApiKeyLoading(true)
      try {
        const [providerData, apiKeyData] = await Promise.all([
          getProviders({ lite: true }).catch(() => []),
          getApiKeys().catch(() => ({ enabled: false, keys: [] })),
        ])
        if (!cancelled) {
          setProviders(providerData)
          setApiKeys(apiKeyData.keys ?? [])
        }
      } finally {
        if (!cancelled) {
          setProviderLoading(false)
          setApiKeyLoading(false)
        }
      }
    }
    void loadOptions()
    return () => { cancelled = true }
  }, [])

  const summary = stats?.summary
  const totalTokens = summary?.total_tokens ?? 0
  const requests = summary?.requests ?? 0
  const inputTokens = summary?.prompt_tokens ?? 0
  const outputTokens = summary?.completion_tokens ?? 0
  const cacheRead = summary?.cached_tokens ?? 0
  const cacheWrite = summary?.cache_creation_tokens ?? 0
  const reasoningTokens = summary?.reasoning_tokens ?? 0
  const reasoningRate = summary?.reasoning_request_rate ?? 0
  const rankings = stats?.rankings
  const hasProviderFilter = Boolean(queryFilters.provider)
  const hasModelFilter = Boolean(queryFilters.model)
  const showRankings = !(hasProviderFilter && hasModelFilter)
  const showModelRankings = showRankings && !hasModelFilter
  const showProviderRankings = showRankings && !hasProviderFilter
  const providerRemarkByName = useMemo(() => Object.fromEntries(providers.map((p) => [p.name, p.remark || p.name])), [providers])
  const modelLabel = useCallback((name: string) => name, [])
  const providerLabel = useCallback((name: string) => providerRemarkByName[name] || name, [providerRemarkByName])
  const hitRate = inputTokens > 0 ? cacheRead / inputTokens : 0

  const updateProvider = useCallback((v: string) => {
    const provider = v
    setProviderDraft(provider)
    setQueryFilters((cur) => {
      if (provider) {
        const keepModels = providers.find((p) => p.name === provider)?.models ?? []
        const model = cur.model && !keepModels.includes(cur.model) ? '' : cur.model
        setModelDraft(model)
        return { ...cur, provider, model }
      }
      return { ...cur, provider }
    })
  }, [providers])

  const updateApiKey = useCallback((v: string) => {
    setApiKeyDraft(v)
    setQueryFilters((cur) => ({ ...cur, apiKey: v }))
  }, [])

  const updateModel = useCallback((v: string) => {
    setModelDraft(v)
    setQueryFilters((cur) => ({ ...cur, model: v }))
  }, [])

  const applyTime = useCallback(() => {
    const grain = autoGrain(tempStart, tempEnd)
    setQueryFilters((cur) => ({ ...cur, start: tempStart, end: tempEnd, grain }))
    setTimePopoverOpen(false)
  }, [tempEnd, tempStart])

  const currentTimeLabel = useMemo(() => {
    const preset = getSelectedPreset(queryFilters.start, queryFilters.end)
    return rangeLabel(queryFilters.start, queryFilters.end, preset)
  }, [queryFilters.end, queryFilters.start])

  const onPopoverOpenChange = useCallback((open: boolean) => {
    if (open) {
      setTempStart(queryFilters.start)
      setTempEnd(queryFilters.end)
      setTempPreset(getSelectedPreset(queryFilters.start, queryFilters.end))
    }
    setTimePopoverOpen(open)
  }, [queryFilters.end, queryFilters.start])

  const PRESET_OPTIONS: Array<{ label: string; value: PresetKey }> = [
    { label: '当天', value: 'today' },
    { label: '1d', value: '1d' },
    { label: '7d', value: '7d' },
    { label: '14d', value: '14d' },
    { label: '30d', value: '30d' },
    { label: '90d', value: '90d' },
  ]

  if (loading && !stats) {
    return (
      <AdminPage primaryActions={<ManagerRefreshButton loading onClick={() => void fetchStats()} />}>
        <div className="flex justify-center py-10"><Spinner /></div>
      </AdminPage>
    )
  }

  if (error) {
    return (
      <AdminPage primaryActions={<ManagerRefreshButton loading onClick={() => void fetchStats()} />}>
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => void fetchStats()}>重试</Button>
          </div>
        </Alert>
      </AdminPage>
    )
  }

  return (
    <TooltipProvider>
      <AdminPage primaryActions={<ManagerRefreshButton loading onClick={() => void fetchStats()} />}>
        {/* 第一排：使用统计标题 + 说明；渠道 / 图表类型 / 单位 / 时间 / 刷新在同一列 */}
        <Card size="sm" className="shadow-none">
          <CardContent className="flex flex-wrap items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-tight">使用统计</h3>
              <p className="text-[13px] text-muted-foreground">查看 AI 模型的使用情况和成本统计</p>
            </div>

            <div className="flex items-center gap-1.5">
              <Select value={providerDraft || ALL} onValueChange={(v) => updateProvider(v === ALL ? '' : v)} disabled={providerLoading}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="全部渠道" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部渠道</SelectItem>
                  {providerOptions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={apiKeyDraft || ALL} onValueChange={(v) => updateApiKey(v === ALL ? '' : v)} disabled={apiKeyLoading}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="全部 API Key" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部 API Key</SelectItem>
                  {apiKeyOptions.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={modelDraft || ALL} onValueChange={(v) => updateModel(v === ALL ? '' : v)}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="全部模型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部模型</SelectItem>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ToggleGroup type="single" variant="outline" value={chartType} onValueChange={(v) => v && setChartType(v as ChartType)}>
              <ToggleGroupItem value="bar"><ChartColumn className="mr-1" />柱状图</ToggleGroupItem>
              <ToggleGroupItem value="line"><ChartLine className="mr-1" />驼峰图</ToggleGroupItem>
            </ToggleGroup>

            <ToggleGroup type="single" variant="outline" value={timeUnit} onValueChange={(v) => v && setTimeUnit(v as TimeUnit)}>
              <ToggleGroupItem value="M">M</ToggleGroupItem>
              <ToggleGroupItem value="万">万</ToggleGroupItem>
              <ToggleGroupItem value="亿">亿</ToggleGroupItem>
              <ToggleGroupItem value="auto">auto</ToggleGroupItem>
            </ToggleGroup>

            <div className="flex items-center gap-2">
              <Popover open={timePopoverOpen} onOpenChange={onPopoverOpenChange}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="text-blue-600 dark:text-blue-400"><Clock className="mr-1" />{currentTimeLabel}</Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[380px] gap-3">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    className="w-full"
                    value={tempPreset === 'custom' ? '' : tempPreset}
                    onValueChange={(value) => {
                      if (!value) return
                      const preset = value as PresetKey
                      if (preset === 'custom') return
                      const { start, end } = presetToRange(preset)
                      setTempStart(start)
                      setTempEnd(end)
                      setTempPreset(preset)
                    }}
                  >
                    {PRESET_OPTIONS.map((opt) => (
                      <ToggleGroupItem key={opt.value} value={opt.value} className="flex-1">{opt.label}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">开始时间</span>
                      <input
                        type="datetime-local"
                        value={tempStart}
                        onChange={(e) => {
                          const nextStart = e.target.value
                          if (!nextStart) return
                          setTempStart(nextStart)
                          setTempPreset(getSelectedPreset(nextStart, tempEnd))
                        }}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">结束时间</span>
                      <input
                        type="datetime-local"
                        value={tempEnd}
                        onChange={(e) => {
                          const nextEnd = e.target.value
                          if (!nextEnd) return
                          setTempEnd(nextEnd)
                          setTempPreset(getSelectedPreset(tempStart, nextEnd))
                        }}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setTimePopoverOpen(false)}><X className="mr-1" />取消</Button>
                    <Button onClick={applyTime}><Check className="mr-1" />确认</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        {/* 第二排：左卡片（真实消耗 + 关键指标 + 明细） + 右卡片（Top3 榜单） */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card size="sm" className="shadow-none lg:col-span-2">
            <CardContent className="flex h-full flex-col gap-2.5 px-4 py-3">
              {/* 真实消耗跨两排在左，右侧上排思考占比/缓存命中率，下排总请求数/平均响应 */}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {/* 真实消耗：左侧、无卡片边框，icon 前置为独立小图标块 */}
                <div className="flex items-center gap-3.5 px-1 py-1">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-[10px]" style={{ background: 'rgba(14,165,233,0.12)' }}>
                    <Zap style={{ color: '#0ea5e9' }} className="size-[22px]" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[13px] leading-none text-muted-foreground">真实消耗 Tokens</span>
                    <span className="mt-2.5 flex items-baseline gap-1.5 leading-tight">
                      <span className="text-[34px] font-semibold leading-none" style={{ color: '#0ea5e9' }}>{Math.round(totalTokens).toLocaleString('zh-CN')}</span>
                      <span className="text-[11px] font-normal leading-none text-muted-foreground">≈</span>
                      <span className="text-[11px] font-normal leading-none text-muted-foreground">{formatTokenWithUnit(totalTokens, timeUnit).split('≈')[1]?.trim()}</span>
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MetricTile icon={<Percent />} iconColor="#7c3aed" label="思考占比" inlineValue valueColor="#7c3aed" value={formatPercent(reasoningRate)}
                    extra={<Progress value={reasoningRate * 100} className="h-1.5" indicatorClassName="bg-[#8b5cf6]" />} />
                  <MetricTile icon={<Percent />} iconColor="#06b6d4" label="缓存命中率" inlineValue valueColor="#06b6d4" value={formatPercent(hitRate)}
                    extra={<Progress value={hitRate * 100} className="h-1.5" indicatorClassName="bg-[#22c55e]" />} />
                  <Card size="sm" className="h-full shadow-none">
                    <CardContent className="flex h-full flex-col justify-center gap-1 px-3 py-2">
                      <span className="flex items-center gap-1 leading-none">
                        <Zap style={{ color: '#10b981' }} className="size-4" />
                        <span className="text-xs text-muted-foreground">总请求数</span>
                      </span>
                      <span className="text-lg font-semibold" style={{ color: '#10b981' }}>{requests.toLocaleString('zh-CN')}</span>
                    </CardContent>
                  </Card>
                  <MetricTile icon={<Clock />} iconColor="#0ea5e9" label="平均响应" valueColor="#0ea5e9" value={formatDuration(summary?.avg_duration_ms ?? 0)} />
                </div>
              </div>
              {/* 第三排：输入 / 输出 / 缓存创建 / 缓存命中 / 思考 */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                <MetricTile icon={<CloudDownload />} iconColor="#3b82f6" label="输入" valueColor="#3b82f6" value={formatTokenScaled(inputTokens, timeUnit)} />
                <MetricTile icon={<CloudUpload />} iconColor="#10b981" label="输出" valueColor="#10b981" value={formatTokenScaled(outputTokens, timeUnit)} />
                <MetricTile icon={<Database />} iconColor="#8b5cf6" valueColor="#8b5cf6" value={formatTokenScaled(cacheWrite, timeUnit)}
                  label={
                    <Tooltip>
                      <TooltipTrigger asChild><span className="cursor-help underline decoration-dotted">缓存创建</span></TooltipTrigger>
                      <TooltipContent>缓存创建是输入 token 的明细，已经计入输入，不应再与输入相加。</TooltipContent>
                    </Tooltip>
                  } />
                <MetricTile icon={<Star />} iconColor="#f59e0b" valueColor="#f59e0b" value={formatTokenScaled(cacheRead, timeUnit)}
                  label={
                    <Tooltip>
                      <TooltipTrigger asChild><span className="cursor-help underline decoration-dotted">缓存命中</span></TooltipTrigger>
                      <TooltipContent>缓存命中是输入 token 的明细，已经计入输入，不应再与输入相加。</TooltipContent>
                    </Tooltip>
                  } />
                <MetricTile icon={<Lightbulb />} iconColor="#a855f7" label="思考" valueColor="#a855f7" value={formatTokenScaled(reasoningTokens, timeUnit)} />
              </div>
            </CardContent>
          </Card>
          <div className="flex h-full flex-col gap-3">
            <MiniRanking title="模型 Top3" icon={<ChartColumn />} iconColor="#3b82f6" rows={rankings?.model_usage_top} metric="tokens" timeUnit={timeUnit} nameOf={modelLabel} className="flex-1" />
            <MiniRanking title="渠道 Top3" icon={<Database />} iconColor="#8b5cf6" rows={rankings?.provider_usage_top} metric="tokens" timeUnit={timeUnit} nameOf={providerLabel} className="flex-1" />
          </div>
        </div>

        <Card size="sm" className="shadow-none">
          <CardContent className="px-4 py-3">
            <div className="mb-2 text-sm font-medium">使用趋势</div>
            <UsageChart metric="tokenTrend" scope="summary" series={stats?.series ?? {}} filters={rangeFilters} chartType={chartType} />
          </CardContent>
        </Card>
        <Card size="sm" className="shadow-none">
          <CardContent className="px-4 py-3">
            <div className="mb-2 text-sm font-medium">请求次数</div>
            <UsageChart metric="calls" scope="summary" series={stats?.series ?? {}} filters={rangeFilters} chartType={chartType} />
          </CardContent>
        </Card>
        <Card size="sm" className="shadow-none">
          <CardContent className="px-4 py-3">
            <div className="mb-2 text-sm font-medium">失败率</div>
            <UsageChart metric="failureRate" scope="summary" series={stats?.series ?? {}} filters={rangeFilters} chartType={chartType} />
          </CardContent>
        </Card>
        <Card size="sm" className="shadow-none">
          <CardContent className="px-4 py-3">
            <div className="mb-2 text-sm font-medium">响应时间</div>
            <UsageChart metric="duration" scope="summary" series={stats?.series ?? {}} filters={rangeFilters} chartType={chartType} />
          </CardContent>
        </Card>

        {showRankings && (
          <Card size="sm" className="shadow-none">
            <CardContent className="px-4 py-3">
              <div className="mb-2 text-sm font-medium">排行榜</div>
              {showModelRankings && (
                <>
                  <span className="text-xs text-muted-foreground">模型排行榜</span>
                  <div className="mt-1.5 mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <RankingTable title="使用量前 10 模型" rows={rankings?.model_usage_top} metric="tokens" timeUnit={timeUnit} nameOf={modelLabel} />
                    <RankingTable title="请求次数前 10 模型" rows={rankings?.model_requests_top} metric="requests" timeUnit={timeUnit} nameOf={modelLabel} />
                  </div>
                  <span className="text-xs text-muted-foreground">模型指标排行</span>
                  <div className="mt-1.5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <RankingTable title="响应最快前 10 模型" rows={rankings?.model_speed_top} metric="avg_duration_ms" timeUnit={timeUnit} nameOf={modelLabel} compact />
                    <RankingTable title="缓存命中率前 10 模型" rows={rankings?.model_cache_hit_top} metric="cache_hit_rate" timeUnit={timeUnit} nameOf={modelLabel} compact />
                    <RankingTable title="失败率前 10 模型" rows={rankings?.model_failure_rate_top} metric="failure_rate" timeUnit={timeUnit} nameOf={modelLabel} compact />
                  </div>
                  {rankings?.custom_model_usage_top && rankings.custom_model_usage_top.length > 0 && (
                    <>
                      <span className="mt-4 block text-xs text-muted-foreground">自定义模型 / 模型组占用（次要）</span>
                      <div className="mt-1.5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <RankingTable title="使用量前 10 自定义模型" rows={rankings.custom_model_usage_top} metric="tokens" timeUnit={timeUnit} nameOf={modelLabel} />
                      </div>
                    </>
                  )}
                </>
              )}
              {showProviderRankings && (
                <>
                  <span className="mt-6 block text-xs text-muted-foreground">渠道排行榜</span>
                  <div className="mt-1.5 mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <RankingTable title="使用量前 10 渠道" rows={rankings?.provider_usage_top} metric="tokens" timeUnit={timeUnit} nameOf={providerLabel} />
                    <RankingTable title="请求次数前 10 渠道" rows={rankings?.provider_requests_top} metric="requests" timeUnit={timeUnit} nameOf={providerLabel} />
                  </div>
                  <span className="text-xs text-muted-foreground">渠道指标排行</span>
                  <div className="mt-1.5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <RankingTable title="成功率前 10 渠道" rows={rankings?.provider_success_rate_top} metric="success_rate" timeUnit={timeUnit} nameOf={providerLabel} compact />
                    <RankingTable title="响应最快前 10 渠道" rows={rankings?.provider_speed_top} metric="avg_duration_ms" timeUnit={timeUnit} nameOf={providerLabel} compact />
                    <RankingTable title="缓存命中率前 10 渠道" rows={rankings?.provider_cache_hit_top} metric="cache_hit_rate" timeUnit={timeUnit} nameOf={providerLabel} compact />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <RankingTable title="失败率前 10 渠道" rows={rankings?.provider_failure_rate_top} metric="failure_rate" timeUnit={timeUnit} nameOf={providerLabel} compact />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </AdminPage>
    </TooltipProvider>
  )
}
