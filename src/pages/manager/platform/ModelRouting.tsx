/**
 * 自定义模型路由（平台管理页）。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/*`（纯 axios）。
 * 交互、状态、API 调用、校验与错误路径与原版保持一致。
 */
import { useState, useEffect, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Check, ChevronsUpDown, CircleHelp, Copy, Eye, GripVertical, Pencil, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPage, SectionCard } from '@/components/manager/platform-page'
import { ManagerPageActions, ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  createModelGroup,
  deleteModelGroup,
  getModelRouting,
  getModelRoutingWithFallback,
  updateModelGroup,
} from '@/@admin-port/api/modelRouting'
import { getProviderAccounts } from '@/@admin-port/api/providers'
import type { ModelRouteProvider, ModelRoutingResponse, ProviderAccount } from '@/@admin-port/types/admin'
import { UnifiedProviderModal } from './Channels'

// ==================== Draft 类型 ====================

// 一套方案：id 是稳定身份（同组内唯一），name 只是展示标签（可空、可重复、可改名）。
// 同一自定义模型下可多套，但同一时刻只有 activeScheme(=某方案 id) 一套生效，其三字段
// 投影到组顶层 models/白/黑名单。activeScheme 认 id 不认 name——改名不影响激活指向。
interface Scheme {
  id: string
  name: string
  models: string[]
  provider_whitelist: string[]
  provider_blacklist: string[]
  // is_backup：显式标记「作为备用方案」。仅被标记的非激活方案进降级链，按数组顺序降级；
  // 未标记的方案只能手动切换为激活方案，不会自动兜底。备用方案自身不再二次备用。
  is_backup: boolean
}

// 生成同组内唯一的方案 id（时间戳 + 随机后缀，避免同一 tick 连开多套碰撞）。
function newSchemeId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface GroupDraft extends Record<string, unknown> {
  name: string
  remark: string
  enabled: boolean
  aliases: string[]
  models: string[]
  provider_whitelist: string[]
  provider_blacklist: string[]
  backup_model_group: string
  response_model: string
  metadata_model: string
  schemes: Scheme[]
  activeScheme: string // 存激活方案的 id（不是 name）
}

// 无 schemes 的旧组由顶层字段合成的那一套方案名（须与后端 DEFAULT_SCHEME_NAME 一致）。
const DEFAULT_SCHEME_NAME = '默认'

type GroupModalState =
  | { mode: 'create'; draft: GroupDraft }
  | { mode: 'edit'; originalName: string; draft: GroupDraft }

// ==================== 工具函数 ====================

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
    const time = Date.parse(value)
    if (Number.isFinite(time)) return time
  }
  return fallback
}

// 解析后端 schemes 数组；方案身份是 id（不是 name）。id 缺失（旧数据）时按位置补
// 确定性兜底 id，与后端 _normalize_schemes 的 legacy-{序号} 对齐；按 id 去重。
// name 只是展示标签，允许为空、允许重复。
function schemesFromRaw(raw: unknown): Scheme[] {
  if (!Array.isArray(raw)) return []
  const result: Scheme[] = []
  const seen = new Set<string>()
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const schemeId = textValue(record.id).trim() || `legacy-${index}`
    if (seen.has(schemeId)) return
    seen.add(schemeId)
    result.push({
      id: schemeId,
      name: textValue(record.name).trim(),
      models: stringList(record.models),
      provider_whitelist: stringList(record.provider_whitelist),
      provider_blacklist: stringList(record.provider_blacklist),
      is_backup: boolValue(record.is_backup, false),
    })
  })
  return result
}

// 旧组（无 schemes）用顶层三字段合成一条默认方案，保证任何组至少一套方案。
// legacy 组读出的合成方案沿用后端确定性 id（legacy-0），避免每次进出弹框 id 抖动。
function synthesizeDefaultScheme(models: string[], whitelist: string[], blacklist: string[], id = 'legacy-0'): Scheme {
  return {
    id,
    name: DEFAULT_SCHEME_NAME,
    models,
    provider_whitelist: whitelist,
    provider_blacklist: blacklist,
    is_backup: false,
  }
}

function groupDraftFromRaw(name?: string, raw?: Record<string, unknown>): GroupDraft {
  if (!raw) {
    const scheme = synthesizeDefaultScheme([], [], [], newSchemeId())
    return {
      name: name ?? '',
      remark: '',
      enabled: true,
      aliases: [],
      models: [],
      provider_whitelist: [],
      provider_blacklist: [],
      backup_model_group: '',
      response_model: '',
      metadata_model: '',
      schemes: [scheme],
      activeScheme: scheme.id,
    }
  }

  const topModels = stringList(raw.models)
  const topWhitelist = stringList(raw.provider_whitelist)
  const topBlacklist = stringList(raw.provider_blacklist)
  let schemes = schemesFromRaw(raw.schemes)
  if (!schemes.length) {
    schemes = [synthesizeDefaultScheme(topModels, topWhitelist, topBlacklist)]
  }
  // 激活方案按 id 命中（id 是方案身份，绝不按 name 匹配）；落空回落首套。
  const rawActive = textValue(raw.active_scheme).trim()
  const active = schemes.find((s) => s.id === rawActive) ?? schemes[0]

  return {
    name: textValue(raw.name) || name || '',
    remark: textValue(raw.remark),
    enabled: boolValue(raw.enabled, true),
    aliases: stringList(raw.aliases),
    // 顶层三字段 = 激活方案的投影，保证卡片与可用渠道口径一致。
    models: active.models,
    provider_whitelist: active.provider_whitelist,
    provider_blacklist: active.provider_blacklist,
    backup_model_group: textValue(raw.backup_model_group || raw.backup_group),
    response_model: textValue(raw.response_model),
    metadata_model: textValue(raw.metadata_model),
    schemes,
    activeScheme: active.id,
  }
}

// 清洗一套方案：id 保留（身份），name/models/名单去空 trim。name 允许为空、允许重复。
function cleanScheme(scheme: Scheme): Scheme {
  return {
    id: scheme.id,
    name: scheme.name.trim(),
    models: scheme.models.map((m) => m.trim()).filter(Boolean),
    provider_whitelist: scheme.provider_whitelist.map((s) => s.trim()).filter(Boolean),
    provider_blacklist: scheme.provider_blacklist.map((s) => s.trim()).filter(Boolean),
    is_backup: scheme.is_backup === true,
  }
}

function groupPayload(draft: GroupDraft): Record<string, unknown> {
  // 按 id 保留全部方案（name 可空可重，不以 name 过滤）；激活方案按 id 命中。
  const schemes = draft.schemes.map(cleanScheme).filter((s) => s.id)
  const active = schemes.find((s) => s.id === draft.activeScheme.trim()) ?? schemes[0]
  // 顶层三字段 = 激活方案的投影（后端 normalize 也会做，这里带上保证与列表接口一致）。
  return {
    name: draft.name.trim(),
    remark: draft.remark.trim(),
    enabled: draft.enabled,
    aliases: draft.aliases.map((s) => s.trim()).filter(Boolean),
    models: active ? active.models : [],
    provider_whitelist: active ? active.provider_whitelist : [],
    provider_blacklist: active ? active.provider_blacklist : [],
    backup_model_group: draft.backup_model_group.trim() || null,
    response_model: draft.response_model.trim(),
    metadata_model: draft.metadata_model.trim() || null,
    schemes,
    active_scheme: active ? active.id : '',
  }
}

