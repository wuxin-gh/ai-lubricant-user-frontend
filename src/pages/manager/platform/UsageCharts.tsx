/**
 * 使用图表（平台管理页）。
 * 从 admin-frontend 的 antd + @ant-design/charts 版重写为 shadcn + recharts。
 * 逻辑与投影口径（projectSeries / deriveSuccessFail / buildTokenTrend / buildFailureRate）
 * 完全照搬，仅把渲染层从 @ant-design/charts 换成 recharts，Typography/Empty 换成原生 + tailwind。
 * 数据层复用 @/@admin-port/api（纯 axios），此文件仅是视图。
 */
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DashboardSeriesItem } from '@/@admin-port/types/admin'
import {
  type ChartType,
  type RangeFilters,
  alignBucket,
  buildBuckets,
  colorOf,
  deriveSuccessFail,
  formatValue,
  projectSeries,
} from '@/@admin-port/pages/shared/chartUtils'

export type MetricType = 'token' | 'calls' | 'modelToken' | 'successFail' | 'duration' | 'tokenTrend' | 'failureRate'
export type ScopeType = 'summary' | 'provider' | 'api_key'

interface UsageChartProps {
  metric: MetricType
  scope: ScopeType
  series: Record<string, DashboardSeriesItem[]>
  filters: RangeFilters
  chartType: ChartType
  title?: string
}

const TOKEN_TREND_SERIES: Array<{ key: string; name: string; color: string }> = [
  { key: 'model_input_distribution', name: '输入', color: '#3b82f6' },
  { key: 'model_output_distribution', name: '输出', color: '#10b981' },
  { key: 'model_cache_write_distribution', name: '创建', color: '#8b5cf6' },
]

function tokenTrendColor(name: string): string {
  return TOKEN_TREND_SERIES.find((item) => item.name === name)?.color ?? colorOf(name)
}

function buildTokenTrend(series: Record<string, DashboardSeriesItem[]>, filters: RangeFilters) {
  return TOKEN_TREND_SERIES.map((item) => {
    const rows = series[item.key] ?? []
    const projected = projectSeries(rows, filters, { keepSeries: false, singleName: item.name })
    return { ...item, data: projected.data, max: projected.max }
  })
}

function buildFailureRate(callRows: DashboardSeriesItem[], failRows: DashboardSeriesItem[], filters: RangeFilters) {
  const columns = buildBuckets(new Date(filters.start).getTime() / 1000, new Date(filters.end).getTime() / 1000, filters.grain)
  const callByBucket = new Map<number, number>()
  const failByBucket = new Map<number, number>()

  callRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    callByBucket.set(bucket, (callByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })
  failRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    failByBucket.set(bucket, (failByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })

  const data = columns.map((column) => {
    const total = callByBucket.get(column.bucket) ?? 0
    const fail = failByBucket.get(column.bucket) ?? 0
    return { label: column.label, series: '失败率', value: total > 0 ? (fail / total) * 100 : 0 }
  })
  return { data, names: ['失败率'], max: Math.max(1, ...data.map((item) => item.value)) }
}

// 请求次数拆分图的固定配色：总数蓝、成功绿、失败红，语义直观。
const CALLS_BREAKDOWN_COLOR: Record<string, string> = {
  '请求次数': 'var(--blue)',
  '成功': 'var(--green)',
  '失败': 'var(--red)',
}

/**
 * 请求次数拆分：同一张图内呈现 请求次数（总数）/ 成功 / 失败 三条序列。
 * 失败取 model_failure_distribution（与失败率图同口径），成功 = 总数 − 失败（夹到 ≥0），
 * 口径为尝试级（含重试），与 deriveSuccessFail 一致。无任何数据时返回空，保留「暂无数据」态。
 */
