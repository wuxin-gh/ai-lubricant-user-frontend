/**
 * 事件配置（通知中心 · 订阅配置 tab）。
 *
 * 三层模型里的中间层：一个「事件」是独立实体，自己带事件类型、生效时间、状态、
 * 触发条件和事件参数；推送目标通过事件↔渠道绑定表挂多个渠道。所以这里配的不是
 * 「某渠道订阅某事件」，而是「这个事件在什么条件下成立、成立后推给哪些渠道」。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BellRing, CirclePlus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ComboMultiSelect, type ComboOption } from '@/components/ui/combo-select'
import { cn } from '@/lib/utils'
import { ContentType } from '@/api/Api'
import { sharedApi } from '@/api/shared-api'
import { getProviders, getProviderAccounts } from '@/@admin-port/api/providers'
import { getApiKeys } from '@/@admin-port/api/apiKeys'
import {
  createNotifyEvent,
  deleteNotifyEvent,
  getNotifyChannels,
  getNotifyEvents,
  getNotifyEventTypes,
  updateNotifyEvent,
  type NotifyChannelLite,
  type NotifyEventDefinition,
  type NotifyEventType,
} from '@/@admin-port/api/dashboard'

const CATEGORY_LABELS: Record<string, string> = {
  account: '账号',
  channel: '渠道',
  api_key: '密钥',
  model: '模型',
  node: '节点',
  security: '安全',
  task: '任务',
  system: '系统',
}

/** 参数值的来源：pickers 从真实数据拉选项，`text` 才让用户自己敲。 */
type ParamSource = 'provider' | 'account' | 'api_key' | 'text'

type ParamField = {
  key: string
  label: string
  source: ParamSource
  /** 空选时的说明，替代原来教人怎么写逗号的 placeholder。 */
  hint: string
}

// 事件参数按事件的一级分类给出可筛的维度：账号类事件盯账号，渠道类盯渠道，等等。
// 后端 _filter_matches 用「复数键 vs 单数参数」匹配，所以键名固定这几个；且它对
// 「事件没带这个维度」判定为不匹配，所以只列事件真会带上的 param —— 节点类事件只
// 带 version/previous_version，给它挂 node_names 会把所有节点通知静默过滤掉。
const PARAM_FIELDS: Record<string, ParamField[]> = {
  account: [
    { key: 'provider_names', label: '限定渠道', source: 'provider', hint: '不选=所有渠道' },
    { key: 'account_usernames', label: '限定账号', source: 'account', hint: '先选渠道再选账号，不选=该范围内所有账号' },
  ],
  channel: [{ key: 'provider_names', label: '限定渠道', source: 'provider', hint: '不选=所有渠道' }],
  api_key: [{ key: 'api_key_ids', label: '限定密钥', source: 'api_key', hint: '不选=所有密钥' }],
  model: [{ key: 'provider_names', label: '限定渠道', source: 'provider', hint: '不选=所有渠道' }],
  node: [],
  security: [],
  task: [],
  system: [],
}

/** 阈值比较可选的参数名：只有这些事件的 params 里真有数值字段。 */
const THRESHOLD_FIELDS: Record<string, ComboOption[]> = {
  'api_key.usage_threshold': [
    { value: 'used', label: '已用量（used）' },
    { value: 'limit', label: '配额上限（limit）' },
  ],
  'account.frozen': [{ value: 'seconds', label: '冻结时长/秒（seconds）' }],
  'channel.frozen': [{ value: 'seconds', label: '冻结时长/秒（seconds）' }],
}

type ConditionKind = 'severity' | 'threshold' | 'count' | 'silence'

type FormState = {
  id: string | null
  name: string
  event_type: string
  status: 'active' | 'disabled'
  effective_from: string
  effective_to: string
  daily_start: string
  daily_end: string
  channel_ids: string[]
  params: Record<string, string[]>
  // 触发条件：勾选哪几种就带哪几条，AND 关系
  useSeverity: boolean
  severityMin: string
  useThreshold: boolean
  thresholdField: string
  thresholdOp: string
  thresholdValue: string
  useCount: boolean
  countTimes: string
  countWindow: string
  useSilence: boolean
  silenceWindow: string
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  event_type: '',
  status: 'active',
  effective_from: '',
  effective_to: '',
  daily_start: '',
  daily_end: '',
  channel_ids: [],
  params: {},
  useSeverity: false,
  severityMin: 'warn',
  useThreshold: false,
  thresholdField: '',
  thresholdOp: '>=',
  thresholdValue: '',
  useCount: false,
  countTimes: '3',
  countWindow: '600',
  useSilence: false,
  silenceWindow: '3600',
}