function modelName(raw: Record<string, unknown>): string {
  return textValue(raw.model_id || raw.id || raw.name || raw.upstream_model_id)
}

function providerFilterSummary(record: Record<string, unknown>): string {
  const whitelist = stringList(record.provider_whitelist)
  const blacklist = stringList(record.provider_blacklist)
  if (whitelist.length) return `白名单：${whitelist.join(', ')}`
  if (blacklist.length) return `黑名单：${blacklist.join(', ')}`
  return '不限制渠道'
}

// 单个可用渠道视图：渠道 + 命中的成员模型 + 渠道账号
interface AvailableChannel {
  name: string
  remark: string
  enabled: boolean
  accounts: string[]
  matchedModels: string[]
}

// 计算某自定义模型的可用渠道：与后端 model_group_allows_provider 一致的白/黑名单判定，
// 叠加"渠道确实承载该组任一成员模型"的交集判定。只读展示，不改变路由行为。
function computeAvailableChannels(draft: GroupDraft, providers: ModelRouteProvider[]): AvailableChannel[] {
  const whitelist = new Set(draft.provider_whitelist)
  const blacklist = new Set(draft.provider_blacklist)
  const groupModels = new Set(draft.models)
  const result: AvailableChannel[] = []
  for (const provider of providers) {
    const tags = new Set(stringList(provider.tags))
    if (whitelist.size && !Array.from(whitelist).some((tag) => tags.has(tag))) continue
    if (blacklist.size && Array.from(blacklist).some((tag) => tags.has(tag))) continue
    const matchedModels = (provider.models ?? []).filter((model) => groupModels.has(model))
    if (!matchedModels.length) continue
    result.push({
      name: provider.name,
      remark: provider.remark || '',
      enabled: provider.enabled !== false,
      accounts: provider.accounts ?? [],
      matchedModels,
    })
  }
  return result
}

// 卡片上模型/渠道过滤标签的最大展示数量，超出折叠为"+N"
const CARD_TAG_LIMIT = 5

// ==================== 色调与标签 ====================

type StatusTone = 'green' | 'yellow' | 'red' | 'muted'

const TONE_TEXT: Record<StatusTone, string> = {
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  red: 'text-red-600 dark:text-red-400',
  muted: 'text-muted-foreground',
}

const TONE_DOT: Record<StatusTone, string> = {
  green: 'bg-green-600 dark:bg-green-400',
  yellow: 'bg-yellow-600 dark:bg-yellow-400',
  red: 'bg-red-600 dark:bg-red-400',
  muted: 'bg-muted-foreground',
}

// antd Tag color → tailwind 边框/文字色
type TagTone = 'green' | 'purple' | 'blue' | 'orange' | 'geekblue' | 'cyan' | 'default'
const TAG_TONE: Record<TagTone, string> = {
  green: 'border-green-600/40 text-green-700 dark:border-green-400/40 dark:text-green-400',
  purple: 'border-purple-600/40 text-purple-700 dark:border-purple-400/40 dark:text-purple-400',
  blue: 'border-blue-600/40 text-blue-700 dark:border-blue-400/40 dark:text-blue-400',
  orange: 'border-orange-600/40 text-orange-700 dark:border-orange-400/40 dark:text-orange-400',
  geekblue: 'border-indigo-600/40 text-indigo-700 dark:border-indigo-400/40 dark:text-indigo-400',
  cyan: 'border-cyan-600/40 text-cyan-700 dark:border-cyan-400/40 dark:text-cyan-400',
  default: '',
}

function ColorTag({ tone, className, children }: { tone: TagTone; className?: string; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn(TAG_TONE[tone], className)}>
      {children}
    </Badge>
  )
}

// 卡片上的渠道过滤：白/黑名单以标签展示并截断到前 N 个，其余折叠为"+N"；不限制时给一句说明。
// 标签文案取渠道备注名（resolveLabel），白名单用绿色、黑名单用橙色区分。
function renderFilterTags(record: Record<string, unknown>, resolveLabel: (name: string) => string): ReactNode {
  const whitelist = stringList(record.provider_whitelist)
  const blacklist = stringList(record.provider_blacklist)
  const items = whitelist.length ? whitelist : blacklist
  if (!items.length) {
    return <span className="text-[13px] text-muted-foreground">不限制渠道</span>
  }
  const tone: TagTone = whitelist.length ? 'green' : 'orange'
  const overflow = items.slice(CARD_TAG_LIMIT)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.slice(0, CARD_TAG_LIMIT).map((item) => (
        <ColorTag key={item} tone={tone}>{resolveLabel(item)}</ColorTag>
      ))}
      {overflow.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <ColorTag tone={tone}>+{overflow.length}</ColorTag>
            </span>
          </TooltipTrigger>
          <TooltipContent>{overflow.map(resolveLabel).join('、')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

// 账号状态徽标：与渠道页 getAccountBadge 口径一致（已冻结 > 已禁用 > 认证态）
type AccountBadge = { label: string; tone: StatusTone }
function getAccountBadge(a: ProviderAccount): AccountBadge {
  if (a.cooldown) return { label: '已冻结', tone: 'yellow' }
  if (a.switch === false) return { label: '已禁用', tone: 'muted' }
  if (a.auth === true) return { label: '已认证', tone: 'green' }
  if (a.auth === false) {
    if (a.auth_error?.includes('等待自动刷新')) return { label: '已过期', tone: 'yellow' }
    if (a.auth_error?.includes('需人工')) return { label: '需重新登录', tone: 'red' }
    return { label: '未认证', tone: 'red' }
  }
  return { label: '待检查', tone: 'muted' }
}

// 渠道级状态：由账号态聚合。有可用账号（已认证且未冻结未禁用）即为"可用"，
// 否则若全部冻结/禁用/未认证则相应降级；无账号则"无可用账号"。
function summarizeChannelStatus(enabled: boolean, accounts: ProviderAccount[] | undefined): AccountBadge {
  if (!enabled) return { label: '渠道已禁用', tone: 'muted' }
  if (accounts === undefined) return { label: '加载中', tone: 'muted' }
  if (!accounts.length) return { label: '无账号', tone: 'muted' }
  const usable = accounts.some((a) => a.switch !== false && !a.cooldown && a.auth === true)
  if (usable) return { label: '可用', tone: 'green' }
  if (accounts.every((a) => a.switch === false)) return { label: '账号全禁用', tone: 'muted' }
  if (accounts.some((a) => a.cooldown)) return { label: '账号冻结中', tone: 'yellow' }
  return { label: '无可用账号', tone: 'red' }
}

// ==================== 样式 ====================

const gridStyle: CSSProperties = {
  display: 'grid',
  // 卡片最小宽度取 420px：保证底部四个操作按钮（详情/渠道状态/复制/删除）恒定同行不换行。
  gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
  gap: '14px',
}

const channelsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: '12px',
}

// ==================== 通用小组件 ====================

// 带问号提示的字段标题。真实模型选路弹框（RealModelRouting）复用同一套，保证两处口径一致。
export function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <Label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-foreground">
      <span>{label}</span>
      {hint ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-muted-foreground">
              <CircleHelp className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">{hint}</TooltipContent>
        </Tooltip>
      ) : null}
    </Label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <FieldLabel label={label} hint={hint} />
      {children}
    </div>
  )
}

