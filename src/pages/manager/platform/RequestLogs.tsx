import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import {
  Activity,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Clock,
  Copy,
  Eraser,
  FlaskConical,
  KeyRound,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminPage } from '@/components/manager/platform-page'
import { ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getRequestLogDetail, getRequestLogs } from '@/@admin-port/api/logs'
import type { RequestLogQuery } from '@/@admin-port/api/logs'
import { getApiKeys } from '@/@admin-port/api/apiKeys'
import { getProviders } from '@/@admin-port/api/providers'
import { UnifiedProviderModal } from './Channels'
import type {
  ApiKey,
  RequestLog,
  RequestLogAttempt,
  RequestLogDetail,
  RequestLogProxyInfo,
  RequestLogSecurityEvent,
} from '@/@admin-port/types/admin'

// ==================== 常量 ====================

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const CLIENT_TYPE_OPTIONS = ['Claude', 'Codex', 'Cursor', 'Cline', 'Roo', 'Gemini']

// Radix Select 禁止空字符串值，用哨兵表示「全部」，回传时映射回 ''
const ALL = '__all__'

// 结束时间统一为「当前 + 2 小时」，覆盖时钟漂移与短时未来日志
function presetEnd(): Dayjs {
  return dayjs().add(2, 'hour')
}

const RANGE_PRESETS: { key: string; label: string; value: () => [Dayjs, Dayjs] }[] = [
  { key: '15m', label: '近 15 分钟', value: () => [dayjs().subtract(15, 'minute'), presetEnd()] },
  { key: '1h', label: '近 1 小时', value: () => [dayjs().subtract(1, 'hour'), presetEnd()] },
  { key: '3h', label: '近 3 小时', value: () => [dayjs().subtract(3, 'hour'), presetEnd()] },
  { key: '6h', label: '近 6 小时', value: () => [dayjs().subtract(6, 'hour'), presetEnd()] },
  { key: '12h', label: '近 12 小时', value: () => [dayjs().subtract(12, 'hour'), presetEnd()] },
  { key: '24h', label: '近 24 小时', value: () => [dayjs().subtract(24, 'hour'), presetEnd()] },
  { key: 'today', label: '今天', value: () => [dayjs().startOf('day'), presetEnd()] },
  { key: 'yesterday', label: '昨天', value: () => [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] },
  { key: '3d', label: '近 3 天', value: () => [dayjs().subtract(3, 'day'), presetEnd()] },
  { key: '7d', label: '近 7 天', value: () => [dayjs().subtract(7, 'day'), presetEnd()] },
  { key: '30d', label: '近 30 天', value: () => [dayjs().subtract(30, 'day'), presetEnd()] },
]

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'error', label: '异常' },
  { value: 'cancelled', label: '已取消' },
  { value: 'requesting', label: '请求中' },
  { value: 'security_blocked', label: '安全拦截' },
  { value: 'empty_non_stream', label: '空响应' },
]

// 检测/测试日志的 api_key_name 由定时检测(is_probe)/手动测试(is_test)链路写入，
// 不在 keys 列表里，固定补进 API Key 下拉头部便于直接查询。
// 来源：admin.py 探测链路 api_key_name = is_probe ? 'admin-check' : 'admin-test'。
// 渠道「定时检测」关闭「保留检测日志」后，该渠道的 admin-check 记录不再出现。
const SYSTEM_KEY_OPTIONS = [
  { value: 'admin-check', label: '检测日志', hint: '定时检测', Icon: Activity },
  { value: 'admin-test', label: '测试日志', hint: '手动测试', Icon: FlaskConical },
] as const

// ==================== 工具函数 ====================

function fromDayjs(d: Dayjs | null): number | null {
  if (!d || !d.isValid()) return null
  return d.unix()
}

/** 把 Dayjs 转为 <input type="datetime-local"> 需要的 `YYYY-MM-DDTHH:mm` 字符串。 */
function toDateTimeLocal(d: Dayjs): string {
  return d.format('YYYY-MM-DDTHH:mm')
}

function clientTypeLabel(type: string | null): string {
  const t = String(type || 'unknown').toLowerCase()
  if (t.includes('claude')) return 'Claude'
  if (t.includes('codex')) return 'Codex'
  if (t.includes('cursor')) return 'Cursor'
  if (t.includes('cline')) return 'Cline'
  if (t.includes('roo')) return 'Roo'
  if (t.includes('gemini')) return 'Gemini'
  if (t === 'unknown' || !t) return '-'
  return type || '-'
}

function formatSeconds(ms: number | null | undefined): string {
  if (ms == null) return '-'
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * 表格里的创建时间：今天只显示 HH:mm:ss，其他天前置「-N天」。
 * 目的是压缩列宽，完整时间由 tooltip 提供。
 */
function formatLogTime(sec: number): { short: string; full: string } {
  const d = dayjs(sec * 1000)
  const full = d.format('YYYY-MM-DD HH:mm:ss')
  const clock = d.format('HH:mm:ss')
  const dayDiff = d.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (dayDiff === 0) return { short: clock, full }
  const sign = dayDiff > 0 ? '+' : '-'
  return { short: `${sign}${Math.abs(dayDiff)}天 ${clock}`, full }
}

function formatLogError(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let text: string
  if (typeof raw === 'string') {
    text = raw
  } else {
    try {
      text = JSON.stringify(raw)
    } catch {
      text = String(raw)
    }
  }

  let statusPrefix = ''
  const match = text.match(/^\s*(\d{3})\s*:\s*/)
  if (match) {
    statusPrefix = `[${match[1]}] `
    text = text.slice(match[0].length)
  }

  const unwrap = (value: unknown, depth: number): unknown => {
    if (depth > 6) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          return unwrap(JSON.parse(trimmed), depth + 1)
        } catch {
          return value
        }
      }
      return value
    }
    if (Array.isArray(value)) return value.map((item) => unwrap(item, depth + 1))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      const record = value as Record<string, unknown>
      Object.keys(record).forEach((key) => {
        out[key] = unwrap(record[key], depth + 1)
      })
      return out
    }
    return value
  }

  const parsed = unwrap(text, 0)
  const pickMessage = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return ''
    const record = value as Record<string, unknown>
    if (record.error && typeof record.error === 'object') {
      const inner = pickMessage(record.error)
      if (inner) return inner
    }
    if (record.message !== undefined && record.message !== null) {
      if (typeof record.message === 'object') {
        const deeper = pickMessage(record.message)
        if (deeper) return deeper
      } else if (typeof record.message === 'string' && record.message) {
        const deeper = pickMessage(unwrap(record.message, 0))
        return deeper || record.message
      }
    }
    if (typeof record.detail === 'string' && record.detail) return record.detail
    if (typeof record.error === 'string') return record.error
    return ''
  }

  const resultMessage = pickMessage(parsed)
  if (resultMessage) return statusPrefix + resultMessage
  if (typeof parsed === 'string') return statusPrefix + parsed
  try {
    return statusPrefix + JSON.stringify(parsed)
  } catch {
    return statusPrefix + text
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseJsonRaw(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function jsonToCopyText(data: unknown): string {
  if (data === null || data === undefined) return ''
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function rawToCopyText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : jsonToCopyText(item)))
      .join('')
  }
  if (
    typeof value === 'object' &&
    Array.isArray((value as Record<string, unknown>).events)
  ) {
    const events = (value as Record<string, unknown>).events as unknown[]
    return events
      .map((item) => (typeof item === 'string' ? item : jsonToCopyText(item)))
      .join('')
  }
  return jsonToCopyText(value)
}

// ==================== 通用视图原子 ====================

type TagColor =
  | 'success'
  | 'warning'
  | 'processing'
  | 'error'
  | 'danger'
  | 'orange'
  | 'green'
  | 'default'

const TAG_TONE: Record<TagColor, string> = {
  success: 'border-green-500/40 text-green-600 dark:text-green-400',
  green: 'border-green-500/40 text-green-600 dark:text-green-400',
  warning: 'border-yellow-500/40 text-yellow-600 dark:text-yellow-500',
  orange: 'border-orange-500/40 text-orange-600 dark:text-orange-400',
  processing: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  error: 'border-red-500/40 text-red-600 dark:text-red-400',
  danger: 'border-red-500/40 text-red-600 dark:text-red-400',
  default: '',
}

