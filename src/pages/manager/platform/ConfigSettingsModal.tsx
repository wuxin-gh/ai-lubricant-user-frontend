/**
 * 渠道级 / 日志级配置弹框。
 * 运行配置与测试类型分成独立工作区；测试类型采用列表 + 详情编辑。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { CircleQuestionMark } from 'lucide-react'
import { toast } from 'sonner'
import {
  getMainConfig,
  updateModelRefreshConfig,
  updateMessageDeleteConfig,
  updateRetryConfig,
  updateRateLimitConfig,
  updateStreamConfig,
  updateLogRetentionConfig,
  updateDataRetentionConfig,
  updateAccountTestConfig,
} from '@/@admin-port/api/dashboard'
import { getHeaderTemplates, saveHeaderTemplates } from '@/@admin-port/api/providers'
import type { HeaderTemplate, TestTypeDef } from '@/@admin-port/types/admin'

export type ConfigSection = 'scheduled' | 'scheduledTest' | 'retry' | 'stream' | 'retention' | 'testTypes' | 'headerTemplates'

interface Props {
  open: boolean
  onClose: () => void
  sections: ConfigSection[]
  title?: string
}

interface NumberField {
  kind: 'number'
  path: string
  label: string
  hint: string
  suffix?: string
}
interface ToggleField {
  kind: 'toggle'
  path: string
  label: string
  hint: string
}
type Field = NumberField | ToggleField

export const SECTION_FIELDS: Record<ConfigSection, { title: string; fields: Field[] }> = {
  scheduled: {
    title: '定时任务',
    fields: [
      { kind: 'number', path: 'model_refresh.interval_minutes', label: '模型刷新间隔', hint: '多久从上游重新拉取一次模型列表。', suffix: '分钟' },
      { kind: 'toggle', path: 'message_delete.enabled', label: '消息删除', hint: '开启后，后台会按设定间隔清理消息数据。' },
      { kind: 'number', path: 'message_delete.interval_minutes', label: '消息删除间隔', hint: '后台执行消息清理任务的频率。', suffix: '分钟' },
    ],
  },
  scheduledTest: {
    title: '定时检测',
    fields: [
      { kind: 'number', path: 'scheduled_test.concurrency', label: '检测并发数', hint: '所有渠道共用一个检测消费者池；并发越高越不易堆积，但对上游压力也越大。', suffix: '个' },
      { kind: 'number', path: 'scheduled_test.skip_if_requested_within_seconds', label: '最近请求跳过窗口', hint: '账号在这段时间内有过真实请求就跳过本轮检测（刚被流量证明可达，无需再探）。0=不跳过。', suffix: '秒' },
    ],
  },
  retry: {
    title: '重试与限流',
    fields: [
      { kind: 'number', path: 'retry.max_retries', label: '模型重试次数', hint: '模型请求失败后的全局重试次数。', suffix: '次' },
      { kind: 'number', path: 'rate_limit.cooldown_seconds', label: '限流冷却时间', hint: '触发上游限流后，该账号暂时不再被选用的时长。', suffix: '秒' },
      { kind: 'number', path: 'rate_limit.exception_cooldown_seconds', label: '异常冷却时间', hint: '发生网络或服务端异常后，该账号的临时冷却时长。', suffix: '秒' },
      { kind: 'toggle', path: 'rate_limit.allow_token_reservation_overflow', label: '允许渠道 token 预占触线放行', hint: '仅影响渠道账号和模型的 token 限额，不影响 API Key 限额。开启后，本次预占达到限额时仍执行并冻结后续请求；关闭后，拒绝当前渠道候选并尝试其他账号。' },
      { kind: 'toggle', path: 'retry.context_overflow_not_retryable_enabled', label: '上下文超限不重试', hint: '开启后，命中上下文/token 超限时直接返回标准错误，不消耗重试次数。' },
    ],
  },
  stream: {
    title: '流式响应',
    fields: [
      { kind: 'toggle', path: 'stream.incomplete_error_enabled', label: '不完整响应返回错误', hint: '上游只返回结束标记、没有有效内容时，判为失败并允许切换账号重试。' },
    ],
  },
  retention: {
    title: '日志保留',
    fields: [
      { kind: 'number', path: 'data_retention.log_days', label: '日志保留天数', hint: '超过这个天数的请求日志会在清理时整行删除。', suffix: '天' },
      { kind: 'number', path: 'log_retention.max_entries', label: '日志保留条数上限', hint: '数据库删除阈值：清理时把 request_logs 删到只剩这么多条。填 0 = 只按天数保留，不按条数删。', suffix: '条' },
      { kind: 'number', path: 'data_retention.cleanup_hour', label: '定时清理时刻', hint: '每天在这个小时执行日志清理任务。', suffix: '点 (0-23)' },
    ],
  },
  testTypes: { title: '测试类型', fields: [] },
  headerTemplates: { title: 'Headers 配置', fields: [] },
}

/** 模板值支持的通用变量，请求时逐次渲染（后端 providers/custom.py 的
 *  build_request_template_variables / render_account_template_paths 渲染）。
 *  Headers 模板与测试模板共用这一份，缺值一律渲染为空串，密钥类字段不暴露给模板。 */