export interface Option {
  value: string
  label: string
}

// 渠道白/黑名单/模型搜索：同时按 value 与 label 过滤（对齐原 providerFilterOption）
function optionMatches(option: Option, keyword: string): boolean {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  return option.value.toLowerCase().includes(k) || option.label.toLowerCase().includes(k)
}

// 多选：Popover + Command 手动过滤（替代 antd Select mode="multiple"）
// 真实模型选路弹框复用同一控件，两处渠道标签选择行为一致。
export function MultiSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string[]
  onChange: (value: string[]) => void
  options: Option[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedSet = new Set(value)
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(value.filter((item) => item !== v))
    else onChange([...value, v])
  }
  const filtered = options.filter((o) => optionMatches(o, search))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-auto min-h-9 w-full justify-between">
          <span className="flex flex-1 flex-wrap items-center gap-1 py-0.5 text-left">
            {value.length ? (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelOf(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(v)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem key={opt.value} value={opt.value} onSelect={() => toggle(opt.value)}>
                <span className="flex-1">{opt.label}</span>
                {selectedSet.has(opt.value) ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// 单选（可搜索、可清除）：替代 antd Select showSearch allowClear
function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: Option[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedLabel = value ? options.find((o) => o.value === value)?.label ?? value : ''
  const filtered = options.filter((o) => optionMatches(o, search))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('flex-1 truncate text-left', value ? '' : 'text-muted-foreground')}>
            {value ? selectedLabel : placeholder}
          </span>
          <span className="flex items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(undefined)
                }}
              >
                <X className="size-4" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.value}
                onSelect={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="flex-1">{opt.label}</span>
                {value === opt.value ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// 标签录入：替代 antd Select mode="tags"（回车添加、退格删除）
function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const t = input.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
  }
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1">
          {tag}
          <span
            role="button"
            tabIndex={-1}
            className="opacity-60 hover:opacity-100"
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            <X className="size-3" />
          </span>
        </Badge>
      ))}
      <input
        className="min-w-16 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        value={input}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !input && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={add}
      />
    </div>
  )
}