/** ISO → datetime-local 的 value（后端返回带时区，输入框只吃 YYYY-MM-DDTHH:mm）。 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** 后端 event_params 的值可能是列表、也可能是历史遗留的单值/逗号串，一律归一成列表。 */
function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  const text = String(value ?? '')
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 把事件行还原成表单态（编辑时回填）。 */
function formFromEvent(event: NotifyEventDefinition): FormState {
  const conditions = Array.isArray(event.trigger_condition?.conditions)
    ? (event.trigger_condition.conditions as Record<string, unknown>[])
    : []
  const find = (kind: ConditionKind) =>
    conditions.find((c) => String(c.type ?? '').toLowerCase() === kind)
  const severity = find('severity')
  const threshold = find('threshold')
  const count = find('count')
  const silence = find('silence')
  const params: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(event.event_params ?? {})) {
    const list = toList(value)
    if (list.length > 0) params[key] = list
  }
  return {
    id: event.id,
    name: event.name,
    event_type: event.event_type,
    status: event.status === 'disabled' ? 'disabled' : 'active',
    effective_from: toLocalInput(event.effective_from),
    effective_to: toLocalInput(event.effective_to),
    daily_start: (event.daily_start ?? '').slice(0, 5),
    daily_end: (event.daily_end ?? '').slice(0, 5),
    channel_ids: event.channel_ids ?? [],
    params,
    useSeverity: !!severity,
    severityMin: String(severity?.min ?? 'warn'),
    useThreshold: !!threshold,
    thresholdField: String(threshold?.field ?? ''),
    thresholdOp: String(threshold?.op ?? '>='),
    thresholdValue: String(threshold?.value ?? ''),
    useCount: !!count,
    countTimes: String(count?.times ?? '3'),
    countWindow: String(count?.window_seconds ?? '600'),
    useSilence: !!silence,
    silenceWindow: String(silence?.window_seconds ?? '3600'),
  }
}

/** 表单态 → 后端 payload。空值一律不带，让后端按「无约束」处理。 */
function payloadFromForm(form: FormState) {
  const conditions: Record<string, unknown>[] = []
  if (form.useSeverity) conditions.push({ type: 'severity', min: form.severityMin })
  if (form.useThreshold && form.thresholdField) {
    conditions.push({
      type: 'threshold',
      field: form.thresholdField.trim(),
      op: form.thresholdOp,
      value: form.thresholdValue.trim(),
    })
  }
  if (form.useCount) {
    conditions.push({
      type: 'count',
      times: Number(form.countTimes) || 1,
      window_seconds: Number(form.countWindow) || 0,
    })
  }
  if (form.useSilence) {
    conditions.push({ type: 'silence', window_seconds: Number(form.silenceWindow) || 0 })
  }
  const event_params: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(form.params)) {
    const cleaned = list.map((s) => s.trim()).filter(Boolean)
    if (cleaned.length > 0) event_params[key] = cleaned
  }
  return {
    name: form.name.trim(),
    event_type: form.event_type,
    status: form.status,
    effective_from: form.effective_from ? new Date(form.effective_from).toISOString() : null,
    effective_to: form.effective_to ? new Date(form.effective_to).toISOString() : null,
    daily_start: form.daily_start || null,
    daily_end: form.daily_end || null,
    trigger_condition: conditions.length > 0 ? { conditions } : {},
    event_params,
    channel_ids: form.channel_ids,
  }
}

/** 事件行下方那句人话摘要：什么条件下、推给谁。 */
function describe(event: NotifyEventDefinition, channelName: (id: string) => string): string {
  const parts: string[] = []
  const paramEntries = Object.entries(event.event_params ?? {})
    .map(([k, v]) => [k, toList(v)] as const)
    .filter(([, list]) => list.length > 0)
  parts.push(paramEntries.length === 0
    ? '全部参数'
    : paramEntries.map(([, list]) => list.join('、')).join(' / '))

  const conditions = Array.isArray(event.trigger_condition?.conditions)
    ? (event.trigger_condition.conditions as Record<string, unknown>[])
    : []
  for (const c of conditions) {
    const kind = String(c.type ?? '').toLowerCase()
    if (kind === 'severity') parts.push(`级别≥${c.min}`)
    else if (kind === 'threshold') parts.push(`${c.field}${c.op}${c.value}`)
    else if (kind === 'count') parts.push(`${c.times}次/${c.window_seconds}秒`)
    else if (kind === 'silence') parts.push(`静默${c.window_seconds}秒`)
  }
  if (event.daily_start && event.daily_end) {
    parts.push(`每天 ${event.daily_start.slice(0, 5)}-${event.daily_end.slice(0, 5)}`)
  }
  const channels = (event.channel_ids ?? []).map(channelName)
  parts.push(channels.length > 0 ? `推送：${channels.join('、')}` : '未绑定渠道')
  return parts.join(' · ')
}