const TEMPLATE_VARIABLES: Array<{ token: string; desc: string }> = [
  { token: '{{uuid}}', desc: '随机 UUID v4' },
  { token: '{{time}}', desc: 'UTC ISO 时间' },
  { token: '{{timestamp}}', desc: 'Unix 秒' },
  { token: '{{timestamp_ms}}', desc: 'Unix 毫秒' },
  { token: '{{client_session_id}}', desc: '客户端会话 ID' },
  { token: '{{client_request_id}}', desc: '客户端请求 ID' },
  { token: '{{account.username}}', desc: '账号用户名' },
  { token: '{{account.provider}}', desc: '渠道协议名' },
  { token: '{{account.metadata.键名}}', desc: '账号元数据（账号编辑页配置；勿存密钥）' },
]

/** Headers 模板值支持的变量，出站请求时按请求逐次渲染。 */
const HEADER_TEMPLATE_VARIABLES = TEMPLATE_VARIABLES

/** 测试模板 messages/body 支持的变量：通用变量 + 本次测试上下文（被测模型/账号/渠道）。 */
const TEST_TEMPLATE_VARIABLES: Array<{ token: string; desc: string }> = [
  ...TEMPLATE_VARIABLES,
  { token: '{{model}}', desc: '本次测试的被测模型' },
  { token: '{{username}}', desc: '本次测试的账号' },
  { token: '{{provider}}', desc: '本次测试的渠道' },
]

// Header 模板编辑行：headers 用有序键值对表示，便于改 key 并保持行顺序。
export interface HeaderTemplateRow {
  id: string
  name: string
  headers: Array<{ key: string; value: string }>
}