function ColorTag({
  color = 'default',
  children,
  className,
}: {
  color?: TagColor
  children: ReactNode
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn('font-normal', TAG_TONE[color], className)}>
      {children}
    </Badge>
  )
}

function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-muted-foreground', className)}>{children}</span>
}

/** 实际出站代理：值由服务端在真正发请求处记录，代理密码已脱敏。 */
function ProxyInfoView({ info }: { info?: RequestLogProxyInfo }) {
  if (!info || !info.mode) return <>-</>
  const target =
    info.mode === 'network'
      ? info.proxy_url
      : info.mode === 'url_prefix'
        ? info.url_prefix
        : info.mode === 'node'
          ? info.node_id
          : ''
  const modeLabel =
    info.mode === 'direct'
      ? '直连'
      : info.mode === 'network'
        ? '网络代理'
        : info.mode === 'url_prefix'
          ? 'URL 前缀'
          : info.mode === 'node'
            ? '节点'
            : info.mode
  return (
    <span className="flex flex-wrap items-center gap-1">
      <ColorTag color={info.mode === 'direct' ? 'default' : 'processing'}>{modeLabel}</ColorTag>
      {target ? <code className="rounded bg-muted px-1">{target}</code> : null}
      {info.target_host ? <Muted>→ {info.target_host}</Muted> : null}
      {info.proxy_config_id ? <Muted>#{info.proxy_config_id}</Muted> : null}
    </span>
  )
}

/** 可搜索、可清空的单选下拉（对齐 antd Select showSearch allowClear）。 */
function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  width,
  allowClear = true,
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
  placeholder?: string
  width?: number
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="h-9 justify-between font-normal"
          style={{ width }}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <span className="ml-1 flex items-center gap-1">
            {allowClear && value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="清除"
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ minWidth: Math.max(width ?? 160, 220) }}>
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-80">
            <CommandEmpty>无匹配</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4 shrink-0',
                      value === o.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * API Key 下拉：父 Key 可展开看子 Key（二级折叠），头部固定补「检测日志/测试日志」入口。
 * 选中项回传的是单个 key 的 name（后端按 api_key_name 精确匹配）；
 * 父子只是导航分组——选父 Key 只查父 Key 自己的日志，不聚合子 Key。
 */