/** 弹框里的分区外壳：统一标题/说明/留白，避免每块自己拼一套 border+padding。 */
function Section({
  title,
  hint,
  aside,
  children,
}: {
  title: string
  hint?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border bg-muted/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 触发条件的一行：勾选框 + 说明，勾上才展开参数，未勾时不占版面。 */
function ConditionRow({
  id,
  checked,
  onCheckedChange,
  label,
  hint,
  children,
}: {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  hint: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        checked ? 'border-primary/40 bg-background' : 'bg-background/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(c) => onCheckedChange(c === true)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          {checked ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </div>
  )
}

export type NotificationEventsScope = 'platform' | 'user'

export default function NotificationEvents({ scope = 'platform' }: { scope?: NotificationEventsScope }) {
  const api = sharedApi
  const [events, setEvents] = useState<NotifyEventDefinition[]>([])
  const [eventTypes, setEventTypes] = useState<NotifyEventType[]>([])
  const [channels, setChannels] = useState<NotifyChannelLite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // 参数筛选框的候选项。渠道/密钥进弹窗时拉一次；账号按已选渠道拉（账号接口是
  // 按渠道分页的，没有全局账号列表），所以跟着 provider_names 变。
  const [providerOptions, setProviderOptions] = useState<ComboOption[]>([])
  const [apiKeyOptions, setApiKeyOptions] = useState<ComboOption[]>([])
  const [accountOptions, setAccountOptions] = useState<ComboOption[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const loadScopedEvents = useCallback(async () => {
    if (scope === 'platform') return getNotifyEvents()
    const res = await api.request<{ code: number; data?: NotifyEventDefinition[] }>({
      path: '/api/v1/users/notifications/events', method: 'GET', format: 'json',
    })
    return res.data?.code === 0 ? (res.data.data ?? []) : []
  }, [scope])

  const loadScopedTypes = useCallback(async () => {
    if (scope === 'platform') return getNotifyEventTypes()
    const res = await api.request<{ code: number; data?: NotifyEventType[] }>({
      path: '/api/v1/users/notifications/event-types', method: 'GET', format: 'json',
    })
    return res.data?.code === 0 ? (res.data.data ?? []) : []
  }, [scope])

  const loadScopedChannels = useCallback(async () => {
    if (scope === 'platform') return getNotifyChannels()
    const res = await api.api.v1UsersNotifyChannelsList()
    return res.data?.code === 0 && Array.isArray(res.data.data)
      ? res.data.data.map((channel) => ({
          id: channel.id!, name: channel.name ?? '', kind: String(channel.kind ?? ''),
        }))
      : []
  }, [scope])

  const createScopedEvent = useCallback(async (payload: Record<string, unknown>) => {
    if (scope === 'platform') return createNotifyEvent(payload)
    const res = await api.request<{ code: number; data?: NotifyEventDefinition; message?: string }>({
      path: '/api/v1/users/notifications/events', method: 'POST', body: payload,
      type: ContentType.Json, format: 'json',
    })
    if (res.data?.code !== 0 || !res.data.data) throw new Error(res.data?.message || '事件创建失败')
    return res.data.data
  }, [scope])

  const updateScopedEvent = useCallback(async (id: string, payload: Record<string, unknown>) => {
    if (scope === 'platform') return updateNotifyEvent(id, payload)
    const res = await api.request<{ code: number; message?: string }>({
      path: `/api/v1/users/notifications/events/${id}`, method: 'PUT', body: payload,
      type: ContentType.Json, format: 'json',
    })
    if (res.data?.code !== 0) throw new Error(res.data?.message || '事件保存失败')
  }, [scope])

  const deleteScopedEvent = useCallback(async (id: string) => {
    if (scope === 'platform') return deleteNotifyEvent(id)
    const res = await api.request<{ code: number; message?: string }>({
      path: `/api/v1/users/notifications/events/${id}`, method: 'DELETE', format: 'json',
    })
    if (res.data?.code !== 0) throw new Error(res.data?.message || '事件删除失败')
  }, [scope])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextEvents, nextTypes, nextChannels] = await Promise.all([
        loadScopedEvents(),
        loadScopedTypes(),
        loadScopedChannels(),
      ])
      setEvents(nextEvents)
      setEventTypes(nextTypes.filter((t) => t.owner_scope === scope))
      setChannels(nextChannels)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载事件配置失败')
    } finally {
      setLoading(false)
    }
  }, [loadScopedEvents, loadScopedTypes, loadScopedChannels, scope])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!dialogOpen || scope !== 'platform') return
    let cancelled = false
    void Promise.all([
      getProviders({ lite: true }).catch(() => []),
      getApiKeys().catch(() => ({ enabled: false, keys: [] })),
    ]).then(([providers, apiKeys]) => {
      if (cancelled) return
      setProviderOptions(providers.map((provider) => ({
        value: provider.name,
        label: provider.remark ? `${provider.remark}（${provider.name}）` : provider.name,
      })))
      setApiKeyOptions(apiKeys.keys.map((key) => ({
        value: String(key.id),
        label: `${key.name || '未命名密钥'}（ID: ${key.id}）`,
      })))
    })
    return () => { cancelled = true }
  }, [dialogOpen, scope])

  const selectedProviders = form.params.provider_names ?? []
  useEffect(() => {
    if (!dialogOpen || scope !== 'platform' || selectedProviders.length === 0) {
      setAccountOptions([])
      setLoadingAccounts(false)
      return
    }
    let cancelled = false
    setLoadingAccounts(true)
    void Promise.all(selectedProviders.map(async (provider) => ({
      provider,
      accounts: await getProviderAccounts(provider, { view: 'lite' }).catch(() => []),
    }))).then((groups) => {
      if (cancelled) return
      const providersByUsername = new Map<string, string[]>()
      for (const group of groups) {
        for (const account of group.accounts) {
          const names = providersByUsername.get(account.username) ?? []
          names.push(group.provider)
          providersByUsername.set(account.username, names)
        }
      }
      setAccountOptions([...providersByUsername.entries()].map(([username, providers]) => ({
        value: username,
        label: `${username}（${providers.join('、')}）`,
      })))
    }).finally(() => {
      if (!cancelled) setLoadingAccounts(false)
    })
    return () => { cancelled = true }
  }, [dialogOpen, scope, selectedProviders.join('|')])

  const groupedTypes = useMemo(() => {
    const groups = new Map<string, NotifyEventType[]>()
    for (const t of eventTypes) {
      const bucket = groups.get(t.category) ?? []
      bucket.push(t)
      groups.set(t.category, bucket)
    }
    return [...groups.entries()]
  }, [eventTypes])

  const typeName = (type: string) => eventTypes.find((t) => t.type === type)?.name ?? type
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? id
  const currentCategory = eventTypes.find((t) => t.type === form.event_type)?.category ?? ''
  const paramFields = PARAM_FIELDS[currentCategory] ?? []
  const thresholdOptions = THRESHOLD_FIELDS[form.event_type] ?? []

  const optionsForField = (field: ParamField): ComboOption[] => {
    if (field.source === 'provider') return providerOptions
    if (field.source === 'account') return accountOptions
    if (field.source === 'api_key') return apiKeyOptions
    return []
  }

  const updateParam = (key: string, values: string[]) => {
    setForm((prev) => ({
      ...prev,
      params: { ...prev.params, [key]: values },
    }))
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (event: NotifyEventDefinition) => {
    setForm(formFromEvent(event))
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.event_type) {
      toast.error('请选择事件类型')
      return
    }
    if (form.channel_ids.length === 0) {
      toast.error('请至少绑定一个通知渠道')
      return
    }
    setSaving(true)
    try {
      const payload = payloadFromForm(form)
      if (form.id) {
        await updateScopedEvent(form.id, payload)
        toast.success('事件已保存')
      } else {
        await createScopedEvent(payload)
        toast.success('事件已添加')
      }
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存事件失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (event: NotifyEventDefinition) => {
    try {
      await deleteScopedEvent(event.id)
      setEvents((current) => current.filter((item) => item.id !== event.id))
      toast.success('事件已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除事件失败')
    }
  }

  const toggleChannel = (id: string) => {
    setForm((prev) => ({
      ...prev,
      channel_ids: prev.channel_ids.includes(id)
        ? prev.channel_ids.filter((c) => c !== id)
        : [...prev.channel_ids, id],
    }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          事件自带生效时间、状态、触发条件与参数；一个事件可推送到多个通知渠道。
        </p>
        <Button size="sm" onClick={openCreate} disabled={eventTypes.length === 0}>
          <CirclePlus className="size-4" />
          添加事件
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          <BellRing className="mx-auto mb-2 size-8 opacity-30" />
          暂无事件配置
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{event.name}</span>
                  <Badge variant="outline">{typeName(event.event_type)}</Badge>
                  <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
                    {event.status === 'active' ? '启用' : '停用'}
                  </Badge>
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">
                  {describe(event, channelName)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(event)} aria-label="编辑事件">
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void handleDelete(event)} aria-label="删除事件">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? '编辑事件' : '添加事件'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <Section
              title="事件基础"
              hint="选择要订阅的事件类型，再给它一个便于辨认的名字。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">事件类型</Label>
                  <Select
                    value={form.event_type}
                    onValueChange={(v) => setForm((prev) => ({
                    ...prev,
                    event_type: v,
                    params: {},
                    // 新事件类型可能没有可比的数值字段，阈值条件要随之清掉，
                    // 否则一个已隐藏的字段会随 payload 偷偷提交。
                    useThreshold: false,
                    thresholdField: '',
                    thresholdValue: '',
                  }))}
                  >
                    <SelectTrigger><SelectValue placeholder="按分类选择事件" /></SelectTrigger>
                    <SelectContent>
                      {groupedTypes.map(([category, items]) => (
                        <div key={category}>
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                            {CATEGORY_LABELS[category] ?? category}
                          </div>
                          {items.map((t) => (
                            <SelectItem key={t.type} value={t.type}>{t.name}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">事件名称</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="留空则用事件类型名"
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">事件状态</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as 'active' | 'disabled' }))}
                  >
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="disabled">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Section>

            <Section
              title="生效时间"
              hint="可选：限定事件只在某段时间、每天的某段时间内触发；全留空表示始终生效。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">生效起始</Label>
                  <Input
                    type="datetime-local"
                    value={form.effective_from}
                    onChange={(e) => setForm((prev) => ({ ...prev, effective_from: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">留空=不限起始</p>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">生效截止</Label>
                  <Input
                    type="datetime-local"
                    value={form.effective_to}
                    onChange={(e) => setForm((prev) => ({ ...prev, effective_to: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">留空=不限制止</p>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">每天开始时间</Label>
                  <Input
                    type="time"
                    value={form.daily_start}
                    onChange={(e) => setForm((prev) => ({ ...prev, daily_start: e.target.value }))}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-medium">每天结束时间</Label>
                  <Input
                    type="time"
                    value={form.daily_end}
                    onChange={(e) => setForm((prev) => ({ ...prev, daily_end: e.target.value }))}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                每日时间窗两个都留空表示全天；结束早于开始表示跨零点（如 22:00–06:00）。
              </p>
            </Section>

            {paramFields.length > 0 && (
              <section className="rounded-xl border bg-muted/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">事件参数</h3>
                    <p className="mt-1 text-xs text-muted-foreground">选择要关注的对象；全部留空表示不限制范围。</p>
                  </div>
                  <Badge variant="outline">可选筛选</Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {paramFields.map((field) => {
                    const values = form.params[field.key] ?? []
                    const options = optionsForField(field)
                    const accountNeedsProvider = field.source === 'account' && selectedProviders.length === 0
                    return (
                      <div key={field.key} className="min-w-0 space-y-1.5">
                        <Label className="text-xs font-medium">{field.label}</Label>
                        <ComboMultiSelect
                          value={values}
                          onChange={(next) => updateParam(field.key, next)}
                          options={options}
                          disabled={accountNeedsProvider || (field.source === 'account' && loadingAccounts)}
                          placeholder={accountNeedsProvider ? '请先选择渠道' : field.source === 'account' && loadingAccounts ? '正在加载账号…' : '搜索并选择，可多选'}
                          contentZIndex={1101}
                          className="min-h-10 bg-background"
                        />
                        <p className="text-[11px] text-muted-foreground">{field.hint}</p>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <Section
              title="触发条件"
              hint="勾选的条件需同时满足才会推送；不勾任何条件=事件发生即推。"
            >
              <div className="grid gap-3">
                <ConditionRow
                  id="cond-severity"
                  checked={form.useSeverity}
                  onCheckedChange={(c) => setForm((prev) => ({ ...prev, useSeverity: c }))}
                  label="按严重级别过滤"
                  hint="只推送达到指定级别及以上的事件。"
                >
                  <Select
                    value={form.severityMin}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, severityMin: v }))}
                  >
                    <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">info 及以上</SelectItem>
                      <SelectItem value="warn">warn 及以上</SelectItem>
                      <SelectItem value="error">error 及以上</SelectItem>
                      <SelectItem value="critical">仅 critical</SelectItem>
                    </SelectContent>
                  </Select>
                </ConditionRow>

                {thresholdOptions.length > 0 && (
                  <ConditionRow
                    id="cond-threshold"
                    checked={form.useThreshold}
                    onCheckedChange={(c) => setForm((prev) => ({ ...prev, useThreshold: c }))}
                    label="阈值比较"
                    hint="事件携带的数值达到条件才推送。"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={form.thresholdField}
                        onValueChange={(v) => setForm((prev) => ({ ...prev, thresholdField: v }))}
                      >
                        <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="选择数值字段" /></SelectTrigger>
                        <SelectContent>
                          {thresholdOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={form.thresholdOp}
                        onValueChange={(v) => setForm((prev) => ({ ...prev, thresholdOp: v }))}
                      >
                        <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['>', '>=', '<', '<=', '==', '!='].map((op) => (
                            <SelectItem key={op} value={op}>{op}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="w-[120px]"
                        value={form.thresholdValue}
                        onChange={(e) => setForm((prev) => ({ ...prev, thresholdValue: e.target.value }))}
                        placeholder="阈值"
                      />
                    </div>
                  </ConditionRow>
                )}

                <ConditionRow
                  id="cond-count"
                  checked={form.useCount}
                  onCheckedChange={(c) => setForm((prev) => ({ ...prev, useCount: c }))}
                  label="累计次数才触发"
                  hint="同一对象在时间窗内累计发生若干次才推送，避免偶发抖动刷屏。"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">累计</span>
                    <Input
                      className="w-[80px]"
                      value={form.countTimes}
                      onChange={(e) => setForm((prev) => ({ ...prev, countTimes: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground">次 / 窗口</span>
                    <Input
                      className="w-[100px]"
                      value={form.countWindow}
                      onChange={(e) => setForm((prev) => ({ ...prev, countWindow: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground">秒（0=不限窗口）</span>
                  </div>
                </ConditionRow>

                <ConditionRow
                  id="cond-silence"
                  checked={form.useSilence}
                  onCheckedChange={(c) => setForm((prev) => ({ ...prev, useSilence: c }))}
                  label="静默期去重"
                  hint="推送一次后，静默期内对同一对象不再重复推送。"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">静默</span>
                    <Input
                      className="w-[120px]"
                      value={form.silenceWindow}
                      onChange={(e) => setForm((prev) => ({ ...prev, silenceWindow: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground">秒内不再推送同一对象</span>
                  </div>
                </ConditionRow>
              </div>
            </Section>

            <Section
              title="推送渠道"
              hint="选择事件触发后要推送到哪些渠道；可多选。"
              aside={<Badge variant="outline">{form.channel_ids.length} 已选</Badge>}
            >
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  还没有通知渠道，先到「渠道配置」tab 添加。
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {channels.map((channel) => {
                    const selected = form.channel_ids.includes(channel.id)
                    const isCenter = channel.kind === 'notify_center'
                    return (
                      <label
                        key={channel.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 transition-colors',
                          selected ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleChannel(channel.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{channel.name}</span>
                        <Badge variant={isCenter ? 'default' : 'outline'} className="text-xs">
                          {isCenter ? '站内 + App' : channel.kind}
                        </Badge>
                      </label>
                    )
                  })}
                  <p className="col-span-full mt-1 text-[11px] text-muted-foreground">
                    勾选「通知中心」该事件才会进入站内通知列表并推送到 App；不勾选则只发所选 webhook/机器人。
                  </p>
                </div>
              )}
            </Section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : null}
              {form.id ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