function ModalShell({ title, error, saving, onClose, onSave, saveDisabled, saveHint, children }: {
  title: string
  error: string | null
  saving: boolean
  onClose: () => void
  onSave: () => void
  saveDisabled?: boolean
  saveHint?: string
  children: ReactNode
}) {
  const saveButton = (
    <Button onClick={onSave} disabled={saving || saveDisabled}>
      {saving ? <Spinner /> : null}
      保存当前项
    </Button>
  )
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="flex max-h-[85vh] max-w-[1000px] flex-col gap-4 sm:max-w-[1000px]"
        // 阻止点击弹框外部（遮罩/失焦）关闭；保留 Esc 关闭与右上角 X、底部「取消」关闭。
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[72vh] flex-col gap-[18px] overflow-auto pr-1">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {children}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {saveDisabled && saveHint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-not-allowed">{saveButton}</span>
              </TooltipTrigger>
              <TooltipContent>{saveHint}</TooltipContent>
            </Tooltip>
          ) : saveButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RouteSchemeEditor({
  draft,
  schemeView,
  schemeEdit,
  modelOptions,
  providerOptionsFor,
  onSetSchemeView,
  onUpdateScheme,
  onPatchSchemeEdit,
  onCommitSchemeEdit,
  onCancelSchemeEdit,
  onAddScheme,
  onRemoveScheme,
  onActivateScheme,
  onBeginEditScheme,
  onCopyScheme,
  onMoveScheme,
}: {
  draft: GroupDraft
  schemeView: 'current' | 'manage' | 'edit'
  schemeEdit: { target: number | 'new'; scheme: Scheme } | null
  modelOptions: string[]
  providerOptionsFor: (models: string[], selected: string[]) => Option[]
  onSetSchemeView: (view: 'current' | 'manage' | 'edit') => void
  onUpdateScheme: (index: number, patch: Partial<Scheme>) => void
  onPatchSchemeEdit: (patch: Partial<Scheme>) => void
  onCommitSchemeEdit: () => void
  onCancelSchemeEdit: () => void
  onAddScheme: () => void
  onRemoveScheme: (index: number) => void
  onActivateScheme: (id: string) => void
  onBeginEditScheme: (index: number) => void
  onCopyScheme: (index: number) => void
  onMoveScheme: (from: number, to: number) => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-2.5">
      {schemeView === 'current' ? (
        (() => {
          const idx = draft.schemes.findIndex((s) => s.id === draft.activeScheme)
          const scheme = draft.schemes[idx] ?? draft.schemes[0]
          if (!scheme) return null
          const realIdx = draft.schemes.indexOf(scheme)
          const whitelistOptions = providerOptionsFor(scheme.models, scheme.provider_whitelist)
          const blacklistOptions = providerOptionsFor(scheme.models, scheme.provider_blacklist)
          return (
            <>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel label="当前方案" hint="当前启用方案的配置。可直接修改，点弹框底部「保存当前项」即保存。多套方案的管理、切换点右侧「管理方案」。" />
                <div className="flex items-center gap-2">
                  <ColorTag tone="green">启用中 · {scheme.name || '未命名'}</ColorTag>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onSetSchemeView('manage')}>
                    <Settings2 className="size-3.5" /> 管理方案
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-green-600/50 bg-green-50/40 p-3.5 dark:border-green-400/40 dark:bg-green-400/5">
                <Field label="方案名" hint="仅作展示标签，可留空、可与其他方案重名；方案的唯一身份由系统自动分配，改名不影响启用指向">
                  <Input value={scheme.name} onChange={(event) => onUpdateScheme(realIdx, { name: event.target.value })} placeholder="如：高配 / 省配" />
                </Field>
                <Field label="选择模型" hint="只能选择真实模型（模型广场中的模型），不支持选择其他自定义模型或别名">
                  <MultiSelect
                    value={scheme.models}
                    onChange={(values) => onUpdateScheme(realIdx, { models: values })}
                    placeholder="从列表选择真实模型"
                    options={modelOptions.map((m) => ({ value: m, label: m }))}
                  />
                </Field>
                <Field label="渠道标签白名单" hint="只在所选渠道中调用该方案，留空表示不限制；仅列出承载了已选成员模型的渠道">
                  <MultiSelect
                    value={scheme.provider_whitelist}
                    onChange={(values) => onUpdateScheme(realIdx, { provider_whitelist: values })}
                    placeholder={scheme.models.length ? '不限制（留空）' : '请先选择模型'}
                    options={whitelistOptions}
                  />
                </Field>
                <Field label="渠道标签黑名单" hint="排除所选渠道，留空表示不限制；仅列出承载了已选成员模型的渠道">
                  <MultiSelect
                    value={scheme.provider_blacklist}
                    onChange={(values) => onUpdateScheme(realIdx, { provider_blacklist: values })}
                    placeholder={scheme.models.length ? '不限制（留空）' : '请先选择模型'}
                    options={blacklistOptions}
                  />
                </Field>
              </div>
            </>
          )
        })()
      ) : schemeView === 'edit' && schemeEdit ? (
        (() => {
          const scheme = schemeEdit.scheme
          const isNew = schemeEdit.target === 'new'
          const whitelistOptions = providerOptionsFor(scheme.models, scheme.provider_whitelist)
          const blacklistOptions = providerOptionsFor(scheme.models, scheme.provider_blacklist)
          return (
            <>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel label={isNew ? '新增方案' : '编辑方案'} hint="改动先暂存，点「保存」写回该自定义模型的方案列表（此时仍未落库，需再点弹框底部「保存当前项」才真正生效）；点「退出」丢弃本次改动。" />
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" onClick={() => onCommitSchemeEdit()}>
                    保存
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onCancelSchemeEdit()}>
                    <X className="size-3.5" /> 退出
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border bg-background p-3.5">
                <Field label="方案名" hint="仅作展示标签，允许为空、允许重复；方案身份由内部 id 唯一标识，改名不影响启用指向">
                  <Input value={scheme.name} onChange={(event) => onPatchSchemeEdit({ name: event.target.value })} placeholder="如：高配 / 省配" />
                </Field>
                <Field label="选择模型" hint="只能选择真实模型（模型广场中的模型），不支持选择其他自定义模型或别名">
                  <MultiSelect
                    value={scheme.models}
                    onChange={(values) => onPatchSchemeEdit({ models: values })}
                    placeholder="从列表选择真实模型"
                    options={modelOptions.map((m) => ({ value: m, label: m }))}
                  />
                </Field>
                <Field label="渠道标签白名单" hint="只在所选渠道中调用该方案，留空表示不限制；仅列出承载了已选成员模型的渠道">
                  <MultiSelect
                    value={scheme.provider_whitelist}
                    onChange={(values) => onPatchSchemeEdit({ provider_whitelist: values })}
                    placeholder={scheme.models.length ? '不限制（留空）' : '请先选择模型'}
                    options={whitelistOptions}
                  />
                </Field>
                <Field label="渠道标签黑名单" hint="排除所选渠道，留空表示不限制；仅列出承载了已选成员模型的渠道">
                  <MultiSelect
                    value={scheme.provider_blacklist}
                    onChange={(values) => onPatchSchemeEdit({ provider_blacklist: values })}
                    placeholder={scheme.models.length ? '不限制（留空）' : '请先选择模型'}
                    options={blacklistOptions}
                  />
                </Field>
                <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-foreground">作为备用方案</span>
                    <span className="text-xs text-muted-foreground">
                      开启后，当激活方案整组不可用时按「已有方案」列表的顺序自动降级到本方案；未开启则只能手动切换为当前方案。备用方案自身不再二次降级。
                    </span>
                  </div>
                  <Switch
                    checked={scheme.is_backup === true}
                    onCheckedChange={(checked) => onPatchSchemeEdit({ is_backup: checked === true })}
                  />
                </div>
              </div>
            </>
          )
        })()
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel label="已有方案" hint="列出该自定义模型下的全部方案。激活方案是主路由；勾选了「作为备用方案」的方案按列表顺序组成降级链，整组不可用时从「备用 1」开始逐套兜底，全部备用耗尽再走「备用自定义模型」。未勾选备用的方案只能手动切换为当前方案。可编辑、删除或切换。切换只改暂存配置，点弹框底部「保存当前项」才真正生效。" />
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onAddScheme()}>
                <Plus className="size-3.5" /> 新增方案
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onSetSchemeView('current')}>
                <X className="size-3.5" /> 返回
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {draft.schemes.map((scheme, index) => {
              const isActive = scheme.id === draft.activeScheme
              const isBackup = scheme.is_backup === true && !isActive
              const backupIndex = (() => {
                let n = 0
                for (let i = 0; i < index; i++) {
                  const s = draft.schemes[i]
                  if (s.is_backup === true && s.id !== draft.activeScheme) n += 1
                }
                return n + 1
              })()
              const isDragging = dragIndex === index
              const isDragOver = dragOverIndex === index
              return (
                <div
                  key={scheme.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(index)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverIndex !== index) setDragOverIndex(index)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex !== null && dragIndex !== index) {
                      onMoveScheme(dragIndex, index)
                    }
                    setDragIndex(null)
                    setDragOverIndex(null)
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setDragOverIndex(null)
                  }}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5',
                    isActive ? 'border-green-600/50 bg-green-50/40 dark:border-green-400/40 dark:bg-green-400/5' : 'bg-background',
                    isDragging && 'opacity-40',
                    isDragOver && 'border-orange-500 ring-1 ring-orange-400/60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing" title="拖动调整顺序">
                      <GripVertical className="size-3.5" />
                    </span>
                    {isActive ? (
                      <ColorTag tone="green">当前</ColorTag>
                    ) : isBackup ? (
                      <ColorTag tone="orange">备用 {backupIndex}</ColorTag>
                    ) : (
                      <ColorTag tone="default">未启用</ColorTag>
                    )}
                    <span className="text-[14px] font-semibold text-foreground">{scheme.name || '未命名方案'}</span>
                    <span className="text-xs text-muted-foreground">{scheme.models.length} 个模型</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onBeginEditScheme(index)}>
                      <Pencil className="size-3.5" /> 编辑
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onCopyScheme(index)}>
                      <Copy className="size-3.5" /> 复制
                    </Button>
                    {draft.schemes.length > 1 ? (
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-600 dark:text-red-400" onClick={() => onRemoveScheme(index)}>
                        <X className="size-3.5" /> 删除
                      </Button>
                    ) : null}
                    {!isActive ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onActivateScheme(scheme.id)}>
                        切换为当前方案
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export function ModelRouting() {
  return (
    <TooltipProvider>
      <AdminPage
        title="自定义模型"
        description="以卡片管理自定义模型；支持别名、渠道过滤与备用模型；保存、启停、删除都只作用于当前项。"
      >
        <ModelRoutingContent />
      </AdminPage>
    </TooltipProvider>
  )
}

/**
 * 自定义模型内容（不含 AdminPage/TooltipProvider 外壳），供模型广场页作为 tab 嵌入。
 * 整页 ModelRouting 只是在本内容外再包一层 AdminPage + TooltipProvider。
 */