function buildCallsBreakdown(callRows: DashboardSeriesItem[], failRows: DashboardSeriesItem[], filters: RangeFilters) {
  if (callRows.length === 0 && failRows.length === 0) {
    return { data: [] as Array<{ label: string; series: string; value: number }>, names: [] as string[], max: 1 }
  }
  const columns = buildBuckets(new Date(filters.start).getTime() / 1000, new Date(filters.end).getTime() / 1000, filters.grain)
  const callByBucket = new Map<number, number>()
  const failByBucket = new Map<number, number>()

  callRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    callByBucket.set(bucket, (callByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })
  failRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    failByBucket.set(bucket, (failByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })

  const data: Array<{ label: string; series: string; value: number }> = []
  const totals: number[] = []
  columns.forEach((column) => {
    const total = callByBucket.get(column.bucket) ?? 0
    const fail = failByBucket.get(column.bucket) ?? 0
    data.push({ label: column.label, series: '请求次数', value: total })
    data.push({ label: column.label, series: '成功', value: Math.max(0, total - fail) })
    data.push({ label: column.label, series: '失败', value: fail })
    totals.push(total)
  })
  return { data, names: ['请求次数', '成功', '失败'], max: Math.max(1, ...totals) }
}

type FlatRow = { label: string; series: string; value: number }

// 把 [{label, series, value}] 透视成 recharts 需要的 [{label, [series]: value}] 宽表
function pivotChartData(rows: FlatRow[], names: string[]): Array<Record<string, string | number>> {
  const byLabel = new Map<string, Record<string, string | number>>()
  const order: string[] = []
  for (const row of rows) {
    let entry = byLabel.get(row.label)
    if (!entry) {
      entry = { label: row.label }
      // 每个 series 初值 0，保证柱状堆叠/图例齐全
      for (const n of names) entry[n] = 0
      byLabel.set(row.label, entry)
      order.push(row.label)
    }
    entry[row.series] = (Number(entry[row.series]) || 0) + Number(row.value ?? 0)
  }
  return order.map((label) => byLabel.get(label) as Record<string, string | number>)
}