function ApiKeyTreeSelect({
  value,
  onChange,
  apiKeys,
}: {
  value: string
  onChange: (v: string) => void
  apiKeys: ApiKey[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  // 父子分组：有子 Key 的父 → 折叠组；无子 Key 的父 + 父已删除的孤儿子 Key → 扁平项。
  const { groups, flatKeys } = useMemo(() => {
    const byId = new Map(apiKeys.map((k) => [k.id, k]))
    const childrenOf = new Map<number, ApiKey[]>()
    const parents: ApiKey[] = []
    const orphans: ApiKey[] = []
    for (const k of apiKeys) {
      if (k.parent_id && byId.has(k.parent_id)) {
        const arr = childrenOf.get(k.parent_id) ?? []
        arr.push(k)
        childrenOf.set(k.parent_id, arr)
      } else if (k.parent_id) {
        orphans.push(k)
      } else {
        parents.push(k)
      }
    }
    const byName = (a: ApiKey, b: ApiKey) => a.name.localeCompare(b.name, 'zh-Hans-CN')
    parents.sort(byName)
    orphans.sort(byName)
    for (const arr of childrenOf.values()) arr.sort(byName)
    const groups = parents
      .filter((p) => (childrenOf.get(p.id)?.length ?? 0) > 0)
      .map((p) => ({ parent: p, children: childrenOf.get(p.id) ?? [] }))
    const flatKeys = [...parents.filter((p) => !childrenOf.has(p.id)), ...orphans]
    return { groups, flatKeys }
  }, [apiKeys])

  const q = search.trim().toLowerCase()
  const nameMatch = (name: string) => !q || name.toLowerCase().includes(q)
  const sysVisible = SYSTEM_KEY_OPTIONS.filter(
    (o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  )
  const groupsVisible = groups.filter(
    (g) => nameMatch(g.parent.name) || g.children.some((c) => nameMatch(c.name)),
  )
  const flatVisible = flatKeys.filter((k) => nameMatch(k.name))

  // 当前选中项若是子 Key，其父组始终展开，保证选中项可见。
  const selectedParentId = apiKeys.find((k) => k.name === value && k.parent_id)?.parent_id ?? null
  const isGroupExpanded = (g: { parent: ApiKey; children: ApiKey[] }) => {
    if (q) return g.children.some((c) => nameMatch(c.name))
    return expanded.has(g.parent.id) || g.parent.id === selectedParentId
  }
  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedSys = SYSTEM_KEY_OPTIONS.find((o) => o.value === value)
  const selectedKey = apiKeys.find((k) => k.name === value)
  const triggerLabel = selectedSys?.label ?? selectedKey?.name ?? value

  const commit = (v: string) => {
    onChange(v)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="h-9 justify-between font-normal"
          style={{ width: 160 }}
        >
          <span
            className={cn('flex items-center gap-1.5 truncate', !triggerLabel && 'text-muted-foreground')}
          >
            {selectedSys ? (
              <selectedSys.Icon className="size-3.5" />
            ) : value ? (
              <KeyRound className="size-3.5 opacity-60" />
            ) : null}
            <span className="truncate">{triggerLabel || '选择或搜索 Key'}</span>
          </span>
          <span className="ml-1 flex items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="清除"
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ minWidth: 260 }}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索 Key 名称" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-80">
            {sysVisible.length === 0 && groupsVisible.length === 0 && flatVisible.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">无匹配</div>
            ) : null}

            {sysVisible.length > 0 ? (
              <CommandGroup heading="系统日志">
                {sysVisible.map((o) => (
                  <CommandItem key={o.value} value={o.value} onSelect={() => commit(o.value)}>
                    <o.Icon className="size-3.5 opacity-70" />
                    <span className="flex-1 truncate">{o.label}</span>
                    <Muted className="text-xs">{o.hint}</Muted>
                    <Check
                      className={cn('ml-1 size-4 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {groupsVisible.map((g) => {
              const expandedNow = isGroupExpanded(g)
              const parentActive = value === g.parent.name
              return (
                <CommandGroup key={g.parent.id}>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={expandedNow ? '收起子 Key' : '展开子 Key'}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
                      onClick={() => toggleExpand(g.parent.id)}
                    >
                      {expandedNow ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <CommandItem
                      value={g.parent.name}
                      onSelect={() => commit(g.parent.name)}
                      className="flex-1"
                    >
                      <KeyRound className="size-3.5 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{g.parent.name}</span>
                      <Muted className="text-xs">{g.children.length}</Muted>
                      <Check
                        className={cn('ml-1 size-4 shrink-0', parentActive ? 'opacity-100' : 'opacity-0')}
                      />
                    </CommandItem>
                  </div>
                  {expandedNow
                    ? g.children
                        .filter((c) => nameMatch(c.name))
                        .map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => commit(c.name)}
                            className="pl-9"
                          >
                            <span className="flex-1 truncate">{c.name}</span>
                            <Check
                              className={cn(
                                'ml-1 size-4 shrink-0',
                                value === c.name ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                          </CommandItem>
                        ))
                    : null}
                </CommandGroup>
              )
            })}

            {flatVisible.length > 0 ? (
              <CommandGroup heading={groupsVisible.length > 0 ? '其他 Key' : 'API Key'}>
                {flatVisible.map((k) => (
                  <CommandItem key={k.id} value={k.name} onSelect={() => commit(k.name)}>
                    <KeyRound className="size-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{k.name}</span>
                    <Check
                      className={cn('ml-1 size-4 shrink-0', value === k.name ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-bold text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** 判断当前 range 是否匹配某个预设（匹配时给出预设 label，否则显示自定义区间）。 */
function matchPresetKey(range: [Dayjs, Dayjs]): string | null {
  for (const preset of RANGE_PRESETS) {
    const [ps, pe] = preset.value()
    // 预设的结束时间是「当前 + 2h」，秒级会漂移，用分钟粒度比较起点即可
    if (
      Math.abs(range[0].diff(ps, 'minute')) <= 1 &&
      Math.abs(range[1].diff(pe, 'minute')) <= 1
    ) {
      return preset.key
    }
  }
  return null
}

/**
 * 时间范围选择器：单个触发按钮 + 弹层。
 * 弹层里上方是 1h/6h/24h/今天 快捷预设，下方是自定义起止时间。
 * 把原先「两个 datetime-local 输入 + 一排预设按钮」合并为一个入口。
 */
function TimeRangePicker({
  range,
  onChange,
}: {
  range: [Dayjs, Dayjs]
  onChange: (r: [Dayjs, Dayjs]) => void
}) {
  const [open, setOpen] = useState(false)
  const activePreset = matchPresetKey(range)
  const activeLabel =
    RANGE_PRESETS.find((p) => p.key === activePreset)?.label ??
    `${range[0].format('MM-DD HH:mm')} ~ ${range[1].format('MM-DD HH:mm')}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 justify-between gap-2 font-normal" style={{ minWidth: 220 }}>
          <span className="flex items-center gap-2 truncate">
            <Clock className="size-3.5 opacity-60" />
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-3" align="start">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-1.5">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                size="sm"
                variant={activePreset === preset.key ? 'default' : 'outline'}
                className="h-7 px-1 text-xs"
                onClick={() => {
                  onChange(preset.value())
                  setOpen(false)
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">自定义区间</span>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">开始</span>
              <Input
                type="datetime-local"
                className="h-9"
                value={toDateTimeLocal(range[0])}
                onChange={(e) => {
                  const d = dayjs(e.target.value)
                  if (d.isValid()) onChange([d, range[1]])
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">结束</span>
              <Input
                type="datetime-local"
                className="h-9"
                value={toDateTimeLocal(range[1])}
                onChange={(e) => {
                  const d = dayjs(e.target.value)
                  if (d.isValid()) onChange([range[0], d])
                }}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ==================== 状态 / Tag 工具 ====================

function statusTag(log: RequestLog | RequestLogDetail) {
  if (log.success) return <ColorTag color="success">成功</ColorTag>
  if (log.status === 'security_blocked') return <ColorTag color="warning">安全拦截</ColorTag>
  if (log.status === 'cancelled') return <ColorTag color="warning">已取消</ColorTag>
  if (log.status === 'empty_non_stream') return <ColorTag color="warning">空响应</ColorTag>
  if (log.status === 'requesting') return <ColorTag color="processing">请求中</ColorTag>
  return <ColorTag color="error">失败</ColorTag>
}

function severityColor(severity?: string): TagColor {
  if (severity === 'high') return 'error'
  if (severity === 'warn') return 'warning'
  if (severity === 'info') return 'processing'
  return 'default'
}

// ==================== JSON / 原始值展示 ====================

const JSON_SYNTAX_COLORS = {
  key: 'var(--blue)',
  string: 'var(--green)',
  number: 'var(--green)',
  boolean: 'var(--yellow)',
  nullish: 'var(--text2)',
  brace: 'var(--text2)',
}

function JsonPrimitive({
  name,
  value,
  color,
}: {
  name?: string
  value: string
  color: string
}) {
  return (
    <div style={{ fontFamily: 'var(--fontM)', fontSize: 13, lineHeight: 1.6 }}>
      {name !== undefined && (
        <span style={{ color: JSON_SYNTAX_COLORS.key }}>"{name}": </span>
      )}
      <span style={{ color }}>{value}</span>
    </div>
  )
}

function JsonNode({
  data,
  name,
  depth = 0,
}: {
  data: unknown
  name?: string
  depth?: number
}) {
  const [open, setOpen] = useState(depth < 1)

  if (data === null) {
    return <JsonPrimitive name={name} value="null" color={JSON_SYNTAX_COLORS.nullish} />
  }
  if (typeof data === 'boolean') {
    return (
      <JsonPrimitive name={name} value={String(data)} color={JSON_SYNTAX_COLORS.boolean} />
    )
  }
  if (typeof data === 'number') {
    return (
      <JsonPrimitive name={name} value={String(data)} color={JSON_SYNTAX_COLORS.number} />
    )
  }
  if (typeof data === 'string') {
    return (
      <JsonPrimitive name={name} value={`"${data}"`} color={JSON_SYNTAX_COLORS.string} />
    )
  }

  const isArray = Array.isArray(data)
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>)

  const openBrace = isArray ? '[' : '{'
  const closeBrace = isArray ? ']' : '}'

  if (entries.length === 0) {
    return (
      <div style={{ fontFamily: 'var(--fontM)', fontSize: 13, lineHeight: 1.6 }}>
        {name !== undefined && (
          <span style={{ color: JSON_SYNTAX_COLORS.key }}>"{name}": </span>
        )}
        <span style={{ color: JSON_SYNTAX_COLORS.brace }}>
          {openBrace}
          {closeBrace}
        </span>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'var(--fontM)', fontSize: 13, lineHeight: 1.6 }}>
      <span
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {name !== undefined && (
          <span style={{ color: JSON_SYNTAX_COLORS.key }}>"{name}": </span>
        )}
        <span style={{ color: JSON_SYNTAX_COLORS.brace, marginRight: 4, fontSize: 10 }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ color: JSON_SYNTAX_COLORS.brace }}>
          {open ? openBrace : `${openBrace}${entries.length}${closeBrace}`}
        </span>
      </span>
      {open && (
        <div style={{ marginLeft: 16, borderLeft: '1px solid var(--admin-border)', paddingLeft: 8 }}>
          {entries.map(([k, v]) => (
            <JsonNode key={k} data={v} name={isArray ? undefined : k} depth={depth + 1} />
          ))}
          <div style={{ color: JSON_SYNTAX_COLORS.brace }}>{closeBrace}</div>
        </div>
      )}
    </div>
  )
}

function JsonView({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <Muted>无</Muted>
  }
  if (typeof data !== 'object') {
    return (
      <div>
        <JsonNode data={data} />
      </div>
    )
  }
  const text = JSON.stringify(data)
  if (!text || text === '{}') {
    return <Muted>无</Muted>
  }
  return (
    <div>
      <JsonNode data={data} depth={0} />
    </div>
  )
}

function RawStringValueView({ text }: { text: string }) {
  if (!text.trim()) return <Muted>空</Muted>
  return (
    <code
      className="block rounded bg-muted px-2 py-1 text-[13px]"
      style={{ whiteSpace: 'pre-wrap' }}
    >
      {text}
    </code>
  )
}

function RawValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <Muted>无</Muted>
  }
  if (typeof value === 'string') {
    return <RawStringValueView text={value} />
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      return <RawStringValueView text={value.join('')} />
    }
    return (
      <div>
        <JsonNode data={value} depth={0} />
      </div>
    )
  }
  if (
    typeof value === 'object' &&
    Array.isArray((value as Record<string, unknown>).events)
  ) {
    const events = (value as Record<string, unknown>).events as unknown[]
    if (events.every((item) => typeof item === 'string')) {
      return <RawStringValueView text={events.join('')} />
    }
  }
  return (
    <div>
      <JsonNode data={value} depth={0} />
    </div>
  )
}

// ==================== 消息体 / 内容块展示 ====================

function ContentBlockView({ block, index }: { block: unknown; index: number }) {
  if (typeof block === 'string') {
    return (
      <div className="mb-2">
        <div className="mb-1 flex items-center gap-1">
          <ColorTag>{index + 1}</ColorTag>
          <ColorTag color="processing">text</ColorTag>
        </div>
        <code className="block rounded bg-muted px-2 py-1 text-[13px]" style={{ whiteSpace: 'pre-wrap' }}>
          {block}
        </code>
      </div>
    )
  }

  if (!block || typeof block !== 'object') {
    return (
      <div className="mb-2">
        <div className="mb-1 flex items-center gap-1">
          <ColorTag>{index + 1}</ColorTag>
          <ColorTag>value</ColorTag>
        </div>
        <code className="block rounded bg-muted px-2 py-1 text-[13px]" style={{ whiteSpace: 'pre-wrap' }}>
          {String(block)}
        </code>
      </div>
    )
  }

  const record = block as Record<string, unknown>

  if (record.type === 'text') {
    const text =
      typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : ''
    return (
      <div className="mb-2">
        <div className="mb-1 flex items-center gap-1">
          <ColorTag>{index + 1}</ColorTag>
          <ColorTag color="processing">text</ColorTag>
        </div>
        <code className="block rounded bg-muted px-2 py-1 text-[13px]" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </code>
      </div>
    )
  }

  if (record.type === 'tool_use') {
    return (
      <div className="mb-2">
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <ColorTag>{index + 1}</ColorTag>
          <ColorTag color="processing">tool_use</ColorTag>
          <ColorTag>{String(record.name || 'tool')}</ColorTag>
          {record.id !== undefined && <ColorTag>{String(record.id)}</ColorTag>}
        </div>
        <JsonView data={record.input ?? record} />
      </div>
    )
  }

  if (record.type === 'tool_result') {
    const content = Array.isArray(record.content) ? record.content : [record.content]
    return (
      <div className="mb-2">
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <ColorTag>{index + 1}</ColorTag>
          <ColorTag color={record.is_error ? 'error' : 'processing'}>tool_result</ColorTag>
          {record.tool_use_id !== undefined && <ColorTag>{String(record.tool_use_id)}</ColorTag>}
        </div>
        <div className="flex flex-col gap-1.5">
          {content.map((item, itemIndex) => (
            <ContentBlockView key={itemIndex} block={item} index={itemIndex} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1">
        <ColorTag>{index + 1}</ColorTag>
        <ColorTag>{String(record.type || 'object')}</ColorTag>
      </div>
      <JsonView data={record} />
    </div>
  )
}

function MessagesView({ messages }: { messages: unknown }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return <Muted>无</Muted>
  }

  return (
    <Accordion type="multiple" className="w-full">
      {messages.map((message, index) => {
        const record =
          message && typeof message === 'object'
            ? (message as Record<string, unknown>)
            : {}
        const parts = Array.isArray(record.content) ? record.content : [record.content]
        const preview = parts
          .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
          .join(' ')
          .replace(/\s+/g, ' ')
          .slice(0, 120)

        return (
          <AccordionItem key={index} value={String(index)}>
            <AccordionTrigger className="py-2">
              <span className="flex flex-wrap items-center gap-2 text-left">
                <span className="font-bold" style={{ color: 'var(--blue)' }}>
                  #{index + 1}
                </span>
                <span className="font-bold">{String(record.role || 'unknown')}</span>
                <Muted>{parts.length} 段</Muted>
                {preview && <Muted className="truncate">{preview}</Muted>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-1.5">
                {parts.map((part, partIndex) => (
                  <ContentBlockView key={partIndex} block={part} index={partIndex} />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

// ==================== 安全事件 / 重试记录展示 ====================

function securityReasonText(detail: Record<string, unknown>): string {
  if (!detail) return ''
  if (typeof detail.prefix === 'string' && detail.prefix) return `命中的凭据前缀: ${detail.prefix}***`
  if (typeof detail.match_preview === 'string' && detail.match_preview) return `触发片段: ${detail.match_preview}`
  if (typeof detail.reason === 'string' && detail.reason) return detail.reason
  if (typeof detail.role === 'string' && detail.role) return `命中角色: ${detail.role}`
  const flat = Object.entries(detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ')
  return flat
}

function SecurityEventsView({ events }: { events: RequestLogSecurityEvent[] }) {
  if (!events.length) {
    return <Muted>无安全事件</Muted>
  }

  return (
    <div className="flex flex-col gap-2.5">
      {events.map((event) => {
        const detail =
          event.detail && typeof event.detail === 'object'
            ? (event.detail as Record<string, unknown>)
            : {}
        const matchPreview =
          typeof detail.match_preview === 'string' ? detail.match_preview : ''
        const role = typeof detail.role === 'string' ? detail.role : ''
        const sourceIp = event.source_ip || '-'
        const time = event.event_time
          ? new Date(event.event_time * 1000).toLocaleString()
          : '-'
        const reasonText = securityReasonText(detail)

        return (
          <Card key={event.id} size="sm" className="p-3 shadow-none">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <ColorTag color={severityColor(event.severity)}>{event.severity || 'info'}</ColorTag>
              <ColorTag color="processing">{event.tag || '-'}</ColorTag>
              <Muted className="text-xs">事件 ID #{event.id}</Muted>
              <Muted className="text-xs">· {time}</Muted>
              {event.request_id && <Muted className="text-xs">· 请求 {event.request_id}</Muted>}
              {event.model && <Muted className="text-xs">· 模型 {event.model}</Muted>}
              <Muted className="text-xs">· 来源 IP {sourceIp}</Muted>
              {role && <ColorTag>{role}</ColorTag>}
            </div>
            {reasonText && !matchPreview && (
              <div className="mb-1.5">
                <Muted className="mr-1.5">拦截原因：</Muted>
                <span className="text-yellow-600 dark:text-yellow-500">{reasonText}</span>
              </div>
            )}
            {matchPreview && (
              <div className="mb-1.5">
                <Muted className="mr-1.5">触发片段：</Muted>
                <code className="rounded bg-muted px-1 text-red-600 dark:text-red-400">
                  {matchPreview}
                </code>
              </div>
            )}
            {Object.keys(detail).length > 0 && (
              <Accordion type="multiple" className="w-full">
                <AccordionItem value="detail" className="border-b-0">
                  <AccordionTrigger className="py-1.5">
                    <Muted className="text-xs">完整 detail</Muted>
                  </AccordionTrigger>
                  <AccordionContent>
                    <JsonView data={detail} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function ChannelRetryAttemptsView({ attempts }: { attempts: RequestLogDetail['channel_retry_attempts'] }) {
  if (!attempts?.length) return <Muted>无渠道请求重试</Muted>
  return (
    <div className="flex flex-col gap-2">
      {attempts.map((attempt) => {
        const ok = attempt.status === 'success'
        return (
          <Card key={attempt.attempt_no} size="sm" className="p-3 shadow-none">
            <div className="flex flex-wrap items-center gap-2">
              <ColorTag color={attempt.attempt_no > 1 ? 'warning' : 'default'}>
                {attempt.attempt_no === 1 ? '首次渠道请求' : `渠道请求重试 ${attempt.attempt_no - 1}`}
              </ColorTag>
              <ColorTag color={ok ? 'success' : 'error'}>{ok ? '成功' : '失败'}</ColorTag>
              {attempt.upstream_status != null && <ColorTag>HTTP {attempt.upstream_status}</ColorTag>}
              <Muted>开始 {formatLogTime(attempt.started_at).full}</Muted>
              <Muted>结束 {formatLogTime(attempt.finished_at).full}</Muted>
              <Muted>用时 {formatSeconds(attempt.duration_ms)}</Muted>
            </div>
            {!ok && attempt.error && (
              <div className="mt-1.5 break-words text-red-600 dark:text-red-400">
                {formatLogError(attempt.error)}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function AttemptsView({
  attempts,
  currentLogId,
  onNavigate,
}: {
  attempts: RequestLogAttempt[]
  currentLogId: number
  onNavigate: (id: number) => void
}) {
  if (!attempts.length) {
    return <Muted>无重试记录</Muted>
  }

  return (
    <div className="flex flex-col gap-2">
      {[...attempts]
        .sort((a, b) => (a.attempt_no || a.time || 0) - (b.attempt_no || b.time || 0))
        .map((attempt, index) => {
          const ok = !!attempt.success
          const status = ok ? '成功' : attempt.status || '失败'
          const totalTokens =
            (attempt.prompt_tokens || 0) + (attempt.completion_tokens || 0)

          return (
            <Card key={attempt.id || index} size="sm" className="p-3 shadow-none">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                {index > 0 && <Muted>→</Muted>}
                <ColorTag color="processing">Attempt {attempt.attempt_no ?? index + 1}</ColorTag>
                {(attempt.routing_detail?.inner_retry_index || 0) > 0 ? (
                  <ColorTag color="warning">
                    渠道内重试 {attempt.routing_detail!.inner_retry_index!}/{Math.max(1, (attempt.routing_detail?.inner_retry_limit || 1) - 1)}
                  </ColorTag>
                ) : (
                  <ColorTag>候选 {(attempt.routing_detail?.outer_retry_index || 0) + 1}</ColorTag>
                )}
                {attempt.id === currentLogId ? (
                  <ColorTag>DB #{attempt.id}</ColorTag>
                ) : (
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => onNavigate(attempt.id)}
                  >
                    DB #{attempt.id}
                  </Button>
                )}
                <ColorTag color={ok ? 'success' : 'error'}>{status}</ColorTag>
                <ColorTag>
                  {attempt.provider_remark || attempt.provider_name || '-'} / {attempt.account_username || '-'} /{' '}
                  {attempt.model || '-'}
                </ColorTag>
                {attempt.archived && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <ColorTag>已归档</ColorTag>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>该 attempt 已归档，仅保留元数据，正文为空</TooltipContent>
                  </Tooltip>
                )}
                {attempt.payload_truncated && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <ColorTag color="orange">正文省略</ColorTag>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>写入队列压力下正文被剥离，仅保留元数据</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Muted>{attempt.time ? formatLogTime(attempt.time).short : '时间未知'}</Muted>
                <Muted>
                  · 完成于 {attempt.time ? formatLogTime(attempt.time + ((attempt.duration_ms || 0) / 1000)).short : '-'}
                </Muted>
                <Muted>· 用时 {formatSeconds(attempt.duration_ms)}</Muted>
                <Muted>· TTFT {formatSeconds(attempt.first_token_ms)}</Muted>
                <Muted>
                  · Token {totalTokens}（入 {attempt.prompt_tokens || 0} / 出{' '}
                  {attempt.completion_tokens || 0}）
                </Muted>
                {(attempt.estimated_prompt_tokens || 0) > 0 && (
                  <Muted>· 预测输入 {attempt.estimated_prompt_tokens}</Muted>
                )}
                {(attempt.cached_tokens || 0) > 0 && <ColorTag>缓存读 {attempt.cached_tokens}</ColorTag>}
                {(attempt.cache_creation_tokens || 0) > 0 && (
                  <ColorTag color="warning">缓存写 {attempt.cache_creation_tokens}</ColorTag>
                )}
              </div>
              {!ok && attempt.error_preview && (
                <div className="mt-1.5 break-words text-red-600 dark:text-red-400">
                  {formatLogError(attempt.error_preview)}
                </div>
              )}
            </Card>
          )
        })}
    </div>
  )
}

// ==================== 详情弹窗 ====================

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  if (!text) return null
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard
          .writeText(text)
          .then(() => toast.success('已复制'))
          .catch(() => toast.error('复制失败'))
      }}
    >
      <Copy className="size-3.5" />
      {label}
    </Button>
  )
}

/** 详情基础信息网格（对齐 antd Descriptions bordered column=3）。 */
function InfoGrid({ items }: { items: { key: string; label: ReactNode; children: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-1 border-b border-r p-2.5 last:border-r">
          <span className="text-xs text-muted-foreground">{item.label}</span>
          <div className="text-[13px]">{item.children}</div>
        </div>
      ))}
    </div>
  )
}

function DetailModal({
  logId,
  onClose,
  onNavigate,
}: {
  logId: number
  onClose: () => void
  onNavigate: (id: number) => void
}) {
  const [detail, setDetail] = useState<RequestLogDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setDetail(null)
    getRequestLogDetail(logId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setDetail(value)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '加载详情失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
    }
  }, [logId, reloadKey])

  const requestBody = detail ? parseJsonObject(detail.request_body) : {}
  const requestHeaders = detail ? parseJsonObject(detail.request_headers) : {}
  const routerRequestBody = detail ? parseJsonObject(detail.router_request_body) : {}
  const routerRequestHeaders = detail ? parseJsonObject(detail.router_request_headers) : {}
  const routerResponseBody = detail ? parseJsonRaw(detail.router_response_body) : null
  const responseBody = detail ? parseJsonRaw(detail.response_body) : null
  const responseHeaders = detail ? parseJsonObject(detail.response_headers) : {}

  const baseInfoItems = detail
    ? [
        { key: 'id', label: '日志 ID', children: `#${detail.id ?? logId}` },
        {
          key: 'request_id',
          label: '请求 ID',
          children: <code className="rounded bg-muted px-1">{detail.request_id || '-'}</code>,
        },
        {
          key: 'attempt',
          label: '尝试序号',
          children: (() => {
            const totalAttempts = (detail.attempts?.length ?? 0) + 1
            const no = detail.attempt_no ?? 1
            return (
              <span className="flex flex-wrap items-center gap-1">
                <code className="rounded bg-muted px-1">
                  第 {no} / {totalAttempts} 次
                </code>
                {totalAttempts > 1 && <ColorTag color="warning">共 {totalAttempts} 次</ColorTag>}
                {detail.payload_truncated && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <ColorTag color="orange">正文省略</ColorTag>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      该条日志因写入队列压力被剥离正文（请求/响应体、请求头），仅保留元数据
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
            )
          })(),
        },
        {
          key: 'provider',
          label: '渠道',
          children: <ColorTag color="processing">{detail.provider_remark || detail.provider_name || '-'}</ColorTag>,
        },
        { key: 'account', label: '账号', children: <ColorTag>{detail.account_username || '-'}</ColorTag> },
        { key: 'client', label: '客户端', children: <ColorTag>{clientTypeLabel(detail.client_type)}</ColorTag> },
        {
          key: 'session',
          label: '会话 ID',
          children: <code className="rounded bg-muted px-1">{detail.session_id || '-'}</code>,
        },
        {
          key: 'editor',
          label: 'Editor ID',
          children: <code className="rounded bg-muted px-1">{detail.editor_id || '-'}</code>,
        },
        {
          key: 'editor_session',
          label: 'Editor Session',
          children: <code className="rounded bg-muted px-1">{detail.editor_session_id || '-'}</code>,
        },
        {
          key: 'model',
          label: '模型',
          children:
            detail.actual_model &&
            detail.actual_model !== (detail.requested_model || detail.model) ? (
              <span>
                <span className="block text-muted-foreground line-through">
                  {detail.requested_model || detail.model || '-'}
                </span>
                <span style={{ color: 'var(--blue)' }}>→ {detail.actual_model}</span>
              </span>
            ) : (
              <span style={{ color: 'var(--blue)' }}>
                {detail.requested_model || detail.model || '-'}
              </span>
            ),
        },
        {
          key: 'upstream_model',
          label: '上游返回模型',
          children: detail.upstream_returned_model ? (
            <code className="rounded bg-muted px-1" style={{ color: 'var(--blue)' }}>
              {detail.upstream_returned_model}
            </code>
          ) : (
            '-'
          ),
        },
        {
          key: 'endpoint',
          label: '客户端请求路径',
          children: <code className="rounded bg-muted px-1">{detail.endpoint || '-'}</code>,
        },
        {
          key: 'router_path',
          label: '渠道请求路径',
          children: <code className="rounded bg-muted px-1">{detail.router_request_path || '-'}</code>,
        },
        {
          key: 'proxy',
          label: '实际代理',
          children: <ProxyInfoView info={detail.proxy_info} />,
        },
        { key: 'api_key', label: 'API Key', children: detail.api_key_name || '-' },
        {
          key: 'duration',
          label: '耗时 / 首字',
          children: (
            <span className="flex flex-wrap items-center gap-1">
              <span>
                渠道 {formatSeconds(detail.duration_ms)} / TTFT{' '}
                {formatSeconds(detail.first_token_ms)}
              </span>
              <ColorTag color="processing">
                合计 {formatSeconds(detail.total_duration_ms ?? (
                  (detail.duration_ms || 0) + (detail.attempts || []).reduce(
                    (sum, attempt) => sum + (attempt.duration_ms || 0), 0
                  )
                ))} · {detail.actual_attempt_count ?? (detail.attempts.length + 1)} 次请求
              </ColorTag>
              <ColorTag color={(detail.route_duration_ms || 0) > 1000 ? 'warning' : 'default'}>
                选路 {formatSeconds(detail.route_duration_ms)}
              </ColorTag>
              {detail.routing_redis_degraded && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <ColorTag color="error">Redis 降级</ColorTag>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {`Redis 选路已降级${detail.redis_timeout_stage ? `：${detail.redis_timeout_stage}` : ''}`}
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
          ),
        },
        {
          key: 'routing_timing',
          label: '选路分段',
          children: (
            <span className="flex flex-wrap items-center gap-1">
              <ColorTag>候选 {formatSeconds(detail.candidate_collect_ms)}</ColorTag>
              <ColorTag>策略 {formatSeconds(detail.strategy_select_ms)}</ColorTag>
              <ColorTag>预占 {formatSeconds(detail.account_reserve_ms)}</ColorTag>
            </span>
          ),
        },
        {
          key: 'routing_detail',
          label: '候选准备细分',
          children: (
            <span className="flex flex-wrap items-center gap-1">
              <ColorTag>组判断 {formatSeconds(detail.routing_detail?.model_group_check_ms)}</ColorTag>
              <ColorTag>策略配置 {formatSeconds(detail.routing_detail?.strategy_config_ms)}</ColorTag>
              <ColorTag>组成员 {formatSeconds(detail.routing_detail?.candidate_group_members_ms)}</ColorTag>
              <ColorTag>元数据 {formatSeconds(detail.routing_detail?.candidate_metadata_ms)}</ColorTag>
              <ColorTag>渠道过滤 {formatSeconds(detail.routing_detail?.provider_filter_ms)}</ColorTag>
              <ColorTag>模型 TPM 内存 {formatSeconds(detail.routing_detail?.candidate_tpm_check_ms)}</ColorTag>
              <ColorTag>能力检查 {formatSeconds(detail.routing_detail?.candidate_operation_check_ms)}</ColorTag>
              <ColorTag>流量因子 {formatSeconds(detail.routing_detail?.candidate_volume_factor_ms)}</ColorTag>
              <ColorTag>候选扫描 {formatSeconds(detail.routing_detail?.candidate_scan_ms)}</ColorTag>
            </span>
          ),
        },
        {
          key: 'stream',
          label: '流式',
          children: detail.stream ? (
            <ColorTag color="processing">是</ColorTag>
          ) : (
            <ColorTag>否</ColorTag>
          ),
        },
        {
          key: 'tokens',
          label: 'Token',
          children: (
            <span className="flex flex-wrap items-center gap-1">
              {(detail.estimated_prompt_tokens || 0) > 0 && (
                <ColorTag>预测输入 {detail.estimated_prompt_tokens}</ColorTag>
              )}
              <ColorTag color="processing">输入 {detail.prompt_tokens || 0}</ColorTag>
              <ColorTag color="processing">输出 {detail.completion_tokens || 0}</ColorTag>
              {(detail.cached_tokens || 0) > 0 && <ColorTag>缓存读 {detail.cached_tokens}</ColorTag>}
              {(detail.cache_creation_tokens || 0) > 0 && (
                <ColorTag color="warning">缓存写入 {detail.cache_creation_tokens}</ColorTag>
              )}
            </span>
          ),
        },
        { key: 'status', label: '结果', children: statusTag(detail) },
        {
          key: 'upstream_status',
          label: '上游状态',
          children: <code className="rounded bg-muted px-1">{detail.upstream_status || '-'}</code>,
        },
      ]
    : []

  const panelItems = detail
    ? [
        {
          key: 'request',
          label: '请求参数',
          extra: <CopyButton text={jsonToCopyText(requestBody)} />,
          children: <JsonView data={requestBody} />,
        },
        {
          key: 'messages',
          label: `消息体${Array.isArray(requestBody.messages) ? ` (${requestBody.messages.length})` : ''}`,
          extra: <CopyButton text={jsonToCopyText(requestBody.messages)} />,
          children: <MessagesView messages={requestBody.messages} />,
        },
        {
          key: 'req_headers',
          label: '请求头',
          extra: <CopyButton text={jsonToCopyText(requestHeaders)} />,
          children: <JsonView data={requestHeaders} />,
        },
        {
          key: 'response',
          label: '响应体',
          extra: <CopyButton text={rawToCopyText(responseBody)} />,
          children: <RawValueView value={responseBody} />,
        },
        {
          key: 'attempts',
          label: `请求记录${detail.attempts.length + 1 ? ` (${detail.attempts.length + 1})` : ''}`,
          extra: null,
          children: (
            <AttemptsView
              attempts={[detail, ...detail.attempts]}
              currentLogId={logId}
              onNavigate={onNavigate}
            />
          ),
        },
        {
          key: 'router_req',
          label: '渠道请求体',
          extra: <CopyButton text={jsonToCopyText(routerRequestBody)} />,
          children: <JsonView data={routerRequestBody} />,
        },
        {
          key: 'router_req_headers',
          label: '渠道请求头',
          extra: <CopyButton text={jsonToCopyText(routerRequestHeaders)} />,
          children: <JsonView data={routerRequestHeaders} />,
        },
        {
          key: 'router_resp',
          label: '渠道响应体',
          extra: <CopyButton text={rawToCopyText(routerResponseBody)} />,
          children: <RawValueView value={routerResponseBody} />,
        },
        {
          key: 'resp_headers',
          label: '渠道响应头',
          extra: <CopyButton text={jsonToCopyText(responseHeaders)} />,
          children: <JsonView data={responseHeaders} />,
        },
        {
          key: 'channel_retry_attempts',
          label: `渠道请求明细${detail.channel_retry_attempts?.length ? ` (${detail.channel_retry_attempts.length})` : ''}`,
          extra: null,
          children: <ChannelRetryAttemptsView attempts={detail.channel_retry_attempts} />,
        },
        {
          key: 'security',
          label: `安全事件${detail.security_events?.length ? ` (${detail.security_events.length})` : ''}`,
          extra: null,
          children:
            detail.security_events && detail.security_events.length > 0 ? (
              <SecurityEventsView events={detail.security_events} />
            ) : (
              <Muted>无安全事件</Muted>
            ),
        },
      ]
    : []

  const defaultPanels =
    detail &&
    ((detail.security_events?.length ?? 0) > 0 || detail.status === 'security_blocked')
      ? ['security']
      : []

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        className="flex max-h-[92dvh] w-[92vw] max-w-[1400px] flex-col gap-4 overflow-hidden sm:max-w-[1400px]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>请求详情 #{logId}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2 pr-2">
          {loading && (
            <div className="flex justify-center py-10">
              <Spinner className="size-6" />
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>加载详情失败</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <span>{error}</span>
                  <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                    重试
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {detail && (
            <>
              {detail.archived && (
                <Alert>
                  <AlertTitle>该日志已归档，仅保留元数据</AlertTitle>
                  <AlertDescription>
                    归档日志不再保留请求/响应体与请求头等大字段内容，下方 body 相关面板为空。
                  </AlertDescription>
                </Alert>
              )}
              <InfoGrid items={baseInfoItems} />
              <Accordion type="multiple" defaultValue={defaultPanels} className="w-full">
                {panelItems.map((panel) => (
                  <AccordionItem key={panel.key} value={panel.key}>
                    <div className="flex items-center justify-between gap-2">
                      <AccordionTrigger className="flex-1 py-2.5">{panel.label}</AccordionTrigger>
                      {panel.extra ? <div className="shrink-0">{panel.extra}</div> : null}
                    </div>
                    <AccordionContent>
                      <div className="max-h-[60dvh] overflow-auto overscroll-contain pb-2 pr-2">
                        {panel.children}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ==================== 分页 ====================

/**
 * 分页控件：条数汇总 + 每页条数选择 + 首页/上一页/页码跳转/下一页/末页。
 * 页码支持直接输入跳转（回车或失焦生效，越界自动夹到 [1, totalPages]）。
 */
function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (p: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const [jumpValue, setJumpValue] = useState('')

  const commitJump = () => {
    if (!jumpValue) return
    const raw = Number(jumpValue)
    setJumpValue('')
    if (!Number.isFinite(raw)) return
    const target = Math.min(totalPages, Math.max(1, Math.floor(raw)))
    if (target !== page) onPageChange(target)
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(total, page * pageSize)

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pt-3">
      <Muted className="text-[13px]">
        共 {total} 条，第 {rangeStart}-{rangeEnd} 条
      </Muted>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={page <= 1}
            aria-label="首页"
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={page <= 1}
            aria-label="上一页"
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="flex items-center gap-1 px-1 text-[13px]">
            <Input
              className="h-8 w-12 text-center"
              inputMode="numeric"
              value={jumpValue === '' ? String(page) : jumpValue}
              onChange={(e) => setJumpValue(e.target.value.replace(/[^\d]/g, ''))}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitJump}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
            />
            <Muted>/ {totalPages}</Muted>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={page >= totalPages}
            aria-label="下一页"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={page >= totalPages}
            aria-label="末页"
            onClick={() => onPageChange(totalPages)}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ==================== 主组件 ====================

export function RequestLogs() {
  const initialNow = useMemo(() => dayjs(), [])

  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    initialNow.subtract(24, 'hour'),
    initialNow.add(2, 'hour'),
  ])
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [modelFilter, setModelFilter] = useState<string>('')
  const [clientTypeFilter, setClientTypeFilter] = useState<string>('')
  const [sessionIdFilter, setSessionIdFilter] = useState<string>('')
  const [editorIdFilter, setEditorIdFilter] = useState<string>('')
  const [editorSessionIdFilter, setEditorSessionIdFilter] = useState<string>('')
  const [apiKeyFilter, setApiKeyFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [appliedFilters, setAppliedFilters] = useState({
    start_time: initialNow.subtract(24, 'hour').unix(),
    end_time: initialNow.add(2, 'hour').unix(),
    provider_name: '',
    model: '',
    client_type: '',
    session_id: '',
    editor_id: '',
    editor_session_id: '',
    api_key_name: '',
    status: '',
  })

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [providers, setProviders] = useState<{ name: string; remark?: string; models?: string[] }[]>([])
  const modelOptions = useMemo(() => {
    const sourceProviders = providerFilter ? providers.filter((p) => p.name === providerFilter) : providers
    return [...new Set(sourceProviders.flatMap((p) => p.models ?? []))].filter(Boolean).sort()
  }, [providers, providerFilter])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<{ total: number; rows: RequestLog[] } | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getApiKeys()
      .then((value) => {
        if (!cancelled) setApiKeys(value.keys || [])
      })
      .catch(() => {})
    getProviders({ lite: true })
      .then((value) => {
        if (!cancelled) setProviders(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const buildQuery = useCallback(
    (targetPage: number, targetPageSize: number): RequestLogQuery => {
      const query: RequestLogQuery = {
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
        start_time: appliedFilters.start_time,
        end_time: appliedFilters.end_time,
      }
      if (appliedFilters.provider_name) query.provider_name = appliedFilters.provider_name
      if (appliedFilters.model) query.model = appliedFilters.model
      if (appliedFilters.client_type) query.client_type = appliedFilters.client_type
      if (appliedFilters.session_id) query.session_id = appliedFilters.session_id
      if (appliedFilters.editor_id) query.editor_id = appliedFilters.editor_id
      if (appliedFilters.editor_session_id) query.editor_session_id = appliedFilters.editor_session_id
      if (appliedFilters.api_key_name) query.api_key_name = appliedFilters.api_key_name
      const statusValue = appliedFilters.status
      if (statusValue === 'success') {
        query.success = true
      } else if (statusValue === 'failed') {
        query.success = false
      } else if (statusValue) {
        query.status = statusValue
      }
      return query
    },
    [appliedFilters],
  )

  const fetchData = useCallback(
    async (targetPage: number, targetPageSize: number, signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const result = await getRequestLogs(buildQuery(targetPage, targetPageSize), signal)
        if (signal?.aborted) return
        const raw = result as unknown as {
          total?: number
          rows?: RequestLog[]
          items?: RequestLog[]
        }
        const rows = raw.rows ?? raw.items ?? []
        setData({ total: raw.total ?? rows.length, rows })
      } catch (err) {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : '加载数据失败')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [buildQuery],
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchData(page, pageSize, controller.signal)
    return () => controller.abort()
  }, [fetchData, page, pageSize])

  const handleQuery = () => {
    const start = fromDayjs(range[0])
    const end = fromDayjs(range[1])
    if (start === null || end === null || start > end) {
      toast.warning('请选择有效时间范围')
      return
    }
    setAppliedFilters({
      start_time: start,
      end_time: end,
      provider_name: providerFilter,
      model: modelFilter,
      client_type: clientTypeFilter,
      session_id: sessionIdFilter,
      editor_id: editorIdFilter,
      editor_session_id: editorSessionIdFilter,
      api_key_name: apiKeyFilter,
      status: statusFilter,
    })
    setPage(1)
  }

  const handleReset = () => {
    const now = dayjs()
    const start = now.subtract(24, 'hour')
    const end = now.add(2, 'hour')
    setRange([start, end])
    setProviderFilter('')
    setModelFilter('')
    setClientTypeFilter('')
    setSessionIdFilter('')
    setEditorIdFilter('')
    setEditorSessionIdFilter('')
    setApiKeyFilter('')
    setStatusFilter('')
    setAppliedFilters({
      start_time: start.unix(),
      end_time: end.unix(),
      provider_name: '',
      model: '',
      client_type: '',
      session_id: '',
      editor_id: '',
      editor_session_id: '',
      api_key_name: '',
      status: '',
    })
    setPage(1)
  }

  const total = data?.total ?? 0
  const rows = data?.rows ?? []
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage
      title="请求日志"
      description="查看所有 API 请求的详细记录和状态"
      contentStyle={{ gap: 16 }}
      primaryActions={
        <ManagerRefreshButton loading={loading} onClick={() => void fetchData(page, pageSize)} />
      }
    >
      {/* 筛选栏 */}
      <Card size="sm" className="shrink-0 p-4 shadow-none">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="时间范围">
            <TimeRangePicker range={range} onChange={setRange} />
          </FilterField>

          <FilterField label="渠道">
            <SearchSelect
              value={providerFilter}
              onChange={(v) => { setProviderFilter(v); setModelFilter('') }}
              placeholder="全部"
              width={180}
              options={providers
                .map((p) => ({ label: p.remark || p.name, value: p.name }))
                .filter((item) => item.value)
                .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))}
            />
          </FilterField>

          <FilterField label="模型">
            <SearchSelect
              value={modelFilter}
              onChange={setModelFilter}
              placeholder="全部"
              width={180}
              options={modelOptions.map((m) => ({ label: m, value: m }))}
            />
          </FilterField>

          <FilterField label="客户端">
            <SearchSelect
              value={clientTypeFilter}
              onChange={setClientTypeFilter}
              placeholder="全部"
              width={130}
              options={CLIENT_TYPE_OPTIONS.map((c) => ({ label: c, value: c }))}
            />
          </FilterField>

          <FilterField label="API Key">
            <ApiKeyTreeSelect
              value={apiKeyFilter}
              onChange={setApiKeyFilter}
              apiKeys={apiKeys}
            />
          </FilterField>

          <FilterField label="会话 ID">
            <Input
              placeholder="模糊匹配"
              className="h-9 w-[180px]"
              value={sessionIdFilter}
              onChange={(e) => setSessionIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuery()
              }}
            />
          </FilterField>

          <FilterField label="Editor ID">
            <Input
              placeholder="精确匹配"
              className="h-9 w-[180px]"
              value={editorIdFilter}
              onChange={(e) => setEditorIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuery()
              }}
            />
          </FilterField>

          <FilterField label="Editor Session">
            <Input
              placeholder="精确匹配"
              className="h-9 w-[180px]"
              value={editorSessionIdFilter}
              onChange={(e) => setEditorSessionIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuery()
              }}
            />
          </FilterField>

          <div className="flex shrink-0 items-end gap-3">
            <FilterField label="状态">
              <Select
                value={statusFilter || ALL}
                onValueChange={(v) => setStatusFilter(v === ALL ? '' : v)}
              >
                <SelectTrigger className="h-9 w-[120px]">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部</SelectItem>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <Button onClick={handleQuery} disabled={loading}>
              {loading ? <Spinner className="size-4" /> : <Search className="size-4" />}
              查询
            </Button>

            <Button variant="outline" onClick={handleReset} disabled={loading}>
              <Eraser className="size-4" />
              重置
            </Button>
          </div>
        </div>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <span>{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void fetchData(page, pageSize)}
              >
                <RefreshCw className="size-4" />
                重试
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 数据表格 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div className="min-w-0 rounded-md border">
            <Table className="min-w-[1290px] table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[76px] text-center">ID</TableHead>
                <TableHead className="w-[90px] text-center">创建时间</TableHead>
                <TableHead className="w-[110px] text-center">客户端 / 会话ID</TableHead>
                <TableHead className="w-[122px] text-center">渠道 / 账号</TableHead>
                <TableHead className="w-[92px] text-center">API Key</TableHead>
                <TableHead className="w-[180px] text-center">模型</TableHead>
                <TableHead className="w-[125px] text-center">用时 / 首字</TableHead>
                <TableHead className="w-[135px] text-center">输入 / 输出</TableHead>
                <TableHead className="w-[64px] text-center">尝试</TableHead>
                <TableHead className="w-[82px] text-center">结果</TableHead>
                <TableHead className="w-[200px] text-center">异常内容</TableHead>
                <TableHead className="w-[70px] text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                    {loading ? '加载中...' : '暂无日志'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((record) => {
                  // 后端按 provider_name 补了 provider_remark（渠道备注/显示名）；
                  // 渠道已删除时 remark 为空，回落到 provider_name（即渠道 id）。
                  const providerDisplay = record.provider_remark || record.provider_name || '-'
                  const requestedModel = record.requested_model || record.model || '-'
                  const actualModel = record.actual_model || record.model || ''
                  const hasDiff = !!actualModel && actualModel !== requestedModel
                  const ttft =
                    record.stream && record.success && record.first_token_ms != null
                      ? formatSeconds(record.first_token_ms)
                      : '-'
                  const totalTokens =
                    (record.prompt_tokens || 0) +
                    (record.completion_tokens || 0) +
                    (record.cached_tokens || 0) +
                    (record.cache_creation_tokens || 0)
                  const errorText = formatLogError(record.error_preview)
                  const displayErrorText =
                    errorText.length > 30 ? `${errorText.slice(0, 30)}...` : errorText
                  const attemptNo = record.attempt_no ?? 1
                  const logTime = formatLogTime(record.time)

                  return (
                    <TableRow key={record.id}>
                      <TableCell className="text-center">
                        <code className="text-muted-foreground">{record.id}</code>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center text-[13px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{logTime.short}</span>
                          </TooltipTrigger>
                          <TooltipContent>{logTime.full}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <ColorTag>{clientTypeLabel(record.client_type)}</ColorTag>
                          {record.session_id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <code className="block max-w-[90px] truncate text-[11px] text-muted-foreground">
                                  {record.session_id}
                                </code>
                              </TooltipTrigger>
                              <TooltipContent>{record.session_id}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div
                          className="flex w-full min-w-0 cursor-pointer flex-col items-center gap-0.5"
                          onClick={() => {
                            // 日志里的 provider_name 就是渠道 id（后端 id 即 name），直接用，无需反查列表。
                            if (record.provider_name) setEditingProviderId(record.provider_name)
                          }}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="block max-w-full truncate font-bold underline"
                                style={{ color: 'var(--blue)' }}
                              >
                                {providerDisplay}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{providerDisplay}</TooltipContent>
                          </Tooltip>
                          <Muted className="block max-w-full truncate text-[13px]">
                            {record.account_username || '-'}
                          </Muted>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-[13px]">
                        <span className="block max-w-full truncate">{record.api_key_name || '-'}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code
                                className={cn(
                                  'block max-w-full truncate',
                                  hasDiff && 'text-muted-foreground line-through opacity-70',
                                )}
                                style={hasDiff ? undefined : { color: 'var(--blue)' }}
                              >
                                {requestedModel}
                              </code>
                            </TooltipTrigger>
                            <TooltipContent>{requestedModel}</TooltipContent>
                          </Tooltip>
                          {hasDiff && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <code
                                  className="block max-w-full truncate font-bold"
                                  style={{ color: 'var(--blue)' }}
                                >
                                  {actualModel}
                                </code>
                              </TooltipTrigger>
                              <TooltipContent>{actualModel}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <div>
                            <span className="font-bold">{formatSeconds(record.duration_ms)}</span>
                            <Muted className="ml-1">/ {ttft}</Muted>
                            {record.stream && <ColorTag color="processing" className="ml-1">流</ColorTag>}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <ColorTag color={(record.route_duration_ms || 0) > 1000 ? 'warning' : 'default'}>
                                  选路 {formatSeconds(record.route_duration_ms)}
                                </ColorTag>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {`候选 ${formatSeconds(record.candidate_collect_ms)} / 策略 ${formatSeconds(record.strategy_select_ms)} / 预占 ${formatSeconds(record.account_reserve_ms)}`}
                            </TooltipContent>
                          </Tooltip>
                          {record.routing_redis_degraded && <ColorTag color="error">Redis 降级</ColorTag>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {!totalTokens ? (
                          (record.estimated_prompt_tokens || 0) > 0 ? (
                            <Muted>预测入 {record.estimated_prompt_tokens}</Muted>
                          ) : (
                            <Muted>-</Muted>
                          )
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              <ColorTag color="processing">入 {record.prompt_tokens || 0}</ColorTag>
                              <ColorTag color="processing">出 {record.completion_tokens || 0}</ColorTag>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {(record.estimated_prompt_tokens || 0) > 0 && (
                                <ColorTag>预测入 {record.estimated_prompt_tokens}</ColorTag>
                              )}
                              {(record.cached_tokens || 0) > 0 && <ColorTag>缓存读 {record.cached_tokens}</ColorTag>}
                              {(record.cache_creation_tokens || 0) > 0 && (
                                <ColorTag color="warning">写 {record.cache_creation_tokens}</ColorTag>
                              )}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <ColorTag color={attemptNo > 1 ? 'warning' : 'default'}>{attemptNo}</ColorTag>
                          {record.payload_truncated && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <ColorTag color="orange">正文省略</ColorTag>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>写入队列压力下正文被剥离，仅保留元数据</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{statusTag(record)}</TableCell>
                      <TableCell className="text-center">
                        {!errorText ? (
                          <Muted>-</Muted>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  'block whitespace-normal break-words text-[13px]',
                                  record.status === 'security_blocked'
                                    ? 'text-yellow-600 dark:text-yellow-500'
                                    : 'text-red-600 dark:text-red-400',
                                )}
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  maxHeight: 42,
                                }}
                              >
                                {displayErrorText}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[400px] break-words">{errorText}</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant="outline" onClick={() => setDetailId(record.id)}>
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        {/* 分页 */}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      </div>

      {/* 详情弹窗 */}
      {detailId !== null && (
        <DetailModal logId={detailId} onClose={() => setDetailId(null)} onNavigate={setDetailId} />
      )}

      {/* 渠道编辑弹窗：任何页面只传渠道 id，弹窗自己加载和执行增删改。 */}
      {editingProviderId && (
        <UnifiedProviderModal
          open
          providerId={editingProviderId}
          onClose={() => setEditingProviderId(null)}
          onChanged={() => { void fetchData(page, pageSize) }}
        />
      )}

    </AdminPage>
  )
}

export default RequestLogs
