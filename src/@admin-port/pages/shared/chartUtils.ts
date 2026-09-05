import type { DashboardSeriesItem } from '../../types/admin'

export type Grain = 'hour' | 'day' | 'week'
export type ChartType = 'bar' | 'line'

export interface RangeFilters {
  start: string
  end: string
  grain: Grain
}

export interface BucketColumn {
  bucket: number
  label: string
  showLabel: boolean
  values: Map<string, number>
}

const SERIES_COLORS = [
  'var(--blue)',
  'var(--green)',
  'var(--yellow)',
  'var(--red)',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
]

export function toDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function datetimeToUnix(value: string): number {
  const date = new Date(value)
  return Math.floor(date.getTime() / 1000)
}

export function formatCount(value: number | undefined | null): string {
  const n = Number(value ?? 0)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function formatValue(value: number, decimals = 0): string {
  if (decimals > 0) return value.toFixed(decimals).replace(/\.0+$/, '')
  return formatCount(value)
}

export type TimePreset = '1h' | '3h' | 'today' | '1d' | '7d' | '14d' | '15d' | '30d' | '90d'

export function presetToRange(preset: TimePreset): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end)
  if (preset === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (preset.endsWith('h')) {
    const hours = Number(preset.replace('h', ''))
    start.setTime(end.getTime() - hours * 3_600_000)
  } else {
    const days = Number(preset.replace('d', ''))
    start.setTime(end.getTime() - days * 86_400_000)
  }
  return { start: toDateTimeLocal(start), end: toDateTimeLocal(end) }
}

export function autoGrain(startValue: string, endValue: string): Grain {
  const start = new Date(startValue).getTime()
  const end = new Date(endValue).getTime()
  const spanDays = Math.max(0, end - start) / 86_400_000
  if (spanDays <= 6) return 'hour'
  if (spanDays <= 50) return 'day'
  return 'week'
}

function formatShortDateTime(value: string): string {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hour}:${minute}`
}

export function rangeLabel(start: string, end: string, preset: TimePreset | 'custom'): string {
  if (preset === 'today') return '当天'
  if (preset !== 'custom') return preset
  return `${formatShortDateTime(start)} - ${formatShortDateTime(end)}`
}

export type TimeUnit = 'auto' | 'M' | '万' | '亿'

export function formatTokenWithUnit(value: number | undefined | null, unit: TimeUnit): string {
  const n = Number(value ?? 0)
  const raw = Math.round(n).toLocaleString('zh-CN')
  let scaled = ''
  let suffix = ''
  if (unit === 'auto') {
    if (Math.abs(n) >= 100_000_000) { scaled = (n / 1_000_000).toFixed(2); suffix = 'M' }
    else if (Math.abs(n) >= 10_000) { scaled = (n / 10_000).toFixed(2); suffix = '万' }
    else { return raw }
  } else if (unit === 'M') { scaled = (n / 1_000_000).toFixed(2); suffix = 'M' }
  else if (unit === '万') { scaled = (n / 10_000).toFixed(2); suffix = '万' }
  else { scaled = (n / 100_000_000).toFixed(2); suffix = '亿' }
  return `${raw} ≈ ${scaled} ${suffix}`
}

/** 只返回换算后的值 + 单位（例如 7368.70 万），不带原始数字。 */
export function formatTokenScaled(value: number | undefined | null, unit: TimeUnit): string {
  const n = Number(value ?? 0)
  if (unit === 'auto') {
    if (Math.abs(n) >= 100_000_000) return `${(n / 1_000_000).toFixed(2)} M`
    if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(2)} 万`
    return Math.round(n).toLocaleString('zh-CN')
  }
  if (unit === 'M') return `${(n / 1_000_000).toFixed(2)} M`
  if (unit === '万') return `${(n / 10_000).toFixed(2)} 万`
  return `${(n / 100_000_000).toFixed(2)} 亿`
}


export function formatTokenLong(value: number | undefined | null): string {
  const n = Number(value ?? 0)
  return `${Math.round(n).toLocaleString('zh-CN')} ≈ ${(n / 100_000_000).toFixed(2)} 亿 ≈ ${(n / 1_000_000).toFixed(2)} M`
}