function ChartTooltip({
  active,
  payload,
  label,
  decimals,
  unit,
  colorFn,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ name?: string | number; value?: number | string }>
  label?: string | number
  decimals: number
  unit: string
  colorFn: (name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 text-muted-foreground">{label}</div>
      {payload.map((item) => (
        <div key={String(item.name)} className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full" style={{ background: colorFn(String(item.name)) }} />
          <span className="text-foreground">{item.name}</span>
          <span className="ml-auto font-medium text-foreground">
            {`${formatValue(Number(item.value ?? 0), decimals)}${unit}`}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 统一图表组件 - 支持板块1汇总、板块2渠道、板块3 API Key。
 * - metric: 要绘制的指标类型
 * - scope: 数据来源（汇总、单渠道、单 API Key）
 * - series: 后端 dashboard_stats 返回的 series 对象
 * - filters: 时间范围和颗粒
 * - chartType: 柱状图或折线图
 */
export function UsageChart({ metric, scope, series, filters, chartType, title }: UsageChartProps) {
  const { data, names, decimals, unit, tooltip, fixedColor } = useMemo(() => {
    let sourceRows: DashboardSeriesItem[] = []
    let keepSeries = true
    let average = false
    let singleName = 'total'
    let scale = 1
    let decimals = 0
    let unit = ''
    let tooltip = ''
    let fixedColor: ((name: string) => string) | undefined

    switch (metric) {
      case 'tokenTrend': {
        const projected = buildTokenTrend(series, filters)
        return { data: projected.flatMap((item) => item.data), names: TOKEN_TREND_SERIES.map((item) => item.name), max: Math.max(1, ...projected.map((item) => item.max)), decimals, unit, tooltip, fixedColor: tokenTrendColor }
      }
      case 'failureRate': {
        const projected = buildFailureRate(series.model_call_distribution ?? [], series.model_failure_distribution ?? [], filters)
        decimals = 2
        unit = '%'
        tooltip = '失败率 = 失败请求数 / 总请求数，失败口径沿用 error_count。'
        return { data: projected.data, names: projected.names, max: projected.max, decimals, unit, tooltip, fixedColor: undefined }
      }
      case 'token': {
        // 后端 dashboard_stats 只产出 model_* 维度的序列（已按 provider 等过滤），
        // 不存在 provider_token_distribution：所有 scope 统一取 model_token_distribution，
        // keepSeries=false 时 projectSeries 会把同一 bucket 内各模型求和为单一序列。
        sourceRows = series.model_token_distribution ?? []
        keepSeries = false
        singleName = 'Token消耗'
        break
      }
      case 'calls': {
        // 图内三条序列：请求次数（总数）/ 成功 / 失败。总数取 model_call_distribution
        // （provider_call_distribution 不存在，见 token 分支说明），失败取 model_failure_distribution。
        const derived = buildCallsBreakdown(series.model_call_distribution ?? [], series.model_failure_distribution ?? [], filters)
        tooltip = '成功 = 请求次数 − 失败，失败口径沿用 error_count。'
        return { data: derived.data, names: derived.names, max: derived.max, decimals, unit, tooltip, fixedColor: (name: string) => CALLS_BREAKDOWN_COLOR[name] ?? colorOf(name) }
      }
      case 'modelToken': {
        sourceRows = series.model_token_distribution ?? []
        keepSeries = true
        break
      }
      case 'successFail': {
        const callRows = series.model_call_distribution ?? series.provider_call_distribution ?? []
        const exceptionRows = series.model_failure_distribution ?? series.exception_distribution ?? []
        const derived = deriveSuccessFail(callRows, exceptionRows, filters)
        return { data: derived.data, names: derived.names, max: derived.max, decimals, unit, tooltip, fixedColor }
      }
      case 'duration': {
        sourceRows = series.model_response_average ?? series.provider_response_average ?? []
        keepSeries = false
        singleName = '平均耗时'
        average = true
        scale = 1 / 1000
        decimals = 2
        unit = 's'
        break
      }
    }

    const projected = projectSeries(sourceRows, filters, { keepSeries, average, singleName, scale })
    return { data: projected.data, names: projected.names, max: projected.max, decimals, unit, tooltip, fixedColor }
  }, [metric, scope, series, filters])

  const colorFn = fixedColor ?? ((name: string) => colorOf(name))
  const chartData = useMemo(() => pivotChartData(data as FlatRow[], names), [data, names])
  const showLegend = names.length > 1
  // 请求次数拆分图不做堆叠：总数序列已包含成功与失败，堆叠会重复计数。
  const stacked = chartType === 'bar' && names.length > 1 && metric !== 'calls'

  return (
    <div className="w-full">
      {title && (
        <span className="mb-2 block text-sm font-semibold">{title}</span>
      )}
      {tooltip && (
        <span className="mb-2 block text-xs text-muted-foreground">{tooltip}</span>
      )}
      <div className="rounded-md border bg-card p-3">
        {chartData.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-sm text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            {chartType === 'line' ? (
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="currentColor" strokeDasharray="4 8" strokeOpacity={0.1} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }} tickFormatter={(v: number) => `${formatValue(Number(v), decimals)}${unit}`} />
                <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload as ReadonlyArray<{ name?: string | number; value?: number | string }>} label={props.label as string | number} decimals={decimals} unit={unit} colorFn={colorFn} />} />
                {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                {names.map((name) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={colorFn(name)} strokeWidth={2} dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="currentColor" strokeDasharray="4 8" strokeOpacity={0.1} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }} tickFormatter={(v: number) => `${formatValue(Number(v), decimals)}${unit}`} />
                <Tooltip cursor={{ fill: 'currentColor', opacity: 0.06 }} content={(props) => <ChartTooltip active={props.active} payload={props.payload as ReadonlyArray<{ name?: string | number; value?: number | string }>} label={props.label as string | number} decimals={decimals} unit={unit} colorFn={colorFn} />} />
                {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                {names.map((name) => (
                  <Bar key={name} dataKey={name} fill={colorFn(name)} stackId={stacked ? 'stack' : undefined} radius={stacked ? 0 : [2, 2, 0, 0]} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