export function toHeaderTemplateRow(template: HeaderTemplate): HeaderTemplateRow {
  return {
    id: template.id ?? '',
    name: template.name ?? '',
    headers: Object.entries(template.headers ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') })),
  }
}

export const DEFAULT_TEST_TYPES: TestTypeDef[] = [
  { key: 'chat', label: '聊天', operation: null, messages: [{ role: 'user', content: 'hi' }], body: {} },
  { key: 'stream', label: '流式', operation: null, messages: [{ role: 'user', content: 'hi' }], body: { stream: true } },
  {
    key: 'tool', label: '工具', operation: null,
    messages: [{ role: 'user', content: "What's the weather in Beijing? Use the get_weather tool." }],
    body: { tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get the current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'] } } }], tool_choice: 'auto' },
  },
  { key: 'thinking', label: '思考', operation: null, messages: [{ role: 'user', content: 'Think step by step: prove 17 is prime.' }], body: { reasoning_effort: 'medium' } },
  { key: 'multi', label: '多 messages', operation: null, messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello! How can I help?' }, { role: 'user', content: 'Say bye.' }], body: {} },
  { key: 'image', label: '图片生成', operation: 'image', messages: [], body: { prompt: 'A simple test image of a red apple on a desk.', n: 1, size: '1024x1024' } },
  { key: 'video', label: '视频生成', operation: 'video', messages: [], body: { prompt: 'A short test video of ocean waves.' } },
  { key: 'tts', label: '语音合成', operation: 'tts_generation', messages: [], body: { input: 'Hello, this is an account test.', voice: 'alloy', response_format: 'mp3' } },
]

export interface TestTypeRow {
  key: string
  label: string
  operation: string
  messagesText: string
  bodyText: string
}

interface ParseResult {
  valid: boolean
  message?: string
}

export function toRow(t: TestTypeDef): TestTypeRow {
  return {
    key: t.key ?? '',
    label: t.label ?? '',
    operation: t.operation ?? '',
    messagesText: JSON.stringify(t.messages ?? [], null, 2),
    bodyText: JSON.stringify(t.body ?? {}, null, 2),
  }
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (
    acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined
  ), obj)
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.')
  const root: Record<string, unknown> = { ...obj }
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    cur[key] = cur[key] && typeof cur[key] === 'object' ? { ...(cur[key] as Record<string, unknown>) } : {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return root
}

export function validateJson(text: string, expected: 'array' | 'object'): ParseResult {
  try {
    const value: unknown = JSON.parse(text || (expected === 'array' ? '[]' : '{}'))
    if (expected === 'array' && !Array.isArray(value)) return { valid: false, message: '需要是 JSON 数组' }
    if (expected === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return { valid: false, message: '需要是 JSON 对象' }
    return { valid: true }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : '不是合法 JSON' }
  }
}

export function operationMeta(operation: string) {
  switch (operation) {
    case 'image': return { label: '图片', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
    case 'video': return { label: '视频', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' }
    case 'tts_generation': return { label: '语音', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    default: return null
  }
}

export function ConfigSettingsModal({ open, onClose, sections, title }: Props) {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testRows, setTestRows] = useState<TestTypeRow[]>([])
  const [headerRows, setHeaderRows] = useState<HeaderTemplateRow[]>([])
  const [activeTab, setActiveTab] = useState<'runtime' | 'testTypes' | 'headerTemplates'>('runtime')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [selectedHeaderIdx, setSelectedHeaderIdx] = useState(0)

  const showTestTypes = sections.includes('testTypes')
  const showHeaderTemplates = sections.includes('headerTemplates')
  const runtimeSections = sections.filter((section) => section !== 'testTypes' && section !== 'headerTemplates')
  const hasWorkspaces = runtimeSections.length > 0 ? (showTestTypes || showHeaderTemplates) : (showTestTypes && showHeaderTemplates)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getMainConfig()
      setConfig(data as Record<string, unknown>)
      const rawTypes = (data as Record<string, unknown>).account_test as { types?: TestTypeDef[] } | undefined
      const list = Array.isArray(rawTypes?.types) && rawTypes.types.length > 0 ? rawTypes.types : DEFAULT_TEST_TYPES
      setTestRows(list.map(toRow))
      setSelectedIdx(0)
      if (showHeaderTemplates) {
        // Header 模板是独立的全局列表接口，不在 main config 里。
        const templates = await getHeaderTemplates().catch(() => [])
        setHeaderRows(templates.map(toHeaderTemplateRow))
        setSelectedHeaderIdx(0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }, [showHeaderTemplates])

  useEffect(() => {
    if (open) {
      setActiveTab(runtimeSections.length > 0 ? 'runtime' : (showTestTypes ? 'testTypes' : 'headerTemplates'))
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load])

  const handleChange = (path: string, value: unknown) => {
    setConfig((prev) => setByPath(prev, path, value))
  }
  const updateRow = (idx: number, patch: Partial<TestTypeRow>) => {
    setTestRows((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }
  const addRow = () => {
    setTestRows((prev) => {
      const next = [...prev, { key: '', label: '', operation: '', messagesText: '[\n  { "role": "user", "content": "hi" }\n]', bodyText: '{}' }]
      setSelectedIdx(next.length - 1)
      return next
    })
  }
  const removeRow = (idx: number) => {
    setTestRows((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      setSelectedIdx(Math.max(0, Math.min(idx, next.length - 1)))
      return next
    })
  }
  const resetRows = () => {
    setTestRows(DEFAULT_TEST_TYPES.map(toRow))
    setSelectedIdx(0)
  }

  const addHeaderTemplate = () => {
    setHeaderRows((prev) => {
      const used = new Set(prev.map((row) => row.id))
      let index = prev.length + 1
      while (used.has(`template-${index}`)) index += 1
      const next = [...prev, { id: `template-${index}`, name: '', headers: [{ key: '', value: '' }] }]
      setSelectedHeaderIdx(next.length - 1)
      return next
    })
  }
  const updateHeaderTemplate = (idx: number, patch: Partial<HeaderTemplateRow>) => {
    setHeaderRows((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }
  const removeHeaderTemplate = (idx: number) => {
    setHeaderRows((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      setSelectedHeaderIdx(Math.max(0, Math.min(idx, next.length - 1)))
      return next
    })
  }

  const serializeHeaderTemplates = (): { templates?: HeaderTemplate[]; error?: string; errorIndex?: number } => {
    const ids = new Set<string>()
    const templates: HeaderTemplate[] = []
    for (const [index, row] of headerRows.entries()) {
      const id = row.id.trim()
      const name = row.name.trim()
      if (!id) return { error: 'Header 模板 ID 不能为空', errorIndex: index }
      if (!name) return { error: `模板「${id}」的名称不能为空`, errorIndex: index }
      if (ids.has(id)) return { error: `Header 模板 ID 重复：${id}`, errorIndex: index }
      ids.add(id)
      const headers: Record<string, string> = {}
      const headerKeys = new Set<string>()
      for (const header of row.headers) {
        const key = header.key.trim()
        if (!key && !header.value.trim()) continue
        if (!key) return { error: `模板「${name}」存在未填写名称的 Header`, errorIndex: index }
        const normalized = key.toLowerCase()
        if (headerKeys.has(normalized)) return { error: `模板「${name}」的 Header 重复：${key}`, errorIndex: index }
        headerKeys.add(normalized)
        headers[key] = header.value
      }
      templates.push({ id, name, headers })
    }
    return { templates }
  }

  const serializeTestTypes = (): { types?: TestTypeDef[]; error?: string; errorIndex?: number } => {
    const seen = new Set<string>()
    const types: TestTypeDef[] = []
    for (const [index, row] of testRows.entries()) {
      const key = row.key.trim()
      if (!key) return { error: '测试类型的标识（key）不能为空', errorIndex: index }
      if (!/^[a-z0-9_]+$/.test(key)) return { error: `「${key}」的 key 只能使用小写英文、数字或下划线`, errorIndex: index }
      if (seen.has(key)) return { error: `测试类型标识重复：${key}`, errorIndex: index }
      seen.add(key)
      const messagesCheck = validateJson(row.messagesText, 'array')
      if (!messagesCheck.valid) return { error: `「${key}」的请求消息无效：${messagesCheck.message}`, errorIndex: index }
      const bodyCheck = validateJson(row.bodyText, 'object')
      if (!bodyCheck.valid) return { error: `「${key}」的附加请求体无效：${bodyCheck.message}`, errorIndex: index }
      types.push({
        key,
        label: row.label.trim() || key,
        operation: row.operation.trim() || null,
        messages: JSON.parse(row.messagesText || '[]') as TestTypeDef['messages'],
        body: JSON.parse(row.bodyText || '{}') as Record<string, unknown>,
      })
    }
    return { types }
  }

  // 按 section 调对应的细分接口：每个接口只改自己那一段，段间互不覆盖。
  // 只保存本弹框实际展示的 section，避免误动未加载的配置段。
  const saveRuntimeSections = async () => {
    const num = (path: string, fallback: number): number => {
      const value = getByPath(config, path)
      return typeof value === 'number' ? value : (value != null && value !== '' ? Number(value) : fallback)
    }
    const bool = (path: string): boolean => Boolean(getByPath(config, path))
    for (const sectionKey of runtimeSections) {
      if (sectionKey === 'scheduled') {
        await updateModelRefreshConfig(num('model_refresh.interval_minutes', 30))
        await updateMessageDeleteConfig(bool('message_delete.enabled'), num('message_delete.interval_minutes', 30))
      } else if (sectionKey === 'retry') {
        await updateRetryConfig({
          max_retries: num('retry.max_retries', 3),
          context_overflow_not_retryable_enabled: bool('retry.context_overflow_not_retryable_enabled'),
        })
        // rate-limit 接口整体替换 rate_limit：status_codes 保留配置现值（本弹框不编辑）。
        const statusCodes = getByPath(config, 'rate_limit.status_codes')
        await updateRateLimitConfig({
          status_codes: Array.isArray(statusCodes) ? statusCodes : [429],
          cooldown_seconds: num('rate_limit.cooldown_seconds', 60),
          exception_cooldown_seconds: num('rate_limit.exception_cooldown_seconds', 30),
        })
      } else if (sectionKey === 'stream') {
        await updateStreamConfig({ incomplete_error_enabled: bool('stream.incomplete_error_enabled') })
      } else if (sectionKey === 'retention') {
        await updateLogRetentionConfig(num('log_retention.max_entries', 200))
        await updateDataRetentionConfig(num('data_retention.log_days', 30), num('data_retention.cleanup_hour', 2))
      }
    }
  }

  const handleSave = async () => {
    let types: TestTypeDef[] | undefined
    let templates: HeaderTemplate[] | undefined
    if (showTestTypes) {
      const result = serializeTestTypes()
      if (result.error) {
        setError(result.error)
        setActiveTab('testTypes')
        if (result.errorIndex != null) setSelectedIdx(result.errorIndex)
        toast.error(result.error)
        return
      }
      types = result.types
    }
    if (showHeaderTemplates) {
      const result = serializeHeaderTemplates()
      if (result.error) {
        setError(result.error)
        setActiveTab('headerTemplates')
        if (result.errorIndex != null) setSelectedHeaderIdx(result.errorIndex)
        toast.error(result.error)
        return
      }
      templates = result.templates
    }
    setSaving(true)
    setError(null)
    try {
      await saveRuntimeSections()
      if (types) {
        await updateAccountTestConfig(types as unknown as Record<string, unknown>[])
      }
      if (templates) {
        await saveHeaderTemplates(templates)
      }
      toast.success('配置保存成功')
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存配置失败'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const runtimeContent = (
    <RuntimeSettings
      sections={runtimeSections}
      config={config}
      onChange={handleChange}
    />
  )
  const testTypesContent = (
    <TestTypesEditor
      rows={testRows}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onUpdate={updateRow}
      onAdd={addRow}
      onRemove={removeRow}
      onReset={resetRows}
    />
  )
  const headerTemplatesContent = (
    <HeaderTemplatesEditor
      rows={headerRows}
      selectedIdx={selectedHeaderIdx}
      onSelect={setSelectedHeaderIdx}
      onUpdate={updateHeaderTemplate}
      onAdd={addHeaderTemplate}
      onRemove={removeHeaderTemplate}
    />
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[min(96vw,1180px)] max-w-[min(96vw,1180px)] flex-col overflow-hidden sm:max-w-[min(96vw,1180px)]">
        <DialogHeader>
          <DialogTitle>{title ?? '配置'}</DialogTitle>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {loading ? (
          <div className="flex min-h-72 items-center justify-center"><Spinner className="size-6" /></div>
        ) : hasWorkspaces ? (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'runtime' | 'testTypes' | 'headerTemplates')} className="min-h-0 flex-1">
            <TabsList variant="line" className="w-full justify-start border-b">
              {runtimeSections.length > 0 && <TabsTrigger value="runtime">运行配置</TabsTrigger>}
              {showTestTypes && <TabsTrigger value="testTypes">测试类型</TabsTrigger>}
              {showHeaderTemplates && <TabsTrigger value="headerTemplates">Headers 配置</TabsTrigger>}
            </TabsList>
            {runtimeSections.length > 0 && <TabsContent value="runtime" className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">{runtimeContent}</TabsContent>}
            {showTestTypes && <TabsContent value="testTypes" className="mt-4 min-h-0 flex-1 overflow-hidden">{testTypesContent}</TabsContent>}
            {showHeaderTemplates && <TabsContent value="headerTemplates" className="mt-4 min-h-0 flex-1 overflow-hidden">{headerTemplatesContent}</TabsContent>}
          </Tabs>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {showHeaderTemplates ? headerTemplatesContent : showTestTypes ? testTypesContent : runtimeContent}
          </div>
        )}
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading}>
            {saving && <Spinner className="mr-2 size-4" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RuntimeSettings({
  sections,
  config,
  onChange,
}: {
  sections: ConfigSection[]
  config: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((sectionKey) => {
        const section = SECTION_FIELDS[sectionKey]
        return (
          <section key={sectionKey} className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">{section.title}</h3>
            <div className="flex flex-col gap-3">
              {section.fields.map((field) => {
                const value = getByPath(config, field.path)
                return (
                  <div key={field.path} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Label className="font-normal">{field.label}</Label>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{field.hint}</p>
                    </div>
                    {field.kind === 'toggle' ? (
                      <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange(field.path, checked)} />
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          type="number"
                          className="h-9 w-[100px]"
                          value={typeof value === 'number' ? value : (value != null ? String(value) : '')}
                          onChange={(event) => onChange(field.path, event.target.value === '' ? undefined : Number(event.target.value))}
                        />
                        {field.suffix && <span className="w-12 text-xs text-muted-foreground">{field.suffix}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function TestTypesEditor({
  rows,
  selectedIdx,
  onSelect,
  onUpdate,
  onAdd,
  onRemove,
  onReset,
}: {
  rows: TestTypeRow[]
  selectedIdx: number
  onSelect: (idx: number) => void
  onUpdate: (idx: number, patch: Partial<TestTypeRow>) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  onReset: () => void
}) {
  const selected = rows[selectedIdx]
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Alert>
        <AlertDescription className="text-xs leading-5">
          <strong>账号测试</strong> Tab 的「测试类型」下拉来自这里。每个类型定义一次请求的消息和附加 body。
          <br />默认类型未被改动时仍会按目标协议自动适配工具/思考字段；自定义或改动后的类型按 messages + body 原样下发。
          <br />messages / body 里的字符串支持 <code>{'{{变量}}'}</code>（与 Headers 配置同一套，另有 <code>{'{{model}}'}</code>、<code>{'{{username}}'}</code>、<code>{'{{provider}}'}</code>），详见字段旁的问号。
        </AlertDescription>
      </Alert>
      <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] gap-4">
        <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/20 p-2">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row, idx) => {
              const meta = operationMeta(row.operation)
              const selectedRow = idx === selectedIdx
              return (
                <button
                  key={`${row.key}-${idx}`}
                  type="button"
                  onClick={() => onSelect(idx)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${selectedRow ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.label || '未命名类型'}</span>
                    <span className={`block truncate text-xs ${selectedRow ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{row.key || '未设置 key'}</span>
                  </span>
                  {meta && <Badge variant="secondary" className={selectedRow ? 'border-0 bg-primary-foreground/15 text-primary-foreground' : meta.className}>{meta.label}</Badge>}
                </button>
              )
            })}
            {rows.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">还没有测试类型</p>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
            <Button type="button" size="sm" variant="outline" onClick={onAdd}>新增</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onReset}>恢复默认</Button>
          </div>
        </aside>
        <div className="min-h-0 overflow-y-auto rounded-lg border p-4">
          {selected ? (
            <TestTypeDetails row={selected} index={selectedIdx} onUpdate={onUpdate} onRemove={onRemove} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个类型，或新建类型。</div>
          )}
        </div>
      </div>
    </div>
  )
}

export function HeaderTemplatesEditor({
  rows,
  selectedIdx,
  onSelect,
  onUpdate,
  onAdd,
  onRemove,
}: {
  rows: HeaderTemplateRow[]
  selectedIdx: number
  onSelect: (idx: number) => void
  onUpdate: (idx: number, patch: Partial<HeaderTemplateRow>) => void
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  const selected = rows[selectedIdx]
  const updateHeader = (headerIdx: number, patch: Partial<{ key: string; value: string }>) => {
    if (!selected) return
    onUpdate(selectedIdx, {
      headers: selected.headers.map((header, idx) => (idx === headerIdx ? { ...header, ...patch } : header)),
    })
  }
  const addHeader = () => {
    if (!selected) return
    onUpdate(selectedIdx, { headers: [...selected.headers, { key: '', value: '' }] })
  }
  const removeHeader = (headerIdx: number) => {
    if (!selected) return
    onUpdate(selectedIdx, { headers: selected.headers.filter((_, idx) => idx !== headerIdx) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)] gap-4">
        <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/20 p-2">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row, idx) => {
              const selectedRow = idx === selectedIdx
              return (
                <button
                  key={`${row.id}-${idx}`}
                  type="button"
                  onClick={() => onSelect(idx)}
                  className={`mb-1 flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${selectedRow ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  <span className="truncate text-sm font-medium">{row.name || '未命名模板'}</span>
                  <span className={`truncate text-xs ${selectedRow ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{row.id || '未设置 ID'}</span>
                </button>
              )
            })}
            {rows.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">还没有 Header 模板</p>}
          </div>
          <div className="mt-2 border-t pt-2">
            <Button type="button" size="sm" variant="outline" className="w-full" onClick={onAdd}>新增模板</Button>
          </div>
        </aside>
        <div className="min-h-0 overflow-y-auto rounded-lg border p-4">
          {selected ? (
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldHelp label="模板 ID" hint="渠道协议行保存的是这个 ID；修改后需要重新选择受影响的渠道协议。">
                  <Input value={selected.id} placeholder="例如 cline-cli" onChange={(event) => onUpdate(selectedIdx, { id: event.target.value })} />
                </FieldHelp>
                <FieldHelp label="模板名称" hint="用于渠道协议配置的 Header 模板下拉展示。">
                  <Input value={selected.name} placeholder="例如 Cline CLI" onChange={(event) => onUpdate(selectedIdx, { name: event.target.value })} />
                </FieldHelp>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="grid flex-1 grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.2fr)_auto] gap-2">
                    <Label>Key</Label>
                    <div className="flex items-center gap-1">
                      <Label>Value</Label>
                      <TemplateVariablesHelp
                        title="Value 支持变量"
                        hint="填写固定文本或下面的变量；出站请求时按请求逐次渲染。缺值渲染为空串，不报错。"
                        variables={HEADER_TEMPLATE_VARIABLES}
                      />
                    </div>
                    <span />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addHeader}>添加 Header</Button>
                </div>
                {selected.headers.map((header, headerIdx) => (
                  <div key={headerIdx} className="grid grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.2fr)_auto] gap-2">
                    <Input value={header.key} placeholder="x-client-type" onChange={(event) => updateHeader(headerIdx, { key: event.target.value })} />
                    <Input value={header.value} placeholder="cline-cli 或 {{uuid}}" onChange={(event) => updateHeader(headerIdx, { value: event.target.value })} />
                    <Button type="button" variant="ghost" onClick={() => removeHeader(headerIdx)}>删除</Button>
                  </div>
                ))}
                {selected.headers.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">暂无 Header，点击“添加 Header”。</p>}
              </div>
              <div className="flex justify-end border-t pt-4">
                <Button type="button" variant="destructive" size="sm" onClick={() => onRemove(selectedIdx)}>删除此模板</Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个模板，或新建模板。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function TestTypeDetails({
  row,
  index,
  onUpdate,
  onRemove,
}: {
  row: TestTypeRow
  index: number
  onUpdate: (idx: number, patch: Partial<TestTypeRow>) => void
  onRemove: (idx: number) => void
}) {
  const messagesValidation = useMemo(() => validateJson(row.messagesText, 'array'), [row.messagesText])
  const bodyValidation = useMemo(() => validateJson(row.bodyText, 'object'), [row.bodyText])
  const isMedia = Boolean(row.operation)
  const bodyExamples = row.operation === 'image'
    ? '{\n  "prompt": "一只红色的猫",\n  "n": 1,\n  "size": "1024x1024"\n}'
    : row.operation === 'video'
      ? '{\n  "prompt": "海浪缓慢拍打海岸"\n}'
      : row.operation === 'tts_generation'
        ? '{\n  "input": "你好",\n  "voice": "alloy",\n  "response_format": "mp3"\n}'
        : '{\n  "stream": true,\n  "reasoning_effort": "medium"\n}'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold">{row.label || '未命名类型'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">定义测试请求的类型、消息内容与附加参数。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldHelp label="标识 key" hint="测试请求的 test_type 值，也是测试 Tab 下拉的实际 value；只能用小写英文、数字和下划线，且必须唯一。">
          <Input value={row.key} placeholder="例如 custom_chat" onChange={(event) => onUpdate(index, { key: event.target.value })} />
        </FieldHelp>
        <FieldHelp label="显示名" hint="显示在账号测试 Tab 下拉菜单中的名称。">
          <Input value={row.label} placeholder="例如 自定义聊天" onChange={(event) => onUpdate(index, { label: event.target.value })} />
        </FieldHelp>
      </div>
      <FieldHelp label="请求类型" hint="对话类型走聊天接口；媒体类型会分别走图片、视频或语音生成接口。切换为媒体后无需填写请求消息。">
        <RadioGroup value={row.operation || 'chat'} onValueChange={(value) => onUpdate(index, { operation: value === 'chat' ? '' : value })} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RadioOption value="chat" label="对话" />
          <RadioOption value="image" label="图片生成" />
          <RadioOption value="video" label="视频生成" />
          <RadioOption value="tts_generation" label="语音合成" />
        </RadioGroup>
      </FieldHelp>
      {!isMedia && (
        <JsonField
          label="请求消息 messages"
          hint="OpenAI 形态的消息数组，会作为 body.messages 下发。每条消息通常包含 role 和 content。"
          example={'[\n  { "role": "user", "content": "你好，{{username}}" }\n]'}
          value={row.messagesText}
          validation={messagesValidation}
          onChange={(messagesText) => onUpdate(index, { messagesText })}
          variables={TEST_TEMPLATE_VARIABLES}
        />
      )}
      <JsonField
        label="附加请求体 body"
        hint={isMedia
          ? '会合并进媒体请求体；不要填写 model，系统会自动带入当前测试模型。'
          : '会合并进聊天请求体；不要填写 model 或 messages。可用于 stream、tools、tool_choice、reasoning_effort 等字段。'}
        example={bodyExamples}
        value={row.bodyText}
        validation={bodyValidation}
        onChange={(bodyText) => onUpdate(index, { bodyText })}
        variables={TEST_TEMPLATE_VARIABLES}
      />
      <div className="flex justify-end border-t pt-4">
        <Button type="button" variant="destructive" size="sm" onClick={() => onRemove(index)}>删除此类型</Button>
      </div>
    </div>
  )
}

function FieldHelp({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
      {children}
    </div>
  )
}

function RadioOption({ value, label }: { value: string; label: string }) {
  return (
    <Label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal hover:bg-muted">
      <RadioGroupItem value={value} />
      {label}
    </Label>
  )
}

/** 模板变量说明气泡：Headers 的 Value 与测试模板的 messages/body 共用同一份展示。 */
function TemplateVariablesHelp({
  title,
  hint,
  variables,
}: {
  title: string
  hint: string
  variables: Array<{ token: string; desc: string }>
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" title="变量使用说明">
          <CircleQuestionMark className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>
          <div className="mt-1 flex flex-col gap-1.5">
            {variables.map((variable) => (
              <div key={variable.token} className="flex items-baseline gap-2">
                <code className="shrink-0 text-primary">{variable.token}</code>
                <span className="text-[11px] text-muted-foreground">{variable.desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">密钥类字段（api_key/password/token）不暴露给模板；如需鉴权头用专门的认证配置。</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function JsonField({
  label,
  hint,
  example,
  value,
  validation,
  onChange,
  variables,
}: {
  label: string
  hint: string
  example: string
  value: string
  validation: ParseResult
  onChange: (value: string) => void
  /** 传入即在标题旁挂变量说明气泡；字符串叶子里的 {{...}} 由后端逐次渲染。 */
  variables?: Array<{ token: string; desc: string }>
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Label>{label}</Label>
        {variables && (
          <TemplateVariablesHelp
            title="支持变量"
            hint="任意字符串位置都能写变量（含嵌套字段）；每次测试逐次渲染。未识别的 {{...}} 原样保留。"
            variables={variables}
          />
        )}
      </div>
      <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
      <p className="rounded bg-muted px-2 py-1 font-mono text-[11px] leading-4 text-muted-foreground whitespace-pre-wrap">示例：{example}</p>
      <Textarea className="min-h-36 font-mono text-xs leading-5" value={value} onChange={(event) => onChange(event.target.value)} />
      <p className={`text-xs ${validation.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
        {validation.valid ? '✓ JSON 合法' : `✗ ${validation.message}`}
      </p>
    </div>
  )
}