export function formatDuration(value: number | undefined | null): string {
  const ms = Number(value ?? 0)
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${(ms / 60_000).toFixed(2)} min`
}

export function formatPercent(value: number | undefined | null): string {
  return `${(Number(value ?? 0) * 100).toFixed(2)}%`
}

export function colorOf(name: string): string {
  let hash = 0
  for (const ch of name) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  }
  return SERIES_COLORS[Math.abs(hash) % SERIES_COLORS.length]
}

export function alignBucket(timestamp: number, grain: Grain): number {
  const date = new Date(timestamp * 1000)
  if (grain === 'week') {
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  } else if (grain === 'day') {
    date.setHours(0, 0, 0, 0)
  } else {
    date.setMinutes(0, 0, 0)
  }
  return Math.floor(date.getTime() / 1000)
}

export function bucketLabel(bucket: number, grain: Grain): string {
  const date = new Date(bucket * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  if (grain === 'week') return `${date.getMonth() + 1}/${date.getDate()}周`
  if (grain === 'day') return `${date.getMonth() + 1}/${date.getDate()}`
  return `${month}/${day} ${String(date.getHours()).padStart(2, '0')}:00`
}

export function buildBuckets(start: number, end: number, grain: Grain): BucketColumn[] {
  const step = grain === 'week' ? 7 * 86_400 : grain === 'day' ? 86_400 : 3_600
  const first = alignBucket(start, grain)
  const last = alignBucket(end, grain)
  const buckets: number[] = []
  for (let bucket = first; bucket <= last; bucket += step) buckets.push(bucket)
  const labelStep = buckets.length > 8 ? Math.ceil(buckets.length / 8) : 1
  return buckets.map((bucket, index) => ({
    bucket,
    label: bucketLabel(bucket, grain),
    showLabel: index % labelStep === 0 || index === buckets.length - 1,
    values: new Map<string, number>(),
  }))
}

/**
 * 把 series rows 按 bucket 对齐并投影成图表数据。
 * - keepSeries=true：保留每个序列（多序列，如"按模型"）。
 * - keepSeries=false：同一 bucket 内所有序列求和，投影为单一序列（板块1 的 token/请求/耗时）。
 * - average=true：单序列聚合时取平均而非求和（耗时用）。
 */
export function projectSeries(
  rows: DashboardSeriesItem[],
  filters: RangeFilters,
  options: { keepSeries: boolean; average?: boolean; singleName?: string; scale?: number } = { keepSeries: true },
): { data: Array<{ label: string; series: string; value: number }>; names: string[]; max: number } {
  const start = datetimeToUnix(filters.start)
  const end = datetimeToUnix(filters.end)
  const scale = options.scale ?? 1
  const columns = buildBuckets(start, end, filters.grain)
  const columnByBucket = new Map(columns.map((column) => [column.bucket, column]))
  const counts = new Map<number, Map<string, number>>()
  const allNames = new Set<string>()

  rows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    const column = columnByBucket.get(bucket)
    if (!column) return
    const name = options.keepSeries ? (item.name || 'unknown') : (options.singleName || 'total')
    const value = Math.max(0, Number(item.value || 0) * scale)
    allNames.add(name)
    column.values.set(name, (column.values.get(name) ?? 0) + value)
    if (options.average) {
      const bucketCounts = counts.get(column.bucket) ?? new Map<string, number>()
      bucketCounts.set(name, (bucketCounts.get(name) ?? 0) + 1)
      counts.set(column.bucket, bucketCounts)
    }
  })

  if (options.average) {
    columns.forEach((column) => {
      const bucketCounts = counts.get(column.bucket)
      if (!bucketCounts) return
      column.values.forEach((value, name) => {
        const n = bucketCounts.get(name) ?? 1
        column.values.set(name, n > 0 ? value / n : value)
      })
    })
  }

  const data = columns.flatMap((column) =>
    [...column.values.entries()].map(([series, value]) => ({ label: column.label, series, value })),
  )
  const perBucketTotals = columns.map((column) => [...column.values.values()].reduce((sum, v) => sum + v, 0))
  return {
    data,
    names: [...allNames].sort((a, b) => a.localeCompare(b)),
    max: Math.max(1, ...perBucketTotals),
  }
}

/**
 * 成功/失败推导：成功 = 渠道调用总数 − 异常数（夹到 ≥0），失败 = 异常数。
 * callRows 为 provider_call_distribution，exceptionRows 为 exception_distribution。
 * 口径为尝试级（含重试），与异常图一致。
 */
export function deriveSuccessFail(
  callRows: DashboardSeriesItem[],
  exceptionRows: DashboardSeriesItem[],
  filters: RangeFilters,
): { data: Array<{ label: string; series: string; value: number }>; names: string[]; max: number } {
  const start = datetimeToUnix(filters.start)
  const end = datetimeToUnix(filters.end)
  const columns = buildBuckets(start, end, filters.grain)
  const callByBucket = new Map<number, number>()
  const failByBucket = new Map<number, number>()

  callRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    callByBucket.set(bucket, (callByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })
  exceptionRows.forEach((item) => {
    const bucket = alignBucket(Number(item.bucket || 0), filters.grain)
    failByBucket.set(bucket, (failByBucket.get(bucket) ?? 0) + Math.max(0, Number(item.value || 0)))
  })

  const data: Array<{ label: string; series: string; value: number }> = []
  const totals: number[] = []
  columns.forEach((column) => {
    const fail = failByBucket.get(column.bucket) ?? 0
    const total = callByBucket.get(column.bucket) ?? 0
    const success = Math.max(0, total - fail)
    data.push({ label: column.label, series: '成功', value: success })
    data.push({ label: column.label, series: '失败', value: fail })
    totals.push(success + fail)
  })
  return { data, names: ['成功', '失败'], max: Math.max(1, ...totals) }
}
