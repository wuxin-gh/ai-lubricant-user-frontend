/**
 * 模型元数据（模型广场，平台管理页）。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/*`（纯 axios）。
 * 交互、状态、API 调用、字段、表格、弹框、校验与错误路径与原版保持一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'

import { AdminPage, SectionCard, SimpleTable } from '@/components/manager/platform-page'
import { ManagerHeaderActionButton, ManagerPageActions, ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button as UIButton } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import {
  deleteModelMetadata,
  fetchLlmMetadataCatalog,
  fetchModelsDevCatalog,
  fetchOpenRouterCatalog,
  getModelMetadata,
  getOwnedByList,
  getThinkingGlobalConfig,
  getTokenizerRulesConfig,
  updateDefaultMetadata,
  updateModelMetadata,
  updateRealModelRouting,
  updateThinkingGlobalConfig,
  updateTokenizerRulesConfig,
  type CatalogItem,
  type ModelMetadataEntry,
  type ModelMetadataResponse,
  type ModelsDevCatalogItem,
  type RealModelScheme,
  type RuntimeModelEntry,
  type TokenizerRule,
  type UpdateModelMetadataBody,
} from '@/@admin-port/api/modelMetadata'
import { getProviders, getProviderUpstreamModels } from '@/@admin-port/api/providers'
import type { ProviderLite, ProviderUpstreamModelItem } from '@/@admin-port/types/admin'
import { UnifiedProviderModal } from './Channels'
import { ModelRoutingContent } from './ModelRouting'
import { RealModelRoutingDialog, type RealModelRoutingTarget } from './RealModelRouting'

type ViewMode = 'card' | 'table'
type MarketplaceTab = 'marketplace' | 'unconfigured' | 'custom'
type StatusFilter = 'configured' | 'missing' | 'no-route' | 'runtime' | 'all'
type ImportSource = 'catalog:llm-metadata' | 'catalog:openrouter' | 'catalog:modelsdev' | `channel:${string}`
type ModalState =
  | { kind: 'metadata'; mode: 'add' | 'edit'; model: UnifiedModel | null; lockModelId?: boolean }
  | { kind: 'default' }
  | { kind: 'import'; model: UnifiedModel }
  | { kind: 'global-config' }
  | null

interface ImportCandidate extends Record<string, unknown> {
  key: string
  sourceId: string
  provider: string
  name: string
  contextLength: number | null
  outputLimit: number | null
  tracked: boolean
  currentModelId: string
  metadata: UnifiedModel
}

interface ImportState {
  source: ImportSource
  loading: boolean
  error: string | null
  search: string
  page: number
  candidates: ImportCandidate[]
}

interface UnifiedModel extends Record<string, unknown> {
  model_id: string
  name: string
  owned_by: string
  object: string
  max_context_tokens: number | null
  max_tokens: number | null
  input_modalities: string[]
  output_modalities: string[]
  multimodal: string[]
  function_calling: boolean
  auto_thinking: boolean
  is_thinking: boolean
  auto_search: boolean
  capabilities: Record<string, unknown>
  icon_url: string
  created: number | string | null
  _hasMeta: boolean
  _runtime: boolean
  _available: boolean
  _providers: string[]
  _routes: Record<string, unknown>[]
  _reason: string | null
  // 渠道策略配置（model_groups kind='real' 行的顶层列，非元数据）：顶层白/黑名单是激活方案的
  // 投影，schemes/active_scheme 承载多档位降级。导入候选/目录条目不带这些字段，为空。
  _providerWhitelist: string[]
  _providerBlacklist: string[]
  _schemes: RealModelScheme[]
  _activeScheme: string
}

interface MetadataFormState {
  model_id: string
  name: string
  owned_by: string
  object: string
  max_context_tokens: string
  max_tokens: string
  input_modalities: string
  output_modalities: string
  multimodal: string
  function_calling: boolean
  auto_thinking: boolean
  is_thinking: boolean
  auto_search: boolean
  icon_url: string
  capabilitiesText: string
}

interface GlobalConfigFormState {
  loading: boolean
  tokenizerRules: TokenizerRule[]
  ownedByOptions: string[]
  selectedOwnedBy: string[]
  thinkingGlobalEnabled: boolean
  thinkingDefaults: Record<string, unknown>
  reasoningDefaults: Record<string, unknown>
  simulatedReasoningEffort: string
  simulatedAutoSearch: boolean
}

const PAGE_SIZES = [12, 24, 48, 96]

// 模型广场 tab 已承担「已配置 / 未配置」的切分，这里只剩运行态/渠道维度。
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'no-route', label: '无渠道' },
  { key: 'runtime', label: 'runtime' },
]

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN')
    : '—'
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// 解析 real 行的方案数组。id 缺失（旧数据）时按位置补 legacy-{序号}，与后端
// PostgresClient._normalize_schemes 对齐；按 id 去重。models 在真实模型下恒为自身，
// 这里保留后端给的值，由渠道策略弹框在保存时补齐。
function schemeArrayValue(value: unknown): RealModelScheme[] {
  if (!Array.isArray(value)) return []
  const result: RealModelScheme[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const record = recordValue(item)
    const id = textValue(record.id).trim() || `legacy-${index}`
    if (seen.has(id)) return
    seen.add(id)
    result.push({
      id,
      name: textValue(record.name).trim(),
      models: stringArrayValue(record.models),
      provider_whitelist: stringArrayValue(record.provider_whitelist),
      provider_blacklist: stringArrayValue(record.provider_blacklist),
      is_backup: record.is_backup === true,
    })
  })
  return result
}

function normalizeMetadata(entry: ModelMetadataEntry | Record<string, unknown> | null | undefined): UnifiedModel {
  const source = entry ?? {}
  const modelId = textValue(source.model_id) || textValue(source.id)
  const inputModalities = stringArrayValue(source.input_modalities)

  return {
    model_id: modelId,
    name: textValue(source.name),
    owned_by: textValue(source.owned_by),
    object: textValue(source.object) || 'model',
    max_context_tokens: numberValue(source.max_context_tokens),
    max_tokens: numberValue(source.max_tokens),
    input_modalities: inputModalities,
    output_modalities: stringArrayValue(source.output_modalities),
    multimodal: stringArrayValue(source.multimodal).length > 0 ? stringArrayValue(source.multimodal) : inputModalities,
    function_calling: booleanValue(source.function_calling),
    auto_thinking: booleanValue(source.auto_thinking),
    is_thinking: booleanValue(source.is_thinking),
    auto_search: booleanValue(source.auto_search),
    capabilities: recordValue(source.capabilities),
    icon_url: textValue(source.icon_url),
    created: typeof source.created === 'number' || typeof source.created === 'string' ? source.created : null,
    _hasMeta: false,
    _runtime: false,
    _available: false,
    _providers: [],
    _routes: [],
    _reason: null,
    _providerWhitelist: stringArrayValue(source.provider_whitelist),
    _providerBlacklist: stringArrayValue(source.provider_blacklist),
    _schemes: schemeArrayValue(source.schemes),
    _activeScheme: textValue(source.active_scheme),
  }
}

// 把渠道上游模型条目（含 provider 原始 raw）归一化成 UnifiedModel。
// 只映射元数据支持的字段，未知字段丢弃；capabilities 仅取 raw 自带 capabilities 键，
// 不把整个 raw 塞进去。model_id 置空，由调用方覆盖为目标行 model_id。
function normalizeUpstreamItem(item: ProviderUpstreamModelItem): UnifiedModel {
  const raw = recordValue(item.raw)
  const merged: Record<string, unknown> = { ...raw }
  if (item.name && !merged.name) merged.name = item.name
  if (item.upstream_model_id && !merged.id) merged.id = item.upstream_model_id

  const pick = (keys: string[]): unknown => {
    for (const key of keys) {
      const value = merged[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return undefined
  }

  const canonical: Record<string, unknown> = {
    name: pick(['name', 'display_name', 'id', 'title']),
    owned_by: pick(['owned_by', 'owner', 'organization', 'author']),
    object: pick(['object', 'type']),
    created: pick(['created', 'created_at']),
    max_context_tokens: pick(['max_context_tokens', 'context_length', 'context_window', 'context_window_tokens', 'input_token_limit', 'max_input_tokens']),
    max_tokens: pick(['max_tokens', 'max_output_tokens', 'output_limit', 'output_token_limit', 'max_completion_tokens']),
    input_modalities: pick(['input_modalities', 'supported_input_modalities']),
    output_modalities: pick(['output_modalities', 'supported_output_modalities']),
    multimodal: pick(['multimodal']),
    function_calling: pick(['function_calling', 'supports_function_calling', 'supports_tool_calls']),
    auto_thinking: pick(['auto_thinking', 'supports_thinking']),
    is_thinking: pick(['is_thinking', 'thinking', 'reasoning', 'supports_reasoning']),
    auto_search: pick(['auto_search', 'supports_search']),
    capabilities: pick(['capabilities']),
    icon_url: pick(['icon_url', 'icon']),
  }

  return { ...normalizeMetadata(canonical), model_id: '' }
}

function normalizeCatalogItem(item: CatalogItem | ModelsDevCatalogItem): UnifiedModel {
  const normalized = recordValue(item.normalized)
  return normalizeMetadata({
    ...normalized,
    id: item.id,
    name: normalized.name ?? item.name,
    owned_by: normalized.owned_by ?? ('provider' in item ? item.provider : undefined),
    max_context_tokens: normalized.max_context_tokens ?? item.context_length,
    max_tokens: normalized.max_tokens ?? ('output_limit' in item ? item.output_limit : undefined),
  })
}

function catalogCandidate(item: CatalogItem | ModelsDevCatalogItem, source: ImportSource): ImportCandidate {
  const metadata = normalizeCatalogItem(item)
  const provider = textValue(item.provider)
  return {
    key: `${source}:${provider}:${item.id}`,
    sourceId: item.id,
    provider,
    name: item.name ?? metadata.name,
    contextLength: numberValue(item.context_length) ?? metadata.max_context_tokens,
    outputLimit: numberValue(item.output_limit) ?? metadata.max_tokens,
    tracked: false,
    currentModelId: '',
    metadata,
  }
}

function channelCandidate(item: ProviderUpstreamModelItem, source: ImportSource, provider: string): ImportCandidate {
  const metadata = normalizeUpstreamItem(item)
  const sourceId = item.upstream_model_id ?? item.model_id ?? ''
  return {
    key: `${source}:${sourceId}`,
    sourceId,
    provider,
    name: item.name ?? metadata.name,
    contextLength: metadata.max_context_tokens,
    outputLimit: metadata.max_tokens,
    tracked: item.tracked === true,
    currentModelId: item.current_model_id ?? '',
    metadata,
  }
}

function mergeModels(metaModels: ModelMetadataEntry[], runtimeModels: RuntimeModelEntry[]): UnifiedModel[] {
  const byModelId = new Map<string, UnifiedModel>()

  for (const runtime of runtimeModels) {
    const modelId = textValue(runtime.model_id) || textValue(runtime.id)
    if (!modelId) continue
    const metadata = normalizeMetadata(runtime.metadata)
    byModelId.set(modelId, {
      ...metadata,
      model_id: modelId,
      _runtime: true,
      _hasMeta: runtime.has_metadata === true,
      _available: runtime.available === true,
      _routes: runtime.routes ?? [],
      _providers: runtime.providers ?? [],
      _reason: typeof runtime.reason === 'string' ? runtime.reason : null,
    })
  }

  for (const meta of metaModels) {
    const modelId = textValue(meta.model_id) || textValue(meta.id)
    if (!modelId) continue
    const metadata = normalizeMetadata(meta)
    const current = byModelId.get(modelId)
    byModelId.set(modelId, {
      ...metadata,
      model_id: modelId,
      _runtime: current?._runtime ?? false,
      _hasMeta: true,
      _available: current?._runtime ? true : false,
      _routes: current?._routes ?? [],
      _providers: current?._providers ?? [],
      _reason: current?._reason ?? null,
    })
  }
  return Array.from(byModelId.values()).sort((a, b) => {
    if (a._hasMeta !== b._hasMeta) return a._hasMeta ? 1 : -1
    return a.model_id.localeCompare(b.model_id)
  })
}

function getRouteText(route: Record<string, unknown>): string {
  const provider = textValue(route.provider)
  const upstream = textValue(route.upstream_model_id) || textValue(route.routed_model)
  return [provider, upstream].filter(Boolean).join(' / ')
}

function getOriginalSource(model: UnifiedModel): { provider: string; upstreamModelId: string } | null {
  const route = model._routes.find((item) => textValue(item.provider) || textValue(item.upstream_model_id) || textValue(item.routed_model))
  if (!route) return null
  const upstreamModelId = textValue(route.upstream_model_id) || textValue(route.routed_model) || model.model_id
  if (!upstreamModelId) return null
  return { provider: textValue(route.provider), upstreamModelId }
}

function getStatusLabel(model: UnifiedModel): { label: string; tone: 'green' | 'red' | 'yellow' } {
  if (!model._hasMeta) return { label: '未配置', tone: 'red' }
  if (!model._runtime) return { label: '无渠道', tone: 'yellow' }
  return { label: '可用', tone: 'green' }
}

// 卡片/表格上的渠道策略摘要：生效档位的渠道过滤 + 备用方案数。
// 备用方案 = 显式勾选 is_backup 且非生效的方案（与后端降级链口径一致）。
function routingSummary(model: UnifiedModel): { label: string; tone: TagTone; backups: number } {
  const backups = model._schemes.filter((scheme) => scheme.is_backup && scheme.id !== model._activeScheme).length
  if (model._providerWhitelist.length) {
    return { label: `白 ${model._providerWhitelist.join('、')}`, tone: 'green', backups }
  }
  if (model._providerBlacklist.length) {
    return { label: `黑 ${model._providerBlacklist.join('、')}`, tone: 'yellow', backups }
  }
  return { label: '不限渠道', tone: 'default', backups }
}

function createFormState(model: UnifiedModel | null, defaultModelId = ''): MetadataFormState {
  return {
    model_id: model?.model_id ?? defaultModelId,
    name: model?.name ?? '',
    owned_by: model?.owned_by ?? '',
    object: model?.object ?? 'model',
    max_context_tokens: model?.max_context_tokens ? String(model.max_context_tokens) : '',
    max_tokens: model?.max_tokens ? String(model.max_tokens) : '',
    input_modalities: model?.input_modalities.join(',') ?? '',
    output_modalities: model?.output_modalities.join(',') ?? '',
    multimodal: model?.multimodal.join(',') ?? '',
    function_calling: model?.function_calling ?? false,
    auto_thinking: model?.auto_thinking ?? false,
    is_thinking: model?.is_thinking ?? false,
    auto_search: model?.auto_search ?? false,
    icon_url: model?.icon_url ?? '',
    capabilitiesText: JSON.stringify(model?.capabilities ?? {}, null, 2),
  }
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

// 模态候选：覆盖本系统已知取值（text/image/audio/video/file），并按需追加既有值，
// 避免导入来源带入的非标准模态值在勾选框里被静默丢弃。
const MODALITY_OPTIONS = ['text', 'image', 'audio', 'video', 'file'] as const

function modalityOptionsFor(value: string): string[] {
  const items = parseList(value)
  const merged = [...MODALITY_OPTIONS, ...items]
  return Array.from(new Set(merged))
}

function toggleInList(option: string, value: string): string {
  const items = parseList(value)
  const next = items.includes(option) ? items.filter((item) => item !== option) : [...items, option]
  return next.join(',')
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function buildMetadataBody(form: MetadataFormState): UpdateModelMetadataBody {
  const capabilities = JSON.parse(form.capabilitiesText || '{}') as unknown
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new Error('capabilities 必须是 JSON 对象')
  }

  const body: UpdateModelMetadataBody = {
    name: form.name.trim(),
    owned_by: form.owned_by.trim(),
    object: form.object.trim() || 'model',
    max_context_tokens: parsePositiveInteger(form.max_context_tokens),
    max_tokens: parsePositiveInteger(form.max_tokens),
    input_modalities: parseList(form.input_modalities),
    output_modalities: parseList(form.output_modalities),
    multimodal: parseList(form.multimodal),
    function_calling: form.function_calling,
    auto_thinking: form.auto_thinking,
    is_thinking: form.is_thinking,
    auto_search: form.auto_search,
    capabilities: capabilities as Record<string, unknown>,
  }

  const iconUrl = form.icon_url.trim()
  if (iconUrl) body.icon_url = iconUrl
  return body
}

// ==================== 色调与小组件 ====================

type TagTone = 'default' | 'blue' | 'green' | 'red' | 'yellow' | 'purple'

const TAG_TONE: Record<TagTone, string> = {
  default: '',
  blue: 'border-blue-600/40 text-blue-700 dark:border-blue-400/40 dark:text-blue-400',
  green: 'border-green-600/40 text-green-700 dark:border-green-400/40 dark:text-green-400',
  red: 'border-red-600/40 text-red-700 dark:border-red-400/40 dark:text-red-400',
  yellow: 'border-yellow-600/40 text-yellow-700 dark:border-yellow-400/40 dark:text-yellow-400',
  purple: 'border-purple-600/40 text-purple-700 dark:border-purple-400/40 dark:text-purple-400',
}

// antd Button 包装：tone default→outline / primary→default / danger→destructive；固定 size="sm"
function Button({ children, onClick, disabled = false, tone = 'default', type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'default' | 'primary' | 'danger'; type?: 'button' | 'submit' }) {
  const variant = tone === 'primary' ? 'default' : tone === 'danger' ? 'destructive' : 'outline'
  return (
    <UIButton type={type} variant={variant} size="sm" disabled={disabled} onClick={onClick}>
      {children}
    </UIButton>
  )
}

// 可勾选筛选标签（替代 antd Tag.CheckableTag）
function Chip({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

// 只读展示标签（替代 antd Tag color=...）
function Tag({ children, tone = 'default', onClick, title }: { children: ReactNode; tone?: TagTone; onClick?: () => void; title?: string }) {
  return (
    <Badge
      variant="outline"
      title={title}
      onClick={onClick}
      className={cn(TAG_TONE[tone], onClick ? 'cursor-pointer' : undefined)}
    >
      {children}
    </Badge>
  )
}

function CapabilityTags({ model }: { model: UnifiedModel }) {
  const modal = new Set([...model.input_modalities, ...model.output_modalities, ...model.multimodal])
  const tags = [
    model.function_calling ? <Tag key="tool" tone="blue">工具</Tag> : null,
    model.auto_thinking ? <Tag key="thinking" tone="purple">思考</Tag> : null,
    model.auto_search ? <Tag key="search" tone="green">搜索</Tag> : null,
    modal.has('image') ? <Tag key="image" tone="yellow">图像</Tag> : null,
    modal.has('video') ? <Tag key="video" tone="red">视频</Tag> : null,
  ].filter((tag): tag is ReactElement => tag !== null)

  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return <span className="flex flex-wrap gap-1">{tags}</span>
}

// 卡片/表格上的渠道策略摘要标签：生效档位的渠道过滤 + 备用方案数。点击等同于打开渠道策略弹框。
function RoutingTags({ model, onOpen }: { model: UnifiedModel; onOpen: () => void }) {
  if (!model._hasMeta) return <span className="text-xs text-muted-foreground">—</span>
  const summary = routingSummary(model)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Tag tone={summary.tone} title="点击配置渠道策略" onClick={onOpen}>{summary.label}</Tag>
      {summary.backups > 0 ? <Tag tone="yellow" title="生效档位无可用渠道时按顺序降级的备用方案数">备用 {summary.backups}</Tag> : null}
    </span>
  )
}

function formatCreated(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '—'
    const date = new Date(value > 1_000_000_000_000 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN')
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function tokenNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseTokenFilter(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function clampToken(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function OtherParams({ model }: { model: UnifiedModel }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none text-[11px] font-bold text-muted-foreground">其他参数</summary>
      <div className="mt-2 grid gap-2 rounded-md border bg-muted p-2.5">
        <div className="grid gap-2 text-xs" style={{ gridTemplateColumns: '88px minmax(0, 1fr)' }}><b className="text-muted-foreground">object</b><span className="font-mono text-foreground [overflow-wrap:anywhere]">{model.object || '—'}</span></div>
        <div className="grid gap-2 text-xs" style={{ gridTemplateColumns: '88px minmax(0, 1fr)' }}><b className="text-muted-foreground">icon_url</b><span className="font-mono text-foreground [overflow-wrap:anywhere]">{model.icon_url || '—'}</span></div>
        <div className="grid gap-2 text-xs" style={{ gridTemplateColumns: '88px minmax(0, 1fr)' }}><b className="text-muted-foreground">created</b><span className="font-mono text-foreground">{formatCreated(model.created)}</span></div>
        <div className="flex flex-col gap-1.5 text-xs"><b className="text-muted-foreground">capabilities</b><pre className="m-0 max-h-[150px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-card p-2 font-mono text-[11px] text-foreground">{JSON.stringify(model.capabilities ?? {}, null, 2)}</pre></div>
      </div>
    </details>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// 简易分页条（替代 antd Pagination）
function Pager({ current, total, pageSize, onChange }: { current: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(current, totalPages)
  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => onChange(page - 1)} disabled={page <= 1}>上一页</Button>
      <span className="text-xs text-muted-foreground">第 {page}/{totalPages} 页 · 共 {total} 个</span>
      <Button onClick={() => onChange(page + 1)} disabled={page >= totalPages}>下一页</Button>
    </div>
  )
}

export function ModelMetadata() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ModelMetadataResponse | null>(null)
  const [providerSummaries, setProviderSummaries] = useState<ProviderLite[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<MarketplaceTab>('custom')
  const [createCustomSignal, setCreateCustomSignal] = useState(0)
  const [status, setStatus] = useState<StatusFilter>('configured')
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [minTokens, setMinTokens] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<ModalState>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  // 真实模型渠道策略弹框：只在「真实模型」tab 的卡片/表格操作区打开（编辑按钮旁）。
  // 存 model_id 而非整行对象，保证刷新后弹框读到的是最新一行（避免拿旧快照覆盖 schemes）。
  const [routingModelId, setRoutingModelId] = useState<string | null>(null)
  const [routingSaving, setRoutingSaving] = useState(false)
  const [form, setForm] = useState<MetadataFormState>(() => createFormState(null))
  const [formError, setFormError] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>({ source: 'catalog:llm-metadata', loading: false, error: null, search: '', page: 1, candidates: [] })
  const importRequestRef = useRef(0)
  // 自定义模型 tab 嵌入 ModelRoutingContent；刷新计数器递增时让子组件重新加载
  const [customRefreshSignal, setCustomRefreshSignal] = useState(0)
  const [globalConfig, setGlobalConfig] = useState<GlobalConfigFormState>({ loading: true, tokenizerRules: [], ownedByOptions: [], selectedOwnedBy: [], thinkingGlobalEnabled: false, thinkingDefaults: {}, reasoningDefaults: {}, simulatedReasoningEffort: '', simulatedAutoSearch: false })

  const providerLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of providerSummaries) map.set(provider.name, provider.remark || provider.name)
    return map
  }, [providerSummaries])

  const providerLabel = useCallback((provider: string) => providerLabelMap.get(provider) || provider, [providerLabelMap])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [metadata, providersData] = await Promise.all([
        getModelMetadata(),
        getProviders({ lite: true }).catch(() => [] as ProviderLite[]),
      ])
      setData(metadata)
      setProviderSummaries(providersData)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const unified = useMemo(() => mergeModels(data?.models ?? [], data?.runtime_models ?? []), [data])
  const providers = useMemo(() => Array.from(new Set(unified.flatMap((model) => model._providers))).sort(), [unified])
  const tokenBounds = useMemo(() => {
    const values = unified.map((model) => tokenNumber(model.max_tokens)).filter((value): value is number => value !== null && value > 0)
    if (values.length === 0) return { min: 0, max: 200000 }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    return { min: lo, max: Math.max(hi, lo + 1) }
  }, [unified])

  const sliderMin = tokenBounds.min
  const sliderMax = tokenBounds.max > tokenBounds.min ? tokenBounds.max : tokenBounds.min + 1
  const sliderStep = Math.max(1, Math.round((sliderMax - sliderMin) / 100) || 1)
  const sliderLow = clampToken(parseTokenFilter(minTokens) ?? sliderMin, sliderMin, sliderMax)
  const sliderHigh = clampToken(parseTokenFilter(maxTokens) ?? sliderMax, sliderMin, sliderMax)
  const sliderDisabled = unified.length === 0

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const min = parseTokenFilter(minTokens)
    const max = parseTokenFilter(maxTokens)

    return unified.filter((model) => {
      const routesText = model._routes.map(getRouteText).join(' ').toLowerCase()
      const providerLabels = model._providers.map(providerLabel).join(' ')
      const searchText = [model.model_id, model.name, model.owned_by, model._providers.join(' '), providerLabels, routesText].join(' ').toLowerCase()
      if (query && !searchText.includes(query)) return false
      if (tab === 'custom') return false
      // Tab 决定主集合：模型广场只显示已配置模型；未配置模型页只显示缺元数据模型。
      if (tab === 'marketplace' && !model._hasMeta) return false
      if (tab === 'unconfigured' && model._hasMeta) return false
      // 未配置页没有状态二次筛选；模型广场沿用原有状态筛选。
      if (tab === 'marketplace') {
        if (status === 'no-route' && model._runtime) return false
        if (status === 'runtime' && !model._runtime) return false
        // status === 'all' 不再额外过滤
      }
      if (selectedProviders.length > 0 && !model._providers.some((provider) => selectedProviders.includes(provider))) return false
      const outputTokens = model.max_tokens ?? 0
      if (min !== null && Number.isFinite(min) && outputTokens < min) return false
      if (max !== null && Number.isFinite(max) && outputTokens > max) return false
      return true
    })
  }, [maxTokens, minTokens, providerLabel, search, selectedProviders, status, tab, unified])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => { setPage(1) }, [search, status, tab, selectedProviders, minTokens, maxTokens, pageSize])

  const stats = useMemo(() => ({
    modelCount: data?.summary.runtime_model_count ?? unified.length,
    missing: data?.summary.missing_metadata_count ?? unified.filter((model) => !model._hasMeta && model._runtime).length,
    available: unified.filter((model) => model._hasMeta && model._runtime).length,
    providerCount: providers.length,
  }), [data, providers.length, unified])

  // 渠道策略弹框的目标行：按 model_id 从最新 unified 里取，保证刷新后弹框读到最新 schemes。
  const routingTarget = useMemo<RealModelRoutingTarget | null>(() => {
    if (!routingModelId) return null
    const model = unified.find((item) => item.model_id === routingModelId)
    if (!model) return null
    return {
      model_id: model.model_id,
      provider_whitelist: model._providerWhitelist,
      provider_blacklist: model._providerBlacklist,
      schemes: model._schemes,
      active_scheme: model._activeScheme,
    }
  }, [routingModelId, unified])

  const openMetadataModal = useCallback((mode: 'add' | 'edit', model: UnifiedModel | null = null) => {
    setForm(createFormState(model, model?.model_id ?? ''))
    setFormError(null)
    setModal({ kind: 'metadata', mode, model })
  }, [])

  const openRoutingModal = useCallback((model: UnifiedModel) => {
    setRoutingModelId(model.model_id)
  }, [])

  // 渠道策略窄写：PUT /admin/model-metadata/{id}/routing 只改渠道过滤/方案，不触碰元数据。
  const saveRouting = useCallback(async (body: { schemes: RealModelScheme[]; active_scheme: string }) => {
    const modelId = routingModelId
    if (!modelId) return
    setRoutingSaving(true)
    try {
      await updateRealModelRouting(modelId, body)
      setRoutingModelId(null)
      await loadData()
    } finally {
      setRoutingSaving(false)
    }
  }, [loadData, routingModelId])

  const handleSubmitMetadata = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const modelId = form.model_id.trim()
    if (!modelId) { setFormError('model_id 必填'); return }
    setSaving(true)
    try {
      await updateModelMetadata(modelId, buildMetadataBody(form))
      setModal(null)
      await loadData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [form, loadData])

  const handleSubmitDefault = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      await updateDefaultMetadata(buildMetadataBody(form))
      setModal(null)
      await loadData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存默认元数据失败')
    } finally {
      setSaving(false)
    }
  }, [form, loadData])

  const handleDelete = useCallback(async (model: UnifiedModel) => {
    if (!window.confirm(`确定删除模型 ${model.model_id} 的元数据？`)) return
    setSaving(true)
    try {
      await deleteModelMetadata(model.model_id)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }, [loadData])

  const toggleProvider = useCallback((provider: string) => {
    setSelectedProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider])
  }, [])

  const openDefaultModal = useCallback(() => {
    const defaultMeta = normalizeMetadata(data?.default ?? {})
    setForm(createFormState({ ...defaultMeta, model_id: '__default__', _hasMeta: true, _runtime: false, _available: false, _providers: [], _routes: [], _reason: null }))
    setFormError(null)
    setModal({ kind: 'default' })
  }, [data])

  const loadImportCandidates = useCallback(async (source: ImportSource) => {
    const requestId = ++importRequestRef.current
    setImportState((current) => ({ ...current, source, loading: true, error: null, candidates: [], page: 1 }))
    try {
      let candidates: ImportCandidate[]
      if (source === 'catalog:openrouter') {
        const catalog = await fetchOpenRouterCatalog()
        candidates = catalog.items.map((item) => catalogCandidate(item, source))
      } else if (source === 'catalog:modelsdev') {
        const catalog = await fetchModelsDevCatalog()
        candidates = catalog.items.map((item) => catalogCandidate(item, source))
      } else if (source === 'catalog:llm-metadata') {
        const catalog = await fetchLlmMetadataCatalog()
        candidates = catalog.items.map((item) => catalogCandidate(item, source))
      } else {
        const provider = source.slice('channel:'.length)
        const response = await getProviderUpstreamModels(provider)
        candidates = (response.upstream_models ?? []).map((item) => channelCandidate(item, source, provider))
      }
      if (importRequestRef.current !== requestId) return
      setImportState((current) => ({ ...current, loading: false, candidates }))
    } catch (err) {
      if (importRequestRef.current !== requestId) return
      setImportState((current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : '拉取模型列表失败' }))
    }
  }, [])

  const openImportModal = useCallback((model: UnifiedModel) => {
    const sourceInfo = getOriginalSource(model)
    const searchTerm = sourceInfo?.upstreamModelId ?? model.model_id.split('/').pop() ?? model.model_id
    setFormError(null)
    setImportState({ source: 'catalog:llm-metadata', loading: false, error: null, search: searchTerm, page: 1, candidates: [] })
    setModal({ kind: 'import', model })
    void loadImportCandidates('catalog:llm-metadata')
  }, [loadImportCandidates])

  const changeImportSource = useCallback((source: ImportSource) => {
    setImportState((current) => ({ ...current, source, loading: false, error: null, page: 1, candidates: [] }))
    void loadImportCandidates(source)
  }, [loadImportCandidates])

  const selectImportCandidate = useCallback((model: UnifiedModel, candidate: ImportCandidate) => {
    const destination: UnifiedModel = { ...candidate.metadata, model_id: model.model_id }
    setForm(createFormState(destination, model.model_id))
    setFormError(null)
    setModal({ kind: 'metadata', mode: model._hasMeta ? 'edit' : 'add', model: destination, lockModelId: true })
  }, [])

  const openGlobalConfigModal = useCallback(() => {
    setFormError(null)
    setGlobalConfig((current) => ({ ...current, loading: true }))
    setModal({ kind: 'global-config' })
    void Promise.all([getTokenizerRulesConfig(), getThinkingGlobalConfig(), getOwnedByList()])
      .then(([tokenizer, thinking, ownedBy]) => {
        const selected = thinking.reasoning_owned_by ?? []
        const options = Array.from(new Set([...(ownedBy.owned_by ?? []), ...selected])).sort()
        setGlobalConfig({
          loading: false,
          tokenizerRules: tokenizer.rules ?? [],
          ownedByOptions: options,
          selectedOwnedBy: selected,
          thinkingGlobalEnabled: thinking.thinking_global_enabled,
          thinkingDefaults: thinking.thinking_defaults ?? {},
          reasoningDefaults: thinking.reasoning_defaults ?? {},
          simulatedReasoningEffort: thinking.simulated_client_defaults?.reasoning_effort ?? '',
          simulatedAutoSearch: thinking.simulated_client_defaults?.auto_search === true,
        })
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : '加载全局配置失败')
        setGlobalConfig((current) => ({ ...current, loading: false }))
      })
  }, [])

  const saveGlobalConfig = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const rules = globalConfig.tokenizerRules.map((rule, index) => ({
      ...rule,
      name: rule.name.trim() || `规则 ${index + 1}`,
      pattern: rule.pattern.trim(),
      encoding: rule.encoding?.trim(),
    }))
    for (const [index, rule] of rules.entries()) {
      if (!rule.pattern) { setFormError(`第 ${index + 1} 条规则的模型匹配规则不能为空`); return }
      try { new RegExp(rule.pattern) } catch { setFormError(`第 ${index + 1} 条规则的模型匹配规则不是有效的正则表达式`); return }
      if (rule.type === 'chars' && (!Number.isFinite(rule.chars_per_token) || (rule.chars_per_token ?? 0) <= 0)) {
        setFormError(`第 ${index + 1} 条规则的每 Token 字符数必须大于 0`)
        return
      }
      if (rule.type === 'tiktoken' && !rule.encoding) { setFormError(`第 ${index + 1} 条规则请选择编码器`); return }
    }
    setSaving(true)
    try {
      await updateTokenizerRulesConfig(rules)
      await updateThinkingGlobalConfig({
        reasoning_owned_by: globalConfig.selectedOwnedBy,
        thinking_global_enabled: globalConfig.thinkingGlobalEnabled,
        simulated_client_defaults: {
          reasoning_effort: globalConfig.simulatedReasoningEffort.trim(),
          auto_search: globalConfig.simulatedAutoSearch,
        },
      })
      setModal(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存全局配置失败')
    } finally {
      setSaving(false)
    }
  }, [globalConfig])

  const toggleOwnedBy = useCallback((ownedBy: string) => {
    setGlobalConfig((current) => ({ ...current, selectedOwnedBy: current.selectedOwnedBy.includes(ownedBy) ? current.selectedOwnedBy.filter((item) => item !== ownedBy) : [...current.selectedOwnedBy, ownedBy] }))
  }, [])

  const addTokenizerRule = useCallback(() => {
    setGlobalConfig((current) => ({
      ...current,
      tokenizerRules: [...current.tokenizerRules, { name: `规则 ${current.tokenizerRules.length + 1}`, enabled: true, pattern: '', type: 'chars', chars_per_token: 2 }],
    }))
  }, [])

  const patchTokenizerRule = useCallback((index: number, patch: Partial<TokenizerRule>) => {
    setGlobalConfig((current) => ({
      ...current,
      tokenizerRules: current.tokenizerRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }))
  }, [])

  const moveTokenizerRule = useCallback((index: number, direction: -1 | 1) => {
    setGlobalConfig((current) => {
      const target = index + direction
      if (target < 0 || target >= current.tokenizerRules.length) return current
      const tokenizerRules = [...current.tokenizerRules]
      ;[tokenizerRules[index], tokenizerRules[target]] = [tokenizerRules[target], tokenizerRules[index]]
      return { ...current, tokenizerRules }
    })
  }, [])

  const removeTokenizerRule = useCallback((index: number) => {
    setGlobalConfig((current) => ({ ...current, tokenizerRules: current.tokenizerRules.filter((_, ruleIndex) => ruleIndex !== index) }))
  }, [])

  // 渠道 id 即渠道名，弹窗自行按 id 拉取详情，这里不再反查快照列表。
  const openProviderEditor = useCallback((providerName: string) => {
    setEditingProviderId(providerName)
  }, [])

  const providerTags = useCallback((model: UnifiedModel) => (
    <span className="flex flex-wrap gap-1">
      {model._providers.length > 0 ? model._providers.map((provider) => <Tag key={provider} tone="blue" title={`${provider}（点击编辑渠道）`} onClick={() => openProviderEditor(provider)}>{providerLabel(provider)}</Tag>) : <span className="text-xs text-muted-foreground">无渠道</span>}
    </span>
  ), [openProviderEditor, providerLabel])

  const routeLines = useCallback((model: UnifiedModel) => (
    <div className="flex flex-col gap-[3px]">
      {model._routes.length > 0 ? model._routes.slice(0, 4).map((route, index) => (
        <div key={`${getRouteText(route)}-${index}`} className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-muted-foreground" title={getRouteText(route)}>
          <span className="text-blue-600 dark:text-blue-400">{providerLabel(textValue(route.provider)) || '—'}</span> / {textValue(route.upstream_model_id) || textValue(route.routed_model) || '—'}
        </div>
      )) : <span className="text-[11px] text-muted-foreground">无 route/upstream</span>}
      {model._routes.length > 4 && <span className="text-[10px] text-muted-foreground">+{model._routes.length - 4} 条路由</span>}
    </div>
  ), [providerLabel])

  const renderActions = useCallback((model: UnifiedModel) => {
    return (
      <div className="flex w-full flex-nowrap items-center justify-end gap-1.5 overflow-x-auto">
        {model._hasMeta ? <><Button onClick={() => openMetadataModal('edit', model)}>编辑</Button><Button onClick={() => openRoutingModal(model)} disabled={saving}>渠道策略</Button><Button tone="danger" disabled={saving} onClick={() => void handleDelete(model)}>删除</Button></> : <Button tone="primary" onClick={() => openMetadataModal('add', model)}>创建元数据</Button>}
        <span className="mx-0.5 w-px self-stretch bg-border" />
        <Button onClick={() => openImportModal(model)} disabled={saving}>导入</Button>
      </div>
    )
  }, [handleDelete, openImportModal, openMetadataModal, openRoutingModal, saving])

  const renderMetadataForm = (isDefaultModal: boolean, isMetadataModal: boolean) => {
    const readOnlyModelId = isDefaultModal || (isMetadataModal && modal?.kind === 'metadata' && (modal.mode === 'edit' || modal.lockModelId === true))
    return (
      <form onSubmit={isDefaultModal ? handleSubmitDefault : handleSubmitMetadata} className="flex flex-col gap-[18px]">
        {isDefaultModal && <div className="rounded-md border bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">默认元数据用于没有单独配置元数据的模型。保存会调用 <code>PUT /admin/model-metadata/default</code>。</div>}

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold text-muted-foreground">model_id</Label>
          <Input value={isDefaultModal ? '__default__' : form.model_id} readOnly={readOnlyModelId} onChange={(event) => setForm((prev) => ({ ...prev, model_id: event.target.value }))} placeholder="qwen3-max" />
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="flex flex-col gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">name</Label><Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">owned_by</Label><Input value={form.owned_by} onChange={(event) => setForm((prev) => ({ ...prev, owned_by: event.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">object</Label><Input value={form.object} onChange={(event) => setForm((prev) => ({ ...prev, object: event.target.value }))} /></div>
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="flex flex-col gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">max_context_tokens</Label><Input type="number" value={form.max_context_tokens} onChange={(event) => setForm((prev) => ({ ...prev, max_context_tokens: event.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label className="text-xs font-semibold text-muted-foreground">max_tokens</Label><Input type="number" value={form.max_tokens} onChange={(event) => setForm((prev) => ({ ...prev, max_tokens: event.target.value }))} /></div>
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {(['input_modalities', 'output_modalities', 'multimodal'] as const).map((field) => {
            const current = parseList(form[field])
            const options = modalityOptionsFor(form[field])
            return (
              <div key={field} className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{field}</Label>
                <div className="flex flex-wrap gap-3 pt-1">
                  {options.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-[13px] text-foreground">
                      <Checkbox
                        checked={current.includes(option)}
                        onCheckedChange={() => {
                          setForm((prev) => ({ ...prev, [field]: toggleInList(option, prev[field]) }))
                        }}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-[18px] rounded-md border bg-muted px-3 py-2.5">
          <label className="flex items-center gap-2 text-[13px] text-foreground"><Checkbox checked={form.function_calling} onCheckedChange={(value) => setForm((prev) => ({ ...prev, function_calling: value === true }))} /> function_calling</label>
          <label className="flex items-center gap-2 text-[13px] text-foreground"><Checkbox checked={form.is_thinking} onCheckedChange={(value) => setForm((prev) => ({ ...prev, is_thinking: value === true }))} /> thinking</label>
          <label className="flex items-center gap-2 text-[13px] text-foreground"><Checkbox checked={form.auto_thinking} onCheckedChange={(value) => setForm((prev) => ({ ...prev, auto_thinking: value === true }))} /> auto_thinking</label>
          <label className="flex items-center gap-2 text-[13px] text-foreground"><Checkbox checked={form.auto_search} onCheckedChange={(value) => setForm((prev) => ({ ...prev, auto_search: value === true }))} /> auto_search</label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold text-muted-foreground">icon_url</Label>
          <Input value={form.icon_url} onChange={(event) => setForm((prev) => ({ ...prev, icon_url: event.target.value }))} />
        </div>
        {formError && <div className="text-[13px] text-red-600 dark:text-red-400">{formError}</div>}
        <div className="flex justify-end gap-2 border-t pt-1"><Button onClick={() => setModal(null)} disabled={saving}>取消</Button><Button type="submit" tone="primary" disabled={saving}>{saving ? '保存中...' : '保存'}</Button></div>
      </form>
    )
  }

  const renderImportModal = (model: UnifiedModel) => {
    const query = importState.search.trim().toLowerCase()
    const filteredItems = importState.candidates.filter((item) => !query || [item.sourceId, item.name, item.provider, item.currentModelId].join(' ').toLowerCase().includes(query))
    const totalCount = filteredItems.length
    const totalPages = Math.max(1, Math.ceil(totalCount / 200))
    const currentPage = Math.min(importState.page, totalPages)
    const visibleItems = filteredItems.slice((currentPage - 1) * 200, currentPage * 200)
    const channelSources = Array.from(new Set(model._providers)).sort()

    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs text-muted-foreground">
          为 <b className="text-foreground">{model.model_id}</b> 选择元数据来源和模型。选择后进入元数据表单，点「保存」才写入。
        </div>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void loadImportCandidates(importState.source) }}>
          <NativeSelect className="min-w-[200px]" value={importState.source} onChange={(event) => changeImportSource(event.target.value as ImportSource)}>
            <NativeSelectOption value="catalog:llm-metadata">llm-metadata</NativeSelectOption>
            <NativeSelectOption value="catalog:openrouter">OpenRouter</NativeSelectOption>
            <NativeSelectOption value="catalog:modelsdev">models.dev</NativeSelectOption>
            {channelSources.map((provider) => <NativeSelectOption key={provider} value={`channel:${provider}`}>{providerLabel(provider)}</NativeSelectOption>)}
          </NativeSelect>
          <Input className="w-[280px]" value={importState.search} onChange={(event) => setImportState((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="输入模型 ID / 名称过滤..." />
          <Button type="submit" tone="primary" disabled={importState.loading}>{importState.loading ? '拉取中...' : '刷新来源'}</Button>
          <span className="ml-auto text-xs text-muted-foreground">{importState.loading ? '拉取中...' : `匹配 ${totalCount} / ${importState.candidates.length}（第 ${currentPage}/${totalPages} 页）`}</span>
        </form>
        {importState.error && <div className="text-[13px] text-red-600 dark:text-red-400">{importState.error}</div>}
        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <SimpleTable<ImportCandidate>
            rows={visibleItems}
            rowKey="key"
            emptyText={importState.loading ? '正在拉取模型列表...' : '暂无匹配模型'}
            columns={[
              { key: 'provider', label: '渠道商', width: '130px', render: (_value, row) => <span className="font-mono text-[11px] text-purple-500 dark:text-purple-400">{row.provider || (importState.source === 'catalog:openrouter' ? 'OpenRouter' : '—')}</span> },
              { key: 'sourceId', label: '源模型 ID', render: (_value, row) => <span className="font-mono text-xs text-foreground">{row.sourceId || '—'}</span> },
              { key: 'name', label: '名称', width: '190px', render: (_value, row) => <span className="text-xs text-muted-foreground">{row.name || '—'}</span> },
              { key: 'limits', label: 'ctx/out', width: '120px', render: (_value, row) => <span className="font-mono">{formatCount(row.contextLength)} / {formatCount(row.outputLimit)}</span> },
              { key: 'mapping', label: '状态 / 当前映射', width: '180px', render: (_value, row) => <span className="flex items-center gap-1.5">{row.tracked ? <Tag tone="green">已纳管</Tag> : null}<span className="font-mono text-[11px] text-muted-foreground">{row.currentModelId || '—'}</span></span> },
              { key: 'action', label: '操作', width: '130px', render: (_value, row) => row.sourceId ? <Button tone="primary" onClick={() => selectImportCandidate(model, row)}>选择并填写</Button> : null },
            ]}
          />
        </div>
        {totalCount > 200 && <div className="flex justify-center"><Pager current={currentPage} total={totalCount} pageSize={200} onChange={(page) => setImportState((current) => ({ ...current, page }))} /></div>}
      </div>
    )
  }

  const renderReadonlyDefaults = (values: Record<string, unknown>, kind: 'thinking' | 'reasoning') => {
    const labels: Record<string, string> = {
      thinking_mode: '思考模式',
      thinking_enabled: '默认启用思考',
      auto_thinking: '自动判断是否思考',
      thinking_format: '思考内容格式',
      auto_search: '默认启用搜索',
      reasoning_effort: '默认推理强度',
      research_mode: '研究模式',
    }
    const valueLabels: Record<string, string> = {
      Fast: '快速', summary: '摘要', normal: '标准', low: '低', medium: '中', high: '高', xhigh: '极高',
    }
    const entries = Object.entries(values)
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.length ? entries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-foreground">{labels[key] || key.replaceAll('_', ' ')}</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{key}</div>
            </div>
            <Badge variant="secondary">
              {typeof value === 'boolean' ? (value ? '开启' : '关闭') : valueLabels[String(value)] || String(value ?? '未设置')}
            </Badge>
          </div>
        )) : <div className="text-sm text-muted-foreground">暂无{kind === 'thinking' ? '思考' : '推理'}默认值</div>}
      </div>
    )
  }

  const renderGlobalConfigModal = () => (
    <form onSubmit={saveGlobalConfig} className="flex min-h-0 flex-col">
      {globalConfig.loading ? (
        <div className="p-10 text-center text-muted-foreground">正在加载模型全局配置...</div>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-foreground">基础设置</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">控制哪些厂商使用推理参数体系，以及模拟客户端缺少参数时采用的默认行为。</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="font-medium text-foreground">启用全局思考体系</div><p className="mt-1 text-xs leading-5 text-muted-foreground">开启后，系统会按模型能力处理 thinking 与 reasoning 参数。</p></div>
                  <Checkbox checked={globalConfig.thinkingGlobalEnabled} onCheckedChange={(value) => setGlobalConfig((current) => ({ ...current, thinkingGlobalEnabled: value === true }))} />
                </div>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <div className="font-medium text-foreground">模拟客户端默认值</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">仅对使用客户端预设模拟的请求补充；普通请求保持原值。</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="默认推理强度"><NativeSelect value={globalConfig.simulatedReasoningEffort} onChange={(event) => setGlobalConfig((current) => ({ ...current, simulatedReasoningEffort: event.target.value }))}><NativeSelectOption value="">不设置</NativeSelectOption><NativeSelectOption value="low">低</NativeSelectOption><NativeSelectOption value="medium">中</NativeSelectOption><NativeSelectOption value="high">高</NativeSelectOption><NativeSelectOption value="xhigh">极高</NativeSelectOption></NativeSelect></Field>
                  <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border px-3 py-2 text-sm"><Checkbox checked={globalConfig.simulatedAutoSearch} onCheckedChange={(value) => setGlobalConfig((current) => ({ ...current, simulatedAutoSearch: value === true }))} />默认开启搜索</label>
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-lg border bg-background p-4">
              <div className="font-medium text-foreground">推理模型厂商</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">从模型元数据的“所属厂商”中选择需要启用推理能力识别的厂商。</p>
              <div className="mt-3 flex flex-wrap gap-2">{globalConfig.ownedByOptions.length ? globalConfig.ownedByOptions.map((ownedBy) => <label key={ownedBy} className={cn('flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors', globalConfig.selectedOwnedBy.includes(ownedBy) ? 'border-primary bg-primary/10 text-primary' : 'bg-background text-foreground')}><Checkbox checked={globalConfig.selectedOwnedBy.includes(ownedBy)} onCheckedChange={() => toggleOwnedBy(ownedBy)} /><span>{ownedBy}</span></label>) : <span className="text-xs text-muted-foreground">暂无可选厂商，请先完善模型元数据。</span>}</div>
            </div>
          </section>

          <section className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-base font-semibold text-foreground">Token 估算规则</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">规则从上到下匹配模型 ID；自定义规则优先于系统内置规则，全部未命中时按 2 字符约等于 1 Token 估算。</p></div>
              <UIButton type="button" onClick={addTokenizerRule}>新增规则</UIButton>
            </div>
            <div className="flex flex-col gap-3">
              {globalConfig.tokenizerRules.length ? globalConfig.tokenizerRules.map((rule, index) => (
                <div key={`${index}-${rule.name}`} className="rounded-lg border bg-background p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Badge variant="outline">优先级 {index + 1}</Badge><label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={rule.enabled} onCheckedChange={(value) => patchTokenizerRule(index, { enabled: value === true })} />启用规则</label></div>
                    <div className="flex gap-1"><UIButton type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => moveTokenizerRule(index, -1)}>上移</UIButton><UIButton type="button" variant="ghost" size="sm" disabled={index === globalConfig.tokenizerRules.length - 1} onClick={() => moveTokenizerRule(index, 1)}>下移</UIButton><UIButton type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-600" onClick={() => removeTokenizerRule(index)}>删除</UIButton></div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-4">
                    <Field label="规则名称"><Input value={rule.name} onChange={(event) => patchTokenizerRule(index, { name: event.target.value })} placeholder="例如：GPT 业务模型" /></Field>
                    <Field label="模型匹配规则"><Input className="font-mono" value={rule.pattern} onChange={(event) => patchTokenizerRule(index, { pattern: event.target.value })} placeholder="例如：^gpt-" /></Field>
                    <Field label="分词方式"><NativeSelect value={rule.type} onChange={(event) => patchTokenizerRule(index, event.target.value === 'tiktoken' ? { type: 'tiktoken', encoding: rule.encoding || 'cl100k_base' } : { type: 'chars', chars_per_token: rule.chars_per_token || 2 })}><NativeSelectOption value="chars">按字符估算</NativeSelectOption><NativeSelectOption value="tiktoken">精确分词（tiktoken）</NativeSelectOption></NativeSelect></Field>
                    {rule.type === 'tiktoken' ? <Field label="编码器"><NativeSelect value={rule.encoding || 'cl100k_base'} onChange={(event) => patchTokenizerRule(index, { encoding: event.target.value })}><NativeSelectOption value="cl100k_base">cl100k_base</NativeSelectOption><NativeSelectOption value="o200k_base">o200k_base</NativeSelectOption></NativeSelect></Field> : <Field label="每 Token 字符数"><Input type="number" min="0.1" step="0.1" value={String(rule.chars_per_token ?? 2)} onChange={(event) => patchTokenizerRule(index, { chars_per_token: Number(event.target.value) })} /></Field>}
                  </div>
                </div>
              )) : <div className="rounded-lg border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">暂无自定义规则，将使用系统内置规则与默认字符估算。</div>}
            </div>
          </section>

          <section className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-4"><h3 className="text-base font-semibold text-foreground">系统默认行为</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">以下值由系统内置，仅供查看，不会随本弹框保存而修改。</p></div>
            <div className="grid gap-4 lg:grid-cols-2"><div><div className="mb-2 text-sm font-medium">思考默认值</div>{renderReadonlyDefaults(globalConfig.thinkingDefaults, 'thinking')}</div><div><div className="mb-2 text-sm font-medium">推理默认值</div>{renderReadonlyDefaults(globalConfig.reasoningDefaults, 'reasoning')}</div></div>
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
            <div><div className="font-medium text-foreground">默认模型元数据</div><p className="mt-1 text-xs text-muted-foreground">未单独配置元数据的模型会使用这里设置的默认值。</p></div>
            <UIButton type="button" variant="outline" onClick={() => { setModal(null); openDefaultModal() }}>编辑默认模型元数据</UIButton>
          </section>
        </div>
      )}
      {formError && <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">{formError}</div>}
      <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t bg-background/95 pt-4 backdrop-blur"><Button onClick={() => setModal(null)} disabled={saving}>取消</Button><Button type="submit" tone="primary" disabled={saving || globalConfig.loading}>{saving ? '保存中...' : '保存模型全局配置'}</Button></div>
    </form>
  )

  const renderModal = () => {
    if (!modal) return null
    const isMetadataModal = modal.kind === 'metadata'
    const isDefaultModal = modal.kind === 'default'
    const title = isMetadataModal ? `${modal.mode === 'edit' ? '编辑' : '新增'}模型元数据${modal.model?.model_id ? ` - ${modal.model.model_id}` : ''}` : isDefaultModal ? '默认元数据' : modal.kind === 'import' ? `导入模型元数据 - ${modal.model.model_id}` : '模型全局配置'
    const wide = modal.kind === 'import' || modal.kind === 'global-config'
    return (
      <Dialog open onOpenChange={(o) => { if (!o) setModal(null) }}>
        {/* 宽度用行内 style：shadcn DialogContent 基础类含 sm:max-w-md（响应式变体，
            编译后排在普通 max-w-* 之后），会压过 className 里的 max-w-[…]，导致弹框
            怎么调 className 都卡在 448px。行内 style 优先级最高，稳定生效。 */}
        <DialogContent
          className="flex max-h-[90vh] flex-col gap-4"
          style={{ width: wide ? '94vw' : '90vw', maxWidth: wide ? 1400 : 1200 }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[80vh] overflow-auto pr-1">
            {modal.kind === 'import' ? renderImportModal(modal.model) : modal.kind === 'global-config' ? renderGlobalConfigModal() : renderMetadataForm(isDefaultModal, isMetadataModal)}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <AdminPage title="" contentStyle={{ gap: '16px' }}>
      <ManagerPageActions primary={
        <>
          <ManagerRefreshButton
            loading={tab === 'custom' ? false : loading}
            onClick={() => { if (tab === 'custom') setCustomRefreshSignal((v) => v + 1); else void loadData() }}
          />
          <ManagerHeaderActionButton onClick={() => { setTab('custom'); setCreateCustomSignal((value) => value + 1) }}>
            新增自定义模型
          </ManagerHeaderActionButton>
          <ManagerHeaderActionButton onClick={openGlobalConfigModal}>
            模型全局配置
          </ManagerHeaderActionButton>
        </>
      } />
      {error && <Alert variant="destructive"><AlertTitle>加载/操作错误</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-1.5">
        <Chip active={tab === 'custom'} onClick={() => setTab('custom')}>自定义模型</Chip>
        <Chip active={tab === 'marketplace'} onClick={() => { setTab('marketplace'); setStatus('configured') }}>真实模型</Chip>
        <Chip active={tab === 'unconfigured'} onClick={() => { setTab('unconfigured'); setStatus('missing') }}>未配置模型</Chip>
      </div>
      {tab === 'custom' ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ModelRoutingContent createSignal={createCustomSignal} refreshSignal={customRefreshSignal} registerTopRefresh={false} />
        </div>
      ) : <div className="grid min-h-0 flex-1 items-stretch gap-4" style={{ gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }}>
        <SectionCard title="筛选" description="按配置状态、渠道和输出 token 范围筛选" style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="flex min-h-0 flex-1 flex-col gap-[18px]">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 model_id / name / 渠道 / upstream" />
            {tab === 'marketplace' ? <div className="flex flex-col gap-2.5 border-t pt-[18px]"><div className="text-[11px] font-bold uppercase tracking-[0.4px] text-muted-foreground">状态</div><div className="flex flex-wrap gap-1.5">{STATUS_FILTERS.map((item) => <Chip key={item.key} active={status === item.key} onClick={() => setStatus(item.key)}>{item.label}</Chip>)}</div></div> : null}
            <div className="flex flex-col gap-3 border-t pt-[18px]">
              <div className="flex items-center justify-between gap-2.5"><div className="text-[11px] font-bold uppercase tracking-[0.4px] text-muted-foreground">max_tokens 范围</div><span className="font-mono text-[11px] text-muted-foreground">{formatCount(parseTokenFilter(minTokens) ?? tokenBounds.min)} - {formatCount(parseTokenFilter(maxTokens) ?? tokenBounds.max)}</span></div>
              <Slider min={sliderMin} max={sliderMax} step={sliderStep} disabled={sliderDisabled} value={[Math.min(sliderLow, sliderHigh), Math.max(sliderLow, sliderHigh)]} onValueChange={([low, high]) => { setMinTokens(String(low)); setMaxTokens(String(high)) }} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 border-t pt-[18px]"><div className="text-[11px] font-bold uppercase tracking-[0.4px] text-muted-foreground">渠道</div><div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">{providers.length === 0 ? <span className="text-xs text-muted-foreground">暂无渠道</span> : providers.map((provider) => <Chip key={provider} active={selectedProviders.includes(provider)} onClick={() => toggleProvider(provider)}>{providerLabel(provider)}</Chip>)}</div></div>
          </div>
        </SectionCard>
        <div className="flex h-full min-w-0 flex-col gap-4">
          <SectionCard title="模型列表" description={`显示 ${pageItems.length} / 筛选 ${filtered.length} / 全部 ${unified.length}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} toolbar={<div className="flex flex-wrap items-center justify-end gap-2.5"><div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><span>模型 {stats.modelCount}</span><span>未配置 {stats.missing}</span><span>可用 {stats.available}</span><span>渠道 {stats.providerCount}</span></div><Button tone="primary" onClick={() => openMetadataModal('add')}>新增元数据</Button><div className="inline-flex rounded-md border p-0.5">{(['card', 'table'] as ViewMode[]).map((mode) => <button key={mode} type="button" onClick={() => setViewMode(mode)} className={cn('rounded px-2 py-0.5 text-xs', viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{mode === 'card' ? '卡片' : '表格'}</button>)}</div><div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><span>每页</span><NativeSelect size="sm" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <NativeSelectOption key={size} value={String(size)}>{size}/页</NativeSelectOption>)}</NativeSelect></div></div>}>
            <div className="min-h-[320px] flex-1 overflow-y-auto rounded-md border bg-muted p-3">
            {loading && !data ? <div className="p-9"><Empty><EmptyHeader><EmptyDescription>加载中...</EmptyDescription></EmptyHeader></Empty></div> : viewMode === 'card' ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>{pageItems.length === 0 ? <div style={{ gridColumn: '1 / -1' }}><Empty><EmptyHeader><EmptyDescription>暂无匹配模型</EmptyDescription></EmptyHeader></Empty></div> : pageItems.map((model) => { const statusInfo = getStatusLabel(model); return <div key={model.model_id} className={cn('flex flex-col gap-3 rounded-lg border p-4', model._hasMeta ? 'bg-card' : 'border-red-400/35 bg-red-400/5')}><div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><div title={model.model_id} className={cn('overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[13px] font-extrabold', model._hasMeta ? 'text-foreground' : 'text-red-600 dark:text-red-400')}>{model.model_id}</div><div className="mt-[3px] text-xs text-muted-foreground">{model.name || (model._hasMeta ? '—' : '未配置元数据')}</div></div><Tag tone={statusInfo.tone}>{statusInfo.label}</Tag></div>{providerTags(model)}{routeLines(model)}<div className="grid grid-cols-2 gap-x-3 gap-y-2.5"><div><span className="text-[10px] font-bold uppercase tracking-[0.4px] text-muted-foreground">context</span><b className="block font-mono text-[13px] text-foreground">{formatCount(model.max_context_tokens)}</b></div><div><span className="text-[10px] font-bold uppercase tracking-[0.4px] text-muted-foreground">max_tokens</span><b className="block font-mono text-[13px] text-foreground">{formatCount(model.max_tokens)}</b></div><div><span className="text-[10px] font-bold uppercase tracking-[0.4px] text-muted-foreground">owned_by</span><b className="block text-[13px] text-foreground">{model.owned_by || '—'}</b></div><div><span className="text-[10px] font-bold uppercase tracking-[0.4px] text-muted-foreground">modalities</span><b className="block text-[13px] text-foreground">{model.multimodal.join('/') || [...model.input_modalities, ...model.output_modalities].join('/') || '—'}</b></div></div><CapabilityTags model={model} /><RoutingTags model={model} onOpen={() => openRoutingModal(model)} /><OtherParams model={model} /><div className="mt-auto border-t pt-3">{renderActions(model)}</div></div> })}</div> : <SimpleTable<UnifiedModel> rows={pageItems} emptyText="暂无匹配模型" columns={[{ key: 'model_id', label: '模型ID', width: '200px', render: (_value, row) => <span className={cn('font-mono font-bold', row._hasMeta ? 'text-foreground' : 'text-red-600 dark:text-red-400')}>{row.model_id}</span> }, { key: 'name', label: '名称', width: '150px', render: (_value, row) => <span className={row.name ? 'text-foreground' : 'text-muted-foreground'}>{row.name || (row._hasMeta ? '—' : '未配置')}</span> }, { key: '_providers', label: '渠道 / Route', width: '240px', render: (_value, row) => <div className="flex flex-col gap-1.5">{providerTags(row)}{routeLines(row)}</div> }, { key: 'max_context_tokens', label: 'Context', width: '110px', render: (_value, row) => <span className="font-mono tabular-nums">{formatCount(row.max_context_tokens)}</span> }, { key: 'max_tokens', label: 'Output', width: '100px', render: (_value, row) => <span className="font-mono tabular-nums">{formatCount(row.max_tokens)}</span> }, { key: 'multimodal', label: '模态/能力', width: '180px', render: (_value, row) => <div className="flex flex-col gap-1.5"><span className="text-[11px] text-muted-foreground">{row.multimodal.join('/') || '—'}</span><CapabilityTags model={row} /></div> }, { key: '_available', label: '状态', width: '80px', render: (_value, row) => { const statusInfo = getStatusLabel(row); return <Tag tone={statusInfo.tone}>{statusInfo.label}</Tag> } }, { key: 'routing', label: '渠道策略', width: '160px', render: (_value, row) => <RoutingTags model={row} onOpen={() => openRoutingModal(row)} /> }, { key: 'other_params', label: '其他参数', width: '220px', render: (_value, row) => <div className="flex flex-col gap-2"><OtherParams model={row} /></div> }, { key: '_routes', label: '操作', width: '320px', render: (_value, row) => renderActions(row) }]} />}
            </div>
            <div className="mt-4 flex justify-center"><Pager current={currentPage} total={filtered.length} pageSize={pageSize} onChange={setPage} /></div>
          </SectionCard>
        </div>
      </div>}
      {renderModal()}
      <RealModelRoutingDialog
        open={routingTarget !== null}
        target={routingTarget}
        providers={providerSummaries}
        saving={routingSaving}
        onClose={() => setRoutingModelId(null)}
        onSave={saveRouting}
      />
      <UnifiedProviderModal
        open={editingProviderId !== null}
        providerId={editingProviderId ?? undefined}
        initialTab="basic"
        onClose={() => setEditingProviderId(null)}
        onChanged={() => { void loadData() }}
      />
    </AdminPage>
  )
}