export function ModelRoutingContent({ createSignal, refreshSignal, registerTopRefresh }: { createSignal?: number; refreshSignal?: number; registerTopRefresh?: boolean } = {}) {
  const [data, setData] = useState<ModelRoutingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groupModal, setGroupModal] = useState<GroupModalState | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  // 方案区视图：
  //  current = 直接编辑当前启用方案（默认态，底部弹框保存可用）
  //  manage  = 已有方案列表（可编辑/删除/切换当前方案；切换只改 draft，底部弹框保存可用）
  //  edit    = 编辑/新增单套方案，改动落在独立缓冲 schemeEdit 上，保存才写回 draft、退出则丢弃
  const [schemeView, setSchemeView] = useState<'current' | 'manage' | 'edit'>('current')
  // edit 态的编辑缓冲：target 为已有方案下标，或 'new' 表示新增（保存前不落 draft）
  const [schemeEdit, setSchemeEdit] = useState<{ target: number | 'new'; scheme: Scheme } | null>(null)
  // 查看可用渠道弹框：记录被查看的自定义模型名，渠道数据从已加载的 data.providers 现算
  const [channelsModal, setChannelsModal] = useState<{ name: string; draft: GroupDraft } | null>(null)
  // 弹框打开时按命中渠道逐个拉取账号实时状态：{ 渠道名: 账号列表 }；渠道级状态由账号态聚合而来
  const [channelAccounts, setChannelAccounts] = useState<Record<string, ProviderAccount[]>>({})
  const [channelsLoading, setChannelsLoading] = useState(false)
  // 就地打开的渠道编辑弹框：只需渠道 id，其余数据由弹框自行按 id 拉取
  const [editorProviderId, setEditorProviderId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getModelRoutingWithFallback()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取自定义模型配置失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (createSignal) void openGroup()
  // createSignal 只作为父页面触发器；openGroup 每次渲染都会重建，不能加入依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal])

  useEffect(() => {
    if (refreshSignal) void loadData()
  // refreshSignal 只作为父页面触发器；loadData 每次渲染都会重建，不能加入依赖。
  }, [refreshSignal, loadData])

  const groups = data?.model_groups.groups ?? {}
  // 按创建时间升序排序（后端 list_model_groups 已 ORDER BY created_at ASC，但前端聚合后仍需稳定排序）
  const groupEntries = Object.entries(groups)
    .map(([name, raw]) => ({
      name,
      group: raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {},
      createdAt: numberValue((raw as Record<string, unknown> | undefined)?.created_at, 0),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))

  const providers = data?.providers ?? []
  // 选择模型只能是真实模型：过滤掉自定义模型（type === "model_group"）条目
  const modelOptions = data?.models
    .filter((m) => m.type !== 'model_group')
    .map(modelName)
    .filter(Boolean) ?? []
  const groupOptions = groupEntries.map(({ name }) => name).filter(Boolean)
  // 渠道内部名 -> 展示名（备注优先）；卡片与弹框统一按备注名展示渠道
  const providerLabel = (providerName: string): string => {
    const hit = providers.find((p) => p.name === providerName)
    return hit ? hit.remark || hit.name : providerName
  }

  const setGroupDraft = (updater: (draft: GroupDraft) => GroupDraft) => {
    setGroupModal((current) => (current ? { ...current, draft: updater(current.draft) } : current))
  }

  // 把激活方案（按 id 定位）的三字段投影回顶层 models/白/黑名单，保证卡片与可用渠道口径一致。
  const projectActive = (draft: GroupDraft): GroupDraft => {
    const active = draft.schemes.find((s) => s.id === draft.activeScheme) ?? draft.schemes[0]
    if (!active) return { ...draft, models: [], provider_whitelist: [], provider_blacklist: [] }
    return {
      ...draft,
      activeScheme: active.id,
      models: active.models,
      provider_whitelist: active.provider_whitelist,
      provider_blacklist: active.provider_blacklist,
    }
  }

  // 修改指定方案的某个字段（按 index 定位）。id 不变，改名不影响 activeScheme 指向。
  const updateScheme = (index: number, patch: Partial<Scheme>) => {
    setGroupDraft((current) => {
      const schemes = current.schemes.map((s, i) => (i === index ? { ...s, ...patch } : s))
      return projectActive({ ...current, schemes })
    })
  }

  // 编辑缓冲的当前字段改动（仅改 schemeEdit，不落 draft）。
  const patchSchemeEdit = (patch: Partial<Scheme>) => {
    setSchemeEdit((current) => (current ? { ...current, scheme: { ...current.scheme, ...patch } } : current))
  }

  // 进入编辑态编辑已有方案：把该方案拷进缓冲，改动落缓冲，保存才写回 draft。
  const beginEditScheme = (index: number) => {
    const scheme = groupModal?.draft.schemes[index]
    if (!scheme) return
    setSchemeEdit({ target: index, scheme: { ...scheme } })
    setSchemeView('edit')
  }

  // 进入编辑态新增方案：建一套带新 id 的空方案放进缓冲（保存前不进 draft，退出即丢弃）。
  const addScheme = () => {
    const current = groupModal?.draft
    if (!current) return
    const names = new Set(current.schemes.map((s) => s.name))
    let idx = current.schemes.length + 1
    let candidate = `方案${idx}`
    while (names.has(candidate)) {
      idx += 1
      candidate = `方案${idx}`
    }
    setSchemeEdit({ target: 'new', scheme: { id: newSchemeId(), name: candidate, models: [], provider_whitelist: [], provider_blacklist: [], is_backup: false } })
    setSchemeView('edit')
  }

  // 复制已有方案到新增缓冲：配置独立拷贝，保存前不进 draft，也不继承当前/备用身份。
  const copyScheme = (index: number) => {
    const current = groupModal?.draft
    const source = current?.schemes[index]
    if (!current || !source) return

    const names = new Set(current.schemes.map((scheme) => scheme.name))
    const baseName = `${source.name.trim() || '未命名方案'}-副本`
    let name = baseName
    let suffix = 2
    while (names.has(name)) {
      name = `${baseName}${suffix}`
      suffix += 1
    }

    const ids = new Set(current.schemes.map((scheme) => scheme.id))
    let id = newSchemeId()
    while (ids.has(id)) id = newSchemeId()

    setSchemeEdit({
      target: 'new',
      scheme: {
        ...source,
        id,
        name,
        models: [...source.models],
        provider_whitelist: [...source.provider_whitelist],
        provider_blacklist: [...source.provider_blacklist],
        is_backup: false,
      },
    })
    setSchemeView('edit')
  }

  // 编辑态「保存」：把缓冲写回 draft（新增则追加，已有则按 id 替换），不写后端；返回管理态。
  // 方案身份是 id，名称允许重复/为空，不做重名校验。
  const commitSchemeEdit = () => {
    if (!schemeEdit) return
    const cleaned = cleanScheme(schemeEdit.scheme)
    setModalError(null)
    setGroupDraft((current) => {
      if (schemeEdit.target === 'new') {
        return projectActive({ ...current, schemes: [...current.schemes, cleaned] })
      }
      const schemes = current.schemes.map((s, i) => (i === schemeEdit.target ? cleaned : s))
      // id 不变，activeScheme 指向不受改名影响。
      return projectActive({ ...current, schemes })
    })
    setSchemeEdit(null)
    setSchemeView('manage')
  }

  // 编辑态「退出」：丢弃缓冲改动，返回管理态（新增方案则本就没进 draft，直接丢弃）。
  const cancelSchemeEdit = () => {
    setModalError(null)
    setSchemeEdit(null)
    setSchemeView('manage')
  }

  // 删除一套方案；至少保留一套。删除激活方案时激活按 id 回落到第一套。
  const removeScheme = (index: number) => {
    setGroupDraft((current) => {
      if (current.schemes.length <= 1) return current
      const removed = current.schemes[index]
      const schemes = current.schemes.filter((_, i) => i !== index)
      const activeScheme = removed?.id === current.activeScheme ? schemes[0].id : current.activeScheme
      return projectActive({ ...current, schemes, activeScheme })
    })
  }

  // 设某套方案为启用（按 id，同一时刻仅一套生效）。只改 draft，弹框保存才写后端。
  const activateScheme = (id: string) => {
    setGroupDraft((current) => projectActive({ ...current, activeScheme: id }))
  }

  // 把 from 下标的方案拖动重排到 to 下标，用于调整备用方案的降级顺序。
  // id 不变，activeScheme 按 id 指向，移动不影响激活指向。
  const reorderScheme = (from: number, to: number) => {
    if (from === to) return
    setGroupDraft((current) => {
      const schemes = current.schemes.slice()
      const [moved] = schemes.splice(from, 1)
      schemes.splice(to, 0, moved)
      return projectActive({ ...current, schemes })
    })
  }

  const openGroup = async (name?: string, raw?: Record<string, unknown>) => {
    setModalError(null)
    // 默认进入「当前方案」态：直接编辑激活方案那一套，无独立编辑缓冲。
    setSchemeView('current')
    setSchemeEdit(null)
    if (!name) {
      setGroupModal({ mode: 'create', draft: groupDraftFromRaw() })
      return
    }
    // 整组 PUT 依赖完整 schemes；打开详情前拉取最新快照，避免卡片缓存过期。
    // 同时更新 data，确保详情中的渠道下拉列表反映渠道页刚完成的变更。
    let latest = raw
    try {
      const fresh = await getModelRouting()
      setData(fresh)
      const current = fresh.model_groups.groups[name]
      if (current && typeof current === 'object') latest = current as Record<string, unknown>
    } catch {
      // 拉最新失败时退回列表缓存。
    }
    setGroupModal({ mode: 'edit', originalName: name, draft: groupDraftFromRaw(name, latest) })
  }

  // 按命中渠道逐个拉取账号实时状态；供打开弹框与手动刷新复用
  const loadChannelAccounts = useCallback(async (draft: GroupDraft) => {
    const matched = computeAvailableChannels(draft, providers)
    setChannelAccounts({})
    if (!matched.length) return
    setChannelsLoading(true)
    try {
      const entries = await Promise.all(
        matched.map(async (channel) => {
          try {
            const accounts = await getProviderAccounts(channel.name)
            return [channel.name, accounts] as const
          } catch {
            return [channel.name, [] as ProviderAccount[]] as const
          }
        }),
      )
      setChannelAccounts(Object.fromEntries(entries))
    } finally {
      setChannelsLoading(false)
    }
  }, [providers])

  const openChannels = (name: string, raw: Record<string, unknown>) => {
    const draft = groupDraftFromRaw(name, raw)
    setChannelsModal({ name, draft })
    void loadChannelAccounts(draft)
  }

  const openChannelEditor = (providerName: string) => {
    setEditorProviderId(providerName)
  }

  const afterMutation = async (messageText: string) => {
    toast.success(messageText)
    await loadData()
  }

  const saveGroup = async () => {
    if (!groupModal) return
    // edit 态有未落 draft 的方案编辑缓冲，禁止越过「保存/退出」直接落库（底部按钮也已 disabled，此为兜底）。
    if (schemeView === 'edit') {
      setModalError('请先「保存」或「退出」当前正在编辑的方案')
      return
    }
    const draft = groupModal.draft
    const payload = groupPayload(draft)
    const name = textValue(payload.name)
    if (!name) {
      setModalError('自定义模型名称不能为空')
      return
    }
    const ids = draft.schemes.map((s) => s.id)
    if (new Set(ids).size !== ids.length) {
      setModalError('方案 id 重复')
      return
    }
    const activeScheme = draft.schemes.find((s) => s.id === draft.activeScheme) ?? draft.schemes[0]
    if (!activeScheme || !activeScheme.models.filter((m) => m.trim()).length) {
      setModalError('启用方案至少需要一个模型')
      return
    }
    setSaving(true)
    setModalError(null)
    try {
      if (groupModal.mode === 'create') await createModelGroup(payload)
      else await updateModelGroup(groupModal.originalName, payload)
      // 保存成功后不关闭弹框；create 转为 edit 态（名称此后锁定），edit 保持原名不变。
      // 留在弹框内便于继续调整方案并多次保存。
      setGroupModal((current) => (current ? { ...current, mode: 'edit', originalName: name } : current))
      await afterMutation('自定义模型已保存')
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '保存自定义模型失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleGroup = async (name: string, raw: Record<string, unknown>) => {
    setSaving(true)
    try {
      // 启停也是整组 PUT；不能使用卡片渲染时的 raw，否则旧页面/并发保存会把最新 schemes 覆盖掉。
      // 先读数据库当前值，再只改变 enabled，其余字段（包括 schemes/active_scheme）原样带回。
      let latest = raw
      try {
        const fresh = await getModelRouting()
        const current = fresh.model_groups.groups[name]
        if (current && typeof current === 'object') latest = current as Record<string, unknown>
      } catch {
        // 刷新失败时保留原行为；后端错误会阻止本次写入，不会静默删除方案。
      }
      const draft = groupDraftFromRaw(name, latest)
      await updateModelGroup(name, groupPayload({ ...draft, enabled: !draft.enabled }))
      await afterMutation(draft.enabled ? '自定义模型已禁用' : '自定义模型已启用')
    } finally {
      setSaving(false)
    }
  }

  const removeGroup = async (name: string) => {
    if (!window.confirm(`确认删除自定义模型 ${name}？`)) return
    await deleteModelGroup(name)
    await afterMutation('自定义模型已删除')
  }

  const copyGroup = async (name: string, raw: Record<string, unknown>) => {
    const newName = window.prompt('请输入新自定义模型名称', `${name}-copy`)
    const trimmed = newName?.trim() ?? ''
    if (!trimmed) {
      window.alert('名称不能为空')
      return
    }
    if (Object.prototype.hasOwnProperty.call(groups, trimmed)) {
      window.alert('名称已存在')
      return
    }
    const draft = { ...groupDraftFromRaw(name, raw), name: trimmed }
    await createModelGroup(groupPayload(draft))
    await afterMutation('自定义模型已复制')
  }

  // ==================== 卡片渲染 ====================

  const renderGroupCard = (name: string, raw: Record<string, unknown>) => {
    const draft = groupDraftFromRaw(name, raw)
    const title = draft.remark || name
    const aliasTags = draft.aliases
    // 备用方案：显式勾选 is_backup 且非激活的方案，按数组顺序即降级顺序。
    const backupSchemes = draft.schemes.filter((scheme) => scheme.is_backup && scheme.id !== draft.activeScheme)
    return (
      <article key={name} className="relative overflow-hidden rounded-lg border bg-card p-[18px] shadow-sm">
        <div className="mb-3 flex justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-lg font-semibold text-foreground">{title}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <ColorTag tone="green">{name}</ColorTag>
              {aliasTags.length ? aliasTags.map((alias) => (
                <ColorTag key={alias} tone="purple">{alias}</ColorTag>
              )) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={draft.enabled} disabled={saving} onCheckedChange={() => void toggleGroup(name, raw)} />
            <span className="text-xs text-muted-foreground">{draft.enabled ? '启用' : '禁用'}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-[11px] font-extrabold text-muted-foreground">模型列表</div>
            {draft.models.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {draft.models.slice(0, CARD_TAG_LIMIT).map((model) => (
                  <ColorTag key={model} tone="blue">{model}</ColorTag>
                ))}
                {draft.models.length > CARD_TAG_LIMIT ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help">
                        <ColorTag tone="blue">+{draft.models.length - CARD_TAG_LIMIT}</ColorTag>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{draft.models.slice(CARD_TAG_LIMIT).join('、')}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">暂无模型</span>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-extrabold text-muted-foreground">渠道过滤</div>
            {renderFilterTags(raw, providerLabel)}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[11px] font-extrabold text-muted-foreground">备用自定义模型</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground">
                    <CircleHelp className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">主组所有成员全部不可用时，按此备用自定义模型继续兜底；留空则直接返回错误。</TooltipContent>
              </Tooltip>
            </div>
            <span className="text-[13px] text-foreground">{draft.backup_model_group || '无（直接报错）'}</span>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[11px] font-extrabold text-muted-foreground">备用方案</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground">
                    <CircleHelp className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">当前启用方案全部不可用时，按以下顺序逐套降级兜底；全部方案耗尽再走「备用自定义模型」。</TooltipContent>
              </Tooltip>
            </div>
            {backupSchemes.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {backupSchemes.slice(0, CARD_TAG_LIMIT).map((scheme, index) => (
                  <ColorTag key={scheme.id} tone="orange">
                    {index + 1}. {scheme.name || scheme.id}
                  </ColorTag>
                ))}
                {backupSchemes.length > CARD_TAG_LIMIT ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help">
                        <ColorTag tone="orange">+{backupSchemes.length - CARD_TAG_LIMIT}</ColorTag>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {backupSchemes.slice(CARD_TAG_LIMIT).map((s, i) => `${CARD_TAG_LIMIT + i + 1}. ${s.name || s.id}`).join('、')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">无（仅启用方案）</span>
            )}
          </div>
        </div>
        {draft.response_model ? (
          <div className="mt-3">
            <ColorTag tone="geekblue">返回模型名：{draft.response_model}</ColorTag>
          </div>
        ) : null}
        <div className={cn('flex flex-wrap items-center gap-1.5', draft.response_model ? 'mt-2' : 'mt-3')}>
          <ColorTag tone={draft.metadata_model ? 'cyan' : 'default'}>
            元数据：{draft.metadata_model || '最小值'}
          </ColorTag>
          {draft.schemes.length > 1 ? (
            <ColorTag tone="orange">
              {draft.schemes.length} 套方案 · 启用 {(() => {
                const active = draft.schemes.find((s) => s.id === draft.activeScheme) ?? draft.schemes[0]
                return active?.name || active?.id || '—'
              })()}
            </ColorTag>
          ) : null}
        </div>
        <div className="mt-4 flex flex-nowrap items-center gap-1">
          <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap text-muted-foreground" onClick={() => openGroup(name, raw)}>
            <Pencil /> 详情
          </Button>
          <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap text-muted-foreground" onClick={() => openChannels(name, raw)}>
            <Eye /> 渠道状态
          </Button>
          <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap text-muted-foreground" onClick={() => void copyGroup(name, raw)}>
            <Copy /> 复制
          </Button>
          <Button variant="ghost" size="sm" className="mr-auto shrink-0 whitespace-nowrap text-red-600 hover:text-red-600 dark:text-red-400" onClick={() => void removeGroup(name)}>
            删除
          </Button>
        </div>
      </article>
    )
  }

  // ==================== 可用渠道弹框 ====================

  const renderChannelsModal = () => {
    if (!channelsModal) return null
    const { name, draft } = channelsModal
    const title = draft.remark || name
    const channels = computeAvailableChannels(draft, providers)
    const totalAccounts = channels.reduce((sum, ch) => sum + ch.accounts.length, 0)
    return (
      <Dialog open onOpenChange={(o) => { if (!o) setChannelsModal(null) }}>
        <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-[1600px] sm:max-w-[1600px] flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`查看渠道状态 · ${title}`}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[72vh] flex-col gap-4 overflow-auto pr-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Alert className="min-w-[320px] flex-1">
                <AlertDescription>
                  <span>
                    当前配置下命中 <b>{channels.length}</b> 个渠道、<b>{totalAccounts}</b> 个渠道账号。
                    {' '}
                    {providerFilterSummary(groups[name] as Record<string, unknown> ?? {})}。
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    按渠道白/黑名单叠加「渠道确实承载该自定义模型任一成员模型」的交集计算；账号与渠道状态为拉取时的实时快照，可点刷新更新。
                  </span>
                </AlertDescription>
              </Alert>
              <Button variant="outline" disabled={channelsLoading} onClick={() => void loadChannelAccounts(draft)}>
                {channelsLoading ? <Spinner /> : <RefreshCw />}
                刷新
              </Button>
            </div>
            {channels.length ? (
              <div style={channelsGridStyle}>
                {channels.map((channel) => {
                  const accounts = channelAccounts[channel.name]
                  const channelStatus = summarizeChannelStatus(channel.enabled, accounts)
                  return (
                    <div key={channel.name} className="rounded-md border bg-background p-[14px]">
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold text-foreground">{channel.remark || channel.name}</span>
                          <Badge
                            variant="outline"
                            className={channelStatus.tone === 'green' ? TAG_TONE.green : TONE_TEXT[channelStatus.tone]}
                          >
                            {channelStatus.label}
                          </Badge>
                        </div>
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void openChannelEditor(channel.name)}>
                          <Pencil /> 编辑渠道
                        </Button>
                      </div>
                      <div className="mb-2.5">
                        <div className="mb-1.5 text-[11px] font-extrabold text-muted-foreground">命中的成员模型（{channel.matchedModels.length}）</div>
                        <div className="flex flex-wrap items-center gap-1">
                          {channel.matchedModels.map((model) => (
                            <ColorTag key={model} tone="blue">{model}</ColorTag>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1.5 text-[11px] font-extrabold text-muted-foreground">渠道账号（{channel.accounts.length}）</div>
                        {accounts === undefined ? (
                          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Spinner className="size-3" /> 状态加载中…</span>
                        ) : channel.accounts.length ? (
                          <div className="flex w-full flex-col gap-1.5">
                            {channel.accounts.map((username) => {
                              const account = accounts.find((a) => a.username === username)
                              const badge = account ? getAccountBadge(account) : null
                              return (
                                <div key={username} className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">{username}</Badge>
                                  {badge ? (
                                    <span className={cn('inline-flex items-center gap-1 text-xs', TONE_TEXT[badge.tone])}>
                                      <span className={cn('inline-block size-1.5 rounded-full', TONE_DOT[badge.tone])} />
                                      {badge.label}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">状态未知</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">暂无账号</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>当前没有承载该自定义模型成员模型且符合渠道过滤的渠道</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChannelsModal(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ==================== 自定义模型详情弹框 ====================

  const renderGroupModal = () => {
    if (!groupModal) return null
    const draft = groupModal.draft
    // 白/黑名单选择渠道标签；标签选项标注当前承载所选成员模型的渠道数量。
    // 已选标签始终保留，避免渠道标签调整后无法从历史草稿中取消。
    const providerOptionsFor = (models: string[], selected: string[]) => {
      const selectedModels = new Set(models)
      const counts = new Map<string, number>()
      providers.forEach((provider) => {
        if (selectedModels.size && !(provider.models ?? []).some((m) => selectedModels.has(m))) return
        stringList(provider.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1))
      })
      selected.forEach((tag) => { if (!counts.has(tag)) counts.set(tag, 0) })
      return Array.from(counts.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
        .map(([tag, count]) => ({ value: tag, label: `${tag}（${count} 个渠道）` }))
    }
    return (
      <ModalShell
        title={groupModal.mode === 'create' ? '新增自定义模型' : '自定义模型详情'}
        error={modalError}
        saving={saving}
        onClose={() => setGroupModal(null)}
        onSave={() => void saveGroup()}
        saveDisabled={schemeView === 'edit'}
        saveHint="请先「保存」或「退出」当前正在编辑的方案"
      >
        {/* 成对字段一行两个：自定义模型 ID + 备注 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          <Field label="自定义模型 ID" hint="允许与真实模型或其他自定义模型重名，重名时按创建时间优先解析">
            <Input value={draft.name} readOnly={groupModal.mode === 'edit'} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="备注">
            <Input value={draft.remark} onChange={(event) => setGroupDraft((current) => ({ ...current, remark: event.target.value }))} />
          </Field>
        </div>
        {/* 别名 + 备用自定义模型 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          <Field label="别名" hint="别名同样可作为请求入口，重名按创建时间优先；输入后回车添加为一个标签">
            <TagsInput
              value={draft.aliases}
              onChange={(values) => setGroupDraft((current) => ({ ...current, aliases: values.map((v) => v.trim()).filter(Boolean) }))}
              placeholder="输入别名后回车，可多个"
            />
          </Field>
          <Field label="备用自定义模型" hint="主组所有成员全部不可用时，按此备用自定义模型继续兜底；留空则直接返回错误">
            <SearchSelect
              value={draft.backup_model_group || undefined}
              onChange={(value) => setGroupDraft((current) => ({ ...current, backup_model_group: value ?? '' }))}
              placeholder="无（主组全部不可用时直接报错）"
              options={groupOptions.map((name) => ({ value: name, label: name }))}
            />
          </Field>
        </div>
        {/* 返回模型名 + 模型元数据 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          <Field label="返回模型名" hint="覆盖对外返回的模型名字段，留空表示按请求名原样返回">
            <Input value={draft.response_model} onChange={(event) => setGroupDraft((current) => ({ ...current, response_model: event.target.value }))} placeholder="留空 = 请求名原样返回" />
          </Field>
          <Field label="模型元数据" hint="选择一个真实模型，该自定义模型对外暴露的元数据（max_tokens、上下文、模态等）采用所选模型的元数据；留空则按成员最小值自动合成">
            <SearchSelect
              value={draft.metadata_model || undefined}
              onChange={(value) => setGroupDraft((current) => ({ ...current, metadata_model: value ?? '' }))}
              placeholder="留空 = 按成员最小值自动合成"
              options={modelOptions.map((m) => ({ value: m, label: m }))}
            />
          </Field>
        </div>
        {/* 方案区抽成 RouteSchemeEditor：custom 显示选模型/渠道过滤；real 不走这里（由元数据弹窗管理）。 */}
        <RouteSchemeEditor
          draft={draft}
          schemeView={schemeView}
          schemeEdit={schemeEdit}
          modelOptions={modelOptions}
          providerOptionsFor={providerOptionsFor}
          onSetSchemeView={setSchemeView}
          onUpdateScheme={updateScheme}
          onPatchSchemeEdit={patchSchemeEdit}
          onCommitSchemeEdit={commitSchemeEdit}
          onCancelSchemeEdit={cancelSchemeEdit}
          onAddScheme={addScheme}
          onRemoveScheme={removeScheme}
          onActivateScheme={activateScheme}
          onBeginEditScheme={beginEditScheme}
          onCopyScheme={copyScheme}
          onMoveScheme={reorderScheme}
        />
      </ModalShell>
    )
  }

  // ==================== 页面渲染 ====================

  return (
    <>
      {registerTopRefresh !== false ? (
        <ManagerPageActions primary={<ManagerRefreshButton loading={loading} onClick={() => void loadData()} />} />
      ) : null}
      {loading && !data ? (
        <SectionCard title="加载中" description="正在获取自定义模型数据...">
          <Empty>
            <EmptyHeader>
              <EmptyDescription>正在加载自定义模型数据...</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SectionCard>
      ) : error && !data ? (
        <SectionCard title="加载失败" description="无法获取自定义模型数据">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void loadData()}>重试</Button>
            </AlertDescription>
          </Alert>
        </SectionCard>
      ) : !data ? (
        <SectionCard title="暂无数据">
          <Empty>
            <EmptyHeader>
              <EmptyDescription>暂无自定义模型数据</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SectionCard>
      ) : (
        <div>
          {groupEntries.length ? <div style={gridStyle}>{groupEntries.map(({ name, group }) => renderGroupCard(name, group))}</div> : <div className="py-6 text-muted-foreground">暂无自定义模型，点击“新增自定义模型”创建。</div>}
        </div>
      )}

      {renderGroupModal()}
      {renderChannelsModal()}

      <UnifiedProviderModal
        open={editorProviderId !== null}
        providerId={editorProviderId ?? undefined}
        initialTab="overview"
        onClose={() => setEditorProviderId(null)}
        onChanged={() => { void loadData(); if (channelsModal) void loadChannelAccounts(channelsModal.draft) }}
      />
    </>
  )
}
