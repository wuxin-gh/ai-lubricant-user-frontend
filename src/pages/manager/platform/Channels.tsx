/**
 * 渠道管理页。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/*`（纯 axios）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  ChevronsUpDown,
  CircleQuestionMark,
  Copy,
  ExternalLink,
  KeyRound,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Trash2,
  Upload,
  Unlock,
  X,
} from 'lucide-react'

import {
  addProviderAccount,
  batchAddProviderAccounts,
  batchDeleteProviderAccounts,
  batchSetProviderAccountSwitch,
  batchUpdateProviderAccountProxy,
  checkProviderAccounts,
  clearAllProviderCooldowns,
  clearProviderAccountCooldown,
  createCustomProvider,
  deleteProvider,
  deleteProviderAccount,
  deleteProviderModel,
  detectModel,
  getBuiltinProviders,
  getProviderAccounts,
  getProviderAccountSchema,
  getProviderDetail,
  getProviderLimitPolicy,
  getProviderModels,
  getProviderRawConfig,
  getProviderUpstreamModels,
  getProviderAccountAuthStatus,
  cancelProviderAccountAuth,
  replayProviderAccountAuth,
  getProviders,
  getHeaderTemplates,
  initProviderAccount,
  refreshProviderAccountAuth,
  refreshProviderModels,
  replaceProviderModels,
  startProviderAccountAuth,
  testProviderAccounts,
  triggerProviderScheduledTestNow,
  updateProviderAccount,
  updateProviderAccountSwitch,
  updateProviderCustomConfig,
  updateProviderEnabled,
  updateProviderLimitPolicy,
} from '@/@admin-port/api/providers'
import { getProxies } from '@/@admin-port/api/proxyPool'
import type { ProxyEntry } from '@/@admin-port/api/proxyPool'
import { getDashboardStats, getMainConfig } from '@/@admin-port/api/dashboard'
import { getChannelTabConfig, getModelRuleTemplates } from '@/@admin-port/api/globalConfig'
import type {
  AccountSchemaField,
  ChatProtocolConfig,
  DashboardStats,
  DetectModelResult,
  HeaderTemplate,
  ModelIdRewriteEntry,
  ModelRuleTemplate,
  ProviderAccount,
  ProviderAccountLite,
  ProviderAccountPayload,
  ProviderAccountSchema,
  ProviderBaseConfig,
  ProviderCreatePreset,
  ProviderLimitFreezeRule,
  ProviderLimitPolicy,
  ProviderModelEntry,
  ProviderSummary,
  ProviderUpstreamModelItem,
  TestTypeDef,
} from '@/@admin-port/types/admin'
import {
  AdminPage,
  SectionCard,
} from '@/components/manager/platform-page'
import { ManagerHeaderActionButton, ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { UsageChart, type MetricType } from './UsageCharts'
import { ChannelCatalogSelector } from './channel-catalog/ChannelCatalogSelector'
import { ChannelIcon, isChannelIconConfigured } from './channel-catalog/ChannelIcon'
import { FreezePolicyEditor, normalizeFreezeRuleInput } from './FreezePolicyEditor'
import { ModelIdRewriteEditor, expandModelIdRewriteRules, normalizeModelIdRewriteRules } from './ModelIdRewriteEditor'
import { CodeChannelEditorTabs } from './CodeChannelEditorTabs'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ComboMultiSelect, ComboSearchSelect } from '@/components/ui/combo-select'
import { cn } from '@/lib/utils'
import {
  type ChartType,
  type RangeFilters,
  type TimePreset,
  autoGrain,
  datetimeToUnix,
  formatCount,
  presetToRange,
} from '@/@admin-port/pages/shared/chartUtils'

function formatTime(ts: number | string | undefined | null): string {
  if (ts === null || ts === undefined) return '—'
  if (typeof ts === 'string') {
    if (!ts.trim()) return '—'
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  const value = ts > 1_000_000_000_000 ? ts : ts * 1000
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getProviderUpdatedAt(provider: ProviderSummary): number | string | undefined {
  const timestamp = provider.updated_at_ts
  if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) return timestamp
  const updatedAt = provider.updated_at
  if (typeof updatedAt === 'string' && updatedAt.trim()) return updatedAt
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt
  return undefined
}

function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return value.toLocaleString('zh-CN')
}

function getProviderModelsCount(provider: ProviderSummary): number {
  return Array.isArray(provider.models) ? provider.models.length : 0
}

// 内置渠道账号编辑模式分类
// 'schema'：完全由后端 account_schema 驱动（代码渠道用）。字段走 renderSchemaField，
//   授权按钮显隐看 schema 的 auth_start.enabled（canStartAuth），而非硬编码。
type ChannelAuthMode = 'custom' | 'cloudflare' | 'device_auth' | 'password_login' | 'api_key' | 'manual_values' | 'schema'

function getChannelAuthMode(providerId: string, builtinType?: string | null): ChannelAuthMode {
  const type = builtinType || providerId
  if (!type) return 'custom'
  if (type === 'cloudflare') return 'cloudflare'
  // 代码渠道：账号编辑完全由后端 account_schema 决定——spec 类声明了 auth_start+设备码钩子
  // 就冒出授权按钮（canStartAuth 驱动），否则用户名/密码手填 + 声明字段渲染。
  // 原先硬编码的 copilot/atomcode/codebuddy(device_auth) 与 eaichat(password_login)
  // 已下架为代码渠道，走这条 schema 分支，不再需要前端认领。
  if (type === 'code') return 'schema'
  if (type === 'edgeone-ai') return 'manual_values'
  if (builtinType === 'custom') return 'custom'
  // builtin_type 已下线的旧渠道行（如未清理的 qwen/gemini）落通用编辑器。
  return 'custom'
}

// 各渠道对应的官网/登录页面地址
const PROVIDER_WEBSITE_URLS: Record<string, string> = {
  'edgeone-ai': 'https://edgeone.dev',
}

// 各渠道的账号编辑文档说明
const PROVIDER_DOC_GUIDE: Record<string, string> = {
  cloudflare: '请先在 Cloudflare Dashboard 创建包含 Workers AI 权限的 API Token，并获取 Account ID。',
}

type ProviderStatus = 'ok' | 'requesting' | 'cooldown' | 'expired' | 'error' | 'disabled' | 'checking'
// 渠道类型筛选：generic = 通用渠道（配置驱动兼容接口）；custom = 自定义渠道（贴 spec 源码，
// 底层 builtin_type='code'）；builtin = 其余内置模板渠道。
type ProviderTypeFilter = 'all' | 'generic' | 'custom' | 'builtin'
type ProviderProtocolFilter = 'all' | 'openai' | 'anthropic' | 'responses' | 'gemini' | 'cloudflare' | 'other'
const KNOWN_PROTOCOL_FILTERS = ['openai', 'anthropic', 'responses', 'gemini', 'cloudflare']
type ProviderSortKey = 'updated' | 'id' | 'name' | 'accounts' | 'models'
// 「定时更新模型」开关筛选：on = 只看开启自动更新的渠道，off = 只看关闭的。
type ProviderAutoUpdateFilter = 'all' | 'on' | 'off'

const PROVIDER_SORT_OPTIONS: { value: ProviderSortKey; label: string }[] = [
  { value: 'updated', label: '更新时间' },
  { value: 'id', label: 'ID' },
  { value: 'name', label: '名字' },
  { value: 'accounts', label: '账号数' },
  { value: 'models', label: '模型数' },
]
type ProviderTab = 'overview' | 'basic' | 'code' | 'meta' | 'config' | 'models' | 'limits' | 'accounts' | 'stats' | 'test'


function getProviderStatus(provider: ProviderSummary): ProviderStatus {
  if (!provider.enabled) return 'disabled'
  if ((provider.requesting_account_count || 0) > 0) return 'requesting'
  // 认证口径与账号明细一致：auth_account_count 用真实体检结果（auth_ok=True），
  // 不再用 is_init()（凭据存在≠认证有效，token/cookie 过期时仍误报正常）。
  // 启用账号全部未通过认证时：可自动刷新的渠道显示"已过期"（等待定时任务自愈），
  // 只能人工更新凭据的渠道显示"异常"；尚未体检的显示"待检查"。
  if ((provider.enabled_account_count || 0) > 0 && (provider.auth_account_count || 0) === 0) {
    if ((provider.auth_failed_account_count || 0) > 0) {
      return provider.supports_token_auto_refresh ? 'expired' : 'error'
    }
    return 'checking'
  }
  if ((provider.cooldown_account_count || 0) > 0) return 'cooldown'
  return 'ok'
}

function getStatusLabel(status: ProviderStatus): string {
  const map: Record<ProviderStatus, string> = {
    ok: '正常',
    requesting: '正在请求',
    cooldown: '冻结',
    expired: '已过期',
    error: '需重新登录',
    checking: '待检查',
    disabled: '禁用',
  }
  return map[status]
}

function getStatusColor(status: ProviderStatus): string {
  const map: Record<ProviderStatus, string> = {
    ok: 'var(--green)',
    requesting: 'var(--yellow)',
    cooldown: 'var(--yellow)',
    expired: 'var(--yellow)',
    error: 'var(--red)',
    checking: 'var(--text2)',
    disabled: 'var(--text2)',
  }
  return map[status]
}

function getModelDisplayName(model: string | ProviderModelEntry): string {
  if (typeof model === 'string') return model
  return model.model_id || model.upstream_model_id || model.name || model.id || 'unknown'
}
void getModelDisplayName // 兼容旧类型推断占位；保留供未来使用

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function safeBoolean(value: unknown): boolean {
  return value === true
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseJsonObject(text: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!text.trim()) return fallback
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback
  } catch {
    return fallback
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

// ── 冻结规则：对象 × 周期 二维模型 ──
// 常量/归一化/摘要文案与共享编辑器同源（FreezePolicyEditor.tsx），渠道弹窗与
// 全局配置「默认冻结策略」Tab 共用同一套定义（import 见文件头部）。


// 账号状态聚合：单一判据 = 后端 state 枚举（rate_limiter.AccountState 同源）。
// 不再用 is_frozen 当永久判据——那是「冻结中(含临时)」，永久靠 state==='frozen' 区分。
type AccountBadge = { label: string; color: string }
function getAccountBadge(a: ProviderAccount): AccountBadge {
  switch (a.state) {
    case 'disabled':
      return { label: '已禁用', color: 'var(--text2)' }
    case 'frozen':
      return { label: '永久冻结', color: 'var(--red)' }
    case 'cooling': {
      const remaining = (a.cooldown_remaining ?? 0) > 0 ? `冷却中·${Math.ceil(a.cooldown_remaining)}秒` : '冷却中'
      return { label: remaining, color: 'var(--yellow)' }
    }
    case 'model_frozen': {
      // 账号级未冻，但部分模型在冻；具体哪些模型见明细区 freeze_items。
      const count = (a.freeze_items ?? []).filter((it) => it.scope === 'account_model').length
      return { label: count > 0 ? `部分模型冻结·${count}个` : '部分模型冻结', color: 'var(--yellow)' }
    }
    case 'auth_failed':
      if (a.auth_error?.includes('等待自动刷新')) return { label: '已过期', color: 'var(--yellow)' }
      if (a.auth_error?.includes('需人工')) return { label: '需重新登录', color: 'var(--red)' }
      return { label: '未认证', color: 'var(--red)' }
    case 'checking':
      return { label: '待检查', color: 'var(--text2)' }
    case 'available':
      return { label: '已认证', color: 'var(--green)' }
    default:
      break
  }
  // state 缺省（旧后端未返回）时的兼容回退：沿用原布尔级联。
  if (a.is_frozen) return { label: '冻结中', color: 'var(--yellow)' }
  if (a.cooldown) return { label: '冷却中', color: 'var(--yellow)' }
  if (a.switch === false) return { label: '已禁用', color: 'var(--text2)' }
  if (a.auth === true) return { label: '已认证', color: 'var(--green)' }
  if (a.auth === false) {
    if (a.auth_error?.includes('等待自动刷新')) return { label: '已过期', color: 'var(--yellow)' }
    if (a.auth_error?.includes('需人工')) return { label: '需重新登录', color: 'var(--red)' }
    return { label: '未认证', color: 'var(--red)' }
  }
  return { label: '待检查', color: 'var(--text2)' }
}

// 冻结展示只消费结构化 freeze_items；旧字段仅作为旧服务端兼容回退。
function formatFreezeRemaining(item: { remaining?: number | null; permanent?: boolean }): string {
  if (item.permanent || item.remaining == null) return '永久'
  if (item.remaining <= 0) return '已到期'
  return `${Math.ceil(item.remaining)}秒`
}

function buildFreezeDisplay(a: ProviderAccount): { cell: string; title: string } {
  const structured = (a.freeze_items || []).filter((item) => item && (item.scope === 'account' || item.scope === 'account_model'))
  if (structured.length > 0) {
    const lines = structured.map((item) => {
      const objectText = item.scope === 'account_model'
        ? `账号模型${item.model ? `：${safeString(item.model)}` : ''}`
        : '账号'
      const reason = safeString(item.reason).trim() || '无原因'
      return `${objectText}（${reason}）（${formatFreezeRemaining(item)}）`
    })
    return { cell: lines.join('\n'), title: lines.join('\n') }
  }

  const accountReason = safeString(a.cooldown_reason).trim()
  const models = (a.model_cooldowns || []).filter((m) => safeString(m.model).trim())
  const legacyLines: string[] = []
  if (a.is_frozen || a.cooldown) {
    const remaining = a.state === 'frozen' ? '永久' : formatFreezeRemaining({ remaining: a.cooldown_remaining })
    legacyLines.push(`账号（${accountReason || '无原因'}）（${remaining}）`)
  }
  for (const model of models) {
    legacyLines.push(`账号模型：${safeString(model.model)}（${safeString(model.reason).trim() || '无原因'}）（${formatFreezeRemaining(model)}）`)
  }
  return { cell: legacyLines.join('\n'), title: legacyLines.join('\n') }
}

function shortenReason(reason: string, max = 14): string {
  const text = safeString(reason).trim()
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function buildModelRow(model?: ProviderModelEntry): ProviderModelEntry {
  return {
    upstream_model_id: safeString(model?.upstream_model_id || model?.id || model?.name),
    model_id: safeString(model?.model_id || model?.upstream_model_id || model?.id || model?.name),
    name: model?.name,
    extra_config: parseJsonObject(stringifyJson(model?.extra_config ?? {}), {}),
    enabled: model?.enabled !== false,
  }
}

function buildUpstreamModelRow(model: ProviderUpstreamModelItem | ProviderModelEntry | string): ProviderModelEntry {
  if (typeof model === 'string') {
    return { ...buildModelRow({ upstream_model_id: model, model_id: model }), _selection_key: model }
  }
  const item = model as ProviderModelEntry & ProviderUpstreamModelItem
  const upstream = safeString(item.upstream_model_id || item.id || item.name || item.model_id).trim()
  const modelId = safeString(item.current_model_id || item.model_id || upstream).trim() || upstream
  // raw_model_id：原始上游名（未切 "/"、未套规则）；缺省回退 modelId 再回退 upstream。
  const rawModelId = safeString(item.raw_model_id).trim() || modelId
  return {
    ...buildModelRow({ ...item, upstream_model_id: upstream, model_id: modelId, raw_model_id: rawModelId }),
    _selection_key: upstream,
    raw_model_id: rawModelId,
    // 规则命中标记与纯规则结果：开关开启时这行显示 regex_model_id（改名后）。
    regex_model_id: safeString(item.regex_model_id).trim() || modelId,
    is_regex: item.is_regex === true,
    tracked: item.tracked,
    current_model_id: item.current_model_id,
  }
}

function modelDraftKey(row: ProviderModelEntry, index = 0): string {
  return safeString(row._selection_key || row.upstream_model_id || row.model_id || row.id || row.name || `row-${index}`)
}

function modelMatchesSearch(row: ProviderModelEntry, search: string): boolean {
  const keyword = search.trim().toLowerCase()
  if (!keyword) return true
  return [row.upstream_model_id, row.model_id, row.id, row.name]
    .some((value) => safeString(value).toLowerCase().includes(keyword))
}

function compactProviderModelRow(row: ProviderModelEntry): ProviderModelEntry {
  return {
    upstream_model_id: safeString(row.upstream_model_id).trim(),
    model_id: safeString(row.model_id).trim() || safeString(row.upstream_model_id).trim(),
    extra_config: parseJsonObject(stringifyJson(row.extra_config ?? {}), {}),
    enabled: row.enabled !== false,
  }
}

function defaultLimitPolicy(providerName: string): ProviderLimitPolicy {
  return {
    provider_name: providerName,
    name: 'default',
    enabled: true,
    account_rpm: 0,
    account_tpm: 0,
    model_tpm: 0,
    account_concurrent: 0,
    account_rph: 0,
    account_tph: 0,
    account_rpd: 0,
    account_tpd: 0,
    cooldown_policy: { '429': '60', error: '60' },
    freeze_policy: {
      enabled: true,
      rules: [
        {
          condition: 'status_code',
          key: '',
          operator: '==',
          value: '403',
          freeze_object: 'account',
          freeze_period: 'today',
          freeze_value: 0,
        },
        {
          condition: 'exception',
          key: '',
          operator: '',
          value: '',
          freeze_object: 'account',
          freeze_period: 'seconds',
          freeze_value: 60,
        },
        {
          condition: 'status_code',
          key: '',
          operator: '==',
          value: '429',
          freeze_object: 'account',
          freeze_period: 'seconds',
          freeze_value: 60,
        },
      ],
    },
    extra: {},
  }
}

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  height: '34px',
  padding: '0 12px',
  fontSize: '13px',
  fontWeight: '600',
  border: '1px solid var(--admin-border)',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  whiteSpace: 'nowrap',
  background: 'var(--bg3)',
  color: 'var(--text)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
}

const btnIcon: React.CSSProperties = { width: '15px', height: '15px', flexShrink: 0 }

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: 'var(--blue)',
  color: '#fff',
  border: '1px solid var(--blue)',
}

const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: 'var(--bg2)',
  color: 'var(--text)',
}

const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: 'color-mix(in srgb, var(--red) 8%, var(--bg2))',
  color: 'var(--red)',
  borderColor: 'color-mix(in srgb, var(--red) 45%, var(--admin-border))',
}

const batchDisabledStyle: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
  filter: 'grayscale(0.6)',
}

const iconActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '30px',
  height: '30px',
  padding: 0,
  fontSize: '13px',
  fontWeight: '600',
  border: '1px solid transparent',
  borderRadius: '9px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  whiteSpace: 'nowrap',
  background: 'transparent',
  color: 'var(--text2)',
}

const iconActionDangerStyle: React.CSSProperties = {
  ...iconActionStyle,
  color: 'var(--red)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 13px',
  fontSize: '14px',
  border: '1px solid var(--admin-border)',
  borderRadius: 'var(--admin-radius)',
  background: 'var(--bg2)',
  color: 'var(--text)',
  outline: 'none',
  transition: 'border-color 0.12s',
  boxSizing: 'border-box',
  fontFamily: 'var(--font)',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: '120px',
  resize: 'vertical',
  fontFamily: 'var(--fontM)',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

// 定时检测表单内原生 input/number 统一高度，对齐 shadcn Button（h-9 = 36px）触发的 ComboSelect。
const stInputStyle: React.CSSProperties = {
  ...inputStyle,
  height: 36,
  padding: '0 12px',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '14px',
  fontWeight: '600',
  color: 'var(--text2)',
}

const stFormGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '12px',
  alignItems: 'end',
}

const stFormFieldStyle: React.CSSProperties = {
  minWidth: 0,
}

const stLabelStyle: React.CSSProperties = {
  ...labelStyle,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
}

// 定时检测表单项的「?」帮助标记：圆圈 + 原生 title 提示，与检测结果范围既有样式一致。
const stHelpMarkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '1px solid var(--admin-border)',
  fontSize: '10px',
  color: 'var(--text2)',
  cursor: 'help',
  lineHeight: 1,
}

const tagBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  fontSize: '12px',
  fontWeight: '600',
  borderRadius: '999px',
  border: '1px solid var(--admin-border)',
  color: 'var(--text)',
  background: 'var(--bg3)',
}

function normalizeProviderTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)))
}

function providerTagColor(tag: string): React.CSSProperties {
  const palette = [
    { color: '#2563eb', background: 'rgba(37, 99, 235, 0.12)', borderColor: 'rgba(37, 99, 235, 0.28)' },
    { color: '#7c3aed', background: 'rgba(124, 58, 237, 0.12)', borderColor: 'rgba(124, 58, 237, 0.28)' },
    { color: '#db2777', background: 'rgba(219, 39, 119, 0.12)', borderColor: 'rgba(219, 39, 119, 0.28)' },
    { color: '#059669', background: 'rgba(5, 150, 105, 0.12)', borderColor: 'rgba(5, 150, 105, 0.28)' },
    { color: '#d97706', background: 'rgba(217, 119, 6, 0.12)', borderColor: 'rgba(217, 119, 6, 0.28)' },
    { color: '#0891b2', background: 'rgba(8, 145, 178, 0.12)', borderColor: 'rgba(8, 145, 178, 0.28)' },
  ]
  const hash = Array.from(tag).reduce((value, char) => ((value * 31) + (char.codePointAt(0) ?? 0)) >>> 0, 0)
  return palette[hash % palette.length]
}

const UNTAGGED_FILTER = Symbol('untagged-provider-filter')
type ProviderTagFilterValue = string | typeof UNTAGGED_FILTER

function providerTagFilterLabel(value: ProviderTagFilterValue): string {
  return value === UNTAGGED_FILTER ? '未设置标签' : value
}

function ProviderTagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const addDraft = () => {
    const tag = draft.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div style={{ ...inputStyle, minHeight: '42px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '6px 8px' }}>
      {value.map((tag) => (
        <span key={tag} style={{ ...tagBase, ...providerTagColor(tag), gap: '5px', fontWeight: 500 }}>
          {tag}
          <button
            type="button"
            aria-label={`移除标签 ${tag}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
            style={{ border: 0, background: 'transparent', color: 'var(--text2)', padding: 0, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addDraft()
          } else if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        placeholder={value.length > 0 ? '继续输入，按 Enter 添加' : '输入标签，按 Enter 添加'}
        style={{ flex: '1 1 100px', minWidth: '80px', border: 0, outline: 0, background: 'transparent', color: 'var(--text)', font: 'inherit' }}
      />
    </div>
  )
}

function ProviderTagFilter({
  value,
  options,
  onChange,
}: {
  value: ProviderTagFilterValue[]
  options: string[]
  onChange: (next: ProviderTagFilterValue[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (tag: ProviderTagFilterValue) => {
    onChange(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag])
  }
  const filterOptions: ProviderTagFilterValue[] = [UNTAGGED_FILTER, ...options]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="h-auto min-h-9 w-[220px] justify-between px-2.5 py-1.5 font-normal"
          title="可选择多个标签，命中任一标签即显示"
        >
          <span className="flex flex-1 flex-wrap gap-1 overflow-hidden">
            {value.length === 0 ? (
              <span className="text-muted-foreground">按标签筛选</span>
            ) : (
              value.map((tag) => {
                const label = providerTagFilterLabel(tag)
                return (
                  <Badge key={tag === UNTAGGED_FILTER ? 'filter:untagged' : `tag:${tag}`} variant="secondary" className="gap-1" style={tag === UNTAGGED_FILTER ? undefined : providerTagColor(tag)}>
                    {label}
                    <span
                      role="button"
                      tabIndex={-1}
                      className="hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation()
                        toggle(tag)
                      }}
                    >
                      <X className="size-3" />
                    </span>
                  </Badge>
                )
              })
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索标签..." />
          <CommandList>
            <CommandEmpty>无匹配标签</CommandEmpty>
            <CommandGroup>
              {filterOptions.map((tag) => {
                const checked = value.includes(tag)
                const label = providerTagFilterLabel(tag)
                const key = tag === UNTAGGED_FILTER ? '__untagged__' : tag
                return (
                  <CommandItem key={key} value={label} onSelect={() => toggle(tag)}>
                    <Check className={cn('size-4', checked ? 'opacity-100' : 'opacity-0')} />
                    <Badge variant="secondary" style={tag === UNTAGGED_FILTER ? undefined : providerTagColor(tag)}>{label}</Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg2) 96%, white 4%), var(--bg2))',
  border: '1px solid color-mix(in srgb, var(--admin-border) 82%, var(--blue) 18%)',
  borderRadius: '14px',
  padding: '16px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
}

const grid2Style: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '12px',
}

type ModelTableEntry = { row: ProviderModelEntry; index: number }

function ModelEditorModal({
  open,
  row,
  isNew,
  onClose,
  onSave,
}: {
  open: boolean
  row: ProviderModelEntry | null
  isNew: boolean
  onClose: () => void
  onSave: (row: ProviderModelEntry) => void
}) {
  const [draft, setDraft] = useState<ProviderModelEntry>(row ?? buildModelRow())

  // 每次打开时重置草稿（依赖 row 和 open）
  useEffect(() => {
    if (open && row) setDraft({ ...row })
    else if (open && isNew) setDraft(buildModelRow())
  }, [open, row, isNew])

  const update = (patch: Partial<ProviderModelEntry>) => setDraft((prev) => ({ ...prev, ...patch }))

  // extra_config 读写助手：所有新增字段仍存进 extra_config，类型化访问避免重复 cast。
  const extraCfg = (draft.extra_config as Record<string, unknown> | undefined) ?? {}
  const patchExtra = (patch: Record<string, unknown>) => update({ extra_config: { ...extraCfg, ...patch } })

  // 思考默认值形态：reasoning_effort（openai 出站，字符串）与 thinking（anthropic 出站，dict）
  // 二选一互斥。thinking 取值：'enabled'|'disabled'|null（未配）。
  const thinkingVal = extraCfg.thinking
  const thinkingMode: '' | 'reasoning' | 'thinking-enabled' | 'thinking-disabled' =
    extraCfg.reasoning_effort != null && extraCfg.reasoning_effort !== ''
      ? 'reasoning'
      : thinkingVal && typeof thinkingVal === 'object' && (thinkingVal as { type?: string }).type === 'enabled'
        ? 'thinking-enabled'
        : thinkingVal && typeof thinkingVal === 'object' && (thinkingVal as { type?: string }).type === 'disabled'
          ? 'thinking-disabled'
          : ''
  const thinkingBudget = thinkingVal && typeof thinkingVal === 'object'
    ? safeNumber((thinkingVal as { budget_tokens?: number }).budget_tokens)
    : 0

  if (!open) return null

  const disabled = !safeString(draft.upstream_model_id).trim()
  const modalLabel = isNew ? '新增渠道模型' : `编辑模型 · ${safeString(draft.upstream_model_id) || '(空)'}`

  return (
    <Modal open title={modalLabel} onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={grid2Style}>
          <div>
            <label style={labelStyle}>上游模型 ID *</label>
            <input value={safeString(draft.upstream_model_id)} onChange={(e) => update({ upstream_model_id: e.target.value })} placeholder="gpt-4o / claude-3-opus" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>模型 ID（对外名称）</label>
            <input value={safeString(draft.model_id)} onChange={(e) => update({ model_id: e.target.value })} placeholder="留空与上游相同" style={inputStyle} />
          </div>
        </div>
        {/* 出站默认值：max_tokens（客户端未传时用渠道值，客户端传了用客户端的）。
            只作为默认值，无其它作用。reasoning_effort / thinking 见下方二选一区。 */}
        <div style={grid2Style}>
          <div>
            <label style={labelStyle}>max_tokens（输出上限默认值）</label>
            <input
              type="number"
              value={safeString(extraCfg.max_tokens ?? '')}
              onChange={(e) => {
                const v = e.target.value.trim()
                patchExtra({ max_tokens: v === '' ? null : Number(v) })
              }}
              placeholder="不设置"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>max_context_tokens（输入上限）</label>
            <input
              type="number"
              value={safeString(extraCfg.max_context_tokens ?? '')}
              onChange={(e) => {
                const v = e.target.value.trim()
                patchExtra({ max_context_tokens: v === '' ? null : Number(v) })
              }}
              placeholder="选路时按此过滤"
              style={inputStyle}
            />
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, display: 'block' }}>
          max_tokens / reasoning_effort / thinking 作为发给上游的默认值，客户端未传时生效；max_context_tokens 用于选路：预估输入超过此值的渠道模型不进候选。
        </span>

        {/* 思考默认值：reasoning_effort（openai 出站）与 thinking（anthropic 出站）二选一，互斥。 */}
        <div>
          <label style={labelStyle}>思考模式默认值（reasoning_effort / thinking 二选一）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="thinking-mode"
                checked={thinkingMode === ''}
                onChange={() => patchExtra({ reasoning_effort: null, thinking: null })}
              />
              不设置
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="thinking-mode"
                checked={thinkingMode === 'reasoning'}
                onChange={() => patchExtra({
                  reasoning_effort: String(extraCfg.reasoning_effort ?? 'medium') || 'medium',
                  thinking: null,
                })}
              />
              reasoning_effort（openai）
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="thinking-mode"
                checked={thinkingMode === 'thinking-enabled' || thinkingMode === 'thinking-disabled'}
                onChange={() => patchExtra({
                  thinking: { type: 'enabled', budget_tokens: thinkingBudget || 1024 },
                  reasoning_effort: null,
                })}
              />
              thinking（anthropic）
            </label>
          </div>
          {thinkingMode === 'reasoning' && (
            <div style={{ marginTop: 8 }}>
              <ComboSearchSelect
                value={safeString(extraCfg.reasoning_effort ?? 'medium')}
                onChange={(v) => patchExtra({ reasoning_effort: v || null })}
                options={REASONING_EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                contentZIndex={1101}
              />
            </div>
          )}
          {(thinkingMode === 'thinking-enabled' || thinkingMode === 'thinking-disabled') && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="radio"
                  name="thinking-type"
                  checked={thinkingMode === 'thinking-enabled'}
                  onChange={() => patchExtra({ thinking: { type: 'enabled', budget_tokens: thinkingBudget || 1024 } })}
                />
                enabled
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="radio"
                  name="thinking-type"
                  checked={thinkingMode === 'thinking-disabled'}
                  onChange={() => patchExtra({ thinking: { type: 'disabled' } })}
                />
                disabled
              </label>
              {thinkingMode === 'thinking-enabled' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  budget_tokens
                  <input
                    type="number"
                    value={thinkingBudget || ''}
                    onChange={(e) => {
                      const v = e.target.value.trim()
                      patchExtra({ thinking: { type: 'enabled', budget_tokens: v === '' ? 0 : Number(v) } })
                    }}
                    style={{ ...inputStyle, width: 100 }}
                    placeholder="1024"
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>客户端模拟（可选，覆盖渠道配置）</label>
          <ComboSearchSelect
            value={safeString(extraCfg.client_preset ?? 'none')}
            onChange={(v) => patchExtra({ client_preset: v ?? 'none' })}
            options={CLIENT_PRESET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            contentZIndex={1101}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--admin-border)', borderRadius: 10, background: 'var(--panel2)' }}>
          <input
            type="checkbox"
            checked={Boolean(extraCfg.enable_1m_context)}
            onChange={(e) => patchExtra({ enable_1m_context: e.target.checked })}
            style={{ marginTop: 2 }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>启用 1M 上下文声明</span>
            <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>请求该渠道模型时合并 anthropic-beta: context-1m-2025-08-07，适用于要求显式声明 1M 上下文的上游。</span>
          </span>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--admin-border)', paddingTop: '12px' }}>
          <button onClick={onClose} style={btnGhost}>取消</button>
          <button onClick={() => { onSave(draft); onClose() }} disabled={disabled} style={btnPrimary}>{isNew ? '添加' : '保存'}</button>
        </div>
      </div>
    </Modal>
  )
}

function ProviderModelTable({
  entries,
  emptyText,
  selectable = false,
  selected,
  onToggleSelected,
  onDeleteRow,
  onEditRow,
  onDetectModel,
  onToggleEnabled,
}: {
  entries: ModelTableEntry[]
  emptyText: string
  selectable?: boolean
  selected?: Set<string>
  onToggleSelected?: (key: string, checked: boolean) => void
  onDeleteRow?: (row: ProviderModelEntry, index: number) => void | Promise<void>
  onEditRow?: (row: ProviderModelEntry, index: number) => void | Promise<void>
  onDetectModel?: (row: ProviderModelEntry) => void | Promise<void>
  /** 行级启用开关列（模型列表草稿态用）。不传不渲染该列（上游导入视图）。 */
  onToggleEnabled?: (row: ProviderModelEntry, index: number) => void
}) {
  const colSpan = 3 + (selectable ? 1 : 0) + (onToggleEnabled ? 1 : 0)

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg2)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            {selectable && <th style={{ padding: '4px 8px', textAlign: 'left', width: 36 }} />}
            <th style={{ padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>上游模型</th>
            <th style={{ padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>模型 ID</th>
            {onToggleEnabled && <th style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>启用</th>}
            <th style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr><td colSpan={colSpan} style={{ padding: '20px', textAlign: 'center', color: 'var(--text2)' }}>{emptyText}</td></tr>
          ) : entries.map(({ row, index }) => {
            const rowKey = modelDraftKey(row, index)
            const rowEnabled = row.enabled !== false
            return (
              <tr key={`${rowKey}-${index}`} style={{ borderBottom: '1px solid var(--admin-border)', opacity: rowEnabled ? undefined : 0.55 }}>
                {selectable && (
                  <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                    <input type="checkbox" checked={!!selected?.has(rowKey)} onChange={(e) => onToggleSelected?.(rowKey, e.target.checked)} />
                  </td>
                )}
                <td style={{ padding: '6px 8px', fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--fontM)' }}>{safeString(row.upstream_model_id) || '—'}</td>
                <td style={{ padding: '6px 8px', fontSize: '13px', color: safeString(row.model_id) === safeString(row.upstream_model_id) ? 'var(--text2)' : 'var(--text)', fontFamily: 'var(--fontM)' }}>
                  {safeString(row._display_model_id) || safeString(row.model_id) || safeString(row.upstream_model_id) || '—'}
                </td>
                {onToggleEnabled && (
                  <td style={{ padding: '2px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {/* 行级开关：停用 = 模型保留在表但不路由（保存后生效），整行降透明度提示。 */}
                    <span
                      role="button"
                      title={rowEnabled ? '已启用：参与请求路由与对外模型列表' : '已停用：不参与路由与对外模型列表，行保留可随时重开'}
                      onClick={() => onToggleEnabled(row, index)}
                      style={{ ...btnBase, padding: '3px 12px', background: rowEnabled ? 'var(--green)' : 'var(--bg3)', borderColor: rowEnabled ? 'var(--green)' : 'var(--admin-border)', color: rowEnabled ? '#fff' : 'var(--text2)', height: 26, fontSize: 12 }}
                    >{rowEnabled ? '开' : '关'}</span>
                  </td>
                )}
                <td style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button onClick={() => void onEditRow?.(row, index)} style={{ ...btnPrimary, padding: '4px 10px', marginRight: '4px' }}>编辑</button>
                  {onDetectModel && safeString(row.upstream_model_id).trim() && (
                    <button onClick={() => void onDetectModel?.(row)} style={{ ...btnGhost, padding: '4px 10px', marginRight: '4px' }}>窗口测试</button>
                  )}
                  <button onClick={() => void onDeleteRow?.(row, index)} style={{ ...btnDanger, padding: '4px 10px' }}>删除</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Modal({
  open,
  title,
  titleIcon,
  titleExtra,
  onClose,
  children,
  footer,
  maxWidth = 640,
  fixedHeight,
  contentOverflow,
}: {
  open: boolean
  title: string
  titleIcon?: React.ReactNode
  titleExtra?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  maxWidth?: number
  fixedHeight?: string | number
  contentOverflow?: React.CSSProperties['overflowY']
}) {
  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `${maxWidth}px`,
          maxWidth: '100%',
          maxHeight: '88vh',
          height: fixedHeight,
          overflowY: footer ? 'hidden' : 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--admin-border)',
          borderRadius: 'var(--admin-radiusL)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--admin-border)',
            background: 'linear-gradient(135deg, var(--surface2) 0%, var(--surface) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexShrink: 0,
            position: footer ? 'static' : 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {titleIcon}
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 750, color: 'var(--textH)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </h2>
            {titleExtra}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              width: '32px',
              height: '32px',
              border: '1px solid var(--admin-border)',
              borderRadius: 'var(--admin-radius)',
              background: 'var(--bg3)',
              color: 'var(--text2)',
              fontSize: '20px',
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: '24px',
            overflowY: contentOverflow ?? (footer ? 'auto' : undefined),
            flex: footer ? '1 1 auto' : undefined,
            minHeight: 0,
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--admin-border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusTag({
  label,
  color,
  fill = false,
}: {
  label: string
  color: string
  fill?: boolean
}) {
  return (
    <span
      style={{
        ...tagBase,
        borderColor: color,
        color: fill ? '#fff' : color,
        background: fill ? color : 'transparent',
      }}
    >
      {label}
    </span>
  )
}

// 单条限额进度条：文字 used/limit + 4px 填充条，达 80% 橙色、达 100% 红色。
// 只用于「有限额」的维度，不限的维度在上层就被过滤掉，不会渲染到这里。
function LimitBar({
  label,
  used,
  limit,
}: {
  label: string
  used: number
  limit: number
}) {
  const ratio = Math.min(1, used / limit)
  const pct = Math.round(ratio * 100)
  const barColor = ratio >= 1 ? 'var(--red)' : ratio >= 0.8 ? 'var(--yellow)' : 'var(--green)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text2)' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--fontM)', color: 'var(--text)' }}>{`${used}/${limit}`}</span>
      </div>
      <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg3)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.2s' }} />
      </div>
    </div>
  )
}

type LimitDim = { label: string; used: number; limit: number }

// 账号限额展示：
// - 汇总所有维度（TPM/RPM/RPD/并发），过滤掉 limit<=0 的「不限」维度。
// - 无任何限额 → 显示为空（一个淡灰占位符）。
// - 有限额 → 只显示「最吃紧」（used/limit 比例最高）的那一条进度条；
//   若不止一个维度，则在后面加一个「?」徽标，hover 弹出全部限额明细。
function AccountLimits({
  tpmUsed, tpmLimit,
  rpmUsed, rpmLimit,
  rpdUsed, rpdLimit,
  concurrentUsed, concurrentLimit,
}: {
  tpmUsed: number; tpmLimit: number
  rpmUsed: number; rpmLimit: number
  rpdUsed: number; rpdLimit: number
  concurrentUsed: number; concurrentLimit: number
}) {
  const [open, setOpen] = useState(false)
  const dims: LimitDim[] = [
    { label: 'TPM', used: tpmUsed, limit: tpmLimit },
    { label: 'RPM', used: rpmUsed, limit: rpmLimit },
    { label: 'RPD', used: rpdUsed, limit: rpdLimit },
    { label: '并发', used: concurrentUsed, limit: concurrentLimit },
  ].filter((d) => d.limit && d.limit > 0)

  if (dims.length === 0) {
    return <span style={{ color: 'var(--text2)', fontSize: '13px' }}>—</span>
  }

  // 最吃紧的维度：used/limit 比例最高者。
  const primary = dims.reduce((a, b) => (b.used / b.limit > a.used / a.limit ? b : a))
  const hasMore = dims.length > 1

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
      <LimitBar label={primary.label} used={primary.used} limit={primary.limit} />
      {hasMore && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            aria-label="查看全部限额"
            onClick={() => setOpen((v) => !v)}
            style={{
              width: '16px', height: '16px', borderRadius: '50%', border: '1px solid var(--admin-border)',
              background: 'var(--bg3)', color: 'var(--text2)', fontSize: '11px', lineHeight: '14px',
              cursor: 'pointer', padding: 0, marginTop: '1px',
            }}
          >
            ?
          </button>
          {open && (
            <div
              style={{
                position: 'absolute', top: '20px', left: 0, zIndex: 20,
                display: 'flex', flexDirection: 'column', gap: '8px',
                padding: '10px 12px', minWidth: '160px',
                background: 'var(--bg2)', border: '1px solid var(--admin-border)',
                borderRadius: 'var(--admin-radius)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text2)' }}>全部限额</div>
              {dims.map((d) => (
                <LimitBar key={d.label} label={d.label} used={d.used} limit={d.limit} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionBlock({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text2)', letterSpacing: '0.04em' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

// 代码渠道「使用说明」与「使用样例」已内嵌成源码区的子 Tab（CodeChannelEditorTabs.tsx），
// 使用说明正文由后端从仓库文件读取（docs/providers/code-channel.md），最小样例为目录
// 预设的 EchoChannel；完整说明与说明性片段见产品文档站。

// 账号编辑表单显式处理、或需静默丢弃的遗留键（不进“额外字段”可编辑区、不回写）。
// rpd_limit / rpd_per_account：每日请求上限已收敛到渠道级策略表 account_rpd，
// 账号不再单独覆盖；保留在此集合防止历史残留键回显成额外字段被误改回写。
const ACCOUNT_HANDLED_KEYS = new Set([
  'switch',
  'username',
  'password',
  'api_key',
  'key',
  'token',
  'account_id',
  'name',
  'model_name',
  'priority',
  'weight',
  'rpm_limit',
  'tpm_limit',
  'concurrent_limit',
  'proxy',
  'proxy_id',
  'proxy_mode',
  'price_remark',
  'client_id',
  'client_secret',
  'refresh_token',
  'access_token',
  'expires_at',
  'token_expires_at',
  '_access_token_expires_at',
  'access_token_expires_at',
  'rpd_limit',
  'rpd_per_account',
  'add_method',
  'metadata',
])

const ACCOUNT_RUNTIME_KEYS = new Set([
  'auth',
  'auth_checked_at',
  'auth_error',
  'concurrent_used',
  'rpm_used',
  'rpm_available',
  'tpm_used',
  'tpm_available',
  'rpd_limit',
  'rpd_used',
  'rpd_available',
  'disabled',
  'disable_reason',
  'cooldown',
  'cooldown_reason',
  'cooldown_remaining',
  'cooldown_until',
  'cooldown_scope',
  'model_cooldowns',
  'state',
  'is_frozen',
  'freeze_items',
  'has_access_token',
  'has_cookies',
  'token_expires_at',
  'proxy_url',
])
function getAccountExpiryText(value: unknown): string {
  const expiry = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0)
  if (!expiry) return '无'
  const ts = expiry > 1_000_000_000_000 ? expiry : expiry * 1000
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '无'
  return date.toLocaleString('zh-CN')
}

function getExtraAccountFields(record: Record<string, unknown>, schema?: ProviderAccountSchema | null): Array<[string, unknown]> {
  const schemaKeys = new Set(normalizeSchemaFields(schema ?? null).map((field) => field.key))
  return Object.entries(record).filter(([k]) => !ACCOUNT_HANDLED_KEYS.has(k) && !ACCOUNT_RUNTIME_KEYS.has(k) && !schemaKeys.has(k))
}

function serializeExtraField(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function parseExtraField(prev: unknown, text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (typeof prev === 'number') {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : prev
  }
  if (typeof prev === 'boolean') {
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    return prev
  }
  if (typeof prev === 'object' && prev !== null) {
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : prev
    } catch {
      return prev
    }
  }
  return text
}


function normalizeSchemaFields(schema: ProviderAccountSchema | null): AccountSchemaField[] {
  return Array.isArray(schema?.fields) ? schema.fields.filter((f) => f && f.key) : []
}

function schemaFieldValue(field: AccountSchemaField, form: ProviderAccountPayload): string {
  const raw = form[field.key]
  if (field.type === 'datetime') return getAccountExpiryText(raw)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  return safeString(raw)
}

function metadataBadges(account: ProviderAccount, schema: ProviderAccountSchema | null): Array<[string, string]> {
  const raw = account as Record<string, unknown>
  const meta = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? raw.metadata as Record<string, unknown>
    : {}
  const keys = [...(schema?.metadata_badges ?? []), 'add_method']
  const result: Array<[string, string]> = []
  for (const key of keys) {
    const value = meta[key] ?? raw[key]
    if (value === null || value === undefined || value === '') continue
    result.push([key, String(value)])
    if (result.length >= 4) break
  }
  return result
}

// 状态列悬浮详情：认证相关的「标签—值」行。账号名列只显示账号名后，过期时间/认证材料/
// 认证错误/添加方式等诊断统一收进这里；冻结/冷却信息归「冻结原因」列，不在此重复。
type AccountStatusDetail = { key: string; label: string; value: string }

function buildAccountStatusDetails(account: ProviderAccount, schema: ProviderAccountSchema | null): AccountStatusDetail[] {
  const raw = account as Record<string, unknown>
  const rows: AccountStatusDetail[] = []
  // state 缺省（旧后端未返回）时沿用 getAccountBadge 的布尔回退口径。
  const authFailed = account.state === 'auth_failed' || (account.state == null && account.auth === false)
  if (authFailed) rows.push({ key: 'auth_error', label: '认证错误', value: safeString(account.auth_error).trim() || '未知认证错误' })
  if (account.state === 'disabled') rows.push({ key: 'disable_reason', label: '禁用原因', value: safeString(account.disable_reason).trim() || '账号开关已关闭或未加载' })
  const materials = [account.has_access_token || raw.access_token ? 'Access Token' : '', account.has_cookies ? 'Cookies' : ''].filter(Boolean)
  if (materials.length > 0) rows.push({ key: 'materials', label: '认证材料', value: materials.join('、') })
  const expiryText = getAccountExpiryText(account.token_expires_at ?? raw.expires_at ?? raw.access_token_expires_at)
  if (expiryText !== '无') rows.push({ key: 'expiry', label: '过期时间', value: expiryText })
  else if (materials.length > 0) rows.push({ key: 'expiry', label: '过期时间', value: '未知' })
  const checkedText = getAccountExpiryText(account.auth_checked_at)
  if (checkedText !== '无') rows.push({ key: 'checked_at', label: '上次检查', value: checkedText })
  const meta = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? raw.metadata as Record<string, unknown>
    : {}
  const addMethod = meta.add_method ?? raw.add_method
  if (addMethod) rows.push({ key: 'add_method', label: '添加方式', value: addMethod === 'callback' ? '回调添加' : String(addMethod) })
  for (const [key, value] of metadataBadges(account, schema)) {
    if (key === 'add_method') continue // 已作为「添加方式」单独展示，避免重复
    rows.push({ key: `meta_${key}`, label: key, value })
  }
  return rows.slice(0, 8)
}

function AccountsTab({
  providerId,
  builtinType,
  active,
  onEditingChange,
}: {
  providerId: string
  builtinType: string
  active: boolean
  /** 上报「新增账号 / 编辑账号」表单态：父弹框据此在关闭 / 切 Tab 前确认丢弃未保存表单。 */
  onEditingChange?: (editing: boolean) => void
}) {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editingUsername, setEditingUsername] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderAccountPayload>({ username: '', switch: true, proxy: '' })
  const [extraFields, setExtraFields] = useState<Record<string, unknown>>({})
  const [metadataFields, setMetadataFields] = useState<Record<string, unknown>>({})
  const [accountSchema, setAccountSchema] = useState<ProviderAccountSchema | null>(null)
  const [authStarting, setAuthStarting] = useState(false)
  const [authStartInfo, setAuthStartInfo] = useState<string | null>(null)
  const [authPolling, setAuthPolling] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [replayUrl, setReplayUrl] = useState('')
  const [replaying, setReplaying] = useState(false)
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const authStateRef = useRef<string | null>(null)
  const [refreshingAuth, setRefreshingAuth] = useState<Record<string, boolean>>({})
  const [initiating, setInitiating] = useState<Record<string, boolean>>({})
  const [thawing, setThawing] = useState<Record<string, boolean>>({})
  const [batchMode, setBatchMode] = useState(false)
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set())
  const [proxySaving, setProxySaving] = useState<Record<string, boolean>>({})
  const [batchAddOpen, setBatchAddOpen] = useState(false)
  const [batchProxyOpen, setBatchProxyOpen] = useState(false)
  const [batchProxyValue, setBatchProxyValue] = useState('')
  const [batchAddText, setBatchAddText] = useState('')
  const [batchAddProxy, setBatchAddProxy] = useState('')
  const [batchAddError, setBatchAddError] = useState<string | null>(null)

  const channelType = builtinType || providerId
  const isCloudflare = channelType === 'cloudflare'
  const isEdgeOne = channelType === 'edgeone-ai'
  const isTabbit = channelType === 'tabbit'
  const [builtinDocUrl, setBuiltinDocUrl] = useState<string | undefined>(undefined)
  const authMode = getChannelAuthMode(providerId, builtinType)
  const websiteUrl = PROVIDER_WEBSITE_URLS[channelType]
  const docGuide = PROVIDER_DOC_GUIDE[channelType]
  const docUrl = builtinDocUrl
  const schemaPasswordField = normalizeSchemaFields(accountSchema).find((field) => field.key === 'password' || field.key === 'api_key')
  const passwordLabel = safeString(schemaPasswordField?.label)
    || (isCloudflare ? 'API Key'
      : isEdgeOne ? '密码 / API Key（可空）'
      : 'API Key / 密码')

  const loadAccounts = useCallback(async () => {
    if (!providerId) return
    setLoading(true)
    setError(null)
    try {
      // accounts(full) 已内联返回每个账号的 cooldown/model_cooldowns 字段，
      // 无需再并发调用 accounts/status（后者会重复触发一次渠道级冻结索引读取）。
      const [data, proxyList, schema] = await Promise.all([
        getProviderAccounts(providerId),
        getProxies().catch(() => [] as ProxyEntry[]),
        getProviderAccountSchema(providerId).catch(() => null),
      ])
      setAccounts(data)
      setSelectedUsernames((prev) => {
        const valid = new Set(data.map((item) => item.username))
        const next = new Set(Array.from(prev).filter((username) => valid.has(username)))
        return next.size === prev.size ? prev : next
      })
      setProxies(proxyList)
      setAccountSchema(schema)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载账号失败')
    } finally {
      setLoading(false)
    }
  }, [providerId])

  useEffect(() => {
    if (active) {
      void loadAccounts()
    }
    // 切到其他 tab 时不清空账号数据，避免来回切换时反复拉接口
  }, [active, loadAccounts])

  // 上报编辑态给父弹框：进入/退出表单、以及组件卸载（切 Tab/关弹框）都要同步，
  // 否则父层会拿着已卸载表单的 editing=true 永久拦截后续操作。
  // onEditingChange 由父层 useCallback 固定引用，不随 render 抖动。
  useEffect(() => {
    onEditingChange?.(isEditing)
    return () => onEditingChange?.(false)
  }, [isEditing, onEditingChange])

  // 加载内置渠道的文档链接（仅部分渠道有，如 Cloudflare）
  useEffect(() => {
    if (!channelType) return
    let cancelled = false
    getBuiltinProviders()
      .then((list) => {
        if (cancelled) return
        const info = list.find((p) => p.name === channelType)
        setBuiltinDocUrl(info?.doc_url || undefined)
      })
      .catch(() => { /* 静默失败 */ })
    return () => { cancelled = true }
  }, [channelType])

  // 监听授权回调窗口的 postMessage（来自 HTMLResponse 页面）
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // 回调页由本服务端渲染，必然同源；不校验 origin 等于任何页面都能伪造「授权完成」
      if (event.origin !== window.location.origin) return
      if (!event.data || event.data.type !== 'ai-lubricant-account-auth') return
      // 回调已给出终态，轮询 interval 必须一起停掉（只置 authPolling 会让它继续跑）
      if (authPollRef.current) { clearInterval(authPollRef.current); authPollRef.current = null }
      authStateRef.current = null
      setAuthPolling(false)
      if (event.data.ok) {
        setAuthStartInfo('授权完成')
        // 立即刷新账号列表
        void loadAccounts()
      } else {
        setAuthError(event.data.message || '授权失败')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [loadAccounts])

  const resetForm = () => {
    setForm({ username: '', switch: true, proxy: '' })
    setExtraFields({})
    setMetadataFields({})
    setAuthStartInfo(null)
  }

  const startCreate = () => {
    setEditingUsername(null)
    setIsEditing(true)
    resetForm()
    const schemaDefaults = Object.fromEntries(
      normalizeSchemaFields(accountSchema).map((field) => [field.key, field.default_value ?? field.default ?? '']),
    )
    setForm({
      ...schemaDefaults,
      username: '',
      password: '',
      api_key: '',
      proxy: '',
      switch: true,
      price_remark: '',
    })
  }

  const startEdit = (account: ProviderAccount) => {
    const raw = account as Record<string, unknown>
    setEditingUsername(account.username)
    setIsEditing(true)
    const schemaValues = Object.fromEntries(
      normalizeSchemaFields(accountSchema).map((field) => [field.key, raw[field.key] ?? field.default_value ?? field.default ?? '']),
    )
    setForm({
      ...schemaValues,
      username: account.username,
      // 可见框统一用 password 承载凭据回显（值取账号真正在用的字段）；不再单独预填
      // form.api_key/key，避免保存时把陈旧值连带回传遮蔽新凭据（见 saveAccount 的路由逻辑）。
      password: safeString(raw.password || raw.api_key || raw.key || raw.token),
      proxy: (raw.proxy_id ?? raw.proxy) === null ? null : safeString(raw.proxy_id ?? raw.proxy),
      switch: account.switch,
      price_remark: safeString(raw.price_remark),
      account_id: safeString(raw.account_id ?? (isCloudflare ? raw.username : '')),
      name: safeString(raw.name),
      model_name: safeString(raw.model_name),
      client_id: safeString(raw.client_id),
      client_secret: safeString(raw.client_secret),
      refresh_token: safeString(raw.refresh_token),
      access_token: safeString(raw.access_token),
      access_token_expires_at: typeof raw._access_token_expires_at === 'number'
        ? raw._access_token_expires_at
        : (typeof raw.expires_at === 'number' ? raw.expires_at : (typeof raw.token_expires_at === 'number' ? raw.token_expires_at : undefined)),
    })
    setExtraFields(Object.fromEntries(getExtraAccountFields(raw, accountSchema)))
    const rawMetadata = raw.metadata
    setMetadataFields(rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata) ? { ...(rawMetadata as Record<string, unknown>) } : {})
  }

  // 复制账号：沿用 startEdit 的预填逻辑，但 editingUsername 置空（保存走新增），
  // 用户名追加 -copy 后缀避免与源账号重名；进入新增编辑态后需点「添加账号」确认才落库。
  const startCopy = (account: ProviderAccount) => {
    startEdit(account)
    setEditingUsername(null)
    setForm((prev) => ({ ...prev, username: `${account.username}-copy` }))
  }

  const backToList = () => {
    // 返回列表时自动取消进行中的授权
    if (authPollRef.current || authStateRef.current) {
      void cancelAccountAuth()
    }
    setIsEditing(false)
    setEditingUsername(null)
    resetForm()
  }

  const toggleSelected = (username: string, checked: boolean) => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev)
      if (checked) next.add(username)
      else next.delete(username)
      return next
    })
  }
  const allSelected = accounts.length > 0 && selectedUsernames.size === accounts.length
  const toggleSelectAll = (checked: boolean) => {
    setSelectedUsernames(checked ? new Set(accounts.map((item) => item.username)) : new Set())
  }
  const selectedUsernamesList = useMemo(
    () => Array.from(selectedUsernames),
    [selectedUsernames],
  )
  const enterBatchMode = () => {
    setSelectedUsernames(new Set())
    setBatchMode(true)
  }
  const leaveBatchMode = () => {
    setSelectedUsernames(new Set())
    setBatchProxyOpen(false)
    setBatchProxyValue('')
    setBatchMode(false)
  }
  const openBatchProxy = () => {
    if (selectedUsernamesList.length === 0) return
    setBatchProxyValue('')
    setBatchProxyOpen(true)
  }

  // 批量添加粘贴解析：每行按空白切分。第一个 token = 用户名，第二个 = schema 声明的凭据字段
  // （没 schema 时回退 password）；schema 额外必填字段 ≥2 个时，按字段声明顺序映射后续 token。
  const batchSchemaFields = normalizeSchemaFields(accountSchema)
  const credField = schemaPasswordField?.key || 'password'
  const extraSchemaFields = batchSchemaFields.filter((field) => !['username', 'password', 'api_key', 'key', 'proxy', 'switch'].includes(field.key))
  const requiredExtraSchemaFields = extraSchemaFields.filter((field) => field.required)
  const batchFormatTokens = useMemo(() => {
    const tokens = ['用户名', schemaPasswordField?.label || (credField === 'api_key' ? 'API_KEY' : '密钥')]
    requiredExtraSchemaFields.forEach((field) => tokens.push(field.label || field.key))
    return tokens
  }, [schemaPasswordField, requiredExtraSchemaFields, credField])
  const showBatchFormatHint = requiredExtraSchemaFields.length > 0

  const parseBatchText = (text: string): { accounts: ProviderAccountPayload[]; errors: string[] } => {
    const errors: string[] = []
    const accounts: ProviderAccountPayload[] = []
    const seen = new Set<string>()
    text.split(/\r?\n/).forEach((rawLine, index) => {
      const line = rawLine.trim()
      if (!line) return
      const tokens = line.split(/\s+/).map((part) => part.trim()).filter(Boolean)
      if (tokens.length < 2) {
        errors.push(`第 ${index + 1} 行：缺少凭据`)
        return
      }
      const username = tokens[0]
      if (seen.has(username)) {
        errors.push(`第 ${index + 1} 行：用户名 ${username} 重复`)
        return
      }
      seen.add(username)
      const payload: ProviderAccountPayload = { username, switch: true }
      payload[credField] = tokens[1]
      const followingFields = requiredExtraSchemaFields.slice()
      let tokenIndex = 2
      followingFields.forEach((field) => {
        if (tokenIndex < tokens.length) {
          payload[field.key] = tokens[tokenIndex]
          tokenIndex += 1
        } else if (field.required) {
          errors.push(`第 ${index + 1} 行：缺少 ${field.label || field.key}`)
        }
      })
      accounts.push(payload)
    })
    return { accounts, errors }
  }

  const openBatchAdd = () => {
    setBatchAddText('')
    setBatchAddProxy('')
    setBatchAddError(null)
    setBatchAddOpen(true)
  }

  const submitBatchAdd = async () => {
    if (!providerId) return
    const { accounts: parsed, errors } = parseBatchText(batchAddText)
    if (errors.length > 0) {
      setBatchAddError(errors.join('\n'))
      return
    }
    if (parsed.length === 0) {
      setBatchAddError('请至少粘贴一行账号')
      return
    }
    const payloadAccounts = parsed.map((item) => {
      const next = { ...item }
      if (batchAddProxy) next.proxy = batchAddProxy
      else next.proxy = null
      return next
    })
    setSaving(true)
    setBatchAddError(null)
    try {
      await batchAddProviderAccounts(providerId, { accounts: payloadAccounts })
      await loadAccounts()
      setBatchAddOpen(false)
    } catch (err) {
      setBatchAddError(err instanceof Error ? err.message : '批量添加账号失败')
    } finally {
      setSaving(false)
    }
  }

  const batchActionDisabled = saving || selectedUsernamesList.length === 0
  const batchActionStyle = (style: React.CSSProperties = btnGhost): React.CSSProperties => ({
    ...style,
    ...(batchActionDisabled ? batchDisabledStyle : {}),
  })

  const submitBatchDelete = async () => {
    if (!providerId || selectedUsernamesList.length === 0) return
    if (!window.confirm(`确定批量删除选中的 ${selectedUsernamesList.length} 个账号吗？`)) return
    setSaving(true)
    setError(null)
    try {
      const result = await batchDeleteProviderAccounts(providerId, { usernames: selectedUsernamesList })
      if (result.failed.length > 0) {
        setError(`部分删除失败：${result.failed.map((item) => `${item.username}(${item.error})`).join('、')}`)
      }
      setSelectedUsernames(new Set())
      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败')
    } finally {
      setSaving(false)
    }
  }

  const submitBatchDisable = async () => {
    if (!providerId || selectedUsernamesList.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await batchSetProviderAccountSwitch(providerId, { switch: false, usernames: selectedUsernamesList })
      setSelectedUsernames(new Set())
      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量禁用失败')
    } finally {
      setSaving(false)
    }
  }

  const submitBatchThaw = async () => {
    if (!providerId || selectedUsernamesList.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        selectedUsernamesList.map((username) => clearProviderAccountCooldown(providerId, username)),
      )
      const failed = results.flatMap((result, index) => (
        result.status === 'rejected' ? [selectedUsernamesList[index]] : []
      ))
      if (failed.length > 0) setError(`部分解冻失败：${failed.join('、')}`)
      setSelectedUsernames(new Set())
      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量解冻失败')
    } finally {
      setSaving(false)
    }
  }

  const submitBatchProxy = async (proxyId: string | null) => {
    if (!providerId || selectedUsernamesList.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await batchUpdateProviderAccountProxy(providerId, { usernames: selectedUsernamesList, proxy: proxyId })
      setSelectedUsernames(new Set())
      setBatchProxyOpen(false)
      setBatchProxyValue('')
      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量修改代理失败')
    } finally {
      setSaving(false)
    }
  }

  // 单行代理直接修改：复用批量代理接口，保证直改与批量走同一服务端语义。
  const changeRowProxy = async (username: string, proxyId: string | null) => {
    if (!providerId) return
    setProxySaving((prev) => ({ ...prev, [username]: true }))
    setError(null)
    try {
      await batchUpdateProviderAccountProxy(providerId, { usernames: [username], proxy: proxyId })
      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改代理失败')
    } finally {
      setProxySaving((prev) => ({ ...prev, [username]: false }))
    }
  }

  const saveAccount = async () => {
    if (!providerId || !form.username?.trim()) return
    setSaving(true)
    setError(null)
    try {
      const username = form.username.trim()
      const payload: ProviderAccountPayload = {
        username,
        switch: form.switch !== false,
        price_remark: safeString(form.price_remark).trim(),
      }
      // 可见「密钥/密码」输入框统一绑定 form.password；保存时凭据写回 schema 声明的那个字段
      // （schemaPasswordField.key）——自定义/jiekou 等继承 base 的渠道就是 password，cloudflare
      // 也用 password。跟着 schema 走：schema 声明哪个字段、后端 init/运行时就读哪个，二者永远一致。
      // 绝不再同时回传多个凭据字段，避免 CustomProvider init 优先级（api_key > key > password）
      // 用某个陈旧字段遮蔽本次真正填入的凭据。
      const cred = form.password?.trim() ?? ''
      if (cred) {
        const credKey = schemaPasswordField?.key || 'password'
        payload[credKey] = cred
      }
      for (const field of normalizeSchemaFields(accountSchema)) {
        if (['username', 'password', 'api_key', 'key', 'proxy', 'switch'].includes(field.key)) continue
        const rawValue = form[field.key]
        const textValue = typeof rawValue === 'string' ? rawValue.trim() : rawValue
        if (field.required && (textValue === undefined || textValue === null || textValue === '')) {
          setError(`${field.label || field.key} 必填`)
          setSaving(false)
          return
        }
        if ((textValue === undefined || textValue === null || textValue === '') && field.secret && editingUsername) continue
        if (textValue !== undefined && textValue !== null && textValue !== '') payload[field.key] = textValue
      }
      // 代理
      const proxyVal = form.proxy === null ? '' : safeString(form.proxy)
      if (proxyVal) payload.proxy = proxyVal
      else payload.proxy = null
      // Cloudflare
      if (isCloudflare) {
        const accountId = safeString(form.account_id).trim()
        if (!accountId) {
          setError('Cloudflare 渠道必须填写 Account ID')
          setSaving(false)
          return
        }
        payload.account_id = accountId
      }
      // EdgeOne
      if (isEdgeOne) {
        const edgeoneName = safeString(form.name).trim()
        const modelName = safeString(form.model_name).trim()
        if (!edgeoneName) {
          setError('EdgeOne 渠道必须填写二级域名 name')
          setSaving(false)
          return
        }
        if (!modelName) {
          setError('EdgeOne 渠道必须填写模型名 model_name')
          setSaving(false)
          return
        }
        payload.name = edgeoneName
        payload.model_name = modelName
      }
      // Tabbit
      if (isTabbit) {
        const setOpt = (k: 'client_id' | 'client_secret' | 'refresh_token' | 'access_token') => {
          const v = safeString(form[k]).trim()
          if (v) payload[k] = v
        }
        setOpt('client_id')
        setOpt('client_secret')
        setOpt('refresh_token')
        setOpt('access_token')
      }
      // 额外字段回写
      Object.entries(extraFields).forEach(([k, v]) => {
        payload[k] = v
      })
      // metadata 单独回写（不走 extraFields 路径）：整快照提交，后端 apply diff 热更新到运行态。
      // 空键名丢弃（新增占位未命名的行）；键名 trim 后作为最终键。
      const metadataPayload: Record<string, unknown> = {}
      Object.entries(metadataFields).forEach(([k, v]) => {
        const key = k.trim()
        if (key) metadataPayload[key] = v
      })
      payload.metadata = metadataPayload

      if (editingUsername) {
        await updateProviderAccount(providerId, editingUsername, payload)
      } else {
        await addProviderAccount(providerId, payload)
      }
      await loadAccounts()
      backToList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存账号失败')
    } finally {
      setSaving(false)
    }
  }

  // 账号列表的“代理”列展示代理名称而非具体 IP/URL：优先按 proxy_id 命中代理池条目，
  // 命中不到再按 proxy_url 反查，最后兜底回退到原始文本（历史直填 URL 的账号）。
  const proxyNameById = new Map(proxies.map((p) => [safeString(p.id), safeString(p.name || p.url)]))
  const proxyNameByUrl = new Map(proxies.map((p) => [safeString(p.url), safeString(p.name || p.url)]))
  const resolveProxyName = (a: ProviderAccount) => {
    const id = safeString(a.proxy_id ?? a.proxy)
    if (id && proxyNameById.has(id)) return proxyNameById.get(id) as string
    const url = safeString(a.proxy_url || a.proxy)
    if (url && proxyNameByUrl.has(url)) return proxyNameByUrl.get(url) as string
    return url
  }
  const TABBIT_TOKEN_KEYS = ['client_id', 'client_secret', 'refresh_token', 'access_token', 'access_token_expires_at']
  const tabbitTokenFields = isTabbit
    ? normalizeSchemaFields(accountSchema).filter((field) => TABBIT_TOKEN_KEYS.includes(field.key))
    : []
  const schemaFields = normalizeSchemaFields(accountSchema).filter((field) =>
    !['password'].includes(field.key) && (!isTabbit || !TABBIT_TOKEN_KEYS.includes(field.key)),
  )
  const schemaSections = Array.from(new Set(schemaFields.map((field) => safeString(field.section || '渠道字段'))))
  const canStartAuth = accountSchema?.auth_start?.enabled === true
  // 完成方式：poll（纯轮询自动认领）/ callback（上游回调服务端）/ loopback（本机回调，
  // 同机自动、跨机粘 URL 补投）。决定授权区是否显示「补投回调」输入框。
  const accountCompletion = (accountSchema?.auth_start?.completion as string | undefined) || 'poll'
  const canRefreshAuth = canStartAuth || (accountSchema?.add_methods ?? []).some((m) => ['device_code', 'oauth_callback', 'callback'].includes(m))
  // 授权 UI 是否走「设备码/回调」形态：内置 device_auth 渠道，或 schema 驱动的代码渠道声明了
  // auth_start.enabled（spec 类声明了 begin_device_flow / build_auth_start）。code 渠道没声明
  // auth_start 时退化成用户名/密码手填（与 password_login 同形）。
  const isDeviceAuthActive = authMode === 'device_auth' || (authMode === 'schema' && canStartAuth)

  const renderSchemaField = (field: AccountSchemaField) => {
    const value = schemaFieldValue(field, form)
    const setValue = (next: unknown) => setForm((prev) => ({ ...prev, [field.key]: next }))
    const common = {
      disabled: !!field.readonly,
      style: field.type === 'textarea' ? textareaStyle : inputStyle,
      placeholder: safeString(field.placeholder),
    }
    let control
    if (field.type === 'select' && Array.isArray(field.options)) {
      control = (
        <ComboSearchSelect
          value={safeString(value)}
          onChange={(v) => setValue(v ?? '')}
          disabled={!!field.readonly}
          options={field.options.map((option) => ({ value: String(option.value), label: option.label }))}
          placeholder="未设置"
          contentZIndex={1101}
        />
      )
    } else if (field.type === 'checkbox') {
      control = <input type="checkbox" checked={Boolean(form[field.key])} onChange={(e) => setValue(e.target.checked)} disabled={!!field.readonly} />
    } else if (field.type === 'textarea') {
      control = <textarea value={value} onChange={(e) => setValue(e.target.value)} {...common} rows={3} />
    } else if (field.type === 'datetime') {
      control = <input value={value} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
    } else {
      const inputType = field.type === 'number' ? 'number' : (['api_key', 'key'].includes(field.key) ? 'text' : (field.secret || field.type === 'password' ? 'password' : 'text'))
      control = <input type={inputType} value={value} onChange={(e) => setValue(field.type === 'number' ? Number(e.target.value) : e.target.value)} {...common} />
    }
    return (
      <div key={field.key} style={{ gridColumn: Number(field.span || 1) > 1 || field.type === 'textarea' ? '1 / -1' : undefined }}>
        <label style={labelStyle}>{field.label}{field.required ? ' *' : ''}</label>
        {control}
        {field.help_text ? <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>{field.help_text}</div> : null}
      </div>
    )
  }

  // 取消授权：停轮询 + 调后端清理 state/pending
  const cancelAccountAuth = useCallback(async () => {
    if (authPollRef.current) {
      clearInterval(authPollRef.current)
      authPollRef.current = null
    }
    const st = authStateRef.current
    authStateRef.current = null
    setAuthPolling(false)
    if (providerId && st) {
      try { await cancelProviderAccountAuth(providerId, st) } catch { /* 静默 */ }
    }
  }, [providerId])

  // 手工补投回调地址：跨机部署时上游回调落在用户自己机器的 127.0.0.1 上（那台机器没有
  // 本服务，页面打不开），但地址栏参数是完整的。把整条地址粘回来，服务端按同一套逻辑补投。
  const submitReplayUrl = async () => {
    if (!providerId || !replayUrl.trim()) return
    setReplaying(true)
    setAuthError(null)
    try {
      const result = await replayProviderAccountAuth(providerId, replayUrl.trim())
      setAuthStartInfo(result.message || '回调已补投')
      if (result.status === 'completed') {
        // 补投即完成：停轮询、回填账号、刷新列表
        if (authPollRef.current) { clearInterval(authPollRef.current); authPollRef.current = null }
        authStateRef.current = null
        setAuthPolling(false)
        setReplayUrl('')
        await loadAccounts()
      }
      // status === 'pending'：票据已更新，轮询继续跑，扫描器会拿到凭证
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAuthError(detail || (err instanceof Error ? err.message : '补投回调失败'))
    } finally {
      setReplaying(false)
    }
  }

  const startAccountAuth = async () => {
    if (!providerId) return
    setAuthStarting(true)
    setAuthError(null)
    setAuthStartInfo(null)

    // 清除旧轮询
    if (authPollRef.current) {
      clearInterval(authPollRef.current)
      authPollRef.current = null
    }

    try {
      // origin 由前端上报：回调地址的「服务端部分」必须是浏览器可达的地址，
      // 后端从当次请求推导会在反代/容器后拼出内网地址。路径仍由后端拼，前端不碰。
      const result = await startProviderAccountAuth(providerId, {
        account: form,
        origin: window.location.origin,
      })
      const parts: string[] = []
      if (result.user_code) parts.push(`验证码：${result.user_code}`)
      if (result.verification_uri) parts.push(`授权地址：${result.verification_uri}`)
      if (result.message) parts.push(result.message)
      setAuthStartInfo(parts.join(' · ') || '授权流程已启动，请按新窗口提示完成。')

      const url = result.auth_url || result.verification_uri || result.login_url
      // 用固定窗口名打开：复用同一窗口，保留浏览器 cookie，避免每次开新标签
      if (url) window.open(url, 'ai-lubricant-account-auth')

      // 如果后端指示需要轮询状态
      if (result.poll_status && result.state) {
        setAuthPolling(true)
        const intervalMs = Math.max((result.poll_interval || 3) * 1000, 2000)
        const authState = result.state
        authStateRef.current = authState

        const stopPolling = () => {
          if (authPollRef.current) { clearInterval(authPollRef.current); authPollRef.current = null }
          authStateRef.current = null
          setAuthPolling(false)
        }

        // 超时不在前端处理：服务端 state 的 TTL 过期后，查询返回 404，
        // 这里统一按"已取消/已过期"处理，前端无需自带计时器。
        authPollRef.current = setInterval(async () => {
          try {
            const status = await getProviderAccountAuthStatus(providerId, authState)
            if (status.status === 'completed') {
              stopPolling()
              setAuthStartInfo(status.message || '授权完成')
              // 从授权结果回填用户名等字段
              const acc = status.account as Record<string, unknown> | undefined
              if (acc && acc.username) {
                setForm((prev) => {
                  const next: ProviderAccountPayload = { ...prev }
                  for (const field of normalizeSchemaFields(accountSchema)) {
                    if (acc[field.key] !== undefined && acc[field.key] !== null) {
                      next[field.key] = acc[field.key]
                    }
                  }
                  next.username = String(acc.username)
                  // 兼容通用字段，避免授权成功后再点保存时触发 refresh_token 必填。
                  for (const key of ['password', 'refresh_token', 'access_token', 'access_token_expires_at_ms', 'account_id', 'user_login', 'user_email', 'user_name', 'add_method']) {
                    if (acc[key] !== undefined && acc[key] !== null) next[key] = acc[key]
                  }
                  return next
                })
              }
              await loadAccounts()
            } else if (status.status === 'error') {
              stopPolling()
              setAuthError(status.error || '授权失败')
            } else if (status.status === 'expired' || status.status === 'cancelled') {
              stopPolling()
              setAuthStartInfo(status.message || '授权已过期，请重新发起')
            }
            // pending / idle: 继续轮询
          } catch (err) {
            // 404 = state 已过期/被取消（服务端 TTL）→ 停止轮询并提示
            const httpStatus = (err as { response?: { status?: number } })?.response?.status
            if (httpStatus === 404) {
              stopPolling()
              setAuthStartInfo('授权已过期或已取消，请重新发起')
            }
            // 其他网络错误：暂停本轮，下次 interval 继续重试
          }
        }, intervalMs)
      }

      await loadAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动授权失败')
    } finally {
      setAuthStarting(false)
    }
  }

  // 清理轮询定时器 + 卸载时取消授权
  useEffect(() => {
    return () => {
      if (authPollRef.current) {
        clearInterval(authPollRef.current)
        authPollRef.current = null
      }
      // 卸载时静默取消（不 await，避免组件卸载后 setState）
      const st = authStateRef.current
      authStateRef.current = null
      if (providerId && st) {
        void cancelProviderAccountAuth(providerId, st).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && <div style={{ color: 'var(--red)', fontSize: '14px', padding: '10px 14px', background: 'rgba(251, 113, 133, 0.1)', border: '1px solid var(--red)', borderRadius: 'var(--admin-radius)' }}>{error}</div>}

        {isEditing ? (
          /* ── 编辑态 ── */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={backToList} style={{ ...btnGhost, padding: '5px 10px', fontSize: '13px' }}>← 返回列表</button>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--textH)' }}>{editingUsername ? `编辑账号 · ${editingUsername}` : '新增账号'}</span>
            </div>

            <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Cloudflare：文档链接指引 */}
              {authMode === 'cloudflare' && (docUrl || docGuide) && (
                <div style={{ padding: '12px 14px', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>如何获取参数</div>
                  {docGuide ? <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{docGuide}</div> : null}
                  {docUrl ? (
                    <a href={docUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--blue)' }}>查看获取参数文档 →</a>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text2)' }}>文档地址待补充</div>
                  )}
                </div>
              )}

              {/* 跳转登录渠道：授权入口。schema 驱动的代码渠道声明 auth_start 后同样出现 */}
              {isDeviceAuthActive && (
                <div style={{ padding: '12px 14px', border: `1px solid ${authError ? 'var(--red)' : 'var(--admin-border)'}`, borderRadius: 'var(--admin-radius)', background: authError ? 'rgba(251,113,133,0.08)' : 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                        {accountSchema?.auth_start?.label || '账号授权'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '3px' }}>
                        {accountSchema?.auth_start?.description || accountSchema?.add_guidance || '点击按钮打开授权页面，完成后将自动回填账号信息。'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => void startAccountAuth()} disabled={authStarting || authPolling} style={btnPrimary}>
                        {authStarting ? '授权启动中...' : authPolling ? '授权中...' : (editingUsername || form.username ? '更新授权' : '开始授权')}
                      </button>
                      {(authPolling || authStartInfo) && (
                        <button onClick={() => void cancelAccountAuth()} disabled={authStarting} style={btnGhost}>取消</button>
                      )}
                    </div>
                  </div>
                  {authPolling && (
                    <div style={{ fontSize: '12px', color: 'var(--blue)' }}>
                      {accountCompletion === 'loopback'
                        ? '授权进行中。同机部署浏览器回调会自动完成；跨机若停在打不开的 127.0.0.1 地址，把地址栏整条 URL 粘到下方输入框补投。'
                        : '授权进行中，请在弹出窗口完成授权，完成后会自动回填…'}
                    </div>
                  )}
                  {authStartInfo && !authError ? <div style={{ fontSize: '12px', color: authPolling ? 'var(--blue)' : 'var(--green)' }}>{authStartInfo}</div> : null}
                  {authError ? <div style={{ fontSize: '12px', color: 'var(--red)' }}>{authError}</div> : null}
                  {/* loopback 模式专属：上游只回调 127.0.0.1:{port}，跨机时浏览器停在打不开的本机地址，
                      用户把地址栏整条 URL 粘回来，服务端按与 GET /oauth/callback 相同的认领逻辑补投 */}
                  {accountCompletion === 'loopback' && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={replayUrl}
                        onChange={(e) => setReplayUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submitReplayUrl() }}
                        placeholder="浏览器回调打不开时，粘贴地址栏里的完整回调地址补投"
                        style={{ flex: '1 1 260px', minWidth: '220px', fontSize: '12px', padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg2)', color: 'var(--text)' }}
                      />
                      <button onClick={() => void submitReplayUrl()} disabled={replaying || !replayUrl.trim()} style={{ ...btnGhost, fontSize: '12px', padding: '6px 10px' }}>
                        {replaying ? '补投中...' : '补投回调'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 用户名密码渠道：打开网站按钮。schema 驱动且未声明授权入口的代码渠道同样适用 */}
              {(authMode === 'password_login' || (authMode === 'schema' && !canStartAuth)) && websiteUrl && (
                <div style={{ padding: '12px 14px', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg3)', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>获取登录凭据</div>
                    <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '3px' }}>{accountSchema?.add_guidance || '点击打开渠道官网登录后，填写下方用户名 / 密码。'}</div>
                  </div>
                  <button onClick={() => window.open(websiteUrl, '_blank', 'noopener')} style={btnGhost}>打开网站 ↗</button>
                </div>
              )}

              {/* 基础信息 */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)', marginBottom: '8px' }}>基础信息</div>
                <div style={grid2Style}>
                  <div>
                    <label style={labelStyle}>用户名 / Key 名称 *</label>
                    <input value={safeString(form.username)} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} style={inputStyle} disabled={!!editingUsername || (authMode === 'device_auth' && authPolling)} placeholder={isDeviceAuthActive ? '授权完成后自动回填' : '如 key-1'} />
                  </div>
                  {authMode !== 'device_auth' && (
                    <div>
                      <label style={labelStyle}>{passwordLabel}</label>
                      <input value={safeString(form.password)} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} style={inputStyle} placeholder={authMode === 'password_login' ? '登录密码' : 'sk-...'} type="text" />
                    </div>
                  )}
                  {schemaFields.length > 0 && authMode !== 'device_auth' && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)', margin: '4px 0 8px' }}>渠道字段</div>
                      <div style={grid2Style}>
                        {schemaSections.flatMap((section) => schemaFields.filter((field) => safeString(field.section || '渠道字段') === section).map(renderSchemaField))}
                      </div>
                    </div>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>代理（可选）</label>
                    <ComboSearchSelect
                      value={form.proxy === null ? '' : safeString(form.proxy)}
                      onChange={(v) => setForm((prev) => ({ ...prev, proxy: v || null }))}
                      options={proxies.map((p) => ({
                        value: safeString(p.id),
                        label: (safeString(p.name || p.url)) + (p.mode === 'url_prefix' ? '（前缀转发）' : p.mode === 'direct' ? '（直连）' : ''),
                      }))}
                      placeholder="不使用代理"
                      contentZIndex={1101}
                      listHeight="380px"
                      contentWidth="min(420px, 80vw)"
                    />
                    <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>仅可从代理池选择；如需新增代理请先到代理池维护。</div>
                  </div>
                </div>
              </div>

              {/* Tabbit Token 专属分区 */}
              {isTabbit && tabbitTokenFields.length > 0 && (
                <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)' }}>Tabbit Token</div>
                    <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                      {accountSchema?.add_guidance || '登录 Tabbit 后从浏览器开发者工具的网络请求中找到 /proxy/v0/oauth/token，复制 refresh_token；client_id/client_secret 可留空使用默认值。'}
                    </div>
                  </div>
                  <div style={grid2Style}>
                    {tabbitTokenFields.map(renderSchemaField)}
                  </div>
                </div>
              )}

              {/* 备注 */}
              <div>
                <label style={labelStyle}>备注 / 价格说明</label>
                <input value={safeString(form.price_remark)} onChange={(e) => setForm((prev) => ({ ...prev, price_remark: e.target.value }))} style={inputStyle} placeholder="账号用途、价格、额度等备注" />
              </div>

              {/* 账号添加说明（仅 API Key / 自定义 / 手动值渠道展示通用引导） */}
              {(authMode === 'custom' || authMode === 'api_key' || authMode === 'manual_values') && accountSchema?.add_guidance && (
                <div style={{ padding: '12px 14px', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>添加方式</div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{accountSchema.add_guidance}</div>
                </div>
              )}

              {/* 额外字段（未识别字段动态展示） */}
              {Object.keys(extraFields).length > 0 && (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)', marginBottom: '8px' }}>额外字段</div>
                  <div style={grid2Style}>
                    {Object.entries(extraFields).map(([k, v]) => {
                      const sv = serializeExtraField(v)
                      const isLong = sv.length > 80 || sv.includes('\n')
                      return (
                        <div key={k} style={{ gridColumn: isLong ? '1 / -1' : undefined }}>
                          <label style={labelStyle}>{k}</label>
                          {isLong ? (
                            <textarea
                              value={sv}
                              onChange={(e) => setExtraFields((prev) => ({ ...prev, [k]: parseExtraField(prev[k], e.target.value) }))}
                              style={textareaStyle}
                              rows={3}
                            />
                          ) : (
                            <input
                              value={sv}
                              onChange={(e) => setExtraFields((prev) => ({ ...prev, [k]: parseExtraField(prev[k], e.target.value) }))}
                              style={inputStyle}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 账号元数据（metadata）：用户自定义键值对。热更新生效（保存后无需重启），
                  可在协议行 Header 模板里用 {{account.metadata.<键名>}} 取值。 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)' }}>账号元数据（metadata）</div>
                  <button
                    onClick={() => {
                      // 新增空键占位：用 meta_N 避免与已有键冲突，用户改名即生效。
                      let i = 1
                      let key = 'key1'
                      while (Object.prototype.hasOwnProperty.call(metadataFields, key)) {
                        i += 1
                        key = `key${i}`
                      }
                      setMetadataFields((prev) => ({ ...prev, [key]: '' }))
                    }}
                    style={{ ...btnGhost, padding: '4px 10px', fontSize: '12px' }}
                  >
                    <Plus style={btnIcon} />添加字段
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>
                  自定义键值对，保存后热更新到运行态。Header 模板可用 <code>{'{{account.metadata.键名}}'}</code> 取值；
                  另可用 <code>{'{{account.username}}'}</code>、<code>{'{{account.provider}}'}</code>。请勿在此存放密钥。
                </div>
                {Object.keys(metadataFields).length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text3)' }}>暂无元数据字段</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.entries(metadataFields).map(([k, v]) => {
                      const sv = serializeExtraField(v)
                      const isLong = sv.length > 80 || sv.includes('\n')
                      return (
                        <div key={k} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                          <input
                            value={k}
                            placeholder="键名"
                            onChange={(e) => {
                              const nextKey = e.target.value
                              setMetadataFields((prev) => {
                                // 保序重建：键改名不改变字段顺序，避免输入时条目跳位。
                                const next: Record<string, unknown> = {}
                                Object.entries(prev).forEach(([pk, pv]) => {
                                  next[pk === k ? nextKey : pk] = pv
                                })
                                return next
                              })
                            }}
                            style={{ ...inputStyle, flex: '0 0 34%' }}
                          />
                          {isLong ? (
                            <textarea
                              value={sv}
                              placeholder="值"
                              onChange={(e) => setMetadataFields((prev) => ({ ...prev, [k]: parseExtraField(prev[k], e.target.value) }))}
                              style={{ ...textareaStyle, flex: 1 }}
                              rows={3}
                            />
                          ) : (
                            <input
                              value={sv}
                              placeholder="值"
                              onChange={(e) => setMetadataFields((prev) => ({ ...prev, [k]: parseExtraField(prev[k], e.target.value) }))}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                          )}
                          <button
                            onClick={() => setMetadataFields((prev) => {
                              const next = { ...prev }
                              delete next[k]
                              return next
                            })}
                            title="删除该字段"
                            style={{ ...btnGhost, padding: '6px 8px' }}
                          >
                            <Trash2 style={btnIcon} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input id="account-switch" type="checkbox" checked={form.switch !== false} onChange={(e) => setForm((prev) => ({ ...prev, switch: e.target.checked }))} />
                <label htmlFor="account-switch" style={{ color: 'var(--text)', fontSize: '14px' }}>启用账号</label>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => void saveAccount()} disabled={saving} style={btnPrimary}>{saving ? '保存中...' : editingUsername ? '保存修改' : '添加账号'}</button>
                <button onClick={backToList} style={btnGhost}>取消</button>
              </div>
            </div>
          </>
        ) : (
          /* ── 列表态 ── */
          <>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {!batchMode ? (
                <>
                  <button onClick={startCreate} style={btnPrimary}><Plus style={btnIcon} />新增账号</button>
                  <button onClick={openBatchAdd} disabled={saving} style={btnGhost}><Upload style={btnIcon} />批量添加</button>
                  <button onClick={() => { void loadAccounts() }} disabled={loading} style={btnGhost}><RefreshCw style={btnIcon} />{loading ? '刷新中...' : '刷新'}</button>
                  <button
                    onClick={async () => {
                      if (!providerId) return
                      setSaving(true)
                      try {
                        await checkProviderAccounts(providerId)
                        await loadAccounts()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '检查账号失败')
                      } finally {
                        setSaving(false)
                      }
                    }}
                    disabled={saving}
                    style={btnGhost}
                  >
                    {saving ? <RefreshCw style={btnIcon} /> : <ShieldCheck style={btnIcon} />}{saving ? '检查中...' : '检查账号'}
                  </button>
                  <button
                    onClick={async () => {
                      if (!providerId) return
                      setSaving(true)
                      try {
                        await clearAllProviderCooldowns(providerId)
                        await loadAccounts()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '全部解冻失败')
                      } finally {
                        setSaving(false)
                      }
                    }}
                    disabled={saving || accounts.length === 0}
                    style={btnGhost}
                  >
                    <Unlock style={btnIcon} />全部解冻
                  </button>
                  <button onClick={enterBatchMode} disabled={saving || accounts.length === 0} style={btnGhost}><ListChecks style={btnIcon} />批量操作</button>
                </>
              ) : (
                <>
                  <button onClick={submitBatchDisable} disabled={batchActionDisabled} style={batchActionStyle()}><Snowflake style={btnIcon} />批量禁用</button>
                  <button onClick={submitBatchThaw} disabled={batchActionDisabled} style={batchActionStyle()}><Unlock style={btnIcon} />批量解冻</button>
                  <button onClick={submitBatchDelete} disabled={batchActionDisabled} style={batchActionStyle(btnDanger)}><Trash2 style={btnIcon} />批量删除</button>
                  <button onClick={openBatchProxy} disabled={batchActionDisabled} style={batchActionStyle()}><KeyRound style={btnIcon} />批量修改代理</button>
                  <button onClick={leaveBatchMode} disabled={saving} style={btnGhost}><X style={btnIcon} />取消批量操作</button>
                  <span style={{ fontSize: '13px', color: 'var(--text2)' }}>已选 {selectedUsernamesList.length} 个</span>
                </>
              )}
              <span style={{ fontSize: '13px', color: 'var(--text2)', marginLeft: 'auto' }}>共 {accounts.length} 个账号</span>
            </div>

            <div style={{ overflow: 'auto', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', background: 'var(--bg2)' }}>
              <table style={{ width: '100%', minWidth: batchMode ? '1180px' : '1120px', borderCollapse: 'collapse', fontSize: '14px', tableLayout: 'fixed' }}>
                <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                  <tr>
                    {batchMode && (
                      <th style={{ width: '36px', padding: '8px 6px', textAlign: 'center', fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(event) => toggleSelectAll(event.target.checked)}
                          aria-label="全选账号"
                        />
                      </th>
                    )}
                    <th style={{ width: '14%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>用户名</th>
                    <th style={{ width: '12%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>状态</th>
                    <th style={{ width: '17%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>限额</th>
                    <th style={{ width: '15%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>代理</th>
                    <th style={{ width: '21%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>冻结原因</th>
                    <th style={{ width: '6%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>开关</th>
                    <th style={{ width: '15%', padding: '8px 8px', textAlign: 'center', fontWeight: 600 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 ? (
                    <tr>
                      <td colSpan={batchMode ? 8 : 7} style={{ padding: '24px', textAlign: 'center', color: 'var(--text2)' }}>
                        {loading ? '加载中...' : '暂无账号，点击上方按钮新增'}
                      </td>
                    </tr>
                  ) : (
                    accounts.map((a) => {
                      const badge = getAccountBadge(a)
                      const freezeDisplay = buildFreezeDisplay(a)
                      const freezeReason = freezeDisplay.cell
                      // 认证错误/禁用原因由状态列的悬浮详情解释，不再回退塞进冻结原因列。
                      const reason = shortenReason(freezeReason, 20)
                      const reasonTitle = freezeDisplay.title || ''
                      const rowSaving = saving || initiating[a.username] || thawing[a.username] || refreshingAuth[a.username] || proxySaving[a.username] === true
                      const statusDetails = buildAccountStatusDetails(a, accountSchema)
                      const proxyText = resolveProxyName(a)
                      const accountProxyId = safeString(a.proxy_id ?? a.proxy)
                      const proxyInPool = proxies.some((proxy) => proxy.id === accountProxyId)
                      return (
                        <tr key={a.username} style={{ borderBottom: '1px solid var(--admin-border)' }}>
                          {batchMode && (
                            <td style={{ width: '36px', padding: '8px 6px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selectedUsernames.has(a.username)}
                                onChange={(event) => toggleSelected(a.username, event.target.checked)}
                                aria-label={`选择账号 ${a.username}`}
                              />
                            </td>
                          )}
                          <td style={{ padding: '8px 8px', color: 'var(--text)' }}>
                            <span style={{ display: 'block', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={a.username}>{a.username}</span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            {/* 悬浮展示认证诊断（材料/过期时间/添加方式等），见 buildAccountStatusDetails。 */}
                            {statusDetails.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span style={{ display: 'inline-flex', cursor: 'help' }}>
                                    <StatusTag label={badge.label} color={badge.color} fill={a.cooldown} />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent style={{ zIndex: 1100, maxWidth: 360 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {statusDetails.map((row) => (
                                      <div key={row.key} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', maxWidth: '100%' }}>
                                        <span style={{ opacity: 0.75, flexShrink: 0 }}>{row.label}</span>
                                        <span style={{ overflowWrap: 'anywhere' }}>{row.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <StatusTag label={badge.label} color={badge.color} fill={a.cooldown} />
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                              <AccountLimits
                                tpmUsed={a.tpm_used} tpmLimit={a.tpm_limit}
                                rpmUsed={a.rpm_used} rpmLimit={a.rpm_limit}
                                rpdUsed={a.rpd_used} rpdLimit={a.rpd_limit}
                                concurrentUsed={a.concurrent_used} concurrentLimit={a.concurrent_limit}
                              />
                            </div>
                          </td>
                          <td style={{ padding: '8px 8px', fontSize: '13px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                              <ComboSearchSelect
                                value={accountProxyId ? (proxyInPool ? accountProxyId : '__legacy__') : '__none__'}
                                onChange={(v) => {
                                  const next = v ?? '__none__'
                                  void changeRowProxy(a.username, next === '__none__' || next === '__legacy__' ? null : next)
                                }}
                                disabled={rowSaving}
                                options={[
                                  ...(!proxyInPool && accountProxyId ? [{ value: '__legacy__', label: proxyText || '历史代理' }] : []),
                                  { value: '__none__', label: '不使用代理' },
                                  ...proxies.map((proxy) => ({ value: safeString(proxy.id), label: safeString(proxy.name || proxy.url) })),
                                ]}
                                placeholder="不使用代理"
                                contentZIndex={1101}
                                listHeight="380px"
                                contentWidth="min(420px, 80vw)"
                              />
                            </div>
                          </td>
                          <td title={reasonTitle} style={{ padding: '8px 8px', color: reason === '—' ? 'var(--text2)' : 'var(--text)', fontSize: '13px', whiteSpace: 'pre-line', overflowWrap: 'anywhere', lineHeight: 1.45, textAlign: 'center' }}>{reason}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <button
                              role="switch"
                              aria-checked={a.switch !== false}
                              onClick={async () => {
                                if (!providerId) return
                                setSaving(true)
                                try {
                                  await updateProviderAccountSwitch(providerId, a.username, a.switch === false)
                                  await loadAccounts()
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : '切换账号开关失败')
                                } finally {
                                  setSaving(false)
                                }
                              }}
                              disabled={rowSaving}
                              style={{
                                width: '42px',
                                height: '24px',
                                padding: '2px',
                                border: '1px solid var(--admin-border)',
                                borderRadius: '999px',
                                background: a.switch !== false ? 'var(--green)' : 'var(--bg3)',
                                cursor: rowSaving ? 'not-allowed' : 'pointer',
                                opacity: rowSaving ? 0.7 : 1,
                                transition: 'all 0.12s',
                              }}
                            >
                              <span style={{ display: 'block', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transform: a.switch !== false ? 'translateX(18px)' : 'translateX(0)', transition: 'transform 0.12s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                            </button>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                              {a.auth !== true && (
                                <button
                                  onClick={async () => {
                                    if (!providerId) return
                                    setInitiating((prev) => ({ ...prev, [a.username]: true }))
                                    try {
                                      await initProviderAccount(providerId, a.username)
                                      await loadAccounts()
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : '认证账号失败')
                                    } finally {
                                      setInitiating((prev) => ({ ...prev, [a.username]: false }))
                                    }
                                  }}
                                  title="认证账号"
                                  aria-label={`认证账号 ${a.username}`}
                                  disabled={rowSaving}
                                  style={{ ...iconActionStyle, opacity: rowSaving ? 0.5 : 1 }}
                                >
                                  <KeyRound style={{ width: 15, height: 15 }} />
                                </button>
                              )}
                              {a.cooldown && (
                                <button
                                  onClick={async () => {
                                    if (!providerId) return
                                    setThawing((prev) => ({ ...prev, [a.username]: true }))
                                    try {
                                      await clearProviderAccountCooldown(providerId, a.username)
                                      await loadAccounts()
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : '解冻账号失败')
                                    } finally {
                                      setThawing((prev) => ({ ...prev, [a.username]: false }))
                                    }
                                  }}
                                  title="解冻账号"
                                  aria-label={`解冻账号 ${a.username}`}
                                  disabled={rowSaving}
                                  style={{ ...iconActionStyle, opacity: rowSaving ? 0.5 : 1 }}
                                >
                                  <Unlock style={{ width: 15, height: 15 }} />
                                </button>
                              )}
                              {canRefreshAuth && (
                                <button
                                  onClick={async () => {
                                    if (!providerId) return
                                    setRefreshingAuth((prev) => ({ ...prev, [a.username]: true }))
                                    try {
                                      await refreshProviderAccountAuth(providerId, a.username)
                                      await loadAccounts()
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : '刷新授权失败')
                                    } finally {
                                      setRefreshingAuth((prev) => ({ ...prev, [a.username]: false }))
                                    }
                                  }}
                                  title="刷新授权"
                                  aria-label={`刷新授权 ${a.username}`}
                                  disabled={rowSaving}
                                  style={{ ...iconActionStyle, opacity: rowSaving ? 0.5 : 1 }}
                                >
                                  <RefreshCw style={{ width: 15, height: 15 }} />
                                </button>
                              )}
                              <button onClick={() => startEdit(a)} title="编辑账号" aria-label={`编辑账号 ${a.username}`} disabled={rowSaving} style={{ ...iconActionStyle, opacity: rowSaving ? 0.5 : 1 }}><Pencil style={{ width: 15, height: 15 }} /></button>
                              <button onClick={() => startCopy(a)} title="复制账号" aria-label={`复制账号 ${a.username}`} disabled={rowSaving} style={{ ...iconActionStyle, opacity: rowSaving ? 0.5 : 1 }}><Copy style={{ width: 15, height: 15 }} /></button>
                              <button
                                onClick={async () => {
                                  if (!providerId || !window.confirm(`确定删除账号 ${a.username} 吗？`)) return
                                  setSaving(true)
                                  try {
                                    await deleteProviderAccount(providerId, a.username)
                                    await loadAccounts()
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : '删除账号失败')
                                  } finally {
                                    setSaving(false)
                                  }
                                }}
                                title="删除账号"
                                aria-label={`删除账号 ${a.username}`}
                                disabled={rowSaving}
                                style={{ ...iconActionDangerStyle, opacity: rowSaving ? 0.5 : 1 }}
                              >
                                <Trash2 style={{ width: 15, height: 15 }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {batchProxyOpen && (
              <Modal open={batchProxyOpen} title="批量修改代理" onClose={() => setBatchProxyOpen(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text2)' }}>
                    将为已选中的 {selectedUsernamesList.length} 个账号设置同一个代理。选择“不使用代理”会清除这些账号当前的代理配置。
                  </div>
                  <div>
                    <label style={labelStyle}>目标代理</label>
                    <ComboSearchSelect
                      value={batchProxyValue}
                      onChange={(v) => setBatchProxyValue(v ?? '')}
                      options={[
                        { value: '__none__', label: '不使用代理（清除代理）' },
                        ...proxies.map((proxy) => ({ value: safeString(proxy.id), label: safeString(proxy.name || proxy.url) })),
                      ]}
                      placeholder="请选择代理"
                      contentZIndex={1101}
                      listHeight="380px"
                      contentWidth="min(420px, 80vw)"
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button onClick={() => setBatchProxyOpen(false)} disabled={saving} style={btnGhost}><X style={btnIcon} />取消</button>
                    <button
                      onClick={() => void submitBatchProxy(batchProxyValue === '__none__' ? null : batchProxyValue)}
                      disabled={saving || !batchProxyValue}
                      style={{ ...btnPrimary, ...((saving || !batchProxyValue) ? batchDisabledStyle : {}) }}
                    >
                      <Check style={btnIcon} />{saving ? '保存中...' : '确认修改'}
                    </button>
                  </div>
                </div>
              </Modal>
            )}

            {batchAddOpen && (
              <Modal open={batchAddOpen} title="批量添加账号" onClose={() => setBatchAddOpen(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {showBatchFormatHint ? (
                    <div style={{ ...panelStyle, fontSize: '13px', color: 'var(--text2)' }}>
                      <div style={{ marginBottom: 6, fontWeight: 600, color: 'var(--text)' }}>每行格式：</div>
                      <div style={{ fontFamily: 'var(--fontM)' }}>{batchFormatTokens.join('  ')}</div>
                      <div style={{ marginTop: 6 }}>除用户名/凭据外，按 schema 声明顺序填入 {requiredExtraSchemaFields.length} 个字段。</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--text2)' }}>
                      每行：{batchFormatTokens.join('  ')}（默认代理可在下方选择）
                    </div>
                  )}
                  <div>
                    <label style={{display:'block', fontSize: '13px', fontWeight: 600, marginBottom: 6 }}>
                      批量代理（可选）
                    </label>
                    <ComboSearchSelect
                      value={batchAddProxy}
                      onChange={(v) => setBatchAddProxy(v ?? '')}
                      options={proxies.map((proxy) => ({ value: safeString(proxy.id), label: safeString(proxy.name || proxy.url) }))}
                      placeholder="不使用代理"
                      contentZIndex={1101}
                    />
                  </div>
                  <textarea
                    value={batchAddText}
                    onChange={(e) => setBatchAddText(e.target.value)}
                    placeholder={'username1 sk-xxx\nusername2 sk-yyy'}
                    style={{
                      ...textareaStyle,
                      minHeight: 160,
                      fontFamily: 'var(--fontM)',
                      fontSize: '13px',
                    }}
                  />
                  {batchAddError && (
                    <div style={{ ...panelStyle, color: 'var(--red)', whiteSpace: 'pre-line', fontFamily: 'var(--fontM)', fontSize: '12px' }}>
                      {batchAddError}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => setBatchAddOpen(false)} style={btnGhost}>取消</button>
                    <button onClick={() => void submitBatchAdd()} disabled={saving || !batchAddText.trim()} style={btnPrimary}>
                      {saving ? '添加中…' : '批量添加'}
                    </button>
                  </div>
                </div>
              </Modal>
            )}
          </>
        )}
      </div>
    </>
  )
}

type AccountTestRow = {
  model: string
  upstream: string
  display: string
  state: 'idle' | 'running' | 'ok' | 'fail'
  message: string
  statusCode?: number
  durationMs?: number
}

// 测试类型现由「渠道配置 → 测试类型」维护，前端不再闭合枚举，值由配置驱动。
type AccountTestType = string
// 缺省测试类型（配置未加载/为空时兜底展示），与后端 DEFAULT_TEST_TYPES 的 key/label 对齐。
const FALLBACK_TEST_TYPES: Array<{ key: string; label: string }> = [
  { key: 'chat', label: '聊天' },
  { key: 'stream', label: '流式' },
  { key: 'tool', label: '工具' },
  { key: 'thinking', label: '思考' },
  { key: 'multi', label: '多messages' },
  { key: 'image', label: '图片生成' },
  { key: 'video', label: '视频生成' },
  { key: 'tts', label: '语音合成' },
]
// 客户端类型：让测试请求「长得就像那个客户端发来的」（headers + body 形态）。
// none = 通用测试；其余按对应客户端的真实 headers/协议形态构造。
type AccountTestClientType = 'none' | 'claude-code' | 'codex-cli' | 'codex-tui' | 'codex-openai' | 'opencode' | 'workbuddy'

function AccountTestTab({ providerId, protocol: providerProtocol, active }: { providerId: string; protocol: string | null; active: boolean }) {
  const [accounts, setAccounts] = useState<ProviderAccountLite[]>([])
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [testType, setTestType] = useState<AccountTestType>('chat')
  // 测试类型选项由全局配置驱动（渠道配置 → 测试类型），配置缺失回退 FALLBACK_TEST_TYPES。
  const [testTypeOptions, setTestTypeOptions] = useState<Array<{ key: string; label: string }>>(FALLBACK_TEST_TYPES)
  const [clientType, setClientType] = useState<AccountTestClientType>('none')
  const [protocol, setProtocol] = useState('')
  const [rows, setRows] = useState<AccountTestRow[]>([])
  const [running, setRunning] = useState(false)
  const [loadModelsError, setLoadModelsError] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  // 测试协议下拉项：渠道自身配置的协议置首（作默认），再补齐后端支持的全集。
  // 该选择只控制测试请求 body/header/parser 的协议形态，不修改渠道协议行中配置的 path。
  const protocolOptions = useMemo(() => {
    const values: string[] = []
    const push = (v: unknown) => {
      const s = safeString(v).trim().toLowerCase()
      if (s && !values.includes(s)) values.push(s)
    }
    // 1) 渠道自身配置的协议：主协议 + chat_protocols/supported_protocols 行，置首。
    push(providerProtocol)
    const supported = (rawConfig as Record<string, unknown> | null)?.supported_protocols
    if (Array.isArray(supported)) supported.forEach(push)
    const cps = (rawConfig as Record<string, unknown> | null)?.chat_protocols
    if (Array.isArray(cps)) {
      cps.forEach((cp) => {
        if (cp && typeof cp === 'object') push((cp as Record<string, unknown>).protocol)
      })
    }
    // 2) 后端 test_provider_accounts 支持的协议全集：openai/anthropic/responses/gemini。
    ;['openai', 'anthropic', 'responses', 'gemini'].forEach(push)
    return values.length > 0 ? values : ['openai']
  }, [rawConfig, providerProtocol])

  // 切进测试 Tab 时加载账号列表 + 渠道原始配置（协议下拉用）+ 模型白名单。
  useEffect(() => {
    if (!active || !providerId) return
    let cancelled = false
    setLoadError(null)
    setLoadModelsError(null)
    setRows([])
    setSelectedModels(new Set())
    Promise.all([
      getProviderAccounts(providerId, { view: 'lite' }),
      getProviderRawConfig(providerId).catch(() => null),
    ])
      .then(([data, cfg]) => {
        if (cancelled) return
        setAccounts(data)
        setRawConfig(cfg)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '加载账号失败')
      })
    getProviderModels(providerId, { lite: true })
      .then((models) => {
        if (cancelled) return
        // 测试发送/展示都用系统模型名（model_id）：统一入口按系统名查路由再由
        // resolve_upstream_id 转回该渠道的上游名；直接发上游名会 404「模型不存在」。
        const seen = new Set<string>()
        const next: AccountTestRow[] = []
        for (const m of models || []) {
          const systemId = safeString(m.model_id || m.upstream_model_id)
          if (!systemId || seen.has(systemId)) continue
          seen.add(systemId)
          next.push({
            model: systemId,
            upstream: safeString(m.upstream_model_id || m.model_id),
            display: systemId,
            state: 'idle',
            message: '',
          })
        }
        if (next.length === 0) {
          setLoadModelsError('该渠道暂无可测试的模型（白名单为空）')
        }
        setRows(next)
        setSelectedModels(new Set(next.map((r) => r.model)))
      })
      .catch((err) => {
        if (cancelled) return
        setLoadModelsError(err instanceof Error ? err.message : '加载模型失败')
      })
    return () => {
      cancelled = true
    }
  }, [active, providerId])

  // 测试是诊断入口：不排除禁用/冻结/冷却账号（is_test 链路本就不排除），全部账号可选。
  useEffect(() => {
    if (accounts.length === 0) return
    if (!accounts.some((a) => a.username === username)) {
      setUsername(accounts[0]?.username ?? '')
    }
  }, [accounts, username])

  useEffect(() => {
    if (!protocol && protocolOptions.length > 0) setProtocol(protocolOptions[0])
  }, [protocol, protocolOptions])

  // 加载测试类型选项（渠道配置 → 测试类型）。配置缺失/失败时保留 FALLBACK_TEST_TYPES。
  useEffect(() => {
    if (!active) return
    let cancelled = false
    getMainConfig()
      .then((cfg) => {
        if (cancelled) return
        const raw = (cfg as Record<string, unknown> | undefined)?.account_test as { types?: TestTypeDef[] } | undefined
        const list = Array.isArray(raw?.types) ? raw!.types! : []
        const opts = list
          .map((t) => ({ key: safeString(t?.key).trim(), label: safeString(t?.label).trim() || safeString(t?.key).trim() }))
          .filter((o) => o.key)
        if (opts.length > 0) setTestTypeOptions(opts)
      })
      .catch(() => { /* 保留兜底 */ })
    return () => {
      cancelled = true
    }
  }, [active])

  // 测试类型选项变化后，若当前选中值已不在列表中，回落到首项。
  useEffect(() => {
    if (testTypeOptions.length === 0) return
    if (!testTypeOptions.some((o) => o.key === testType)) {
      setTestType(testTypeOptions[0].key)
    }
  }, [testTypeOptions, testType])

  // 切走 Tab 卸载组件时终止批量测试循环，避免后台继续打测试请求。
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const updateRow = (model: string, patch: Partial<AccountTestRow>) => {
    setRows((prev) => prev.map((r) => (r.model === model ? { ...r, ...patch } : r)))
  }

  const runOne = async (model: string) => {
    if (!username) {
      window.alert('请先选择账号')
      return
    }
    updateRow(model, { state: 'running', message: '正在测试...', statusCode: undefined, durationMs: undefined })
    const start = performance.now()
    try {
      const resp = await testProviderAccounts(providerId, { username, model, test_type: testType, protocol: protocol || undefined, client_type: clientType })
      const r = (resp.results || [])[0] || {}
      const elapsed = typeof r.duration_ms === 'number' ? r.duration_ms : Math.round(performance.now() - start)
      const statusCode = typeof r.status_code === 'number' ? r.status_code : undefined
      const protocolPrefix = safeString(r.protocol || protocol).trim() ? `[${safeString(r.protocol || protocol)}] ` : ''
      if (r.ok) {
        updateRow(model, { state: 'ok', message: `${protocolPrefix}${r.preview ? String(r.preview) : '可用'}`, statusCode, durationMs: elapsed })
      } else {
        // 后端失败原因可能落在 error / detail / message 任意字段，逐个兜底，尽量把上游具体原因透出。
        const reasonRaw = safeString(r.error) || safeString(r.detail) || safeString(r.message) || safeString(r.error_message)
        const reason = reasonRaw.trim() || '测试失败（未返回具体原因）'
        const errTxt = statusCode ? `[${statusCode}] ${protocolPrefix}${reason}`.trim() : `${protocolPrefix}${reason}`.trim()
        updateRow(model, { state: 'fail', message: errTxt, statusCode, durationMs: elapsed })
      }
    } catch (e) {
      const elapsed = Math.round(performance.now() - start)
      updateRow(model, { state: 'fail', message: e instanceof Error ? e.message : '测试失败', durationMs: elapsed })
    }
  }

  const runMany = async (models: string[]) => {
    if (running) return
    if (!username) {
      window.alert('请先选择账号')
      return
    }
    if (models.length === 0) {
      window.alert('请至少选择一个模型')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    for (const model of models) {
      if (controller.signal.aborted) break
      await runOne(model)
    }
    setRunning(false)
    abortRef.current = null
  }

  const stopRunning = () => {
    abortRef.current?.abort()
  }

  const toggleModel = (model: string, checked: boolean) => {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (checked) next.add(model)
      else next.delete(model)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedModels(checked ? new Set(rows.map((r) => r.model)) : new Set())
  }

  const checkedList = rows.map((r) => r.model).filter((m) => selectedModels.has(m))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
      <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
        测试请求走统一入口真实调用上游并记入请求日志；不排除冻结/禁用/冷却账号，失败不冻结、不影响健康度，且不重试。
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 220px' }}>
          <label style={labelStyle}>测试账号</label>
          <ComboSearchSelect
            value={username}
            onChange={(v) => setUsername(v ?? '')}
            disabled={accounts.length === 0}
            options={accounts.map((a) => ({ value: a.username, label: `${a.username}${a.switch === false ? '（已禁用）' : ''}${a.cooldown ? '（冷却中）' : ''}` }))}
            placeholder="该渠道暂无账号"
            contentZIndex={1101}
          />
        </div>
        <div style={{ width: 160 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '4px' }}>
            测试类型
            <span
              title={'测试类型在「渠道管理 → 设置 → 测试类型」里维护。\n每个类型 = 一组消息(messages) + 附加请求体(body)；媒体类型选 operation。\n新增/改动后此下拉自动同步。'}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--admin-border)',
                fontSize: '10px', color: 'var(--text2)', cursor: 'help', lineHeight: 1,
              }}
            >
              ?
            </span>
          </label>
          <ComboSearchSelect
            value={testType}
            onChange={(v) => setTestType((v ?? '') as AccountTestType)}
            options={testTypeOptions.map((o) => ({ value: o.key, label: o.label }))}
            contentZIndex={1101}
          />
        </div>
        <div style={{ width: 180 }}>
          <label style={labelStyle}>客户端类型</label>
          <ComboSearchSelect
            value={clientType}
            onChange={(v) => setClientType((v ?? 'none') as AccountTestClientType)}
            options={[
              { value: 'none', label: '通用（不模拟客户端）' },
              { value: 'claude-code', label: 'Claude Code' },
              { value: 'codex-cli', label: 'Codex CLI' },
              { value: 'codex-tui', label: 'Codex TUI' },
              { value: 'codex-openai', label: 'Codex OpenAI' },
              { value: 'opencode', label: 'OpenCode' },
              { value: 'workbuddy', label: 'WorkBuddy (Tencent)' },
            ]}
            contentZIndex={1101}
          />
        </div>
        <div style={{ width: 150 }}>
          <label style={labelStyle}>协议</label>
          <ComboSearchSelect
            value={protocol}
            onChange={(v) => setProtocol(v ?? '')}
            options={protocolOptions.length > 0 ? protocolOptions.map((p) => ({ value: p, label: p })) : [{ value: '', label: '默认' }]}
            placeholder="默认"
            contentZIndex={1101}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => void runMany(checkedList)} disabled={running || rows.length === 0 || !username} style={{ ...btnPrimary, whiteSpace: 'nowrap' }}>{running ? '测试中...' : '测试勾选'}</button>
          <button onClick={() => void runMany(rows.map((r) => r.model))} disabled={running || rows.length === 0 || !username} style={{ ...btnGhost, whiteSpace: 'nowrap' }}>批量测试</button>
        </div>
      </div>

      {loadError ? (
        <div style={{ color: 'var(--red)', fontSize: '13px' }}>{loadError}</div>
      ) : null}
      {loadModelsError ? (
        <div style={{ color: 'var(--red)', fontSize: '13px' }}>{loadModelsError}</div>
      ) : null}

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ padding: '8px 12px', textAlign: 'left', width: 40 }}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selectedModels.size === rows.length}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>模型</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>测试结果</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--text2)' }}>
                  {loadModelsError ? '请先在「模型列表」中添加模型白名单' : '加载中...'}
                </td>
              </tr>
            ) : rows.map((r) => {
              const isRunning = r.state === 'running'
              const isOk = r.state === 'ok'
              const isFail = r.state === 'fail'
              const color = isRunning ? 'var(--text2)' : (isOk ? 'var(--green)' : isFail ? 'var(--red)' : 'var(--text2)')
              const icon = isRunning ? '⏳' : isOk ? '✓' : isFail ? '✗' : '-'
              const elapsed = r.durationMs != null ? ` · ${r.durationMs}ms` : ''
              return (
                <tr key={r.model} style={{ borderTop: '1px solid var(--admin-border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <input
                      type="checkbox"
                      checked={selectedModels.has(r.model)}
                      onChange={(e) => toggleModel(r.model, e.target.checked)}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--text)' }}>
                    {r.display}
                    {r.upstream && r.upstream !== r.model ? (
                      <span style={{ marginLeft: 6, fontSize: '12px', color: 'var(--text2)' }} title="该渠道实际请求的上游模型名">→ {r.upstream}</span>
                    ) : null}
                  </td>
                  <td style={{ padding: '8px 12px', color, wordBreak: 'break-word', fontSize: '12px' }}>
                    <span style={{ marginRight: 6 }}>{icon}</span>
                    {r.message ? `${r.message}${elapsed}` : (isRunning ? '正在测试...' : '—')}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <button
                      disabled={isRunning || !username}
                      onClick={() => void runOne(r.model)}
                      style={{ ...btnGhost, padding: '4px 10px', fontSize: '12px', opacity: isRunning ? 0.6 : 1 }}
                    >
                      测试
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--admin-border)', paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
          已选 {checkedList.length}/{rows.length}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {running ? (
            <button onClick={stopRunning} style={btnDanger}>终止测试</button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const STATS_METRICS: Array<{ metric: MetricType; title: string }> = [
  { metric: 'tokenTrend', title: '使用趋势' },
  { metric: 'calls', title: '请求次数' },
  { metric: 'failureRate', title: '失败率' },
  { metric: 'duration', title: '响应时间' },
]

// 与数据看板共用同一套时间预设（presetToRange），口径一致：
// today = 今天 00:00 至此刻，其余为「往前 N 天」滚动窗口。
const STATS_RANGE_OPTIONS: Array<{ key: TimePreset; label: string }> = [
  { key: '1h', label: '近 1 小时' },
  { key: '3h', label: '近 3 小时' },
  { key: 'today', label: '当日' },
  { key: '1d', label: '近 24 小时' },
  { key: '7d', label: '近 7 天' },
  { key: '15d', label: '近 15 天' },
  { key: '30d', label: '近 30 天' },
]

function buildStatsRange(preset: TimePreset): RangeFilters {
  const { start, end } = presetToRange(preset)
  // 与数据看板一致：时间粒度由区间跨度自动决定，而非按范围硬编码。
  return { start, end, grain: autoGrain(start, end) }
}

function ProviderStatsTab({ providerName, active }: { providerName: string; active: boolean }) {
  const [rangeKey, setRangeKey] = useState<TimePreset>('today')
  const [chartType, setChartType] = useState<ChartType>('line')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filters = useMemo(() => {
    const opt = STATS_RANGE_OPTIONS.find((o) => o.key === rangeKey) ?? STATS_RANGE_OPTIONS[0]
    return buildStatsRange(opt.key)
  }, [rangeKey])

  const fetchStats = useCallback(async () => {
    if (!providerName) return
    setLoading(true)
    setError(null)
    try {
      const data = await getDashboardStats({
        start: datetimeToUnix(filters.start),
        end: datetimeToUnix(filters.end),
        grain: filters.grain,
        section: 'all',
        provider: providerName,
      })
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载统计数据失败')
    } finally {
      setLoading(false)
    }
  }, [providerName, filters])

  useEffect(() => {
    if (active) void fetchStats()
  }, [active, fetchStats])

  const series = stats?.series ?? {}
  const summary = stats?.summary
  const summaryCards = useMemo<Array<{ label: string; value: string; hint?: string; color: string }>>(() => {
    if (!summary) return []
    const requests = summary.requests ?? 0
    const totalTokens = summary.total_tokens ?? 0
    const inputTokens = summary.prompt_tokens ?? 0
    const outputTokens = summary.completion_tokens ?? 0
    const cacheRead = summary.cached_tokens ?? 0
    const cacheWrite = summary.cache_creation_tokens ?? 0
    const reasoningTokens = summary.reasoning_tokens ?? 0
    const errorCount = summary.error_count ?? 0
    const failureRate = requests > 0 ? (errorCount / requests) * 100 : 0
    const avgDuration = (summary.avg_duration_ms ?? 0) / 1000
    const cacheHitRate = inputTokens > 0 ? (cacheRead / inputTokens) * 100 : 0
    return [
      { label: '请求总数', value: formatNumber(requests), hint: `失败 ${formatNumber(errorCount)} · 失败率 ${failureRate.toFixed(2)}%`, color: '#0ea5e9' },
      { label: 'Token 总量', value: formatCount(totalTokens), hint: `TPM ${formatCount(summary.avg_tpm ?? 0)} · RPM ${formatCount(summary.avg_prm ?? 0)}`, color: '#06b6d4' },
      { label: '输入 Token', value: formatCount(inputTokens), hint: `缓存命中 ${cacheHitRate.toFixed(1)}%`, color: '#3b82f6' },
      { label: '输出 Token', value: formatCount(outputTokens), color: '#10b981' },
      { label: '缓存读', value: formatCount(cacheRead), color: '#f59e0b' },
      { label: '缓存写', value: formatCount(cacheWrite), color: '#8b5cf6' },
      { label: '思考 Token', value: formatCount(reasoningTokens), color: '#a855f7' },
      { label: '平均耗时', value: `${avgDuration.toFixed(2)} s`, color: '#64748b' },
    ]
  }, [summary])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...panelStyle, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--text2)' }}>时间范围</span>
        <select value={rangeKey} onChange={(e) => setRangeKey(e.target.value as TimePreset)} style={{ ...selectStyle, width: 'auto' }}>
          {STATS_RANGE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <span style={{ fontSize: '13px', color: 'var(--text2)', marginLeft: '8px' }}>图表类型</span>
        <button onClick={() => setChartType('bar')} style={{ ...btnGhost, ...(chartType === 'bar' ? { borderColor: 'var(--blue)', color: 'var(--blue)', background: 'var(--tint)' } : {}) }}>柱状图</button>
        <button onClick={() => setChartType('line')} style={{ ...btnGhost, ...(chartType === 'line' ? { borderColor: 'var(--blue)', color: 'var(--blue)', background: 'var(--tint)' } : {}) }}>折线图</button>
        <button onClick={() => void fetchStats()} disabled={loading} style={{ ...btnGhost, marginLeft: 'auto' }}>{loading ? '刷新中...' : '刷新'}</button>
      </div>

      {error ? (
        <div style={{ color: 'var(--red)', padding: '16px 0' }}>
          <div style={{ fontSize: '14px' }}>{error}</div>
          <button onClick={() => void fetchStats()} style={{ ...btnGhost, marginTop: '12px' }}>重试</button>
        </div>
      ) : loading && !stats ? (
        <div style={{ color: 'var(--text2)', padding: '24px 0', fontSize: '14px' }}>正在加载...</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'stretch' }}>
            {summaryCards.length > 0 && (
              <div style={{ flex: '1 1 480px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {summaryCards.map((c) => (
                  <div key={c.label} style={{ ...panelStyle, padding: '10px 12px', borderLeft: `3px solid ${c.color}`, background: `color-mix(in srgb, ${c.color} 6%, var(--bg2))` }}>
                    <div style={{ fontSize: '13px', color: 'var(--text2)' }}>{c.label}</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: c.color, marginTop: '4px', lineHeight: 1.15 }}>{c.value}</div>
                    {c.hint && <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '3px' }}>{c.hint}</div>}
                  </div>
                ))}
              </div>
            )}
            {/* 账号使用占比：按 account_username 聚合，过滤空账号。渠道编辑弹框限定到当前渠道。
                只画环形图，hover 切片显示账号名/数值/占比。 */}
            {(stats?.rankings?.account_usage_top?.length || stats?.rankings?.account_requests_top?.length) ? (
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <div style={{ ...panelStyle, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '2px' }}>账号用量占比</div>
                  <AccountShareChart rows={stats?.rankings?.account_usage_top ?? []} metric="tokens" />
                </div>
                <div style={{ ...panelStyle, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '2px' }}>账号请求占比</div>
                  <AccountShareChart rows={stats?.rankings?.account_requests_top ?? []} metric="requests" />
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            {STATS_METRICS.map((m) => (
              <UsageChart
                key={m.metric}
                metric={m.metric}
                scope="summary"
                series={series}
                filters={filters}
                chartType={chartType}
                title={m.title}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** 账号占比环形图：recharts PieChart（donut）+ Cell 着色。只画图，不列排名。
 *  hover 切片显示账号名/数值/占比。色板用 recharts 官方通用示例色，统一不花。 */
const ACCOUNT_SHARE_PALETTE = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CFE',
  '#FF6B91', '#36CFC9', '#FFA940', '#597EF7', '#73D13D',
]
function accountShareColor(name: string, index: number): string {
  // 同名账号稳定取色；超出调色板循环。
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return ACCOUNT_SHARE_PALETTE[Math.abs(hash) % ACCOUNT_SHARE_PALETTE.length] ?? ACCOUNT_SHARE_PALETTE[index % ACCOUNT_SHARE_PALETTE.length]
}
function AccountShareChart({ rows, metric }: {
  rows: Array<{ name?: string; tokens?: number; requests?: number; token_share?: number; request_share?: number; success_requests?: number }>
  metric: 'tokens' | 'requests'
}) {
  const slices = rows.map((r) => {
    const value = metric === 'tokens' ? (r.tokens ?? 0) : (r.success_requests ?? r.requests ?? 0)
    return { name: r.name || '-', value }
  })
  // 占比由后端 token_share/request_share 给出；recharts 按数值比例算切片，
  // 这里用 share*100 还原成与后端一致的占比口径，避免被 LIMIT 截断的尾部失真。
  const data = rows.map((r) => {
    const share = (metric === 'tokens' ? r.token_share : r.request_share) ?? 0
    return { name: r.name || '-', value: Math.max(0, share) * 100 }
  })
  const fmtValue = (v: number) => (metric === 'tokens' ? formatCount(v) : formatNumber(v))
  const totalValue = slices.reduce((s, x) => s + x.value, 0)
  const centerLabel = metric === 'tokens' ? formatCount(totalValue) : formatNumber(totalValue)
  return (
    <div style={{ position: 'relative', width: 140, height: 140 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={62}
            paddingAngle={1}
            stroke="var(--bg2)"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={accountShareColor(entry.name, i)} />
            ))}
          </Pie>
          <RTooltip
            formatter={((value: number, _name: string, item: { payload?: { name?: string } }) => {
              const name = item?.payload?.name ?? ''
              const row = slices.find((s) => s.name === name)
              const v = row ? row.value : 0
              return [`${fmtValue(v)} · ${value.toFixed(1)}%`, name] as [string, string]
            }) as never}
            contentStyle={{
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid var(--admin-border)',
              padding: '6px 8px',
              width: 'auto',
              maxWidth: 240,
              zIndex: 1001,
            }}
            itemStyle={{ color: '#1f2937' }}
            labelStyle={{ color: '#1f2937', fontWeight: 600 }}
            wrapperStyle={{ width: 'auto', zIndex: 1001 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: 10, color: 'var(--text2)' }}>{metric === 'tokens' ? 'Token' : '请求'}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{centerLabel}</span>
      </div>
    </div>
  )
}

// 创建态账号编辑器：渠道尚未落库时，先在这里填好用户名 / 凭据 / 代理，
// 点「保存」时随渠道一起提交（见 UnifiedProviderModal.buildCreateAccountsPayload）。
// device_auth 类渠道（copilot/codex 等）走跳转授权，创建后再到账号管理里授权，这里不展示表单。
type CreateAccountDraft = { username: string; api_key: string; account_id: string; proxy: string; priority: number; weight: number }

function CreateAccountsEditor({
  accounts,
  setAccounts,
  proxies,
  authMode,
  emptyAccount,
  templateMode = false,
}: {
  accounts: CreateAccountDraft[]
  setAccounts: React.Dispatch<React.SetStateAction<CreateAccountDraft[]>>
  proxies: ProxyEntry[]
  authMode: ChannelAuthMode
  emptyAccount: () => CreateAccountDraft
  templateMode?: boolean
}) {
  if (authMode === 'device_auth') {
    return (
      <div style={{ ...panelStyle, color: 'var(--text2)', textAlign: 'center', fontSize: '13px', padding: '32px 16px' }}>
        该渠道通过跳转授权添加账号。请先点「保存」创建渠道，随后在账号管理里发起授权。
      </div>
    )
  }

  const isCloudflare = authMode === 'cloudflare'
  const isManualValues = authMode === 'manual_values'
  // schema 驱动渠道（代码渠道）创建期还没有 account_schema，先按用户名/密码通用形态收集；
  // 落库后账号管理页再按后端 schema 精细渲染（含设备码授权入口）。
  const isPasswordLike = authMode === 'password_login' || authMode === 'schema'
  const credLabel = isPasswordLike ? '密码' : (isCloudflare ? 'API Key' : 'API Key / 密钥')
  const usernameLabel = isCloudflare ? '用户名 / Account ID *' : '用户名 / Key 名称'

  const patch = (index: number, next: Partial<CreateAccountDraft>) =>
    setAccounts((prev) => prev.map((a, i) => (i === index ? { ...a, ...next } : a)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text2)' }}>
        {templateMode
          ? '请填写该渠道的账号凭据；用户名留空将自动生成 key-1、key-2…'
          : '先填好账号信息，点右下角「保存」时会创建渠道并一并提交账号。用户名留空将自动生成 key-1、key-2…'}
      </div>
      {accounts.map((account, index) => (
        <div key={index} style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text2)' }}>账号 {index + 1}</span>
            <button
              onClick={() => setAccounts((prev) => (prev.length <= 1 ? [emptyAccount()] : prev.filter((_, i) => i !== index)))}
              style={{ ...btnDanger, padding: '3px 10px', fontSize: '12px' }}
            >
              删除
            </button>
          </div>
          <div style={grid2Style}>
            <div>
              <label style={labelStyle}>{usernameLabel}</label>
              <input
                value={account.username}
                onChange={(e) => patch(index, { username: e.target.value })}
                placeholder={isCloudflare ? 'Cloudflare Account ID' : '如 key-1（留空自动生成）'}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{credLabel}{isManualValues ? '（可空）' : ''}</label>
              <input
                value={account.api_key}
                onChange={(e) => patch(index, { api_key: e.target.value })}
                placeholder={isPasswordLike ? '登录密码' : 'sk-...'}
                style={inputStyle}
                type="text"
              />
            </div>
            <div>
              <label style={labelStyle}>代理（可选）</label>
              <select
                value={account.proxy}
                onChange={(e) => patch(index, { proxy: e.target.value })}
                style={selectStyle}
              >
                <option value="">不使用代理</option>
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name || p.url) + (p.mode === 'url_prefix' ? '（前缀转发）' : p.mode === 'direct' ? '（直连）' : '')}
                  </option>
                ))}
              </select>
            </div>
            <div style={grid2Style}>
              <div>
                <label style={labelStyle}>优先级</label>
                <input
                  type="number"
                  value={String(account.priority)}
                  onChange={(e) => patch(index, { priority: safeNumber(e.target.value) })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>权重</label>
                <input
                  type="number"
                  value={String(account.weight)}
                  onChange={(e) => patch(index, { weight: safeNumber(e.target.value, 1) })}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>
        </div>
      ))}
      <div>
        <button onClick={() => setAccounts((prev) => [...prev, emptyAccount()])} style={btnGhost}>+ 添加账号</button>
      </div>
    </div>
  )
}

// ── 渠道模板（市场 manifest）与渠道表单的互转 ──────────────────────────────
//
// 渠道模板就是「加完账号就能跑」的渠道配置，字段与渠道基础配置同构，只是不含账号/
// 密钥/Cookie/Token。所以模板编辑器直接复用本文件的渠道表单（隐藏账号/统计/测试
// Tab），两侧共用同一套协议行/路径/限流/冻结策略控件，字段口径不会漂移。
//
// manifest 结构与服务端 validator / channel_template_export.build_manifest 对齐：
//   { schema, id, kind, name, display_name, summary, publisher, category, tags,
//     icon, version, status, resource: { type, channel: {...}, freeze_policy: {...} } }

const CHANNEL_TEMPLATE_SCHEMA = 'ai-lubricant.channel-template/v1'

type TemplateMetaForm = {
  id: string
  name: string
  display_name: string
  summary: string
  publisher: string
  category: string
  version: string
  status: string
  icon: string
  tagsText: string
}

function emptyTemplateMeta(): TemplateMetaForm {
  return {
    id: '',
    name: '',
    display_name: '',
    summary: '',
    publisher: 'local-ai-lubricant',
    category: 'custom',
    version: '1.0.0',
    status: 'published',
    icon: '',
    tagsText: '',
  }
}

function templateMetaFromManifest(manifest: Record<string, any> | null | undefined): TemplateMetaForm {
  if (!manifest) return emptyTemplateMeta()
  const base = emptyTemplateMeta()
  return {
    id: safeString(manifest.id) || base.id,
    name: safeString(manifest.name) || base.name,
    display_name: safeString(manifest.display_name) || base.display_name,
    summary: safeString(manifest.summary) || base.summary,
    publisher: safeString(manifest.publisher) || base.publisher,
    category: safeString(manifest.category) || base.category,
    version: safeString(manifest.version) || base.version,
    status: safeString(manifest.status) || base.status,
    icon: safeString(manifest.icon),
    tagsText: Array.isArray(manifest.tags) ? manifest.tags.map(String).join(', ') : '',
  }
}

/** manifest.resource.channel -> 渠道表单预设（复用 create 态的 presetData 路径）。 */
function templatePresetFromManifest(manifest: Record<string, any> | null | undefined): ProviderCreatePreset | null {
  const channel = manifest?.resource?.channel
  if (!channel || typeof channel !== 'object') return null
  const freeze = manifest?.resource?.freeze_policy
  return {
    remark: safeString(channel.name) || safeString(manifest?.display_name),
    tags: Array.isArray(manifest?.tags) ? manifest.tags.map(String) : [],
    website_url: safeString(channel.website_url),
    icon: safeString(manifest?.icon),
    enabled: channel.enabled !== false,
    base_url: safeString(channel.base_url),
    models_path: safeString(channel.models_path),
    image_path: safeString(channel.image_path),
    video_path: safeString(channel.video_path),
    speech_path: safeString(channel.speech_path),
    timeout: safeNumber(channel.timeout, 120),
    retry_count: channel.retry_count ?? null,
    extra_retry_status_codes: Array.isArray(channel.extra_retry_status_codes)
      ? channel.extra_retry_status_codes.filter((code: unknown) => Number.isInteger(code))
      : [],
    billing_mode: channel.billing_mode === 'request' ? 'request' : 'token',
    chat_protocols: Array.isArray(channel.chat_protocols) ? channel.chat_protocols : [],
    rate_limit: (channel.rate_limit || {}) as ProviderCreatePreset['rate_limit'],
    freeze_policy: freeze && typeof freeze === 'object'
      ? { enabled: freeze.enabled !== false, rules: Array.isArray(freeze.rules) ? freeze.rules : [] }
      : undefined,
    account_priority: safeNumber(channel.account_priority, 0),
    account_weight: safeNumber(channel.account_weight, 1),
    auto_update_models: channel.auto_update_models !== false,
    model_id_rewrite_rules: normalizeModelIdRewriteRules(channel.model_id_rewrite_rules),
    models: Array.isArray(channel.chat_protocols)
      ? Array.from(new Set(channel.chat_protocols.flatMap((row: any) => Array.isArray(row?.models) ? row.models.map(String) : [])))
      : [],
  }
}

export function UnifiedProviderModal({
  open,
  providerId,
  mode = 'edit',
  initialTab = 'basic',
  initialBuiltinType = '',
  presetData,
  presetFromCatalog = false,
  templateMode = false,
  templateManifest = null,
  onClose,
  onChanged,
  onSaveTemplate,
  onBack,
}: {
  open: boolean
  /** edit 态唯一标识：渠道 id（后端即 name）。打开只需这个。 */
  providerId?: string
  mode?: 'edit' | 'create'
  initialTab?: ProviderTab
  initialBuiltinType?: string
  presetData?: ProviderCreatePreset | null
  /** createPreset 是否来自渠道目录（非复制流程）。来自目录的自定义渠道
   *  timeout 强制走前端默认 120，不信任后端 catalog 预设里的旧 600。 */
  presetFromCatalog?: boolean
  /** 模板模式：把渠道表单复用为渠道模板编辑器，隐藏账号/统计/测试 Tab，保存走
   *  onSaveTemplate 而不是 provider 落库。渠道模板是市场 manifest，无账号/无 id 落库。 */
  templateMode?: boolean
  templateManifest?: {
    id?: string
    name?: string
    display_name?: string
    summary?: string
    publisher?: string
    category?: string
    version?: string
    status?: string
    icon?: string
    tags?: string[]
    resource?: { channel?: Record<string, unknown>; freeze_policy?: { enabled?: boolean; rules?: unknown[] } }
  } | null
  onClose: () => void
  /** 数据已变化的旁路通知，供父页面刷新自身列表。不传也能正常增删改。 */
  onChanged?: (e: { type: 'saved' | 'deleted' | 'created'; id: string }) => void
  onSaveTemplate?: (manifest: Record<string, unknown>) => Promise<void>
  /** 新建渠道时返回上一级（重新选择渠道类型）。仅 create 流程使用。 */
  onBack?: () => void
}) {
  const [activeTab, setActiveTab] = useState<ProviderTab>(initialTab)

  // data state
  const [detail, setDetail] = useState<ProviderBaseConfig | null>(null)
  const [models, setModels] = useState<ProviderModelEntry[]>([])
  const [limitPolicy, setLimitPolicy] = useState<ProviderLimitPolicy | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  // 账号管理 Tab 有未提交的「新增账号 / 编辑账号」表单时的丢弃确认：
  // 关弹框（× / 遮罩 / 取消）与切 Tab 都会卸载 AccountsTab，表单内容会静默丢失。
  const [discardAccountEditOpen, setDiscardAccountEditOpen] = useState(false)
  const accountEditInProgressRef = useRef(false)
  const pendingDiscardActionRef = useRef<(() => void) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  // edit state
  const [enabled, setEnabled] = useState(false)
  const [remarkText, setRemarkText] = useState('')
  const [clearConvEnabled, setClearConvEnabled] = useState(false)
  const [clearConvHours, setClearConvHours] = useState(2)
  // health_check 字段已不在面板暴露：它驱动后台认证探针循环（check_account_loop），
  // 属于专用初始化任务；定时的真实检测入口在「基础配置」tab 的「定时检测」折叠块。
  const [extraRetryStatusCodesText, setExtraRetryStatusCodesText] = useState('')
  // 定时检测：到点按测试参数跑一次真实检测；成功解冻，失败是否冻结由「冻结策略」tab 的渠道级开关控制。
  const [stEnabled, setStEnabled] = useState(false)
  const [stFreqUnit, setStFreqUnit] = useState<'daily' | 'minutes' | 'hours'>('minutes')
  const [stFreqValue, setStFreqValue] = useState(30)
  const [stAccounts, setStAccounts] = useState<string[]>([])
  const [stTestType, setStTestType] = useState('chat')
  const [stClientType, setStClientType] = useState<AccountTestClientType>('none')
  const [stProtocol, setStProtocol] = useState('')
  const [stTestModels, setStTestModels] = useState<string[]>([])
  const [stAccountFilter, setStAccountFilter] = useState<'available' | 'unavailable' | 'all'>('unavailable')
  const [stRetainFailedLogs, setStRetainFailedLogs] = useState(true)
  const [scheduledTestExpanded, setScheduledTestExpanded] = useState(false)
  // 「立即执行」按钮态：异步入队不阻塞，完成后展示入队账号数 / 失败原因，并刷新上次执行时间。
  const [stRunning, setStRunning] = useState(false)
  const [stRunMessage, setStRunMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // 定时检测的账号多选候选：进入编辑态时加载 lite 账号列表（与 AccountTestTab 同源）。
  const [stAccountsList, setStAccountsList] = useState<ProviderAccountLite[]>([])
  // 定时检测复用测试 tab 的测试类型/协议选项源；渠道自身协议置首。
  const [stTestTypeOptions, setStTestTypeOptions] = useState<Array<{ key: string; label: string }>>(FALLBACK_TEST_TYPES)
  const stModelOptions = useMemo(() => {
    const seen = new Set<string>()
    return models
      .map((m) => safeString(m.model_id || m.upstream_model_id || m.id).trim())
      .filter((m) => m && !seen.has(m) && seen.add(m))
      .map((m) => ({ value: m, label: m }))
  }, [models])

  const handleScheduledTestModelChange = (values: string[]) => {
    setStTestModels(values)
  }
  // 立即触发一次定时检测：用当前表单参数覆盖已保存配置，异步入队由后台 worker 消费，不阻塞。
  const runScheduledTestNow = async () => {
    if (!resolvedId || stRunning) return
    setStRunning(true)
    setStRunMessage(null)
    try {
      const res = await triggerProviderScheduledTestNow(resolvedId, {
        accounts: stAccounts.length > 0 ? stAccounts : undefined,
        test_type: stTestType || undefined,
        client_type: stClientType && stClientType !== 'none' ? stClientType : undefined,
        protocol: stProtocol || undefined,
        test_models: stTestModels.length > 0 ? stTestModels : undefined,
        test_model: stTestModels[0] || undefined,
        account_filter: stAccountFilter,
        retain_failed_logs: stRetainFailedLogs,
      })
      if (res.ok) {
        setStRunMessage({ ok: true, text: res.enqueued > 0 ? `已加入检测队列（${res.enqueued} 个账号）` : '当前无候选账号（按检测范围与账号状态筛选后为空）' })
        if (typeof res.triggered_at === 'number' && res.triggered_at > 0) {
          setDetail((prev) => prev ? { ...prev, last_scheduled_test_at: res.triggered_at ?? null } : prev)
        }
      } else {
        setStRunMessage({ ok: false, text: res.detail || '触发失败' })
      }
    } catch (e) {
      setStRunMessage({ ok: false, text: e instanceof Error ? e.message : '触发失败' })
    } finally {
      setStRunning(false)
    }
  }
  const stProtocolOptions = useMemo(() => {
    const values: string[] = []
    const push = (v: unknown) => {
      const s = safeString(v).trim().toLowerCase()
      if (s && !values.includes(s)) values.push(s)
    }
    push(safeString(detail?.protocol))
    const cps = detail?.chat_protocols
    if (Array.isArray(cps)) {
      cps.forEach((cp) => { push(cp?.protocol) })
    }
    ;['openai', 'anthropic', 'responses', 'gemini'].forEach(push)
    return values.length > 0 ? values : ['openai']
  }, [detail])
  // 打开编辑态时加载测试类型选项（全局配置驱动），供定时检测复用；配置缺失回退 FALLBACK_TEST_TYPES。
  useEffect(() => {
    if (!open || mode !== 'edit') return
    let cancelled = false
    getMainConfig()
      .then((cfg) => {
        if (cancelled) return
        const raw = (cfg as Record<string, unknown> | undefined)?.account_test as { types?: TestTypeDef[] } | undefined
        const list = Array.isArray(raw?.types) ? raw!.types! : []
        const opts = list
          .map((t) => ({ key: safeString(t?.key).trim(), label: safeString(t?.label).trim() || safeString(t?.key).trim() }))
          .filter((o) => o.key)
        if (opts.length > 0) setStTestTypeOptions(opts)
      })
      .catch(() => { /* 保留兜底 */ })
    return () => { cancelled = true }
  }, [open, mode])
  // stProtocol 未设时回落到首项，避免空值下发。
  useEffect(() => {
    if (!stProtocol && stProtocolOptions.length > 0) setStProtocol(stProtocolOptions[0])
  }, [stProtocol, stProtocolOptions])
  // stTestType 不在选项列表时回落到首项。
  useEffect(() => {
    if (stTestTypeOptions.length === 0) return
    if (!stTestTypeOptions.some((o) => o.key === stTestType)) setStTestType(stTestTypeOptions[0].key)
  }, [stTestTypeOptions, stTestType])
  const [freezePolicyEnabled, setFreezePolicyEnabled] = useState(true)
  const [freezeRules, setFreezeRules] = useState<ProviderLimitFreezeRule[]>([])
  // 渠道级冻结策略属性：定时检测探测失败是否按正常请求语义记健康度并冻结/刷新 TTL（关=只探不冻）。
  // 存在 limit policy 的 freeze_policy 里，与规则一起经 updateProviderLimitPolicy 保存。
  const [freezeRefreshOnFailure, setFreezeRefreshOnFailure] = useState(true)
  const [chatProtocols, setChatProtocols] = useState<ChatProtocolConfig[]>([])
  const [expandedChatProtocols, setExpandedChatProtocols] = useState<Set<number>>(new Set())
  const [headerTemplates, setHeaderTemplates] = useState<HeaderTemplate[]>([])
  // 全局模型规则模版库：改写编辑器里的「引用模版」下拉与预览展开都要它。
  const [modelRuleTemplates, setModelRuleTemplates] = useState<ModelRuleTemplate[]>([])
  const [templateWarnings, setTemplateWarnings] = useState<string[]>([])
  const [upstreamSelectMode, setUpstreamSelectMode] = useState(false)
  const [upstreamDraftModels, setUpstreamDraftModels] = useState<ProviderModelEntry[]>([])
  const [upstreamSelected, setUpstreamSelected] = useState<Set<string>>(new Set())
  const [upstreamSearch, setUpstreamSearch] = useState('')
  const [loadingUpstreamModels, setLoadingUpstreamModels] = useState(false)
  // 获取上游模型预览开关：开 = 预显示自动更新后的结果（只显示满足规则 is_regex=true
  // 的行、显示改名后名字）；关 = 全部行 + 原始名。默认开。仅显示，不影响后端定时更新。
  const [previewApplyRewrite, setPreviewApplyRewrite] = useState(true)

  // 窗口真实大小测试
  const [detectLoading, setDetectLoading] = useState(false)
  const [detectResult, setDetectResult] = useState<DetectModelResult | null>(null)
  const [detectModelLabel, setDetectModelLabel] = useState('')
  // 测试账号选择：用户先选账号再开始测试（不再随机挑账号）
  const [detectOpen, setDetectOpen] = useState(false)
  const [detectAccounts, setDetectAccounts] = useState<ProviderAccountLite[]>([])
  const [detectUsername, setDetectUsername] = useState('')
  // 预设按钮与自定义输入共用一个 token 数值；预设只负责快捷填入。
  const [windowTokensInput, setWindowTokensInput] = useState('8000')
  const WINDOW_SIZE_PRESETS = [
    { label: '4K', tokens: 4000 },
    { label: '8K', tokens: 8000 },
    { label: '16K', tokens: 16000 },
    { label: '32K', tokens: 32000 },
    { label: '64K', tokens: 64000 },
    { label: '128K', tokens: 128000 },
    { label: '200K', tokens: 200000 },
    { label: '256K', tokens: 256000 },
    { label: '512K', tokens: 512000 },
    { label: '1M', tokens: 1000000 },
  ] as const
  const parsedWindowTokens = /^\d+$/.test(windowTokensInput.trim()) ? Number(windowTokensInput.trim()) : NaN
  const windowTokensValid = Number.isInteger(parsedWindowTokens) && parsedWindowTokens >= 1000 && parsedWindowTokens <= 1000000

  const loadIconFile = (file: File | undefined, apply: (value: string) => void) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('图标文件必须是图片')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('图标文件不能超过 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (!src.startsWith('data:image/')) {
        setError('图标文件读取失败')
        return
      }
      // 限制最大边 512px，等比缩放后转 WebP（失败回退 PNG），避免 base64 膨胀。
      const img = new Image()
      img.onload = () => {
        const MAX = 512
        let { width, height } = img
        if (width > MAX || height > MAX) {
          const scale = Math.min(MAX / width, MAX / height)
          width = Math.max(1, Math.round(width * scale))
          height = Math.max(1, Math.round(height * scale))
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          apply(src)
          setError(null)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        try {
          const webp = canvas.toDataURL('image/webp', 0.9)
          apply(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'))
        } catch {
          // SVG 等含外部引用可能触发 canvas 污染，回退原图 data URL。
          apply(src)
        }
        setError(null)
      }
      img.onerror = () => setError('图标文件解码失败')
      img.src = src
    }
    reader.onerror = () => setError('图标文件读取失败')
    reader.readAsDataURL(file)
  }

  const convertIconUrl = async () => {
    const url = safeString(detail?.icon).trim()
    if (!/^https?:\/\//i.test(url)) {
      setError('请先输入有效的图片 URL')
      return
    }
    try {
      setError(null)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) throw new Error('响应不是图片')
      const file = new File([blob], 'channel-icon', { type: blob.type })
      loadIconFile(file, (value) => setDetail((prev) => prev ? { ...prev, icon: value } : prev))
    } catch (err) {
      setError(`图片 URL 转换失败（可能被跨域策略拦截）: ${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  // 渠道模型编辑态
  const [editingModel, setEditingModel] = useState<{ row: ProviderModelEntry; index: number; isNew: boolean } | null>(null)
  const [rewriteRulesOpen, setRewriteRulesOpen] = useState(false)
  const iconFileInputRef = useRef<HTMLInputElement | null>(null)
  const templateIconFileInputRef = useRef<HTMLInputElement | null>(null)

  // 新增态专属 state（edit 模式不使用）
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createAccounts, setCreateAccounts] = useState<Array<{ username: string; api_key: string; account_id: string; proxy: string; priority: number; weight: number }>>([])
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const emptyCreateAccount = () => ({ username: '', api_key: '', account_id: '', proxy: '', priority: 0, weight: 1 })

  // 唯一真相是 id：edit 态用父传 providerId；create 态落库后 createdId 接管，弹窗随即按 edit 路径工作。
  // 模板模式没有 provider 落库这回事：resolvedId 恒为空，弹窗只编辑 manifest。
  const isCreateMode = mode === 'create' && !templateMode
  const resolvedId = templateMode ? '' : (createdId || (isCreateMode ? '' : (providerId || '')))
  // 基础配置 tab 编辑态加载账号列表，供定时检测多选用（不选=全部账号）。
  useEffect(() => {
    if (!open || mode !== 'edit' || activeTab !== 'basic' || !resolvedId) return
    let cancelled = false
    getProviderAccounts(resolvedId, { view: 'lite' })
      .then((data) => { if (!cancelled) setStAccountsList(data) })
      .catch(() => { /* 忽略：多选可空 */ })
    return () => { cancelled = true }
  }, [open, mode, activeTab, resolvedId])
  // 仍处于「创建草稿」阶段：create 模式且尚未落库。落库后即视同 edit。
  // 模板模式复用 create 的「表单从预设初始化、不拉服务端详情」路径。
  const isCreate = templateMode || (isCreateMode && !createdId)
  const createBuiltinType = initialBuiltinType || ''
  const isCustom = detail?.custom_channel ?? (isCreate ? !createBuiltinType : false)
  const providerCategory = isCreate ? getProviderCategory(createBuiltinType) : (detail ? getProviderCategory(detail.builtin_type || '') : 0)
  const protocolBuiltinType = isCreate ? createBuiltinType : (detail?.builtin_type || '')
  const protocolEditorEnabled = providerCategory === 0 || isProtocolEditableBuiltin(protocolBuiltinType)

  // 模板 manifest 的非渠道字段（市场目录展示用），只在模板模式渲染。
  const [templateMeta, setTemplateMeta] = useState<TemplateMetaForm>(emptyTemplateMeta())

  const [limitPolicyLoading, setLimitPolicyLoading] = useState(false)
  const [modelsLoadState, setModelsLoadState] = useState<'loading' | 'ok' | 'failed'>('loading')
  void limitPolicyLoading; void proxies

  const initCreate = useCallback(() => {
    if (!open) return
    setLoading(false)
    setError(null)
    setCreatedId(null)
    setScheduledTestExpanded(false)
    // 模板模式的表单初值来自 manifest.resource.channel；其余走父层传的 presetData。
    const preset = templateMode ? templatePresetFromManifest(templateManifest) : (presetData ?? null)
    const presetProtocols = Array.isArray(preset?.chat_protocols) && preset.chat_protocols.length > 0
      ? preset.chat_protocols.map((row) => ({
          id: safeString(row.id),
          enabled: row.enabled !== false,
          protocol: safeString(row.protocol) || 'openai',
          path: safeString(row.path),
          upstream_stream: normalizeUpstreamStream(row.upstream_stream),
          client_preset: safeString(row.client_preset) || 'none',
          header_template: safeString(row.header_template),
          system_type: safeString(row.system_type) || 'auto',
          send_reasoning_content: row.send_reasoning_content !== false,
          models: Array.isArray(row.models) ? row.models.map(String) : [],
        }))
      : []
    const proto = safeString(presetProtocols.find((row) => row.enabled !== false)?.protocol || preset?.protocol).trim() || 'openai'
    const defs = getProtocolDefaultPaths(proto)
    const builtinLabel = BUILTIN_TYPE_OPTIONS.find((o) => o.value === createBuiltinType)?.label || createBuiltinType
    const base: ProviderBaseConfig = {
      id: '',
      name: '',
      enabled: preset?.enabled ?? true,
      rate_limit: { rpm_per_account: 0, tpm_per_account: 0, tpm_per_model: 0, concurrent_per_account: 0, ...(preset?.rate_limit || {}) },
      clear_conversation: preset?.clear_conversation ?? {},
      remark: safeString(preset?.remark).trim() || builtinLabel,
      tags: normalizeProviderTags(preset?.tags),
      type: createBuiltinType ? 'builtin' : 'custom',
      custom_channel: !createBuiltinType,
      builtin_type: createBuiltinType,
      protocol: proto,
      base_url: safeString(preset?.base_url).trim(),
      website_url: safeString(preset?.website_url).trim(),
      icon: safeString(preset?.icon).trim(),
      chat_path: safeString(preset?.chat_path).trim() || defs.chat_path,
      models_path: safeString(preset?.models_path).trim() || defs.models_path,
      image_path: safeString(preset?.image_path).trim() || defs.image_path,
      video_path: safeString(preset?.video_path).trim() || defs.video_path,
      speech_path: safeString(preset?.speech_path).trim() || '/v1/audio/speech',
      chat_protocols: presetProtocols,
      supports_image_generation: safeBoolean(preset?.supports_image_generation),
      supports_video_generation: safeBoolean(preset?.supports_video_generation),
      supports_tts: safeBoolean(preset?.supports_tts),
      // 代码渠道：目录 preset.code 已带 Echo 样例，回填到草稿供编辑/保存。
      code: safeString(preset?.code),
      account_priority: safeNumber(preset?.account_priority, 0),
      account_weight: safeNumber(preset?.account_weight, 0),
      auto_update_models: preset?.auto_update_models ?? false,
      model_id_rewrite_rules: normalizeModelIdRewriteRules(preset?.model_id_rewrite_rules),
      // 来自渠道目录的自定义渠道（非内置、非复制）默认超时 120 秒；
      // 不读 catalog 预设里的 timeout，避免后端旧快照仍是 600 时把表单带偏。
      timeout: presetFromCatalog && !createBuiltinType ? 120 : safeNumber(preset?.timeout, 120),
      retry_count: preset?.retry_count ?? null,
      health_check: preset?.health_check ?? { enabled: false, interval_minutes: 30, test_model: '' },
      scheduled_test: preset?.scheduled_test ?? { enabled: false, frequency_unit: 'minutes', frequency_value: 30 },
      billing_mode: preset?.billing_mode || 'token',
      balance: {},
      models: (preset?.models || []).map(String),
    }
    setDetail(base)
    setEnabled(base.enabled)
    setRemarkText(base.remark)
    // 对称 seed 会话清理 / 定时检测表单态（镜像 edit 态 loadData）：
    // 否则即便 detail 里带了预设值，折叠块读取的仍是 st*/clearConv* 初值，复制进来的配置看不到。
    const cc = base.clear_conversation
    setClearConvEnabled(safeBoolean(cc?.enabled))
    setClearConvHours(safeNumber(cc?.max_age_hours, 2))
    const st = base.scheduled_test
    setStEnabled(safeBoolean(st?.enabled))
    const stUnit = safeString(st?.frequency_unit) as 'daily' | 'minutes' | 'hours'
    setStFreqUnit(stUnit === 'daily' || stUnit === 'hours' ? stUnit : 'minutes')
    setStFreqValue(safeNumber(st?.frequency_value, 30))
    setStAccounts(Array.isArray(st?.accounts) ? st!.accounts!.filter((u) => typeof u === 'string') : [])
    setStAccountFilter(st?.account_filter === 'available' || st?.account_filter === 'unavailable' ? st.account_filter : 'unavailable')
    setStRetainFailedLogs(st?.retain_failed_logs !== false)
    const configuredModels = Array.isArray(st?.test_models) ? st.test_models.filter((m) => typeof m === 'string' && m) : []
    setStTestModels(configuredModels.length > 0 ? configuredModels : (safeString(st?.test_model) ? [safeString(st?.test_model)] : []))
    setStTestType(safeString(st?.test_type) || 'chat')
    const stClient = safeString(st?.client_type) as AccountTestClientType
    setStClientType(['none', 'claude-code', 'codex-cli', 'codex-tui', 'codex-openai', 'opencode', 'workbuddy'].includes(stClient) ? stClient : 'none')
    setStProtocol(safeString(st?.protocol))
    setTemplateMeta(templateMode ? templateMetaFromManifest(templateManifest as Record<string, any> | null) : emptyTemplateMeta())
    setExtraRetryStatusCodesText((preset?.extra_retry_status_codes || []).join(', '))
    setTemplateWarnings(preset?.template_warnings || [])
    setModels((preset?.models || []).map((m) => buildUpstreamModelRow(m)))
    setModelsLoadState('ok')
    const initialProtocols = presetProtocols.length > 0
      ? presetProtocols
      : [buildChatProtocolRow(proto, base.chat_path || undefined)]
    setChatProtocols(initialProtocols)
    setExpandedChatProtocols(new Set(initialProtocols.map((_, index) => index)))
    setCreateAccounts(preset?.accounts?.map((a) => ({ username: a.username || '', api_key: a.api_key || '', account_id: a.username || '', proxy: '', priority: 0, weight: 1 })) || [emptyCreateAccount()])
    const policy = defaultLimitPolicy(safeString(preset?.remark).trim() || 'new-provider')
    if (preset?.freeze_policy) {
      // 复制/模板预设显式带了冻结策略 → 以预设为准（用户/模板的明确选择优先于全局默认）。
      policy.freeze_policy = {
        enabled: preset.freeze_policy.enabled !== false,
        rules: Array.isArray(preset.freeze_policy.rules)
          ? preset.freeze_policy.rules.map((rule) => normalizeFreezeRuleInput(rule as Record<string, any>))
          : [],
      }
      setLimitPolicy(policy)
      setFreezePolicyEnabled(safeBoolean(policy.freeze_policy?.enabled))
      setFreezeRules(policy.freeze_policy?.rules.map((r) => ({ ...r })) || [])
    } else {
      // 无预设：先用前端硬编码兜底填上，再异步拉全局「新增渠道默认冻结策略」覆盖。
      // 后端 create_custom_provider 已会落一份同样口径的快照行；这里让弹窗草稿
      // 与之一致，免得二步保存把后端快照改回硬编码默认。
      setLimitPolicy(policy)
      setFreezePolicyEnabled(safeBoolean(policy.freeze_policy?.enabled))
      setFreezeRules(policy.freeze_policy?.rules.map((r) => ({ ...r })) || [])
      getChannelTabConfig()
        .then((cfg) => {
          const fp = cfg?.default_freeze_policy
          if (!fp) return
          const rules = Array.isArray(fp.rules) ? fp.rules.map((r) => normalizeFreezeRuleInput(r as Record<string, any>)) : []
          setFreezePolicyEnabled(fp.enabled !== false)
          setFreezeRules(rules)
          setLimitPolicy((prev) => prev ? { ...prev, freeze_policy: { enabled: fp.enabled !== false, rules } } : prev)
        })
        .catch(() => { /* 拉全局默认失败：保留前端硬编码兜底，创建仍可进行 */ })
    }
    getHeaderTemplates().then(setHeaderTemplates).catch(() => setHeaderTemplates([]))
    getModelRuleTemplates().then(setModelRuleTemplates).catch(() => setModelRuleTemplates([]))
    getProxies().then(setProxies).catch(() => setProxies([]))
  }, [open, createBuiltinType, presetData, presetFromCatalog, templateMode, templateManifest])

  const loadData = useCallback(async () => {
    if (isCreate) {
      initCreate()
      return
    }
    if (!resolvedId) return
    setLoading(true)
    // create 刚落库后由 createdId 触发的这次统一重载要保留「冻结策略二步保存失败」提示，
    // 否则用户刚收到的错误会被立刻冲掉。
    if (!createdId) setError(null)
    try {
      const base = await getProviderDetail(resolvedId)
      // 路径不应为空：后端落库可能为空，前端按协议默认值预填，保证编辑态可见、保存即落库
      const defs = getProtocolDefaultPaths(safeString(base.protocol) || 'openai')
      setDetail({
        ...base,
        tags: normalizeProviderTags(base.tags),
        chat_path: safeString(base.chat_path).trim() || defs.chat_path,
        models_path: safeString(base.models_path).trim() || defs.models_path,
        image_path: safeString(base.image_path).trim() || defs.image_path,
        video_path: safeString(base.video_path).trim() || defs.video_path,
      })
      // 对话协议行：优先用 chat_protocols；旧 endpoint_configs（含 kind=chat 行）也会被后端镜像过来
      const protocols = Array.isArray(base.chat_protocols) && base.chat_protocols.length > 0
        ? base.chat_protocols
        : (Array.isArray(base.endpoint_configs) ? base.endpoint_configs : [])
      setChatProtocols(protocols.map((p) => ({
        id: safeString(p.id),
        enabled: p.enabled !== false,
        protocol: safeString(p.protocol) || 'openai',
        path: safeString(p.path),
        upstream_stream: normalizeUpstreamStream(p.upstream_stream),
        client_preset: safeString(p.client_preset) || 'none',
        header_template: safeString(p.header_template),
        system_type: safeString(p.system_type) || 'auto',
        send_reasoning_content: p.send_reasoning_content !== false,
        models: Array.isArray(p.models) ? p.models.map(String) : [],
      })))
      const initialModelRows = Array.isArray(base.model_rows)
        ? base.model_rows.map((model) => buildModelRow(model))
        : []
      setModels(initialModelRows)
      // init edit state
      setEnabled(safeBoolean(base.enabled))
      setRemarkText(safeString(base.remark))
      const cc = base.clear_conversation
      setClearConvEnabled(safeBoolean(cc?.enabled))
      setClearConvHours(safeNumber(cc?.max_age_hours, 2))
      const st = base.scheduled_test
      setStEnabled(safeBoolean(st?.enabled))
      const stUnit = safeString(st?.frequency_unit) as 'daily' | 'minutes' | 'hours'
      setStFreqUnit(stUnit === 'daily' || stUnit === 'hours' ? stUnit : 'minutes')
      setStFreqValue(safeNumber(st?.frequency_value, 30))
      setStAccounts(Array.isArray(st?.accounts) ? st!.accounts!.filter((u) => typeof u === 'string') : [])
      setStAccountFilter(st?.account_filter === 'available' || st?.account_filter === 'unavailable' ? st.account_filter : 'unavailable')
      setStRetainFailedLogs(st?.retain_failed_logs !== false)
      const configuredModels = Array.isArray(st?.test_models) ? st.test_models.filter((m) => typeof m === 'string' && m) : []
      setStTestModels(configuredModels.length > 0 ? configuredModels : (safeString(st?.test_model) ? [safeString(st?.test_model)] : []))
      setStTestType(safeString(st?.test_type) || 'chat')
      const stClient = safeString(st?.client_type) as AccountTestClientType
      setStClientType(['none', 'claude-code', 'codex-cli', 'codex-tui', 'codex-openai', 'opencode', 'workbuddy'].includes(stClient) ? stClient : 'none')
      setStProtocol(safeString(st?.protocol))
      const extraRetryStatusCodes = Array.isArray(base.extra_retry_status_codes)
        ? base.extra_retry_status_codes.filter((code) => Number.isInteger(code) && code >= 100 && code <= 599)
        : []
      setExtraRetryStatusCodesText(extraRetryStatusCodes.join(', '))

      // header 模板库 / 模型规则模版库（均为系统配置）
      getHeaderTemplates().then(setHeaderTemplates).catch(() => setHeaderTemplates([]))
      getModelRuleTemplates().then(setModelRuleTemplates).catch(() => setModelRuleTemplates([]))

      // load models and policy independently
      setModelsLoadState('loading')
      setLimitPolicyLoading(true)
      getProviderModels(resolvedId)
        .then((providerModels) => {
          setModels(providerModels.map((item) => buildModelRow(item)))
          setModelsLoadState('ok')
        })
        .catch((err) => {
          setModelsLoadState('failed')
          setError(err instanceof Error ? err.message : '模型列表加载失败')
        })
      getProviderLimitPolicy(resolvedId)
        .then((policy) => {
          setLimitPolicy(policy)
          setFreezePolicyEnabled(safeBoolean(policy.freeze_policy?.enabled))
          setFreezeRefreshOnFailure(policy.freeze_policy?.refresh_freeze_on_failure !== false)
          setFreezeRules(
            Array.isArray(policy.freeze_policy?.rules)
              ? policy.freeze_policy.rules.map((r) => normalizeFreezeRuleInput(r as Record<string, any>))
              : []
          )
        })
        .catch(() => setLimitPolicy(defaultLimitPolicy(resolvedId)))
        .finally(() => setLimitPolicyLoading(false))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载详情失败')
    } finally {
      setLoading(false)
    }
  }, [isCreate, initCreate, resolvedId, createdId])

  // 打开/关闭：重置 tab 与清理状态。与数据加载分开，避免 create 落库后
  // resolvedId 变化触发的重载把用户所在 tab 冲回基础配置。
  useEffect(() => {
    if (open) {
      // 模板模式默认停在「模板信息」Tab：先填元信息再配渠道。
      setActiveTab(templateMode ? 'meta' : 'basic')
      // 弹窗常驻挂载：每次打开都强制折叠定时检测面板，避免上一轮展开态泄漏到新增/编辑。
      setScheduledTestExpanded(false)
    } else {
      setDetail(null)
      setModels([])
      setLimitPolicy(null)
      setError(null)
      setEnabled(false)
      setRemarkText('')
      setClearConvEnabled(false)
      setClearConvHours(2)
      setStEnabled(false)
      setStFreqUnit('minutes')
      setStFreqValue(30)
      setStAccounts([])
      setStAccountFilter('unavailable')
      setStTestModels([])
      setStTestType('chat')
      setStClientType('none')
      setStProtocol('')
      setStRetainFailedLogs(true)
      setScheduledTestExpanded(false)
      setExtraRetryStatusCodesText('')
      setTemplateWarnings([])
      setFreezePolicyEnabled(true)
      setFreezeRules([])
      setFreezeRefreshOnFailure(true)
      setUpstreamSelectMode(false)
      setUpstreamDraftModels([])
      setUpstreamSelected(new Set())
      setUpstreamSearch('')
      setCreatedId(null)
      setCreateAccounts([])
    }
  }, [open, initialTab])

  // 数据加载：resolvedId 变化（含 create 落库后 createdId 接管）时按同一路径重载。
  useEffect(() => {
    if (!open) return
    void loadData()
  }, [open, loadData])

  const enabledChatProtocols = chatProtocols.filter((p) => p.enabled !== false)
  const chatProtocolsError = chatProtocols.length === 0
    ? '未配置对话协议：至少添加一条 chat_protocols 协议行才能保存'
    : (enabledChatProtocols.length === 0 ? '所有协议行均被禁用：至少启用一条对话协议行' : '')

  const compactChatProtocols = (): ChatProtocolConfig[] => chatProtocols.map((p) => {
    const row: ChatProtocolConfig = {
      id: safeString(p.id),
      enabled: p.enabled !== false,
      protocol: safeString(p.protocol) || 'openai',
      path: safeString(p.path),
      upstream_stream: normalizeUpstreamStream(p.upstream_stream),
      client_preset: safeString(p.client_preset) || 'none',
      system_type: safeString(p.system_type) || 'auto',
      send_reasoning_content: p.send_reasoning_content !== false,
      models: Array.isArray(p.models) ? p.models.map(String).filter(Boolean) : [],
    }
    // header_template 仅在有值时才带：渠道模板 manifest 禁止携带空 header_template 键
    // （validator 按 key 名拦截，与值无关），与服务端 _protocol_rows 口径一致。
    const ht = safeString(p.header_template)
    if (ht) row.header_template = ht
    return row
  })

  // 切换某条协议行的协议：该行的 path 按默认值追随（见 updateChatProtocolProtocol），
  // 同时若这一行是主协议行，渠道级 models_path 也跟着走新协议默认值（gemini 是 /v1beta/models）。
  const changeChatProtocol = (index: number, protocol: string) => {
    const nextRows = chatProtocols.map((c, i) => i === index ? updateChatProtocolProtocol(c, protocol) : c)
    setChatProtocols(nextRows)
    const nextPrimary = primaryChatProtocol(nextRows)
    if (nextPrimary && nextPrimary === nextRows[index]) {
      const nextModelsPath = getProtocolDefaultPaths(nextPrimary.protocol).models_path
      setDetail((d) => (d && isProtocolDefaultModelsPath(d.models_path) ? { ...d, models_path: nextModelsPath } : d))
    }
  }

  const buildCreateAccountsPayload = () => {
    const saveAuthMode = getChannelAuthMode(createBuiltinType, createBuiltinType)
    if (saveAuthMode === 'device_auth') return []
    const hasCred = (a: { api_key: string; username: string }) => a.api_key.trim() || (saveAuthMode === 'cloudflare' && a.username.trim()) || (saveAuthMode === 'manual_values' && a.username.trim())
    return createAccounts.filter(hasCred).map((a, i) => {
      const username = a.username.trim() || `key-${i + 1}`
      const base: Record<string, unknown> = {
        username,
        ...(a.proxy.trim() ? { proxy: a.proxy.trim() } : {}),
        priority: a.priority,
        weight: a.weight,
      }
      if (saveAuthMode === 'password_login' || saveAuthMode === 'schema') {
        base.password = a.api_key.trim()
      } else if (saveAuthMode === 'cloudflare') {
        base.api_key = a.api_key.trim()
        base.account_id = a.username.trim()
      } else {
        base.api_key = a.api_key.trim()
      }
      return base
    })
  }

  const handleSave = async () => {
    if (!detail || !limitPolicy) return
    if (chatProtocolsError) {
      setActiveTab('config')
      setError(chatProtocolsError)
      return
    }
    if (!remarkText.trim()) {
      setError('渠道名称不能为空')
      setActiveTab('basic')
      return
    }
    if (isCreate && protocolEditorEnabled && createBuiltinType !== 'code' && !safeString(detail.base_url).trim()) {
      setError('渠道地址不能为空')
      setActiveTab('config')
      return
    }
    // 渠道地址仍以 /v1 结尾、且模型列表路径以 /v1 开头时，拼出的模型列表 URL 会出现 /v1/v1/models 这类重复前缀。
    // 拦截并提醒，用户确认后按其填写放行。
    if (protocolEditorEnabled) {
      const baseUrlForCheck = safeString(detail.base_url).trim()
      const modelsPathForCheck = safeString(detail.models_path).trim()
      if (baseUrlForCheck && modelsPathForCheck && /\/v1\/?$/i.test(baseUrlForCheck) && /^\/v1(\/|$)/i.test(modelsPathForCheck)) {
        const ok = window.confirm(
          `渠道地址「${baseUrlForCheck}」以 /v1 结尾，模型列表路径「${modelsPathForCheck}」又以 /v1 开头，`
          + `拼出的模型列表 URL 会变成 ${baseUrlForCheck.replace(/\/$/, '')}${modelsPathForCheck}（重复 /v1）。\n\n确定仍要这样保存吗？`
        )
        if (!ok) {
          setActiveTab('config')
          return
        }
      }
    }
    // 代码渠道：源码必须非空，否则后端 _get_provider_class 会静默回落 CustomProvider。
    if (isCreate && createBuiltinType === 'code' && !safeString(detail.code).trim()) {
      setError('请粘贴渠道源码（一个 spec 类：普通类 + @staticmethod 钩子）')
      setActiveTab('code')
      return
    }
    // 模板没有账号这一层，跳过「至少一个 API Key」校验。
    if (!templateMode && isCreate && isCustom && buildCreateAccountsPayload().length === 0) {
      setError('请先在账号管理中填写至少一个 API Key')
      setActiveTab('accounts')
      return
    }
    const retryCodeTokens = extraRetryStatusCodesText
      .split(/[,，\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
    const invalidRetryCode = retryCodeTokens.find((value) => {
      const code = Number(value)
      return !/^\d+$/.test(value) || !Number.isInteger(code) || code < 100 || code > 599
    })
    if (invalidRetryCode) {
      setError(`额外请求重试状态码无效：${invalidRetryCode}（需为 100-599 的整数）`)
      setActiveTab('config')
      return
    }
    const extraRetryStatusCodes = Array.from(new Set(retryCodeTokens.map(Number))).sort((a, b) => a - b)
    setSaving(true)
    setError(null)
    try {
      if (templateMode) {
        // 模板模式：不落 provider，把表单组装成市场 manifest 交给父层 upsert 到 GitHub。
        const slug = (templateMeta.name || remarkText).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '')
        if (!slug) {
          setError('模板标识（Name）不能为空')
          setActiveTab('meta')
          setSaving(false)
          return
        }
        const manifest: Record<string, unknown> = {
          schema: CHANNEL_TEMPLATE_SCHEMA,
          id: templateMeta.id.trim() || `local.${slug}`,
          kind: 'channel_template',
          name: slug,
          display_name: templateMeta.display_name.trim() || remarkText.trim() || slug,
          summary: templateMeta.summary.trim() || `渠道模板「${remarkText.trim() || slug}」`,
          publisher: templateMeta.publisher.trim() || 'local-ai-lubricant',
          category: templateMeta.category.trim() || 'custom',
          tags: templateMeta.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
          version: templateMeta.version.trim() || '1.0.0',
          status: templateMeta.status || 'published',
          ...(templateMeta.icon ? { icon: templateMeta.icon } : {}),
          resource: {
            type: 'channel_template',
            channel: {
              name: templateMeta.display_name.trim() || remarkText.trim() || slug,
              enabled,
              base_url: safeString(detail.base_url).trim(),
              billing_mode: detail.billing_mode === 'request' ? 'request' : 'token',
              timeout: safeNumber(detail.timeout, 120),
              retry_count: detail.retry_count ?? null,
              extra_retry_status_codes: extraRetryStatusCodes,
              chat_protocols: compactChatProtocols(),
              models_path: safeString(detail.models_path).trim(),
              image_path: safeString(detail.image_path).trim(),
              video_path: safeString(detail.video_path).trim(),
              speech_path: safeString(detail.speech_path).trim(),
              website_url: safeString(detail.website_url).trim(),
              rate_limit: { ...(detail.rate_limit ?? {}) },
              auto_update_models: safeBoolean(detail.auto_update_models),
              model_id_rewrite_rules: normalizeModelIdRewriteRules(detail.model_id_rewrite_rules),
            },
            freeze_policy: { enabled: freezePolicyEnabled, refresh_freeze_on_failure: freezeRefreshOnFailure, rules: freezeRules },
          },
        }
        await onSaveTemplate?.(manifest)
        setSaveNotice('渠道模板已保存到市场仓库。')
        setSaving(false)
        return
      }
      if (isCreate) {
        // 新增态：先创建渠道拿 id（后端即 name）
        const res = await createCustomProvider({
          builtin_type: createBuiltinType || undefined,
          remark: remarkText.trim(),
          tags: normalizeProviderTags(detail.tags),
          enabled,
          website_url: safeString(detail.website_url).trim() || undefined,
          icon: safeString(detail.icon).trim() || undefined,
          // 代码渠道的 Provider 源码必须顶层发送，不进 protocolEditorEnabled 条件块。
          code: createBuiltinType === 'code' ? safeString(detail.code) : undefined,
          ...(protocolEditorEnabled ? {
            base_url: safeString(detail.base_url).trim(),
            chat_protocols: compactChatProtocols(),
            models_path: safeString(detail.models_path).trim() || undefined,
            image_path: safeString(detail.image_path).trim() || undefined,
            video_path: safeString(detail.video_path).trim() || undefined,
            speech_path: safeString(detail.speech_path).trim() || undefined,
          } : {}),
          timeout: safeNumber(detail.timeout, 120),
          retry_count: detail.retry_count ?? null,
          extra_retry_status_codes: extraRetryStatusCodes,
          rate_limit: { ...(detail.rate_limit ?? {}) },
          billing_mode: detail.billing_mode === 'request' ? 'request' : 'token',
          auto_update_models: safeBoolean(detail.auto_update_models),
          model_id_rewrite_rules: normalizeModelIdRewriteRules(detail.model_id_rewrite_rules),
          account_priority: safeNumber(detail.account_priority),
          account_weight: safeNumber(detail.account_weight),
          clear_conversation: { enabled: clearConvEnabled, max_age_hours: clearConvHours },
          accounts: buildCreateAccountsPayload(),
          models: models.map((row) => compactProviderModelRow(row)).filter((row) => row.upstream_model_id),
          // 能力开关 / 健康检查 / 定时检测：新增态也要落库，否则用户在创建时配的定时检测会丢。
          // 后端 _custom_provider_config_from_payload 已支持这几个字段。
          supports_image_generation: safeBoolean(detail.supports_image_generation),
          supports_video_generation: safeBoolean(detail.supports_video_generation),
          supports_tts: safeBoolean(detail.supports_tts),
          health_check: detail.health_check,
          scheduled_test: {
            enabled: stEnabled,
            frequency_unit: stFreqUnit,
            frequency_value: stFreqUnit === 'daily' ? 0 : stFreqValue,
            accounts: stAccounts.length > 0 ? stAccounts : undefined,
            test_type: stTestType || undefined,
            client_type: stClientType && stClientType !== 'none' ? stClientType : undefined,
            protocol: stProtocol || undefined,
            test_models: stTestModels.length > 0 ? stTestModels : undefined,
            test_model: stTestModels[0] || undefined,
            account_filter: stAccountFilter,
            retain_failed_logs: stRetainFailedLogs,
          },
        })
        const name = res.name
        // 二步保存冻结策略
        const nextPolicy: ProviderLimitPolicy = {
          ...limitPolicy,
          provider_name: name,
          name: limitPolicy.name || 'default',
          enabled: enabled || safeBoolean(limitPolicy.enabled),
          account_rpm: safeNumber(limitPolicy.account_rpm),
          account_tpm: safeNumber(limitPolicy.account_tpm),
          model_tpm: safeNumber(limitPolicy.model_tpm),
          account_concurrent: safeNumber(limitPolicy.account_concurrent),
          account_rph: safeNumber(limitPolicy.account_rph),
          account_tph: safeNumber(limitPolicy.account_tph),
          account_rpd: safeNumber(limitPolicy.account_rpd),
          account_tpd: safeNumber(limitPolicy.account_tpd),
          cooldown_policy: {},
          freeze_policy: {
            enabled: freezePolicyEnabled,
            refresh_freeze_on_failure: freezeRefreshOnFailure,
            rules: freezeRules,
          },
        }
        let policyError: string | null = null
        try {
          await updateProviderLimitPolicy(name, nextPolicy)
        } catch (err) {
          policyError = `渠道已创建（${name}），但冻结策略保存失败：${err instanceof Error ? err.message : '未知错误'}。可再次点击保存重试冻结策略。`
        }
        // 渠道已落库：createdId 接管后弹窗即视同 edit 态，
        // 走与普通编辑完全相同的加载流程，用服务端返回重渲染整个弹窗。
        setCreatedId(name)
        onChanged?.({ type: 'created', id: name })
        if (policyError) {
          setError(policyError)
        } else {
          setSaveNotice(`渠道「${remarkText.trim()}」已创建，可继续添加账号。`)
          setActiveTab('accounts')
        }
        return
      }

      // 编辑态
      if (!resolvedId) return
      if (detail && enabled !== detail.enabled) {
        await updateProviderEnabled(resolvedId, enabled)
      }

      const nextRateLimit = detail.rate_limit ?? {}

      // 旧渠道第一次编辑保存时，website_url 为空则从渠道地址提取 origin 落库。
      // 只在本次 payload 生成时兜底；读取侧不回填，之后已有值会保持用户设置。
      const websiteUrl = safeString(detail.website_url).trim() || (() => {
        const raw = safeString(detail.base_url).trim()
        if (!raw) return ''
        try {
          return new URL(raw.match(/^https?:\/\//i) ? raw : `https://${raw}`).origin
        } catch {
          return ''
        }
      })()
      const customPayload: Record<string, unknown> = {
        remark: remarkText.trim(),
        tags: normalizeProviderTags(detail.tags),
        base_url: detail.base_url,
        website_url: websiteUrl,
        icon: safeString(detail.icon).trim(),
        // 代码渠道源码：改 code 会触发后端完整重载（admin update_custom_provider
        // 在 code 变更 + builtin_type=='code' 时走 _load_provider_runtime 换类）。
        ...(detail.builtin_type === 'code' ? { code: safeString(detail.code) } : {}),
        chat_path: detail.chat_path,
        models_path: detail.models_path,
        image_path: detail.image_path,
        video_path: detail.video_path,
        speech_path: detail.speech_path,
        chat_protocols: chatProtocols,
        supports_image_generation: detail.supports_image_generation,
        supports_video_generation: detail.supports_video_generation,
        supports_tts: detail.supports_tts,
        account_priority: safeNumber(detail.account_priority),
        account_weight: safeNumber(detail.account_weight),
        auto_update_models: safeBoolean(detail.auto_update_models),
        model_id_rewrite_rules: normalizeModelIdRewriteRules(detail.model_id_rewrite_rules),
        timeout: safeNumber(detail.timeout, 120),
        retry_count: detail.retry_count ?? null,
        extra_retry_status_codes: extraRetryStatusCodes,
        billing_mode: detail.billing_mode || 'token',
        balance: detail.balance ?? {},
        rate_limit: nextRateLimit,
        health_check: detail.health_check,
        scheduled_test: {
          enabled: stEnabled,
          frequency_unit: stFreqUnit,
          frequency_value: stFreqUnit === 'daily' ? 0 : stFreqValue,
          accounts: stAccounts.length > 0 ? stAccounts : undefined,
          test_type: stTestType || undefined,
          client_type: stClientType && stClientType !== 'none' ? stClientType : undefined,
          protocol: stProtocol || undefined,
          test_models: stTestModels.length > 0 ? stTestModels : undefined,
          test_model: stTestModels[0] || undefined,
          account_filter: stAccountFilter,
          retain_failed_logs: stRetainFailedLogs,
        },
        clear_conversation: { enabled: clearConvEnabled, max_age_hours: clearConvHours },
      }

      await updateProviderCustomConfig(resolvedId, customPayload)

      // 仅当模型列表已权威加载完成时才回写模型表；加载未完成/失败时不调用模型保存接口，
      // 避免旧后端把缺失 models 字段误报为“models 必须是数组”。
      if (modelsLoadState === 'ok') {
        const nextModels = models
          .map((row) => compactProviderModelRow(row))
          .filter((row) => row.upstream_model_id)
        await replaceProviderModels(resolvedId, nextModels)
      }

      const nextPolicy: ProviderLimitPolicy = {
        ...limitPolicy,
        enabled: enabled || safeBoolean(limitPolicy.enabled),
        account_rpm: safeNumber(limitPolicy.account_rpm),
        account_tpm: safeNumber(limitPolicy.account_tpm),
        model_tpm: safeNumber(limitPolicy.model_tpm),
        account_concurrent: safeNumber(limitPolicy.account_concurrent),
        account_rph: safeNumber(limitPolicy.account_rph),
        account_tph: safeNumber(limitPolicy.account_tph),
        account_rpd: safeNumber(limitPolicy.account_rpd),
        account_tpd: safeNumber(limitPolicy.account_tpd),
        cooldown_policy: {},
        freeze_policy: {
          enabled: freezePolicyEnabled,
          refresh_freeze_on_failure: freezeRefreshOnFailure,
          rules: freezeRules,
        },
      }
      await updateProviderLimitPolicy(resolvedId, nextPolicy)

      // 保存成功后不关闭弹框：通知父页面刷新并给出成功提示，用户可继续在当前 Tab 编辑。
      onChanged?.({ type: 'saved', id: resolvedId })
      setSaveNotice('已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 删除是弹窗自身的能力：只要有 id 就能删，不依赖父页面注入回调。
  const handleDeleteProvider = () => {
    if (!resolvedId) return
    setDeleteConfirmOpen(true)
  }

  // AccountsTab 的编辑态上报回调：只写 ref 不写 state，避免每次进出表单都重渲染整个弹框。
  const handleAccountEditingChange = useCallback((editing: boolean) => {
    accountEditInProgressRef.current = editing
  }, [])

  // 编辑中的账号表单存在时，拦截「会丢弃表单」的动作（关弹框 / 切 Tab），先弹确认。
  const guardAccountEditDiscard = (action: () => void) => {
    if (accountEditInProgressRef.current) {
      pendingDiscardActionRef.current = action
      setDiscardAccountEditOpen(true)
      return
    }
    action()
  }

  const confirmDiscardAccountEdit = () => {
    const action = pendingDiscardActionRef.current
    pendingDiscardActionRef.current = null
    setDiscardAccountEditOpen(false)
    action?.()
  }

  const cancelDiscardAccountEdit = () => {
    pendingDiscardActionRef.current = null
    setDiscardAccountEditOpen(false)
  }

  const confirmDeleteProvider = async () => {
    if (!resolvedId) return
    setDeleting(true)
    try {
      await deleteProvider(resolvedId)
      onChanged?.({ type: 'deleted', id: resolvedId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除渠道失败')
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  const handleFetchUpstreamModels = async () => {
    // 渠道已落库（含 create 落库后）即可拉取上游模型。
    const targetId = resolvedId
    if (!targetId) {
      // 渠道尚未落库：获取上游模型需要一个已存在的渠道地址/凭据，先点保存创建渠道。
      setError('请先点击「保存」创建渠道，然后即可获取上游模型。')
      return
    }
    setLoadingUpstreamModels(true)
    try {
      const data = await getProviderUpstreamModels(targetId)
      const rawList = Array.isArray(data.upstream_models) ? data.upstream_models : []
      const existingByUpstream = new Map<string, ProviderModelEntry>()
      models.forEach((model) => {
        const upstream = safeString(model.upstream_model_id).trim()
        if (upstream) existingByUpstream.set(upstream, model)
      })
      const list = rawList
        .map((item) => {
          const row = buildUpstreamModelRow(item)
          const upstream = safeString(row.upstream_model_id).trim()
          const existing = upstream ? existingByUpstream.get(upstream) : undefined
          if (!existing) return row
          return {
            ...row,
            model_id: safeString(existing.model_id).trim() || safeString(row.model_id).trim(),
            extra_config: existing.extra_config,
          }
        })
        .filter((item) => safeString(item.upstream_model_id).trim())
      if (list.length === 0) {
        window.alert(rawList.length === 0 ? '上游返回了 0 个模型' : '未能解析上游模型列表')
        return
      }
      // 默认勾选规则：
      // - 渠道已有模型 → 只勾当前已存在的上游模型（原行为）。
      // - 模型列表为空 → 只勾满足过滤规则（is_regex=true）的行；规则没命中任何行时
      //   一个都不勾，不做「无命中就默认全选」的兜底——全选交给用户手动点。
      const existingKeys = new Set(models.map((m) => safeString(m.upstream_model_id).trim()).filter(Boolean))
      const selectedKeys = new Set(
        list
          .map((item, index) => ({ key: modelDraftKey(item, index), upstream: safeString(item.upstream_model_id).trim(), matched: item.is_regex === true }))
          .filter(({ upstream, matched }) => (models.length > 0 ? existingKeys.has(upstream) : matched))
          .map(({ key }) => key)
      )
      setUpstreamDraftModels(list)
      setUpstreamSelected(selectedKeys)
      setUpstreamSearch('')
      setUpstreamSelectMode(true)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '拉取上游模型失败')
    } finally {
      setLoadingUpstreamModels(false)
    }
  }

  // 获取上游模型预览开关：开 = 预显示自动更新后的结果（只显示满足规则 is_regex=true
  // 的行，model_id 列显示改名后的名字）；关 = 显示全部行 + 原始上游名。
  // 纯显示切换，不改 model_id、不改勾选、不重新拉取——开关关掉也不影响定时更新
  // 按规则过滤改名，那由后端 refresh_models 决定，跟这个开关无关。
  const previewRewriteToggle = (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text2)', cursor: 'pointer' }} title="仅预览自动更新后的样子；开关不影响定时更新是否按规则生效">
      <input type="checkbox" checked={previewApplyRewrite} onChange={(e) => setPreviewApplyRewrite(e.target.checked)} />
      预览过滤结果<span style={{ opacity: 0.6 }}>（仅显示，不影响生效）</span>
    </label>
  )

  const handleRefreshModels = async () => {
    const targetId = resolvedId
    if (!targetId) return
    setSaving(true)
    try {
      await refreshProviderModels(targetId)
      const nextModels = await getProviderModels(targetId)
      setModels(nextModels.map((item) => buildModelRow(item)))
      setModelsLoadState('ok')
    } catch (err) {
      setModelsLoadState('failed')
      setError(err instanceof Error ? err.message : '刷新模型失败')
    } finally {
      setSaving(false)
    }
  }

  const runDetect = async (upstreamModelId: string, windowTokens: number, username: string) => {
    const targetId = resolvedId
    if (!targetId || !upstreamModelId || !Number.isInteger(windowTokens) || windowTokens < 1000 || windowTokens > 1000000) return
    setDetectLoading(true)
    setDetectResult(null)
    setDetectModelLabel(upstreamModelId)
    try {
      const resp = await detectModel(targetId, {
        upstream_model_id: upstreamModelId,
        window_tokens: windowTokens,
        username: username || undefined,
      })
      setDetectResult(resp.results?.[0] ?? null)
    } catch (err) {
      setDetectResult({
        username: username || '',
        ok: false,
        target_tokens: windowTokens,
        error_message: err instanceof Error ? err.message : '窗口真实大小测试失败',
        duration_ms: 0,
      })
    } finally {
      setDetectLoading(false)
    }
  }

  const handleDetectRealModel = async (row: ProviderModelEntry) => {
    const upstream = safeString(row.upstream_model_id).trim()
    if (!upstream) return
    // 先打开弹窗、拉取账号列表让用户选择，不立即探测
    setDetectModelLabel(upstream)
    setDetectResult(null)
    setDetectOpen(true)
    const targetId = resolvedId
    if (!targetId) return
    try {
      const list = await getProviderAccounts(targetId, { view: 'lite' })
      setDetectAccounts(list || [])
      setDetectUsername((prev) => (prev && (list || []).some((a) => a.username === prev)) ? prev : ((list && list[0]?.username) || ''))
    } catch {
      setDetectAccounts([])
      setDetectUsername('')
    }
  }

  // 模板模式隐藏账号/统计/测试：模板只保存可移植配置，没有账号也没有运行数据。
  // 代码渠道：源码是核心，单开一个 Tab，创建/编辑态都紧跟基础配置之后。
  const isCodeChannel = createBuiltinType === 'code' || detail?.builtin_type === 'code'
  const tabs: Array<{ key: ProviderTab; label: string }> = [
    ...(templateMode ? [{ key: 'meta' as ProviderTab, label: '模板信息' }] : []),
    { key: 'basic', label: '基础配置' },
    ...(isCodeChannel ? [{ key: 'code' as ProviderTab, label: '源码' }] : []),
    ...((isCustom || protocolEditorEnabled) ? [{ key: 'config' as ProviderTab, label: '协议' }] : []),
    { key: 'models', label: '模型列表' },
    { key: 'limits', label: '冻结策略' },
    ...(templateMode ? [] : [
      { key: 'accounts' as ProviderTab, label: '账号管理' },
      { key: 'stats' as ProviderTab, label: '数据统计' },
      { key: 'test' as ProviderTab, label: '测试' },
    ]),
  ]

  const title = templateMode
    ? (templateManifest ? '编辑渠道模板' : '新建渠道模板')
    : (detail?.remark || detail?.name || (isCreate ? '新建渠道' : '渠道'))
  // 仅使用渠道显式配置的跳转地址；未配置时不显示外链入口。
  const modalWebsiteUrl = safeString(detail?.website_url).trim() || undefined
  // 开关的作用：预显示自动更新后库里到底是什么样子。
  //   自动更新只保留满足规则（is_regex=true）的行，并替换成 regex_model_id；
  //   不满足的行不会进库。
  //   开 → 只显示 is_regex=true 的行，model_id 列显示替换后的 regex_model_id。
  //   关 → 显示全部行，model_id 列显示上游原始 raw_model_id。
  // 纯显示切换：不改 model_id、不改勾选、不重新拉取——草稿数据始终在内存里。
  // 没配规则时开关开了也不过滤（自动更新本来就不滤）；配了规则但一行没命中时
  // 照样滤成空列表——那就是自动更新后的真实结果，不再回退成「显示全部」把
  // 「规则不生效」糊弄过去。判定与后端 has_model_id_rewrite_rules 同源（展开后
  // 任一条启用即算配了规则，含「只搜索」规则）。
  const hasRewriteRules = expandModelIdRewriteRules(
    detail?.model_id_rewrite_rules ?? [],
    modelRuleTemplates,
  ).some((rule) => rule.enabled)
  const displayModelId = (row: ProviderModelEntry) =>
    previewApplyRewrite
      ? (safeString(row.regex_model_id).trim() || safeString(row.model_id).trim())
      : (safeString(row.raw_model_id).trim() || safeString(row.model_id).trim())
  const upstreamVisibleEntries = upstreamDraftModels
    .map((row, index) => ({ row: { ...row, _display_model_id: displayModelId(row) }, index }))
    .filter(({ row }) => !(previewApplyRewrite && hasRewriteRules && row.is_regex !== true))
    .filter(({ row }) => modelMatchesSearch(row, upstreamSearch))
  const upstreamVisibleKeys = upstreamVisibleEntries.map(({ row, index }) => modelDraftKey(row, index))
  const upstreamVisibleSelectedCount = upstreamVisibleKeys.filter((key) => upstreamSelected.has(key)).length
  const confirmUpstreamSelection = () => {
    const existingByUpstream = new Map<string, ProviderModelEntry>()
    models.forEach((model) => {
      const upstream = safeString(model.upstream_model_id).trim()
      if (upstream) existingByUpstream.set(upstream, model)
    })
    setModels(upstreamDraftModels
      // 导入只按勾选集走：开关是纯显示作用，不影响导入哪些行。
      // 过滤 is_regex 只在定时更新（refresh_models）里做，那是数据层的事。
      .filter((row, index) => upstreamSelected.has(modelDraftKey(row, index)))
      .map((row) => {
        const upstream = safeString(row.upstream_model_id).trim()
        const existing = upstream ? existingByUpstream.get(upstream) : undefined
        return compactProviderModelRow(existing ? { ...row, ...existing, upstream_model_id: upstream } : row)
      })
      .filter((row) => row.upstream_model_id))
    setUpstreamSelectMode(false)
    setUpstreamDraftModels([])
    setUpstreamSelected(new Set())
    setUpstreamSearch('')
  }
  const cancelUpstreamSelection = () => {
    setUpstreamSelectMode(false)
    setUpstreamDraftModels([])
    setUpstreamSelected(new Set())
    setUpstreamSearch('')
  }
  const setVisibleUpstreamSelection = (checked: boolean) => {
    setUpstreamSelected((prev) => {
      const next = new Set(prev)
      upstreamVisibleKeys.forEach((key) => checked ? next.add(key) : next.delete(key))
      return next
    })
  }

  return (
    <Modal
      open={open}
      titleIcon={isChannelIconConfigured(detail?.icon) ? (
        <div style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
          <ChannelIcon name={safeString(detail?.icon)} className="size-4" />
        </div>
      ) : undefined}
      title={`${title} - ${tabs.find((t) => t.key === activeTab)?.label ?? ''}`}
      titleExtra={modalWebsiteUrl ? (
        <button
          type="button"
          onClick={() => window.open(modalWebsiteUrl, '_blank', 'noopener,noreferrer')}
          style={{ ...btnGhost, padding: '6px', lineHeight: 0, flexShrink: 0 }}
          aria-label={`打开网站 ${modalWebsiteUrl}`}
          title={`打开网站 ${modalWebsiteUrl}`}
        >
          <ExternalLink style={{ ...btnIcon, margin: 0 }} />
        </button>
      ) : undefined}
      onClose={() => guardAccountEditDiscard(onClose)}
      maxWidth={1180}
      fixedHeight="88vh"
      contentOverflow="hidden"
      footer={
        <>
          {error && !loading && <div style={{ padding: '10px 14px', marginBottom: '12px', background: 'rgba(251, 113, 133, 0.1)', border: '1px solid var(--red)', borderRadius: 'var(--admin-radius)', fontSize: '14px', color: 'var(--red)' }}>{error}</div>}
          {saveNotice && !error && !loading && <div style={{ padding: '10px 14px', marginBottom: '12px', background: 'rgba(74, 222, 128, 0.1)', border: '1px solid var(--green)', borderRadius: 'var(--admin-radius)', fontSize: '14px', color: 'var(--green)' }}>{saveNotice}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            {resolvedId ? (
              <>
                <button
                  onClick={() => void handleDeleteProvider()}
                  disabled={deleting || saving || loading}
                  style={{ ...btnDanger, opacity: (deleting || saving || loading) ? 0.6 : 1 }}
                >
                  {deleting ? <RefreshCw style={btnIcon} /> : <Trash2 style={btnIcon} />}{deleting ? '删除中...' : '删除渠道'}
                </button>
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确定删除渠道「{remarkText.trim() || detail?.remark || resolvedId}」吗？</AlertDialogTitle>
                      <AlertDialogDescription>此操作不可恢复。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={deleting}
                        onClick={(e) => { e.preventDefault(); void confirmDeleteProvider() }}
                      >
                        {deleting ? '删除中...' : '删除'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (!templateMode && onBack) ? (
              <button onClick={onBack} disabled={saving} style={btnGhost}><ChevronLeft style={btnIcon} />返回选择</button>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { void loadData() }} disabled={loading || saving} style={btnGhost}><RefreshCw style={btnIcon} />{loading ? '刷新中...' : '刷新'}</button>
              <button onClick={() => guardAccountEditDiscard(onClose)} disabled={saving} style={btnGhost}><X style={btnIcon} />取消</button>
              <button onClick={() => void handleSave()} disabled={saving || loading} style={btnPrimary}><Check style={btnIcon} />{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', minHeight: 0 }}>
        {/* tab bar：tab 集由 detail（custom_channel/builtin_type）决定，detail 未到位时先占位，
            否则内置渠道会在首屏被当作自定义渠道闪现「协议」tab。
            tab 栏固定不滚动，滚动条只出现在下方 tab 内容区。 */}
        {!detail ? (
          <div style={{ flexShrink: 0, display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '6px', border: '1px solid var(--admin-border)', borderRadius: '14px', background: 'var(--bg2)', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
            {[72, 56, 72, 72, 72, 72, 48].map((w, i) => (
              <div key={i} style={{ width: w, height: 32, borderRadius: 'var(--admin-radius)', background: 'var(--admin-border)', opacity: 0.5 }} />
            ))}
          </div>
        ) : (
          <div style={{ flexShrink: 0, display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '6px', border: '1px solid var(--admin-border)', borderRadius: '14px', background: 'var(--bg2)', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  if (tab.key === activeTab) return
                  // 账号编辑态下切 Tab 会卸载表单，与关弹框同路：先确认丢弃。
                  guardAccountEditDiscard(() => { setActiveTab(tab.key); setSaveNotice(null); setError(null) })
                }}
                style={{
                  ...btnGhost,
                  height: '32px',
                  borderColor: activeTab === tab.key ? 'color-mix(in srgb, var(--blue) 45%, var(--admin-border))' : 'transparent',
                  color: activeTab === tab.key ? 'var(--blue)' : 'var(--text2)',
                  background: activeTab === tab.key ? 'color-mix(in srgb, var(--blue) 10%, var(--bg2))' : 'transparent',
                  boxShadow: activeTab === tab.key ? '0 2px 8px color-mix(in srgb, var(--blue) 12%, transparent)' : 'none',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* 源码 Tab 由编辑器自己占满高度并内部滚动，外层不能再滚（否则双滚动条）。 */}
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: activeTab === 'code' ? 'hidden' : 'auto', paddingRight: activeTab === 'code' ? 0 : '4px' }}>
        {loading ? (
          <div style={{ color: 'var(--text2)', padding: '24px 0', fontSize: '14px' }}>正在加载...</div>
        ) : !detail ? (
          <div style={{ color: 'var(--red)', padding: '16px 0' }}>
            <div style={{ fontSize: '14px' }}>{error || '数据不可用'}</div>
            <button onClick={() => void loadData()} style={{ ...btnGhost, marginTop: '12px' }}>重试</button>
          </div>
        ) : (
          <>
            {/* 模板信息：独立 Tab，模板模式才出现。先填元信息再配渠道。 */}
            {templateMode && activeTab === 'meta' && (
              <SectionBlock title="模板信息">
                <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>模板标识（Name）</label>
                    <input value={templateMeta.name} onChange={(e) => setTemplateMeta((p) => ({ ...p, name: e.target.value }))} placeholder="openai" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>市场 ID（留空自动生成）</label>
                    <input value={templateMeta.id} onChange={(e) => setTemplateMeta((p) => ({ ...p, id: e.target.value }))} placeholder="local.openai" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>展示名称</label>
                    <input value={templateMeta.display_name} onChange={(e) => setTemplateMeta((p) => ({ ...p, display_name: e.target.value }))} placeholder="留空用渠道名称" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>版本</label>
                    <input value={templateMeta.version} onChange={(e) => setTemplateMeta((p) => ({ ...p, version: e.target.value }))} placeholder="1.0.0" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>发布状态</label>
                    <ComboSearchSelect
                      value={templateMeta.status}
                      onChange={(v) => setTemplateMeta((p) => ({ ...p, status: v ?? 'published' }))}
                      options={[
                        { value: 'published', label: 'published（市场可见）' },
                        { value: 'hidden', label: 'hidden（隐藏）' },
                        { value: 'draft', label: 'draft（草稿）' },
                      ]}
                      contentZIndex={1101}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>图标</label>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid var(--admin-border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                        <ChannelIcon name={templateMeta.icon} className="size-5" />
                      </div>
                      <button
                        type="button"
                        onClick={() => templateIconFileInputRef.current?.click()}
                        style={{ ...btnGhost, padding: '5px 12px', fontSize: '12px', flexShrink: 0 }}
                      >
                        <Upload style={btnIcon} />上传图片
                      </button>
                      {templateMeta.icon ? (
                        <button
                          type="button"
                          onClick={() => setTemplateMeta((p) => ({ ...p, icon: '' }))}
                          style={{ ...iconActionDangerStyle, fontSize: '12px', width: 'auto', height: 'auto', padding: '3px 10px', border: '1px solid transparent', flexShrink: 0 }}
                        >
                          <X style={{ ...btnIcon, width: 12, height: 12 }} />清除
                        </button>
                      ) : null}
                      <input
                        ref={templateIconFileInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { loadIconFile(e.target.files?.[0], (value) => setTemplateMeta((p) => ({ ...p, icon: value }))); e.currentTarget.value = '' }}
                      />
                      <input value={templateMeta.icon} onChange={(e) => setTemplateMeta((p) => ({ ...p, icon: e.target.value }))} placeholder="bot 或 https://.../icon.svg" style={{ ...inputStyle, flex: 1 }} />
                    </div>
                    <div style={{ marginTop: '4px', color: 'var(--text2)', fontSize: '12px' }}>支持内置图标键、HTTPS 图片 URL 或本地上传（base64 不会导出到市场 manifest）。</div>
                  </div>
                  <div>
                    <label style={labelStyle}>发布者</label>
                    <input value={templateMeta.publisher} onChange={(e) => setTemplateMeta((p) => ({ ...p, publisher: e.target.value }))} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>分类</label>
                    <input value={templateMeta.category} onChange={(e) => setTemplateMeta((p) => ({ ...p, category: e.target.value }))} placeholder="openai / anthropic / custom" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>市场标签（逗号分隔）</label>
                    <input value={templateMeta.tagsText} onChange={(e) => setTemplateMeta((p) => ({ ...p, tagsText: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>一句话说明</label>
                    <input value={templateMeta.summary} onChange={(e) => setTemplateMeta((p) => ({ ...p, summary: e.target.value }))} placeholder="这个渠道模板适用于什么场景" style={inputStyle} />
                  </div>
                </div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text2)' }}>
                  模板只保存可移植配置，不含账号、API Key、Token、Cookie。应用模板时只更新基础配置，账号保持不变。
                </div>
              </SectionBlock>
            )}
            {/* 基础配置 */}
            {activeTab === 'basic' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 基础信息：图标（预览/上传/输入）一排，渠道名称、跳转地址、开关一排。直接平铺，不套卡片框。 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={labelStyle}>图标</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid var(--admin-border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      <ChannelIcon name={safeString(detail.icon)} className="size-6" />
                    </div>
                    <button
                      type="button"
                      onClick={() => iconFileInputRef.current?.click()}
                      style={{ ...btnGhost, flexShrink: 0 }}
                    >
                      <Upload style={btnIcon} />上传图片
                    </button>
                    <input
                      ref={iconFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => { loadIconFile(e.target.files?.[0], (value) => setDetail((prev) => prev ? { ...prev, icon: value } : prev)); e.currentTarget.value = '' }}
                    />
                    <input value={safeString(detail.icon)} onChange={(e) => setDetail((prev) => prev ? { ...prev, icon: e.target.value } : prev)} placeholder="bot / brain 或 https://.../icon.svg" style={{ ...inputStyle, flex: '1 1 360px', minWidth: 200 }} />
                    <button
                      type="button"
                      onClick={() => void convertIconUrl()}
                      disabled={!/^https?:\/\//i.test(safeString(detail.icon).trim())}
                      title="拉取该 URL 图片并转为内嵌 base64"
                      style={{ ...btnGhost, flexShrink: 0, opacity: /^https?:\/\//i.test(safeString(detail.icon).trim()) ? 1 : 0.5 }}
                    >
                      转换图片
                    </button>
                    {safeString(detail.icon) ? (
                      <button
                        type="button"
                        onClick={() => setDetail((prev) => prev ? { ...prev, icon: '' } : prev)}
                        style={{ ...btnDanger, flexShrink: 0 }}
                      >
                        <X style={btnIcon} />清除
                      </button>
                    ) : null}
                  </div>
                  <div style={{ marginTop: '4px', color: 'var(--text2)', fontSize: '12px' }}>内置图标键、图片 URL 或本地上传（base64）。粘贴 URL 后点「转换图片」内嵌保存。</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>
                  <div>
                    <label style={labelStyle}>渠道名称</label>
                    <input value={remarkText} onChange={(e) => setRemarkText(e.target.value)} placeholder="给渠道起个名字" style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <label style={labelStyle}>跳转地址</label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="跳转地址说明"
                            style={{ display: 'inline-flex', alignItems: 'center', padding: 0, border: 0, background: 'transparent', color: 'var(--text2)', cursor: 'help' }}
                          >
                            <CircleQuestionMark size={14} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>配置后渠道卡片标题和弹窗标题显示跳转入口；留空保存时自动用渠道地址补齐。</TooltipContent>
                      </Tooltip>
                    </div>
                    <input value={safeString(detail.website_url)} onChange={(e) => setDetail((prev) => prev ? { ...prev, website_url: e.target.value } : prev)} placeholder="https://官网或控制台" style={inputStyle} />
                  </div>
                </div>
              </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <label style={labelStyle}>标签</label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="标签说明"
                            style={{ display: 'inline-flex', alignItems: 'center', padding: 0, border: 0, background: 'transparent', color: 'var(--text2)', cursor: 'help' }}
                          >
                            <CircleQuestionMark size={14} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>用于模型方案按渠道标签进行过滤</TooltipContent>
                      </Tooltip>
                    </div>
                    <ProviderTagInput
                      value={normalizeProviderTags(detail.tags)}
                      onChange={(tags) => setDetail((prev) => prev ? { ...prev, tags } : prev)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>计费方式</label>
                    <ComboSearchSelect
                      value={safeString(detail.billing_mode) || 'token'}
                      onChange={(v) => setDetail((prev) => prev ? { ...prev, billing_mode: v ?? 'token' } : prev)}
                      options={[
                        { value: 'token', label: '按 Token 计费' },
                        { value: 'request', label: '按请求计费' },
                      ]}
                      contentZIndex={1101}
                    />
                  </div>
                </div>
                <div style={{ ...panelStyle, border: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={labelStyle}>启用渠道</label>
                      <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{enabled ? '渠道已启用，对外提供服务' : '渠道已禁用，不会对外提供服务'}</span>
                    </div>
                    <button onClick={() => setEnabled((v) => !v)} style={{ ...btnPrimary, minWidth: '120px', background: enabled ? 'var(--green)' : 'var(--text2)', borderColor: enabled ? 'var(--green)' : 'var(--text2)' }}>{enabled ? '已启用' : '已禁用'}</button>
                  </div>
                </div>


                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>每账号优先级</label>
                    <input type="number" value={String(detail.account_priority ?? 0)} onChange={(e) => setDetail((prev) => prev ? { ...prev, account_priority: e.target.value === '' ? 0 : Number(e.target.value) } : prev)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>每账号权重</label>
                    <input type="number" value={String(detail.account_weight ?? 0)} onChange={(e) => setDetail((prev) => prev ? { ...prev, account_weight: e.target.value === '' ? 0 : Number(e.target.value) } : prev)} style={inputStyle} />
                  </div>
                </div>

                {/* 定时检测属于基础配置；新增态也展示，保存后随渠道一起落库。 */}
                <div style={{ ...panelStyle, border: '1px solid var(--admin-border)' }}>
                      <div
                        role="button"
                        onClick={() => setScheduledTestExpanded((v) => !v)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>定时检测</span>
                          <span style={{ fontSize: '11px', color: stEnabled ? 'var(--green)' : 'var(--text2)' }}>{stEnabled ? '已开启' : '未开启'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text2)' }} title="上一次定时检测到点触发的时间（服务重启后重置）">
                            上次执行 <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatTime(detail.last_scheduled_test_at)}</span>
                          </span>
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); setStEnabled((v) => !v) }}
                            style={{ ...btnPrimary, padding: '4px 12px', background: stEnabled ? 'var(--green)' : 'var(--text2)', borderColor: stEnabled ? 'var(--green)' : 'var(--text2)', cursor: 'pointer' }}
                          >{stEnabled ? '开' : '关'}</span>
                          <span style={{ fontSize: '14px', color: 'var(--text2)' }}>{scheduledTestExpanded ? '▾' : '▸'}</span>
                        </div>
                      </div>
                      {scheduledTestExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                          <div style={stFormGridStyle}>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>
                                检测结果范围
                                <span
                                  title={'只检测成功：仅测渠道已启用、账号已认证且无冻结/冷却的账号。\n只检测异常：仅测处于冻结/冷却或认证不可用的账号。\n全部：不按当前可用状态筛选，所有启用账号都测。\n禁用渠道整体跳过；禁用账号永远跳过。'}
                                  style={stHelpMarkStyle}
                                >?</span>
                              </label>
                              <ComboSearchSelect
                                value={stAccountFilter}
                                onChange={(v) => setStAccountFilter((v ?? 'unavailable') as 'available' | 'unavailable' | 'all')}
                                options={[
                                  { value: 'available', label: '只检测成功' },
                                  { value: 'unavailable', label: '只检测异常' },
                                  { value: 'all', label: '成功异常都检测' },
                                ]}
                                contentZIndex={1101}
                                className="h-9"
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>检测频率</label>
                              <ComboSearchSelect
                                value={stFreqUnit}
                                onChange={(v) => setStFreqUnit((v ?? 'minutes') as 'daily' | 'minutes' | 'hours')}
                                options={[
                                  { value: 'daily', label: '每天' },
                                  { value: 'minutes', label: '每 N 分钟' },
                                  { value: 'hours', label: '每 N 小时' },
                                ]}
                                contentZIndex={1101}
                                className="h-9"
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>间隔数字</label>
                              <input
                                type="number"
                                min={1}
                                value={stFreqUnit === 'daily' ? '' : String(stFreqValue)}
                                disabled={stFreqUnit === 'daily'}
                                placeholder={stFreqUnit === 'daily' ? '每天无需填写' : '请输入间隔'}
                                onChange={(e) => setStFreqValue(Math.max(1, safeNumber(e.target.value, 30)))}
                                style={{ ...stInputStyle, opacity: stFreqUnit === 'daily' ? 0.55 : 1 }}
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>检测账号（不选 = 全部）</label>
                              <ComboMultiSelect
                                value={stAccounts}
                                onChange={(v) => setStAccounts(v)}
                                options={stAccountsList.map((a) => ({ value: a.username, label: `${a.username}${a.switch === false ? '（已禁用）' : ''}${a.cooldown ? '（冷却中）' : ''}` }))}
                                placeholder={stAccountsList.length === 0 ? '该渠道暂无账号' : '不选 = 该渠道全部账号'}
                                contentZIndex={1101}
                                className="h-9 overflow-hidden"
                              />
                            </div>
                          </div>
                          <div style={stFormGridStyle}>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>检测模型（不选 = 默认）</label>
                              <ComboMultiSelect
                                value={stTestModels}
                                onChange={handleScheduledTestModelChange}
                                options={stModelOptions}
                                placeholder={stModelOptions.length === 0 ? '该渠道暂无模型' : '不选 = 渠道默认模型'}
                                contentZIndex={1101}
                                className="h-9 overflow-hidden"
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>测试类型</label>
                              <ComboSearchSelect
                                value={stTestType}
                                onChange={(v) => setStTestType(v ?? 'chat')}
                                options={stTestTypeOptions.map((o) => ({ value: o.key, label: o.label }))}
                                contentZIndex={1101}
                                className="h-9"
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>客户端类型</label>
                              <ComboSearchSelect
                                value={stClientType}
                                onChange={(v) => setStClientType((v ?? 'none') as AccountTestClientType)}
                                options={[
                                  { value: 'none', label: '通用（不模拟客户端）' },
                                  { value: 'claude-code', label: 'Claude Code' },
                                  { value: 'codex-cli', label: 'Codex CLI' },
                                  { value: 'codex-tui', label: 'Codex TUI' },
                                  { value: 'codex-openai', label: 'Codex OpenAI' },
                                  { value: 'opencode', label: 'OpenCode' },
                                  { value: 'workbuddy', label: 'WorkBuddy (Tencent)' },
                                ]}
                                contentZIndex={1101}
                                className="h-9"
                              />
                            </div>
                            <div style={stFormFieldStyle}>
                              <label style={stLabelStyle}>协议</label>
                              <ComboSearchSelect
                                value={stProtocol}
                                onChange={(v) => setStProtocol(v ?? '')}
                                options={stProtocolOptions.length > 0 ? stProtocolOptions.map((p) => ({ value: p, label: p })) : [{ value: '', label: '默认' }]}
                                placeholder="默认"
                                contentZIndex={1101}
                                className="h-9"
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span
                              role="button"
                              onClick={() => setStRetainFailedLogs((v) => !v)}
                              style={{ ...btnPrimary, padding: '4px 12px', flexShrink: 0, background: stRetainFailedLogs ? 'var(--green)' : 'var(--text2)', borderColor: stRetainFailedLogs ? 'var(--green)' : 'var(--text2)', cursor: 'pointer' }}
                            >{stRetainFailedLogs ? '开' : '关'}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <b style={{ color: 'var(--text)' }}>保留检测日志</b>
                              <span
                                title="关闭后定时检测（成功与失败）都不写请求日志，「请求日志」里不再出现该渠道的检测记录。不影响手动测试与正常用户请求，也不改变冻结行为。"
                                style={stHelpMarkStyle}
                              >?</span>
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => void runScheduledTestNow()}
                              disabled={stRunning || !resolvedId}
                              title={resolvedId ? '按当前表单参数立即入队一次检测，由后台异步执行' : '保存渠道后才能立即执行'}
                              style={{ ...btnPrimary, padding: '4px 14px', cursor: stRunning || !resolvedId ? 'not-allowed' : 'pointer', opacity: stRunning || !resolvedId ? 0.6 : 1 }}
                            >{stRunning ? '加入中...' : '立即执行'}</button>
                            {stRunMessage && (
                              <span style={{ fontSize: '12px', color: stRunMessage.ok ? 'var(--green)' : 'var(--red)' }}>{stRunMessage.text}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                {!isCustom && (
                  <SectionBlock title="会话清理">
                    <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '42px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>启用自动清理</span>
                        <button onClick={() => setClearConvEnabled((v) => !v)} style={{ ...btnPrimary, padding: '5px 12px', background: clearConvEnabled ? 'var(--green)' : 'var(--text2)', borderColor: clearConvEnabled ? 'var(--green)' : 'var(--text2)' }}>{clearConvEnabled ? '开' : '关'}</button>
                      </div>
                      <div>
                        <label style={labelStyle}>最大保留小时数</label>
                        <input type="number" value={clearConvHours} onChange={(e) => setClearConvHours(safeNumber(e.target.value, 2))} style={inputStyle} />
                      </div>
                    </div>
                  </SectionBlock>
                )}
              </div>
            )}

            {/* 源码（代码渠道专属 Tab）：四子 Tab —— 代码 / 使用说明 / 使用样例 / agent 生成。
                代码子 Tab 贴 spec 类，保存即 exec 注册、热更新换类即时生效；以服务进程权限执行，
                仅授权管理员可编辑。使用说明与使用样例原为弹框，现已内嵌。agent 生成子 Tab
                用与市场管理气泡同款 AgentConversation，context=code_channel 触发服务端场景，
                agent 按代码渠道编写规则生成 spec 源码（不自动写入，用户自行复制到「代码」子 Tab）。 */}
            {activeTab === 'code' && (
              <CodeChannelEditorTabs
                value={safeString(detail.code)}
                onChange={(v: string) => setDetail((prev) => prev ? { ...prev, code: v } : prev)}
              />
            )}

            {/* 渠道配置 */}
            {activeTab === 'config' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <SectionBlock title={protocolEditorEnabled ? '协议配置' : '渠道配置（协议类参数只读）'}>
                  <div style={grid2Style}>
                    <div>
                      <label style={labelStyle}>渠道地址</label>
                      <input
                        value={safeString(detail.base_url)}
                        onChange={(e) => setDetail((prev) => prev ? { ...prev, base_url: e.target.value } : prev)}
                        onPaste={(e) => {
                          // 粘贴以 /v1（或 /v1/）结尾的地址时直接去掉尾部 /v1：模型列表/对话路径已带 /v1 前缀，
                          // 保留会拼出重复的 /v1。仅在确实需要裁剪时才拦截默认粘贴，避免干扰正常输入。
                          const pasted = e.clipboardData.getData('text')
                          if (!pasted) return
                          const input = e.currentTarget
                          const start = input.selectionStart ?? input.value.length
                          const end = input.selectionEnd ?? input.value.length
                          const combined = input.value.slice(0, start) + pasted + input.value.slice(end)
                          const stripped = combined.replace(/\/v1\/?\s*$/i, '')
                          if (stripped !== combined) {
                            e.preventDefault()
                            setDetail((prev) => prev ? { ...prev, base_url: stripped } : prev)
                          }
                        }}
                        style={inputStyle}
                        disabled={!protocolEditorEnabled}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>超时（秒）</label>
                      <input type="number" value={String(detail.timeout ?? 120)} onChange={(e) => setDetail((prev) => prev ? { ...prev, timeout: e.target.value === '' ? 120 : Number(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>
                        请求重试次数
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span style={{ marginLeft: 4, cursor: 'help', display: 'inline-flex', alignItems: 'center' }}>
                              <CircleQuestionMark size={14} strokeWidth={1.8} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent style={{ zIndex: 1100 }}>选定渠道后的同账号原地重试次数；留空则不做内层重试，由全局重试负责换路</TooltipContent>
                        </Tooltip>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        placeholder="留空则使用全局默认"
                        value={detail.retry_count == null ? '' : String(detail.retry_count)}
                        onChange={(e) => setDetail((prev) => {
                          if (!prev) return prev
                          const raw = e.target.value.trim()
                          if (raw === '') return { ...prev, retry_count: null }
                          let n = Math.floor(Number(raw))
                          if (!Number.isFinite(n)) n = 0
                          n = Math.min(10, Math.max(0, n))
                          return { ...prev, retry_count: n }
                        })}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>
                        额外请求重试状态码
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span style={{ marginLeft: 4, cursor: 'help', display: 'inline-flex', alignItems: 'center' }}>
                              <CircleQuestionMark size={14} strokeWidth={1.8} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent style={{ zIndex: 1100 }}>429、全部 5xx、网络异常和超时默认会重试；这里只填写额外状态码，多个用逗号分隔。</TooltipContent>
                        </Tooltip>
                      </label>
                      <input
                        value={extraRetryStatusCodesText}
                        onChange={(e) => setExtraRetryStatusCodesText(e.target.value)}
                        placeholder="例如 408, 409"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  {protocolEditorEnabled && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>对话协议</span>
                        <button
                          onClick={() => {
                            setChatProtocols((prev) => [...prev, buildChatProtocolRow('openai')])
                            setExpandedChatProtocols((s) => new Set([...s, chatProtocols.length]))
                          }}
                          style={{ ...btnGhost, padding: '4px 10px', fontSize: '12px' }}
                        >新增对话协议</button>
                      </div>
                      {chatProtocolsError && (
                        <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid var(--red, #dc2626)', borderRadius: 'var(--admin-radius)', color: 'var(--red, #dc2626)', fontSize: '13px' }}>{chatProtocolsError}</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {chatProtocols.map((cp, index) => {
                          const expanded = expandedChatProtocols.has(index)
                          const protocolPathNote = PROTOCOL_PATH_NOTES[safeString(cp.protocol).toLowerCase() || 'openai']
                          const pathSummary = cp.path || protocolPathNote?.placeholder || '未设路径'
                          const summary = `${cp.protocol || 'openai'} · ${pathSummary} · ${upstreamStreamLabel(cp.upstream_stream)}${cp.client_preset && cp.client_preset !== 'none' ? ` · ${cp.client_preset}` : ''}`
                          return (
                            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'var(--bg3)', borderRadius: 'var(--admin-radius)', border: '1px solid var(--admin-border)' }}>
                              <div
                                role="button"
                                onClick={() => setExpandedChatProtocols((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(index)) next.delete(index)
                                  else next.add(index)
                                  return next
                                })}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                                  <span style={{ color: 'var(--text2)', fontSize: '12px', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--textH)' }}>协议 {index + 1}</span>
                                  {!expanded && <span style={{ color: 'var(--text2)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, enabled: !c.enabled } : c))} style={{ ...btnPrimary, padding: '3px 8px', fontSize: '12px', background: cp.enabled === false ? 'var(--text2)' : 'var(--green)', borderColor: cp.enabled === false ? 'var(--text2)' : 'var(--green)' }}>{cp.enabled === false ? '关' : '开'}</button>
                                  <button onClick={() => setChatProtocols((prev) => prev.filter((_, i) => i !== index))} style={{ ...btnDanger, padding: '3px 8px', fontSize: '12px' }}>删除</button>
                                  {index > 0 && <button onClick={() => setChatProtocols((prev) => { const list = [...prev]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; return list })} style={{ ...btnGhost, padding: '3px 8px', fontSize: '12px' }}>上移</button>}
                                  {index < chatProtocols.length - 1 && <button onClick={() => setChatProtocols((prev) => { const list = [...prev]; [list[index], list[index + 1]] = [list[index + 1], list[index]]; return list })} style={{ ...btnGhost, padding: '3px 8px', fontSize: '12px' }}>下移</button>}
                                </div>
                              </div>
                              {!expanded && (
                                <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{summary}</div>
                              )}
                              {expanded && (
                                <div style={grid2Style}>
                                  <div>
                                    <label style={labelStyle}>协议</label>
                                    <ComboSearchSelect
                                      value={cp.protocol || 'openai'}
                                      onChange={(v) => changeChatProtocol(index, v ?? 'openai')}
                                      options={PROTOCOL_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                      contentZIndex={1101}
                                    />
                                  </div>
                                  <div>
                                    <label style={labelStyle}>
                                      路径
                                      {protocolPathNote && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span style={{ marginLeft: 4, cursor: 'help', display: 'inline-flex', alignItems: 'center' }}>
                                              <CircleQuestionMark size={14} strokeWidth={1.8} />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent style={{ zIndex: 1100, maxWidth: 360 }}>{protocolPathNote.note}</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </label>
                                    <input
                                      value={safeString(cp.path)}
                                      onChange={(e) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, path: e.target.value } : c))}
                                      style={inputStyle}
                                      placeholder={protocolPathNote?.placeholder || getProtocolDefaultPaths(cp.protocol).chat_path || '/v1/chat/completions'}
                                    />
                                  </div>
                                  <div>
                                    <label style={labelStyle}>
                                      流式
                                      {isUpstreamStreamAuto(cp.upstream_stream) && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span style={{ marginLeft: 4, cursor: 'help', display: 'inline-flex', alignItems: 'center' }}>
                                              <CircleQuestionMark size={14} strokeWidth={1.8} />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent style={{ zIndex: 1100, maxWidth: 360 }}>{UPSTREAM_STREAM_AUTO_HINT}</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </label>
                                    <ComboSearchSelect
                                      value={upstreamStreamToSelectValue(cp.upstream_stream)}
                                      onChange={(v) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, upstream_stream: upstreamStreamFromSelectValue(v ?? 'true') } : c))}
                                      options={UPSTREAM_STREAM_OPTIONS.map((opt) => ({ value: upstreamStreamToSelectValue(opt.value), label: opt.label }))}
                                      contentZIndex={1101}
                                    />
                                  </div>
                                  <div>
                                    <label style={labelStyle}>客户端伪装</label>
                                    <ComboSearchSelect
                                      value={safeString(cp.client_preset) || 'none'}
                                      onChange={(v) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, client_preset: v ?? 'none' } : c))}
                                      options={CLIENT_PRESET_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                      contentZIndex={1101}
                                    />
                                  </div>
                                  {(cp.protocol || 'openai') === 'anthropic' && (
                                    <div>
                                      <label style={labelStyle}>system 类型</label>
                                      <ComboSearchSelect
                                        value={safeString(cp.system_type) || 'auto'}
                                        onChange={(v) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, system_type: v ?? 'auto' } : c))}
                                        options={SYSTEM_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                        contentZIndex={1101}
                                      />
                                    </div>
                                  )}
                                  {(cp.protocol || 'openai') === 'openai' && (
                                    <div>
                                      <label style={labelStyle}>
                                        携带思考内容
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span style={{ marginLeft: 4, cursor: 'help', display: 'inline-flex', alignItems: 'center' }}>
                                              <CircleQuestionMark size={14} strokeWidth={1.8} />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent style={{ zIndex: 1100, maxWidth: 360 }}>是否把上一轮 AI 回复里的思考内容（思考过程）一起发给上游。默认开启（发送）；关闭后不再发送思考内容，避免思考过程被反复回灌给上游。</TooltipContent>
                                        </Tooltip>
                                      </label>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', padding: '6px 0' }}>
                                        <input
                                          type="checkbox"
                                          checked={cp.send_reasoning_content !== false}
                                          onChange={(e) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, send_reasoning_content: e.target.checked } : c))}
                                        />
                                        {cp.send_reasoning_content !== false ? '传入思考内容' : '不传入思考内容'}
                                      </label>
                                    </div>
                                  )}
                                  <div>
                                    <label style={labelStyle}>Header 模板</label>
                                    <ComboSearchSelect
                                      value={safeString(cp.header_template) || ''}
                                      onChange={(v) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, header_template: v ?? '' } : c))}
                                      options={[{ value: '', label: '不套用模板' }, ...headerTemplates.map((tpl) => ({ value: tpl.id, label: tpl.name }))]}
                                      placeholder="不套用模板"
                                      contentZIndex={1101}
                                    />
                                    {templateWarnings.filter((warning) => warning.includes('Header 模板')).map((warning) => (
                                      <div key={warning} style={{ color: 'var(--yellow)', fontSize: '12px', marginTop: '4px' }}>{warning}</div>
                                    ))}
                                  </div>
                                  <div>
                                    <label style={labelStyle}>支持模型（多选，空=全部）</label>
                                    {models.length === 0 ? (
                                      <div style={{ color: 'var(--text2)', fontSize: '12px' }}>渠道下暂无模型</div>
                                    ) : (
                                      <ComboMultiSelect
                                        value={(cp.models || []).filter((mid) => models.some((m) => safeString(m.upstream_model_id || m.model_id) === mid))}
                                        onChange={(next) => setChatProtocols((prev) => prev.map((c, i) => i === index ? { ...c, models: next } : c))}
                                        options={models.map((m) => {
                                          const mid = safeString(m.upstream_model_id || m.model_id)
                                          return { value: mid, label: safeString(m.model_id) || mid }
                                        })}
                                        placeholder="不勾选=支持全部"
                                        contentZIndex={1101}
                                      />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {chatProtocols.length === 0 && (
                          <div style={{ color: 'var(--red, #dc2626)', fontSize: '13px' }}>暂无对话协议：至少添加一条协议行才能保存，否则该渠道无法发送对话请求。</div>
                        )}
                      </div>
                      <div style={grid2Style}>
                        <div>
                          <label style={labelStyle}>模型列表路径</label>
                          <input value={safeString(detail.models_path)} onChange={(e) => setDetail((prev) => prev ? { ...prev, models_path: e.target.value } : prev)} style={inputStyle} placeholder="/v1/models" />
                        </div>
                        <div><label style={labelStyle}>图片生成路径</label><input value={safeString(detail.image_path)} onChange={(e) => setDetail((prev) => prev ? { ...prev, image_path: e.target.value } : prev)} style={inputStyle} placeholder="/v1/images/generations" /></div>
                        <div><label style={labelStyle}>视频生成路径</label><input value={safeString(detail.video_path)} onChange={(e) => setDetail((prev) => prev ? { ...prev, video_path: e.target.value } : prev)} style={inputStyle} placeholder="/v1/videos/generations" /></div>
                        <div><label style={labelStyle}>语音合成路径</label><input value={safeString(detail.speech_path)} onChange={(e) => setDetail((prev) => prev ? { ...prev, speech_path: e.target.value } : prev)} style={inputStyle} placeholder="/v1/audio/speech" /></div>
                      </div>
                    </>
                  )}
                </SectionBlock>
              </div>
            )}

            {/* 模型列表 */}
            {activeTab === 'models' && (
              upstreamSelectMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                  <div style={{ ...panelStyle, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input value={upstreamSearch} onChange={(e) => setUpstreamSearch(e.target.value)} placeholder="搜索上游模型 / 模型 ID" style={{ ...inputStyle, flex: '0 1 220px' }} />
                    <button onClick={() => setVisibleUpstreamSelection(true)} disabled={upstreamVisibleKeys.length === 0} style={btnGhost}>全选</button>
                    <button onClick={() => setVisibleUpstreamSelection(false)} disabled={upstreamVisibleKeys.length === 0} style={btnGhost}>全取消</button>
                    {previewRewriteToggle}
                    <span style={{ fontSize: '13px', color: 'var(--text2)', marginLeft: 'auto' }}>已选 {upstreamSelected.size} / {upstreamDraftModels.length}，当前筛选 {upstreamVisibleSelectedCount} / {upstreamVisibleKeys.length}</span>
                    <button onClick={confirmUpstreamSelection} style={btnPrimary}>确认</button>
                    <button onClick={cancelUpstreamSelection} style={btnGhost}>取消</button>
                  </div>
                  <ProviderModelTable
                    entries={upstreamVisibleEntries}
                    emptyText={previewApplyRewrite && hasRewriteRules ? '没有命中规则的上游模型——自动更新后这些都不会进库' : '没有匹配的上游模型'}
                    selectable
                    selected={upstreamSelected}
                    onToggleSelected={(key, checked) => setUpstreamSelected((prev) => {
                      const next = new Set(prev)
                      if (checked) next.add(key)
                      else next.delete(key)
                      return next
                    })}
                    onDeleteRow={(_, index) => {
                      setUpstreamDraftModels((prev) => prev.filter((__, i) => i !== index))
                      setUpstreamSelected((prev) => {
                        const next = new Set(prev)
                        next.delete(modelDraftKey(upstreamDraftModels[index], index))
                        return next
                      })
                    }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => setEditingModel({ row: buildModelRow(), index: -1, isNew: true })} style={btnPrimary}>新增模型</button>
                    <button onClick={() => void handleFetchUpstreamModels()} disabled={loadingUpstreamModels} style={btnGhost}>{loadingUpstreamModels ? '拉取中...' : '获取上游模型'}</button>
                    <button onClick={() => void handleRefreshModels()} disabled={saving} style={btnGhost}>刷新并重载</button>
                    <button onClick={() => setModels([])} disabled={saving} style={btnDanger}>清空列表</button>
                    <button onClick={() => setRewriteRulesOpen(true)} style={btnGhost}>
                      过滤及改写规则{(detail.model_id_rewrite_rules?.length ?? 0) > 0 ? ` (${detail.model_id_rewrite_rules?.length})` : ''}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text2)', cursor: 'pointer', marginLeft: 'auto' }}>
                      <input type="checkbox" checked={!!detail.auto_update_models} onChange={(e) => setDetail((prev) => prev ? { ...prev, auto_update_models: e.target.checked } : prev)} />
                      定时更新
                    </label>
                    {/* 行级启用开关在表格内：停用行不参与路由，但行保留在表，保存后生效。 */}
                    {(() => {
                      const disabledCount = models.filter((row) => row.enabled === false).length
                      const enabledCount = models.length - disabledCount
                      return (
                        <span style={{ fontSize: '13px', color: 'var(--text2)' }}>
                          共 {models.length} 个模型{disabledCount > 0 ? `，启用 ${enabledCount} / 停用 ${disabledCount}` : ''}
                        </span>
                      )
                    })()}
                  </div>
                  <ProviderModelTable
                    entries={models.map((row, index) => ({ row, index }))}
                    emptyText="暂无模型，请新增或从上游获取"
                    onToggleEnabled={(_, index) => {
                      // 草稿态翻转：enabled === false 即停用；随弹框「保存」一起提交。
                      setModels((prev) => prev.map((item, i) => i === index ? { ...item, enabled: item.enabled === false } : item))
                    }}
                    onEditRow={(row, index) => setEditingModel({ row, index, isNew: false })}
                    onDetectModel={handleDetectRealModel}
                    onDeleteRow={async (model, index) => {
                      if (!resolvedId || !safeString(model.upstream_model_id).trim()) {
                        setModels((prev) => prev.filter((_, i) => i !== index))
                        return
                      }
                      try {
                        await deleteProviderModel(resolvedId, safeString(model.upstream_model_id).trim())
                        setModels((prev) => prev.filter((_, i) => i !== index))
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '删除模型失败')
                      }
                    }}
                  />
                </div>
              )
            )}

            {/* 限制策略 */}
            {activeTab === 'limits' && limitPolicy && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <SectionBlock title="速率限制">
                  <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.6 }}>
                    到量即冻结账号到窗口末：分钟/小时为滑动窗口，每天次数冻到当天结束，每天 tokens 为 24 小时滑动窗口。
                  </div>
                  <div style={grid2Style}>
                    <div>
                      <label style={labelStyle}>每账号 RPM（次/分钟，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_rpm)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_rpm: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号 TPM（tokens/分钟，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_tpm)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_tpm: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号并发（个，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_concurrent)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_concurrent: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每模型 TPM（tokens/分钟，0=不限）</label>
                      <input type="number" value={String(limitPolicy.model_tpm)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, model_tpm: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号 RPH（次/小时，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_rph)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_rph: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号 TPH（tokens/小时，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_tph)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_tph: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号 RPD（次/天，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_rpd)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_rpd: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>每账号 TPD（tokens/天，0=不限）</label>
                      <input type="number" value={String(limitPolicy.account_tpd)} onChange={(e) => setLimitPolicy((prev) => prev ? { ...prev, account_tpd: safeNumber(e.target.value) } : prev)} style={inputStyle} />
                    </div>
                  </div>
                </SectionBlock>

                <SectionBlock title="冻结策略">
                  <FreezePolicyEditor
                    value={{ enabled: freezePolicyEnabled, rules: freezeRules }}
                    onChange={(next) => {
                      setFreezePolicyEnabled(next.enabled)
                      setFreezeRules(next.rules)
                    }}
                  />
                  {/* 渠道级开关：控制失败命中冻结规则时，已冻结对象是否按新周期刷新 TTL（与规则同存于 freeze_policy）。 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--admin-radius)', border: '1px solid var(--admin-border)', marginTop: '10px' }}>
                    <span
                      role="button"
                      onClick={() => setFreezeRefreshOnFailure((v) => !v)}
                      style={{ ...btnPrimary, padding: '4px 12px', background: freezeRefreshOnFailure ? 'var(--green)' : 'var(--text2)', borderColor: freezeRefreshOnFailure ? 'var(--green)' : 'var(--text2)', cursor: 'pointer', flex: '0 0 auto' }}
                    >{freezeRefreshOnFailure ? '开' : '关'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5 }}>
                      <b style={{ color: 'var(--text)' }}>失败刷新冻结周期</b>：开 → 每次失败命中规则都按新周期重设冻结 TTL；关 → 已冻结对象保留剩余时间，不被后续失败刷新（未冻结对象仍正常冻结）。对所有请求生效，含定时检测。
                      <span title="渠道级属性，随冻结策略一起保存；对正常请求、定时检测、响应头规则一视同仁。检测/请求成功仍会解除临时冻结和账号永久冻结，不受此开关影响。" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, marginLeft: 4, borderRadius: '50%', border: '1px solid var(--admin-border)', fontSize: 10, color: 'var(--text2)', cursor: 'help' }}>?</span>
                    </span>
                  </div>
                </SectionBlock>
              </div>
            )}

            {/* 账号管理 */}
            {activeTab === 'accounts' && (
              // 渠道已落库（编辑态 / 创建态点过保存后）→ 用完整账号管理组件；
              // 创建态尚未落库 → 用创建态账号编辑器，先填好用户名/凭据，点保存时随渠道一起提交（见 buildCreateAccountsPayload）。
              resolvedId
                ? <AccountsTab providerId={resolvedId} builtinType={detail.builtin_type || ''} active={open && activeTab === 'accounts'} onEditingChange={handleAccountEditingChange} />
                : (
                  <CreateAccountsEditor
                    accounts={createAccounts}
                    setAccounts={setCreateAccounts}
                    proxies={proxies}
                    authMode={getChannelAuthMode(createBuiltinType, createBuiltinType)}
                    emptyAccount={emptyCreateAccount}
                    templateMode={!!presetData && !presetData.accounts?.length}
                  />
                )
            )}

            {/* 数据统计 */}
            {activeTab === 'stats' && (
              resolvedId
                ? <ProviderStatsTab providerName={resolvedId} active={open && activeTab === 'stats'} />
                : <div style={{ ...panelStyle, color: 'var(--text2)', textAlign: 'center', fontSize: '13px', padding: '32px 16px' }}>渠道创建后才有统计数据。</div>
            )}

            {/* 测试 */}
            {activeTab === 'test' && (
              resolvedId
                ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
                    <AccountTestTab providerId={resolvedId} protocol={safeString(detail.protocol) || null} active={open && activeTab === 'test'} />
                  </div>
                )
                : <div style={{ ...panelStyle, color: 'var(--text2)', textAlign: 'center', fontSize: '13px', padding: '32px 16px' }}>渠道创建后才能测试。</div>
            )}
          </>
        )}
      </div>

      {/* 窗口真实大小测试结果 */}
      <Modal
        open={detectOpen || detectLoading || detectResult !== null}
        title={`窗口真实大小测试 · ${detectModelLabel}`}
        onClose={() => { if (!detectLoading) { setDetectResult(null); setDetectOpen(false) } }}
        maxWidth={720}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {detectLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text2)' }}>
              正在发送约 {parsedWindowTokens.toLocaleString()} tokens 的窗口验证请求，可能需要数秒…
            </div>
          ) : detectResult ? (
            <>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '4px' }}>目标窗口</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>
                    {detectResult.target_tokens.toLocaleString()} tokens
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '4px' }}>验证结果</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: detectResult.ok ? 'var(--green, #10b981)' : 'var(--red, #ef4444)' }}>
                    {detectResult.ok ? '窗口可用' : '窗口不可用'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '4px' }}>耗时</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>{detectResult.duration_ms} ms</div>
                </div>
              </div>

              {detectResult.username && (
                <div style={{ fontSize: '13px', color: 'var(--text2)' }}>测试账号：<span style={{ color: 'var(--text)' }}>{detectResult.username}</span></div>
              )}

              {detectResult.declared_limit && (
                <div style={{ fontSize: '13px', color: 'var(--text2)' }}>
                  metadata 声明窗口：<span style={{ color: 'var(--text)' }}>{detectResult.declared_limit.toLocaleString()} tokens</span>（仅供对照，不参与测试大小计算）
                </div>
              )}

              <div style={{ padding: '8px 12px', fontSize: '13px', color: detectResult.ok ? 'var(--green, #10b981)' : 'var(--red, #ef4444)', background: detectResult.ok ? 'color-mix(in srgb, var(--green, #10b981) 10%, transparent)' : 'color-mix(in srgb, var(--red, #ef4444) 10%, transparent)', border: `1px solid ${detectResult.ok ? 'color-mix(in srgb, var(--green, #10b981) 30%, var(--admin-border))' : 'color-mix(in srgb, var(--red, #ef4444) 30%, var(--admin-border))'}`, borderRadius: 'var(--admin-radius)' }}>
                {detectResult.ok
                  ? `✓ 该模型成功处理约 ${detectResult.target_tokens.toLocaleString()} tokens 的请求。`
                  : `✗ 该模型未能处理约 ${detectResult.target_tokens.toLocaleString()} tokens 的请求。`}
              </div>

              {detectResult.sample && (
                <pre style={{ margin: 0, padding: '10px', maxHeight: '120px', overflow: 'auto', fontSize: '12px', color: 'var(--text2)', background: 'var(--bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detectResult.sample}</pre>
              )}

              {detectResult.error_message && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '6px' }}>上游错误原文</div>
                  <pre style={{ margin: 0, padding: '10px', maxHeight: '180px', overflow: 'auto', fontSize: '12px', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detectResult.error_message}</pre>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text2)', fontSize: '13px' }}>
              已选择模型 <span style={{ color: 'var(--text)', fontFamily: 'var(--fontM)' }}>{detectModelLabel}</span>。
              <br />选择测试账号与窗口大小后点击「开始测试」。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--admin-border)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: 'var(--text2)' }}>测试账号</span>
              <ComboSearchSelect
                value={detectUsername}
                onChange={(v) => setDetectUsername(v ?? '')}
                disabled={detectLoading || detectAccounts.length === 0}
                options={detectAccounts.map((a) => ({ value: a.username, label: a.username }))}
                placeholder="无可用账号"
                contentZIndex={1101}
              />
              <span style={{ fontSize: '12px', color: 'var(--text2)', marginLeft: '4px' }}>测试窗口大小</span>
              <input
                type="number"
                min={1000}
                max={1000000}
                step={1000}
                value={windowTokensInput}
                onChange={(e) => setWindowTokensInput(e.target.value)}
                disabled={detectLoading}
                aria-invalid={!windowTokensValid}
                placeholder="输入 tokens"
                style={{ width: 130, padding: '3px 8px', fontSize: '12px', borderRadius: 'var(--admin-radius)', border: `1px solid ${windowTokensValid ? 'var(--admin-border)' : 'var(--red, #ef4444)'}`, background: 'var(--bg2)', color: 'var(--text)' }}
              />
              <span style={{ fontSize: '11px', color: windowTokensValid ? 'var(--text2)' : 'var(--red, #ef4444)' }}>
                {windowTokensValid ? '1,000–1,000,000 tokens（近似构造）' : '请输入 1,000–1,000,000 的整数'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: 'var(--text2)' }}>快捷预设</span>
              {WINDOW_SIZE_PRESETS.map((preset) => {
                const selected = windowTokensValid && parsedWindowTokens === preset.tokens
                return (
                  <button
                    key={preset.tokens}
                    onClick={() => setWindowTokensInput(String(preset.tokens))}
                    disabled={detectLoading}
                    style={{
                      padding: '3px 9px', fontSize: '12px', borderRadius: 'var(--admin-radius)', cursor: detectLoading ? 'not-allowed' : 'pointer',
                      color: selected ? '#fff' : 'var(--text)',
                      background: selected ? 'var(--blue, #3b82f6)' : 'var(--bg2)',
                      border: '1px solid var(--admin-border)',
                      opacity: detectLoading ? 0.6 : 1,
                    }}
                    title={`直接发送约 ${preset.tokens.toLocaleString()} tokens 的窗口测试请求`}
                  >{preset.label}</button>
                )
              })}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {detectModelLabel && (
                  <button
                    onClick={() => void runDetect(detectModelLabel, parsedWindowTokens, detectUsername)}
                    disabled={detectLoading || !detectUsername || !windowTokensValid}
                    style={{ ...btnGhost, padding: '4px 10px', opacity: (detectLoading || !detectUsername || !windowTokensValid) ? 0.6 : 1 }}
                  >{detectResult ? '重新测试' : '开始测试'}</button>
                )}
                <button onClick={() => { setDetectResult(null); setDetectOpen(false) }} disabled={detectLoading} style={btnGhost}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* 渠道模型编辑态 */}
      <ModelEditorModal
        open={editingModel !== null}
        row={editingModel?.row ?? null}
        isNew={editingModel?.isNew ?? false}
        onClose={() => setEditingModel(null)}
        onSave={(draft) => {
          const compact = compactProviderModelRow(draft)
          if (editingModel?.isNew) {
            setModels((prev) => [...prev, compact])
          } else if (editingModel && editingModel.index >= 0) {
            setModels((prev) => prev.map((item, i) => i === editingModel.index ? compact : item))
          }
          setEditingModel(null)
        }}
      />

      {/* 过滤及改写规则：改动直接落草稿，跟随渠道「保存」一起提交 */}
      <Modal
        open={rewriteRulesOpen && !!detail}
        title="过滤及改写规则"
        onClose={() => setRewriteRulesOpen(false)}
        maxWidth={760}
        footer={<button onClick={() => setRewriteRulesOpen(false)} style={btnPrimary}>完成</button>}
      >
        <ModelIdRewriteEditor
          value={detail?.model_id_rewrite_rules ?? []}
          templates={modelRuleTemplates}
          onChange={(entries: ModelIdRewriteEntry[]) =>
            setDetail((prev) => prev ? { ...prev, model_id_rewrite_rules: entries } : prev)
          }
        />
      </Modal>
      </div>

      {/* 账号编辑未保存时的丢弃确认：关闭弹框 / 切换 Tab 前拦截。 */}
      <AlertDialog open={discardAccountEditOpen} onOpenChange={(open) => { if (!open) cancelDiscardAccountEdit() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>账号正在添加或编辑，是否丢弃这个操作？</AlertDialogTitle>
            <AlertDialogDescription>关闭后当前填写的账号表单内容将丢失，且不会保存。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDiscardAccountEdit}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); confirmDiscardAccountEdit() }}
            >
              丢弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Modal>
  )
}

const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'responses', label: 'Responses' },
  { value: 'gemini', label: 'Gemini' },
]

// 各协议的默认路径。来源：providers/custom.py 与各内置 provider 的 setdefault 默认值。
// 注意：gemini 的聊天地址是按 {model}:generateContent 动态拼接的（见 gemini_proto.py 的
// gemini_stream_url/gemini_nonstream_url），后端不读协议行的 path，故留空并在 UI 上禁用输入。

// 路径写法是模板（含占位符）的协议：占位符给出通用写法，细节走问号提示。
// gemini 把模型名与流式方法写在 URL 里，故 path 支持 {model}/{method} 占位符，
// 由后端 gemini_chat_url 替换（见 providers/gemini_proto.py）。留空回退官方形态。
const PROTOCOL_PATH_NOTES: Record<string, { placeholder: string; note: string }> = {
  gemini: {
    placeholder: '/v1beta/models/{model}:{method}',
    note: 'Gemini 把模型名和流式方法写在 URL 里，所以这里填模板：{model} 替换为请求模型，{method} 替换为 generateContent（非流式）或 streamGenerateContent?alt=sse（流式）。自建/中转上游按其实际前缀填写，例如 /gemini/v1beta/models/{model}:{method}；只写到 /v1beta/models 这类前缀时会自动补 /{model}:{method}；填绝对 URL 则忽略渠道地址直连。留空则按官方形态 /v1beta/models/{model}:{method} 拼接。',
  },
}

const PROTOCOL_DEFAULT_PATHS: Record<string, { chat_path: string; models_path: string; image_path: string; video_path: string }> = {
  openai: { chat_path: '/v1/chat/completions', models_path: '/v1/models', image_path: '/v1/images/generations', video_path: '/v1/videos/generations' },
  anthropic: { chat_path: '/v1/messages', models_path: '/v1/models', image_path: '/v1/images/generations', video_path: '/v1/videos/generations' },
  responses: { chat_path: '/v1/responses', models_path: '/v1/models', image_path: '/v1/images/generations', video_path: '/v1/videos/generations' },
  gemini: { chat_path: '/v1beta/models/{model}:{method}', models_path: '/v1beta/models', image_path: '/v1/images/generations', video_path: '/v1/videos/generations' },
}

function getProtocolDefaultPaths(protocol: string | null | undefined) {
  return PROTOCOL_DEFAULT_PATHS[safeString(protocol).toLowerCase()] || PROTOCOL_DEFAULT_PATHS.openai
}

// 协议行创建时可预填默认路径。用户后续切换“协议”时，只在 path 仍是默认值
// （空 or 旧协议默认路径）时才追随新协议默认值；手动改过的自定义 path 保留不动。
function buildChatProtocolRow(protocol = 'openai', path?: string): ChatProtocolConfig {
  const nextProtocol = safeString(protocol).toLowerCase() || 'openai'
  const defs = getProtocolDefaultPaths(nextProtocol)
  const requested = safeString(path).trim()
  return {
    id: '',
    enabled: true,
    protocol: nextProtocol,
    path: requested || defs.chat_path,
    upstream_stream: true,
    client_preset: 'none',
    header_template: '',
    system_type: 'auto',
    send_reasoning_content: true,
    models: [],
  }
}

// path 是否仍是「协议默认值」：空串，或等于任一协议的默认 chat_path。
// 只有这种未被用户定制过的 path 才允许随协议切换而变化。
function isProtocolDefaultChatPath(path: string | null | undefined) {
  const value = safeString(path).trim()
  if (!value) return true
  return Object.values(PROTOCOL_DEFAULT_PATHS).some((defs) => defs.chat_path && defs.chat_path === value)
}

// 模型列表路径同理：仅当仍是某协议的默认 models_path 时才随主协议切换。
function isProtocolDefaultModelsPath(path: string | null | undefined) {
  const value = safeString(path).trim()
  if (!value) return true
  return Object.values(PROTOCOL_DEFAULT_PATHS).some((defs) => defs.models_path === value)
}

// 主协议行 = 第一条启用行，全禁用时取第一条（与 channel.py _build_state 的取法一致）。
function primaryChatProtocol(rows: ChatProtocolConfig[]): ChatProtocolConfig | undefined {
  return rows.find((c) => c.enabled !== false) || rows[0]
}

function updateChatProtocolProtocol(row: ChatProtocolConfig, protocol: string): ChatProtocolConfig {
  const nextProtocol = safeString(protocol).toLowerCase() || 'openai'
  const nextPath = isProtocolDefaultChatPath(row.path)
    ? getProtocolDefaultPaths(nextProtocol).chat_path
    : safeString(row.path)
  return {
    ...row,
    protocol: nextProtocol,
    path: nextPath,
  }
}

const SYSTEM_TYPE_OPTIONS = [
  { value: 'auto', label: 'auto（同协议不转）' },
  { value: 'str', label: '字符串' },
  { value: 'array', label: '数组' },
]

// upstream_stream 三态：与后端 channel.py 的 UPSTREAM_STREAM_* 一一对应。
// 后端存 JSON 布尔 true/false 或字面量 'auto'，故这里也保持同样形态直传。
const UPSTREAM_STREAM_AUTO = 'auto' as const
type UpstreamStreamValue = boolean | typeof UPSTREAM_STREAM_AUTO

const UPSTREAM_STREAM_OPTIONS: { value: UpstreamStreamValue; label: string }[] = [
  { value: true, label: '固定开' },
  { value: false, label: '固定关' },
  { value: UPSTREAM_STREAM_AUTO, label: '随客户端' },
]

const UPSTREAM_STREAM_AUTO_HINT = '随客户端：上游 stream 跟随客户端请求——客户端要流就流、要非流就非流，不强行覆盖'

function isUpstreamStreamAuto(value: unknown): boolean {
  return value === UPSTREAM_STREAM_AUTO
}

/** 规范化任意来源的 upstream_stream 为三态之一；缺省沿用「固定开」。 */
function normalizeUpstreamStream(value: unknown): UpstreamStreamValue {
  return isUpstreamStreamAuto(value) ? UPSTREAM_STREAM_AUTO : value !== false
}

/** 三态 → <select> 的字符串 value（select 只能承载字符串）。 */
function upstreamStreamToSelectValue(value: unknown): string {
  if (isUpstreamStreamAuto(value)) return UPSTREAM_STREAM_AUTO
  return value === false ? 'false' : 'true'
}

/** <select> 字符串 value → 三态。 */
function upstreamStreamFromSelectValue(value: string): UpstreamStreamValue {
  if (value === UPSTREAM_STREAM_AUTO) return UPSTREAM_STREAM_AUTO
  return value === 'true'
}

/** 折叠态摘要用的中文标签。 */
function upstreamStreamLabel(value: unknown): string {
  if (isUpstreamStreamAuto(value)) return '随客户端'
  return value ? '流式' : '非流式'
}

const CLIENT_PRESET_OPTIONS = [
  { value: 'none', label: '无 (none)' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'codex-tui', label: 'Codex TUI' },
  { value: 'codex-openai', label: 'Codex OpenAI' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'cline', label: 'Cline' },
  { value: 'roo-code', label: 'Roo Code' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
  { value: 'workbuddy', label: 'WorkBuddy (Tencent)' },
]

// 出站思考默认值档位（OpenAI 协议 reasoning_effort；与 thinking 二选一）。
const REASONING_EFFORT_OPTIONS = [
  { value: '', label: '不设置' },
  { value: 'none', label: 'none' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
]

// category: 1 = CustomProvider 继承（可改超时/定时更新/客户端伪装/兼容模式）
// category: 2 = BaseProvider 直接继承（可改超时/定时更新）
const BUILTIN_TYPE_OPTIONS = [
  { value: '', label: '通用渠道', category: 0 },
  { value: 'cloudflare', label: 'Cloudflare Workers AI', category: 1 },
  // 自定义渠道（原「代码渠道」）：贴一个 spec 类即跑（底层适配器是 CustomProvider 子类，没写的钩子回落配置驱动）。
  // 归 category 2 表示「请求行为可被贴的代码接管」；协议配置仍完整开放，spec 未覆盖时框架按它发上游。
  // 原先硬编码的 copilot/codebuddy/eaichat 下拉项已下架为自定义渠道，不再在此枚举。
  { value: 'code', label: '自定义渠道', category: 2 },
]

// 继承 CustomProvider 且走标准通用渠道口径的内置渠道：在前端可完整编辑协议配置
// （base_url / 路径 / 对话协议行等），与通用渠道一致。
// 自定义渠道的 spec 类没覆盖聊天钩子时完全走配置驱动，覆盖了也常读 base_url/协议行，
// 故同样暴露完整协议编辑（base_url 校验在 handleSave 单独豁免）。
const PROTOCOL_EDITABLE_BUILTIN_TYPES = new Set<string>(['code'])

// 判断渠道类别：0=通用渠道，1=CustomProvider继承，2=BaseProvider继承
function getProviderCategory(builtinType: string): number {
  if (!builtinType) return 0
  return BUILTIN_TYPE_OPTIONS.find((o) => o.value === builtinType)?.category ?? 0
}

// 该内置渠道是否在前端暴露完整协议配置编辑（与通用渠道一致）。
// category 0（通用渠道）恒为 true；内置渠道仅 PROTOCOL_EDITABLE_BUILTIN_TYPES 命中时为 true。
function isProtocolEditableBuiltin(builtinType?: string | null): boolean {
  if (!builtinType) return false
  return PROTOCOL_EDITABLE_BUILTIN_TYPES.has(builtinType)
}

function ProviderCard({
  provider,
  isLoading,
  onToggle,
  onDelete,
  onDetail,
  onCopy,
}: {
  provider: ProviderSummary
  isLoading: boolean
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onDetail: (provider: ProviderSummary) => void
  onCopy: (provider: ProviderSummary) => void
}) {
  const status = getProviderStatus(provider)
  const statusColor = getStatusColor(status)
  const title = provider.remark || '未命名渠道'
  const websiteUrl = safeString(provider.website_url).trim()
  // 未配置（或配置了无法识别的值）时整个图标位不渲染，不用默认图标兜底。
  const iconValue = safeString(provider.icon).trim()
  const hasIcon = isChannelIconConfigured(iconValue)

  const accountStats = [
    { label: '账号', value: provider.account_count ?? 0, tone: 'default' as const },
    { label: '已认证', value: provider.auth_account_count ?? 0, tone: 'green' as const },
    { label: '冻结', value: provider.cooldown_account_count ?? 0, tone: 'yellow' as const },
    { label: '停用', value: provider.disabled_account_count ?? 0, tone: (provider.disabled_account_count ?? 0) > 0 ? ('red' as const) : ('muted' as const) },
  ]

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--admin-border)',
        borderRadius: 'var(--admin-radiusL)',
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--admin-border)',
          background: 'linear-gradient(135deg, var(--surface2) 0%, var(--surface) 100%)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {hasIcon && (
                  <div
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    <ChannelIcon name={iconValue} className="size-5" />
                  </div>
                )}
                {websiteUrl ? (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: '16px',
                      fontWeight: 750,
                      color: status === 'disabled' || status === 'error' ? 'var(--text2)' : 'var(--textH)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                      textDecoration: 'none',
                    }}
                    title={`${title}\n${websiteUrl}`}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = status === 'disabled' || status === 'error' ? 'var(--text2)' : 'var(--textH)' }}
                  >
                    {title}
                  </a>
                ) : (
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 750,
                      color: status === 'disabled' || status === 'error' ? 'var(--text2)' : 'var(--textH)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                    title={title}
                  >
                    {title}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: statusColor, fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{getStatusLabel(status)}</span>
                <button
                  onClick={() => onToggle(provider.id, provider.enabled)}
                  disabled={isLoading}
                  title={provider.enabled ? '点击禁用该渠道' : '点击启用该渠道'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    height: '24px',
                    padding: '0 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '999px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    border: '1px solid',
                    transition: 'all 0.12s',
                    opacity: isLoading ? 0.6 : 1,
                    background: provider.enabled ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'color-mix(in srgb, var(--blue) 12%, transparent)',
                    color: provider.enabled ? 'var(--green)' : 'var(--blue)',
                    borderColor: provider.enabled ? 'color-mix(in srgb, var(--green) 40%, var(--admin-border))' : 'color-mix(in srgb, var(--blue) 40%, var(--admin-border))',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '999px', background: 'currentColor', flexShrink: 0 }} />
                  {provider.enabled ? '禁用' : '启用'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' }}>
              {normalizeProviderTags(provider.tags).map((tag) => (
                <span key={tag} style={{ ...tagBase, ...providerTagColor(tag), fontWeight: 500 }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
            padding: '12px',
            background: 'var(--bg2)',
            borderRadius: 'var(--admin-radius)',
            border: '1px solid var(--admin-border)',
          }}
        >
          {accountStats.map((stat) => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '2px' }}>{stat.label}</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: stat.tone === 'default' ? 'var(--textH)' : stat.tone === 'muted' ? 'var(--text2)' : `var(--${stat.tone})` }}>
                {formatNumber(stat.value)}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: 'var(--text2)',
          }}
        >
          <span>模型 {formatNumber(getProviderModelsCount(provider))}</span>
          <span>更新 {formatTime(getProviderUpdatedAt(provider))}</span>
        </div>
      </div>

      <div
        style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--admin-border)',
          background: 'var(--bg2)',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button onClick={() => onDetail(provider)} disabled={isLoading} style={{ ...btnGhost, color: 'var(--blue)', borderColor: 'var(--blue)', flex: 1, minWidth: '52px' }}>
          详情
        </button>
        <button onClick={() => onCopy(provider)} disabled={isLoading} style={{ ...btnGhost, flex: 1, minWidth: '52px' }}>
          复制
        </button>
        <button onClick={() => onDelete(provider.id)} disabled={isLoading} style={{ ...btnDanger, flex: 1, minWidth: '52px' }}>
          删除
        </button>
      </div>
    </div>
  )
}

export function Channels() {
  const [searchParams, setSearchParams] = useSearchParams()
  const providerParam = searchParams.get('provider') ?? ''
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<ProviderSummary | null>(null)
  const [search, setSearch] = useState(providerParam)
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'frozen' | 'authenticated' | 'unauthenticated' | 'expired'>('all')
  const [typeFilter, setTypeFilter] = useState<ProviderTypeFilter>('all')
  const [protocolFilter, setProtocolFilter] = useState<ProviderProtocolFilter>('all')
  const [autoUpdateFilter, setAutoUpdateFilter] = useState<ProviderAutoUpdateFilter>('all')
  const [sortBy, setSortBy] = useState<ProviderSortKey>('updated')
  const [modelFilter, setModelFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState<ProviderTagFilterValue[]>([])
  const [modalProvider, setModalProvider] = useState<ProviderSummary | null>(null)
  const [modalInitialTab, setModalInitialTab] = useState<ProviderTab>('overview')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [initialBuiltinType, setInitialBuiltinType] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [createPreset, setCreatePreset] = useState<ProviderCreatePreset | null>(null)
  // 标记 createPreset 来源：'catalog' = 从渠道目录新选（自定义/内置模板，timeout 应走前端默认 120）；
  // 'copy' = 复制现有渠道（必须保留源 timeout）。用于 initCreate 区分两条路径。
  const [createPresetOrigin, setCreatePresetOrigin] = useState<'catalog' | 'copy' | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)

  // 接收来自模型元数据 provider 标签的 ?provider=<name>，立即应用到搜索过滤并高亮匹配渠道
  useEffect(() => {
    if (providerParam) {
      setSearch(providerParam)
    }
  }, [providerParam])

  const loadProviders = useCallback(async (): Promise<ProviderSummary[]> => {
    setLoading(true)
    setError(null)
    try {
      const data = await getProviders()
      setProviders(data)
      setLastRefreshTime(new Date())
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取渠道列表失败')
      setProviders([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => void loadProviders(), 15_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadProviders])

  useEffect(() => {
    const provider = searchParams.get('provider')?.trim()
    if (!provider) return
    setSearch(provider)
    setModelFilter('')
    setStatusFilter('all')
    setTypeFilter('all')
    setProtocolFilter('all')
    setAutoUpdateFilter('all')
    setSelectedTags([])
  }, [searchParams])

  const handleToggleEnabled = useCallback(
    async (id: string, currentEnabled: boolean) => {
      setActionLoading((prev) => ({ ...prev, [id]: true }))
      try {
        await updateProviderEnabled(id, !currentEnabled)
        await loadProviders()
      } catch (err) {
        setError(
          err instanceof Error
            ? `${!currentEnabled ? '启用' : '禁用'}渠道失败: ${err.message}`
            : `${!currentEnabled ? '启用' : '禁用'}渠道失败`,
        )
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [loadProviders],
  )

  const deleteProviderConfirmed = useCallback(
    async (id: string) => {
      setActionLoading((prev) => ({ ...prev, [id]: true }))
      try {
        await deleteProvider(id)
        await loadProviders()
      } catch (err) {
        setError(
          err instanceof Error ? `删除渠道失败: ${err.message}` : '删除渠道失败',
        )
        throw err
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [loadProviders],
  )

  const handleDelete = useCallback(
    (id: string) => {
      setDeleteTarget(providers.find((p) => p.id === id) ?? null)
    },
    [providers],
  )

  const confirmDelete = useCallback(
    async () => {
      if (!deleteTarget) return
      try {
        await deleteProviderConfirmed(deleteTarget.id)
        setDeleteTarget(null)
      } catch {
        // deleteProviderConfirmed 已 setError；保留弹框打开，供用户重试或取消
      }
    },
    [deleteProviderConfirmed, deleteTarget],
  )

  // 复制渠道：打开新增弹框并预填配置，用户点击创建才真正落库
  const handleCopy = useCallback(
    async (provider: ProviderSummary) => {
      const id = provider.id
      setActionLoading((prev) => ({ ...prev, [id]: true }))
      try {
        const [detail, accounts] = await Promise.all([getProviderDetail(id), getProviderAccounts(id, { view: 'copy' }).catch(() => [])])
        const protocols = (Array.isArray(detail.chat_protocols) && detail.chat_protocols.length > 0
          ? detail.chat_protocols
          : (Array.isArray(detail.endpoint_configs) ? detail.endpoint_configs : [])
        ).map((row) => ({
          id: safeString(row.id),
          enabled: row.enabled !== false,
          protocol: safeString(row.protocol) || 'openai',
          path: safeString(row.path),
          upstream_stream: normalizeUpstreamStream(row.upstream_stream),
          client_preset: safeString(row.client_preset) || 'none',
          header_template: safeString(row.header_template),
          system_type: safeString(row.system_type) || 'auto',
          send_reasoning_content: row.send_reasoning_content !== false,
          models: Array.isArray(row.models) ? row.models.map(String) : [],
        }))
        setCreatePreset({
          remark: `${detail.remark || '未命名渠道'} (副本)`,
          tags: normalizeProviderTags(detail.tags),
          enabled: detail.enabled,
          protocol: detail.protocol,
          base_url: detail.base_url || '',
          website_url: detail.website_url,
          icon: detail.icon,
          chat_path: detail.chat_path,
          models_path: detail.models_path,
          image_path: detail.image_path,
          video_path: detail.video_path,
          speech_path: detail.speech_path,
          timeout: detail.timeout,
          retry_count: detail.retry_count,
          extra_retry_status_codes: detail.extra_retry_status_codes,
          billing_mode: (detail.billing_mode === 'request' ? 'request' : 'token'),
          rate_limit: detail.rate_limit,
          chat_protocols: protocols,
          account_priority: detail.account_priority,
          account_weight: detail.account_weight,
          auto_update_models: detail.auto_update_models,
          model_id_rewrite_rules: normalizeModelIdRewriteRules(detail.model_id_rewrite_rules),
          accounts: accounts.map((a) => ({ api_key: safeString(a.password ?? a.api_key ?? a.key), username: safeString(a.username) })),
          models: detail.models ?? [],
          // 复制时原样带过：能力开关、健康检查、定时检测、会话清理此前被漏带，
          // 源渠道配了也会在新建草稿里丢失。
          supports_image_generation: detail.supports_image_generation,
          supports_video_generation: detail.supports_video_generation,
          supports_tts: detail.supports_tts,
          health_check: detail.health_check,
          scheduled_test: detail.scheduled_test,
          clear_conversation: detail.clear_conversation,
        })
        setCreatePresetOrigin('copy')
        setInitialBuiltinType('')
        setCreateModalOpen(true)
      } catch (err) {
        // 复制失败必须显式提示：页面级 error 只在 providers.length===0 分支渲染，
        // 列表非空时它会被吞掉，用户点击「复制」后毫无反馈，看不到弹框也看不到错误。
        const msg = err instanceof Error ? err.message : '复制渠道失败'
        window.alert(`复制渠道失败: ${msg}`)
        setError(`复制渠道失败: ${msg}`)
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [],
  )

  const openProviderModal = (provider: ProviderSummary, tab: ProviderTab) => {
    setModalProvider(provider)
    setModalInitialTab(tab)
  }

  const closeProviderModal = () => {
    setModalProvider(null)
    setModalInitialTab('overview')
  }

  const matchesStatusFilter = (p: ProviderSummary, filter: typeof statusFilter) => {
    if (filter === 'all') return true
    if (filter === 'enabled') return p.enabled
    if (filter === 'disabled') return !p.enabled
    if (filter === 'frozen') return (p.cooldown_account_count ?? 0) > 0
    if (filter === 'authenticated') return (p.auth_account_count ?? 0) > 0
    if (filter === 'unauthenticated') return (p.enabled_account_count ?? 0) > 0 && (p.auth_account_count ?? 0) === 0
    // 已过期：启用账号全部未通过认证，且存在明确失败的账号（不含仅"待检查"）
    if (filter === 'expired') {
      return (p.enabled_account_count ?? 0) > 0
        && (p.auth_account_count ?? 0) === 0
        && (p.auth_failed_account_count ?? 0) > 0
    }
    return true
  }

  const matchesTypeFilter = (p: ProviderSummary, filter: ProviderTypeFilter) => {
    if (filter === 'all') return true
    if (filter === 'generic') return p.custom_channel === true
    if (filter === 'custom') return p.builtin_type === 'code'
    if (filter === 'builtin') return !p.custom_channel && !!p.builtin_type && p.builtin_type !== 'code'
    return true
  }

  const matchesProtocolFilter = (p: ProviderSummary, filter: ProviderProtocolFilter) => {
    if (filter === 'all') return true
    const protocol = (p.protocol || '').toLowerCase()
    if (filter === 'other') return protocol.length > 0 && !KNOWN_PROTOCOL_FILTERS.includes(protocol)
    return protocol === filter
  }

  const matchesAutoUpdateFilter = (p: ProviderSummary, filter: ProviderAutoUpdateFilter) => {
    if (filter === 'all') return true
    // 缺省视为开启：与运行时口径一致（refresh_models 对未配置的渠道默认自动更新）。
    const autoUpdate = p.auto_update_models !== false
    return filter === 'on' ? autoUpdate : !autoUpdate
  }

  const availableTags = useMemo(() => {
    const tags = providers.flatMap((provider) => normalizeProviderTags(provider.tags))
    return Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [providers])

  const filteredProviders = useMemo(() => {
    let result = providers

    if (search.trim()) {
      const query = search.toLowerCase()
      result = result.filter((p) => {
        const haystack = `${p.id} ${p.remark || ''} ${p.base_url || ''} ${p.protocol || ''}`.toLowerCase()
        return haystack.includes(query)
      })
    }

    if (modelFilter.trim()) {
      const query = modelFilter.toLowerCase()
      result = result.filter((p) => Array.isArray(p.models) && p.models.some((m) => String(m).toLowerCase().includes(query)))
    }

    result = result.filter((p) => matchesStatusFilter(p, statusFilter))
    result = result.filter((p) => matchesTypeFilter(p, typeFilter))
    result = result.filter((p) => matchesProtocolFilter(p, protocolFilter))
    result = result.filter((p) => matchesAutoUpdateFilter(p, autoUpdateFilter))

    if (selectedTags.length > 0) {
      result = result.filter((provider) => {
        const providerTags = normalizeProviderTags(provider.tags)
        return selectedTags.some((tag) => (
          tag === UNTAGGED_FILTER ? providerTags.length === 0 : providerTags.includes(tag)
        ))
      })
    }

    const sorted = [...result]
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'id':
          return safeString(a.id).localeCompare(safeString(b.id))
        case 'name':
          return safeString(a.remark || a.id).localeCompare(safeString(b.remark || b.id))
        case 'accounts':
          return (b.account_count ?? 0) - (a.account_count ?? 0)
        case 'models':
          return getProviderModelsCount(b) - getProviderModelsCount(a)
        case 'updated':
        default: {
          const av = typeof a.updated_at_ts === 'number' ? a.updated_at_ts : 0
          const bv = typeof b.updated_at_ts === 'number' ? b.updated_at_ts : 0
          return bv - av
        }
      }
    })
    return sorted
  }, [providers, search, modelFilter, selectedTags, statusFilter, typeFilter, protocolFilter, autoUpdateFilter, sortBy])

  const summary = useMemo(() => {
    const totalProviders = providers.length
    const enabledProviders = providers.filter((p) => p.enabled).length
    const disabledProviders = totalProviders - enabledProviders
    const totalAccounts = providers.reduce((sum, p) => sum + (p.account_count ?? 0), 0)
    const authAccounts = providers.reduce((sum, p) => sum + (p.auth_account_count ?? 0), 0)
    const cooldownAccounts = providers.reduce((sum, p) => sum + (p.cooldown_account_count ?? 0), 0)
    const totalModels = providers.reduce((sum, p) => sum + getProviderModelsCount(p), 0)

    return {
      totalProviders,
      enabledProviders,
      disabledProviders,
      totalAccounts,
      authAccounts,
      cooldownAccounts,
      totalModels,
    }
  }, [providers])

  const activeProviderQuery = searchParams.get('provider')?.trim() || ''
  const hasActiveFilter = search || modelFilter || selectedTags.length > 0 || statusFilter !== 'all' || typeFilter !== 'all' || protocolFilter !== 'all' || autoUpdateFilter !== 'all' || providerParam

  return (
    <AdminPage
      title="渠道管理"
      description="配置和管理模型服务渠道"
      contentStyle={{}}
      primaryActions={
        <div className="flex items-center gap-2">
          <ManagerHeaderActionButton onClick={() => setCatalogOpen(true)}>
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            添加渠道
          </ManagerHeaderActionButton>
          <ManagerRefreshButton loading={loading} onClick={() => void loadProviders()} />
          <ManagerHeaderActionButton
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
            className={autoRefresh ? 'border-primary bg-primary/10 text-primary' : undefined}
            title={autoRefresh ? '暂停自动刷新' : '开启自动刷新'}
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            {autoRefresh ? '自动' : '手动'}
          </ManagerHeaderActionButton>
          {lastRefreshTime && (
            <span style={{ fontSize: '11px', color: 'var(--text2)' }}>
              {lastRefreshTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      }
    >
      <SectionCard
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            marginBottom: '18px',
            padding: '12px 14px',
            background: 'var(--bg2)',
            borderRadius: 'var(--admin-radius)',
            border: '1px solid var(--admin-border)',
            alignItems: 'center',
            justifyContent: 'space-between',
            flex: '0 0 auto',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                if (providerParam) setSearchParams((current) => {
                  const next = new URLSearchParams(current)
                  next.delete('provider')
                  return next
                }, { replace: true })
              }}
              placeholder="搜索名称 / 备注 / 渠道地址 / 协议"
              style={{ ...inputStyle, width: '240px', minWidth: '200px' }}
            />
            <input
              type="text"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              placeholder="模型包含..."
              style={{ ...inputStyle, width: '160px', minWidth: '160px' }}
            />
            <ProviderTagFilter value={selectedTags} options={availableTags} onChange={setSelectedTags} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ ...selectStyle, width: '120px', minWidth: '120px' }}
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
              <option value="frozen">冻结</option>
              <option value="authenticated">已认证</option>
              <option value="unauthenticated">未认证</option>
              <option value="expired">已过期</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ProviderTypeFilter)}
              style={{ ...selectStyle, width: '140px', minWidth: '140px' }}
            >
              <option value="all">全部类型</option>
              <option value="generic">通用渠道</option>
              <option value="custom">自定义渠道</option>
              <option value="builtin">内置</option>
            </select>
            <select
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value as ProviderProtocolFilter)}
              style={{ ...selectStyle, width: '140px', minWidth: '140px' }}
            >
              <option value="all">全部协议</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="responses">Responses</option>
              <option value="gemini">Gemini</option>
              <option value="cloudflare">Cloudflare</option>
              <option value="other">其他协议</option>
            </select>
            <select
              value={autoUpdateFilter}
              onChange={(e) => setAutoUpdateFilter(e.target.value as ProviderAutoUpdateFilter)}
              style={{ ...selectStyle, width: '136px', minWidth: '136px' }}
              title="按「定时更新模型」开关过滤渠道"
            >
              <option value="all">自动更新：全部</option>
              <option value="on">自动更新：开</option>
              <option value="off">自动更新：关</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ProviderSortKey)}
              style={{ ...selectStyle, width: '190px', minWidth: '190px' }}
              title="排序方式"
            >
              {PROVIDER_SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>排序：{opt.label}</option>
              ))}
            </select>
            {activeProviderQuery && (
              <span style={{ ...tagBase, borderColor: 'var(--blue)', color: 'var(--blue)', background: 'var(--tint)' }}>
                来自模型元数据: {activeProviderQuery}
              </span>
            )}
            {hasActiveFilter && (
              <button
                onClick={() => {
                  setSearch('')
                  setModelFilter('')
                  setSelectedTags([])
                  setStatusFilter('all')
                  setTypeFilter('all')
                  setProtocolFilter('all')
                  setAutoUpdateFilter('all')
                  setSortBy('updated')
                  if (providerParam) setSearchParams((current) => {
                    const next = new URLSearchParams(current)
                    next.delete('provider')
                    return next
                  }, { replace: true })
                }}
                style={btnGhost}
              >
                重置
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
              总数 <b style={{ color: 'var(--text)' }}>{formatNumber(summary.totalProviders)}</b>
            </span>
            <span style={{ fontSize: '12px', color: 'var(--green)', whiteSpace: 'nowrap' }}>
              已启用 <b>{formatNumber(summary.enabledProviders)}</b>
            </span>
            <span style={{ fontSize: '12px', color: summary.disabledProviders > 0 ? 'var(--red)' : 'var(--text2)', whiteSpace: 'nowrap' }}>
              已禁用 <b>{formatNumber(summary.disabledProviders)}</b>
            </span>
            <span style={{ fontSize: '12px', color: 'var(--yellow)', whiteSpace: 'nowrap' }}>
              错误/冻结账号 <b>{formatNumber(summary.cooldownAccounts)}</b>
            </span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && providers.length === 0 ? (
          <div style={{ padding: '24px 0', color: 'var(--text2)' }}>正在加载渠道数据...</div>
        ) : error && providers.length === 0 ? (
          <div style={{ padding: '24px 0', color: 'var(--red)' }}>
            <div style={{ marginBottom: '12px' }}>{error}</div>
            <button onClick={() => void loadProviders()} style={btnGhost}>
              重试
            </button>
          </div>
        ) : providers.length === 0 ? (
          <div style={{ padding: '24px 0', color: 'var(--text2)' }}>暂无渠道数据</div>
        ) : filteredProviders.length === 0 ? (
          <div style={{ padding: '24px 0', color: 'var(--text2)' }}>无匹配渠道</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: '16px',
            }}
          >
            {filteredProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isLoading={actionLoading[provider.id] ?? false}
                onToggle={handleToggleEnabled}
                onDelete={handleDelete}
                onDetail={(p) => openProviderModal(p, 'overview')}
                onCopy={handleCopy}
              />
            ))}
          </div>
        )}
        </div>
      </SectionCard>

      <UnifiedProviderModal
        open={modalProvider !== null}
        providerId={modalProvider?.id}
        initialTab={modalInitialTab}
        onClose={closeProviderModal}
        onChanged={() => { void loadProviders() }}
      />

      <ChannelCatalogSelector
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onSelect={(entry) => {
          setCreatePreset(entry.preset)
          setCreatePresetOrigin('catalog')
          setInitialBuiltinType(entry.builtin_type || '')
          setCreateModalOpen(true)
        }}
      />

      <UnifiedProviderModal
        open={createModalOpen}
        mode="create"
        initialTab="basic"
        initialBuiltinType={initialBuiltinType}
        presetData={createPreset}
        presetFromCatalog={createPresetOrigin === 'catalog'}
        onClose={() => { setCreateModalOpen(false); setCreatePreset(null); setCreatePresetOrigin(null); setInitialBuiltinType('') }}
        onBack={() => {
          // 退回渠道类型选择：关掉新建弹框、保留 preset 以便重新进，
          // 重新打开选择器（onSelect 时没关它，但用户可能手动关过）。
          setCreateModalOpen(false)
          setCatalogOpen(true)
        }}
        onChanged={() => { void loadProviders() }}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除渠道「{deleteTarget?.remark || deleteTarget?.id}」吗？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); void confirmDelete() }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  )
}
