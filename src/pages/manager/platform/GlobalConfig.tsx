import { useCallback, useEffect, useState, type ReactNode } from "react"
import { CircleHelp, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/manager/platform-page"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  getChannelTabConfig,
  getModelTabConfig,
  getNodeGlobalConfig,
  getRunModeConfig,
  updateChannelTabConfig,
  updateModelTabConfig,
  updateNodeGlobalConfig,
  updateRunModeConfig,
  warmupTokenizerVocab,
  checkTokenizerVocabNow,
  type ChannelTabConfig,
  type ModelTabConfig,
  type NodeGlobalConfig,
  type OutputInterceptionRulesConfig,
  type RunModeConfig,
  type TokenizerVocabItem,
} from "@/@admin-port/api/globalConfig"
import {
  cleanupLogsNow,
  getMainConfig,
  updateDataRetentionConfig,
  updateLogRetentionConfig,
} from "@/@admin-port/api/dashboard"
import type { ModelMetadataEntry } from "@/@admin-port/api/modelMetadata"
import type { HeaderTemplate, ModelRuleTemplate, ProviderLimitFreezeRule, TestTypeDef } from "@/@admin-port/types/admin"
import { ModelIdRewriteEditor } from "./ModelIdRewriteEditor"
import {
  DEFAULT_TEST_TYPES,
  HeaderTemplatesEditor,
  RuntimeSettings,
  TestTypesEditor,
  getByPath,
  setByPath,
  toHeaderTemplateRow,
  toRow,
  validateJson,
  type ConfigSection,
  type HeaderTemplateRow,
  type TestTypeRow,
} from "./ConfigSettingsModal"
import { FreezePolicyEditor, safeBoolean } from "./FreezePolicyEditor"

// GitHub 相关配置已整体迁到「资源中心 → 配置」：市场仓库、节点程序版本、渠道目录
// 同步共用同一个市场仓库，配置只留一份，不再在全局配置里单开 GitHub Tab。
type TabKey = "run-mode" | "node-global" | "channels" | "retention" | "default-freeze" | "output-interception" | "test-types" | "header-templates" | "model-rule-templates" | "models"

const TAB_LABELS: Record<TabKey, string> = {
  "run-mode": "运行模式",
  "node-global": "节点网络",
  channels: "渠道运行",
  retention: "日志保留",
  "default-freeze": "默认冻结策略模版",
  "output-interception": "异常输出拦截",
  "test-types": "测试模板",
  "header-templates": "Headers 配置",
  "model-rule-templates": "模型规则模版",
  models: "模型配置",
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function splitLines(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false
      seen.add(line)
      return true
    })
}

function splitList(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

function HelpTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground transition-colors hover:text-foreground" aria-label="查看说明">
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{children}</TooltipContent>
    </Tooltip>
  )
}

function SectionHeading({ title, description, help }: { title: string; description: string; help?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5"><h3 className="font-semibold">{title}</h3>{help ? <HelpTip>{help}</HelpTip> : null}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function Field({ label, hint, children, className = "" }: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label>{label}</Label>
      {hint ? <p className="text-xs leading-4 text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  )
}

function TabFrame({
  description,
  loading,
  saving,
  error,
  onReload,
  onSave,
  children,
}: {
  description: string
  loading: boolean
  saving: boolean
  error: string | null
  onReload: () => void
  onSave: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {description ? <p className="mb-4 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {loading ? (
          <div className="flex min-h-72 items-center justify-center"><Spinner className="size-6" /></div>
        ) : children}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-6 py-4">
        <Button variant="outline" disabled={loading || saving} onClick={onReload}>重新加载</Button>
        <Button disabled={loading || saving} onClick={onSave}>
          {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 size-4" />}
          保存此配置
        </Button>
      </div>
    </div>
  )
}

function useConfig<T>(active: boolean, loader: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setValue(await loader())
      setLoaded(true)
    } catch (error) {
      setError(errorMessage(error, "加载配置失败"))
    } finally {
      setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    if (active && !loaded && !loading) void load()
  }, [active, load, loaded, loading])

  return { value, setValue, loading, saving, setSaving, error, setError, load }
}

const loadRunMode = () => getRunModeConfig()
const loadNodeGlobal = () => getNodeGlobalConfig()
const loadModels = () => getModelTabConfig()
const loadMainConfig = () => getMainConfig().then((data) => data as unknown as Record<string, unknown>)

function RunModeTab({ active }: { active: boolean }) {
  const state = useConfig<RunModeConfig>(active, loadRunMode)
  const save = async () => {
    if (!state.value) return
    state.setSaving(true)
    state.setError(null)
    try {
      state.setValue(await updateRunModeConfig(state.value))
      toast.success("运行模式已保存")
    } catch (error) {
      state.setError(errorMessage(error, "保存运行模式失败"))
    } finally {
      state.setSaving(false)
    }
  }
  return (
    <TabFrame description="控制服务端调试模式。修改后只保存 system.debug，不覆盖其他主配置。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? (
        <div className="max-w-3xl rounded-lg border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div><div className="font-medium">调试模式</div><p className="mt-1 text-sm leading-5 text-muted-foreground">启用更详细的服务端调试行为。生产环境通常应保持关闭。</p></div>
            <Switch checked={state.value.debug} onCheckedChange={(debug) => state.setValue({ debug })} />
          </div>
        </div>
      ) : null}
    </TabFrame>
  )
}

function NodeGlobalTab({ active }: { active: boolean }) {
  const state = useConfig<NodeGlobalConfig>(active, loadNodeGlobal)
  const save = async () => {
    if (!state.value) return
    state.setSaving(true)
    state.setError(null)
    try {
      state.setValue(await updateNodeGlobalConfig(state.value))
      toast.success("节点全局配置已保存并下发")
    } catch (error) {
      state.setError(errorMessage(error, "保存节点全局配置失败"))
    } finally {
      state.setSaving(false)
    }
  }
  return (
    <TabFrame description="配置全部真实节点共享的公网 IPv4/IPv6 探测地址，保存后实时下发到在线节点。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <>
        <Alert className="mb-5"><AlertDescription>每个地址族建议配置至少 3 个不同 HTTP(S) 网站。节点串行访问，多个网站返回同一地址后才确认。一行一个 URL，留空表示禁用对应地址族探测。</AlertDescription></Alert>
        <div className="grid gap-5 lg:grid-cols-2">
          <Field label="IPv4 获取地址"><Textarea className="min-h-80 resize-y font-mono text-xs leading-5" value={(state.value.ipv4_urls ?? []).join("\n")} onChange={(event) => state.setValue((current) => current ? { ...current, ipv4_urls: splitLines(event.target.value) } : current)} /></Field>
          <Field label="IPv6 获取地址"><Textarea className="min-h-80 resize-y font-mono text-xs leading-5" value={(state.value.ipv6_urls ?? []).join("\n")} onChange={(event) => state.setValue((current) => current ? { ...current, ipv6_urls: splitLines(event.target.value) } : current)} /></Field>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">当前配置版本：{String(state.value.revision || 0)}</p>
      </> : null}
    </TabFrame>
  )
}

function channelRuntime(config: ChannelTabConfig): Record<string, unknown> {
  return {
    model_refresh: config.scheduled.model_refresh,
    message_delete: config.scheduled.message_delete,
    scheduled_test: config.scheduled_test,
    retry: config.retry,
    stream: config.stream,
    rate_limit: config.rate_limit,
  }
}

function serializeTestRows(rows: TestTypeRow[]): TestTypeDef[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const key = row.key.trim()
    if (!key) throw new Error("测试类型的 key 不能为空")
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error(`「${key}」的 key 只能使用小写英文、数字或下划线`)
    if (seen.has(key)) throw new Error(`测试类型 key 重复：${key}`)
    seen.add(key)
    const messages = validateJson(row.messagesText, "array")
    if (!messages.valid) throw new Error(`「${key}」的 messages 无效：${messages.message}`)
    const body = validateJson(row.bodyText, "object")
    if (!body.valid) throw new Error(`「${key}」的 body 无效：${body.message}`)
    return { key, label: row.label.trim() || key, operation: row.operation || null, messages: JSON.parse(row.messagesText || "[]"), body: JSON.parse(row.bodyText || "{}") }
  })
}

function serializeHeaderRows(rows: HeaderTemplateRow[]): HeaderTemplate[] {
  const ids = new Set<string>()
  return rows.map((row) => {
    const id = row.id.trim()
    const name = row.name.trim()
    if (!id || !name) throw new Error("Header 模板的 ID 和名称不能为空")
    if (ids.has(id)) throw new Error(`Header 模板 ID 重复：${id}`)
    ids.add(id)
    const headers: Record<string, string> = {}
    const keys = new Set<string>()
    for (const header of row.headers) {
      const key = header.key.trim()
      if (!key && !header.value.trim()) continue
      if (!key) throw new Error(`模板「${name}」存在未填写名称的 Header`)
      if (keys.has(key.toLowerCase())) throw new Error(`模板「${name}」的 Header 重复：${key}`)
      keys.add(key.toLowerCase())
      headers[key] = header.value
    }
    return { id, name, headers }
  })
}

const DEFAULT_OUTPUT_INTERCEPTION_RULES: OutputInterceptionRulesConfig = {
  enabled: false,
  rules: [{ name: "No response requested", enabled: true, match_type: "regex", pattern: "No response requested\\.?" }],
}

function isValidRegex(pattern: string): boolean {
  try { new RegExp(pattern); return true } catch { return false }
}

function OutputInterceptionTable({
  value,
  onChange,
}: {
  value: OutputInterceptionRulesConfig | undefined
  onChange: (next: OutputInterceptionRulesConfig) => void
}) {
  const current = value ?? DEFAULT_OUTPUT_INTERCEPTION_RULES
  const rules = current.rules ?? []
  const patchRule = (index: number, patch: Partial<OutputInterceptionRulesConfig["rules"][number]>) =>
    onChange({ ...current, rules: rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) })
  const addRule = () =>
    onChange({ ...current, rules: [...rules, { name: `规则 ${rules.length + 1}`, enabled: true, match_type: "regex", pattern: "" }] })
  const removeRule = (index: number) =>
    onChange({ ...current, rules: rules.filter((_, i) => i !== index) })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
        <div>
          <div className="flex items-center gap-1.5 font-medium">启用异常输出拦截<HelpTip>整体关闭后保留规则配置，但所有规则均不参与响应匹配。</HelpTip></div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">命中规则的响应不会返回给客户端，而是标记当前候选失败并切换账号或渠道。</p>
        </div>
        <Switch checked={current.enabled} onCheckedChange={(checked) => onChange({ ...current, enabled: checked })} />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-20"><span className="inline-flex items-center gap-1">启用<HelpTip>单独停用此规则，不影响其他规则。</HelpTip></span></TableHead>
              <TableHead className="min-w-44">规则名称</TableHead>
              <TableHead className="w-32">匹配方式</TableHead>
              <TableHead className="min-w-80"><span className="inline-flex items-center gap-1">匹配内容<HelpTip>正则使用 Python 正则语法；文本匹配为大小写敏感的字面子串匹配。</HelpTip></span></TableHead>
              <TableHead className="w-16 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule, index) => {
              const matchType = rule.match_type ?? "regex"
              const invalid = matchType === "regex" && rule.pattern.trim() !== "" && !isValidRegex(rule.pattern)
              return (
                <TableRow key={index}>
                  <TableCell><Switch checked={rule.enabled} onCheckedChange={(checked) => patchRule(index, { enabled: checked })} /></TableCell>
                  <TableCell><Input value={rule.name} placeholder="例如：空响应占位符" onChange={(event) => patchRule(index, { name: event.target.value })} /></TableCell>
                  <TableCell>
                    <NativeSelect value={matchType} onChange={(event) => patchRule(index, { match_type: event.target.value as "regex" | "text" })}>
                      <NativeSelectOption value="regex">正则表达式</NativeSelectOption>
                      <NativeSelectOption value="text">字面文本</NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Input className={`font-mono ${invalid ? "border-destructive" : ""}`} value={rule.pattern} placeholder={matchType === "regex" ? "例如 (?i)^No response requested\\.?$" : "例如 No response requested."} onChange={(event) => patchRule(index, { pattern: event.target.value })} />
                    {invalid ? <p className="mt-1 text-xs text-destructive">正则表达式无效</p> : null}
                  </TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="icon-sm" className="text-destructive" title="删除规则" onClick={() => removeRule(index)}><Trash2 /></Button></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {rules.length === 0 ? <div className="border-t p-10 text-center text-sm text-muted-foreground">暂无拦截规则，点击下方按钮添加。</div> : null}
      </div>
      <div><Button variant="outline" size="sm" onClick={addRule}><Plus className="mr-2 size-4" />新增规则</Button></div>
    </div>
  )
}

function ChannelsTab({ active }: { active: boolean }) {
  const [config, setConfig] = useState<ChannelTabConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setConfig(await getChannelTabConfig())
      setLoaded(true)
    } catch (error) {
      setError(errorMessage(error, "加载渠道运行配置失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (active && !loaded && !loading) void load() }, [active, load, loaded, loading])

  const updateRuntime = (path: string, value: unknown) => setConfig((current) => {
    if (!current) return current
    const next = setByPath(channelRuntime(current), path, value)
    return {
      ...current,
      scheduled: { model_refresh: next.model_refresh as ChannelTabConfig["scheduled"]["model_refresh"], message_delete: next.message_delete as ChannelTabConfig["scheduled"]["message_delete"] },
      scheduled_test: next.scheduled_test as ChannelTabConfig["scheduled_test"],
      retry: next.retry as ChannelTabConfig["retry"],
      stream: next.stream as ChannelTabConfig["stream"],
      rate_limit: next.rate_limit as ChannelTabConfig["rate_limit"],
    }
  })

  const save = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      await updateChannelTabConfig({ scheduled: config.scheduled, scheduled_test: config.scheduled_test, retry: config.retry, stream: config.stream, rate_limit: config.rate_limit })
      toast.success("渠道运行配置已保存")
      await load()
    } catch (error) {
      setError(errorMessage(error, "保存渠道运行配置失败"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <TabFrame description="配置渠道请求的定时任务、全局重试、账号冷却和流式响应质量判定。" loading={loading} saving={saving} error={error} onReload={load} onSave={() => void save()}>
      {config ? <div className="flex flex-col gap-5">
        <Alert><AlertDescription>这些参数直接影响请求调度。测试请求模板、Header 模板和异常输出规则已分别拆到右侧独立页面。</AlertDescription></Alert>
        <SectionHeading title="运行参数" description="定时任务、失败重试、账号冷却和流式响应质量判定。" help="调整前请确认重试次数和冷却范围，避免放大上游请求或过早冻结账号。" />
        <RuntimeSettings sections={["scheduled", "scheduledTest", "retry", "stream"] as ConfigSection[]} config={channelRuntime(config)} onChange={updateRuntime} />
      </div> : null}
    </TabFrame>
  )
}

function RetentionTab({ active }: { active: boolean }) {
  const state = useConfig<Record<string, unknown>>(active, loadMainConfig)
  const [cleaning, setCleaning] = useState(false)

  const num = (path: string, fallback: number): number => {
    const value = getByPath(state.value ?? {}, path)
    if (typeof value === "number") return value
    return value != null && value !== "" ? Number(value) : fallback
  }
  const maxEntries = num("log_retention.max_entries", 200)

  const update = (path: string, value: unknown) =>
    state.setValue((current) => (current ? setByPath(current, path, value) : current))

  const save = async () => {
    if (!state.value) return
    state.setSaving(true)
    state.setError(null)
    try {
      await updateLogRetentionConfig(maxEntries)
      await updateDataRetentionConfig(num("data_retention.log_days", 30), num("data_retention.cleanup_hour", 2))
      toast.success("日志保留配置已保存")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存日志保留配置失败"))
    } finally {
      state.setSaving(false)
    }
  }

  // 手动清理按当前「已保存」的配置执行，不含未保存的输入框改动——服务端读的是 config.json。
  const cleanup = async () => {
    const limitNote = maxEntries > 0 ? `，并把请求日志删到最新 ${maxEntries} 条以内` : ""
    if (!window.confirm(`将按已保存的配置立即清理请求日志：删除 ${num("data_retention.log_days", 30)} 天前的记录${limitNote}，并按同样天数删除 ClickHouse 里对应的请求/响应体。删除不可恢复，确定继续？`)) return
    setCleaning(true)
    try {
      const result = await cleanupLogsNow()
      if (result.started) toast.success("清理任务已在后台启动，完成结果见通知中心")
      else toast.warning(result.detail || "已有清理任务在执行中")
    } catch (error) {
      toast.error(errorMessage(error, "触发日志清理失败"))
    } finally {
      setCleaning(false)
    }
  }

  return (
    <TabFrame description="配置请求日志的保留天数、条数上限与每日清理时刻，并可立即触发一次清理。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <div className="flex flex-col gap-5">
        <Alert variant="destructive">
          <AlertDescription>
            「日志保留条数上限」不只是展示条数，它同时是数据库清理阈值：每次清理（含每日定时）都会把 request_logs 删到只剩最新这么多条，超出的历史记录不可恢复。填 0 = 关闭按条数清理，只按天数保留。
          </AlertDescription>
        </Alert>
        <RuntimeSettings sections={["retention"] as ConfigSection[]} config={state.value} onChange={update} />
        <section className="rounded-lg border bg-card p-5">
          <SectionHeading title="立即清理" description="按上方已保存的配置执行一次清理：删除 Postgres 里的日志行，并按同一保留天数删除 ClickHouse 里的请求/响应体。服务端后台异步执行，结果写入通知中心。" help="Postgres 分批 DELETE 可能持续数十秒；ClickHouse 整月过期的分区直接 DROP 立即回收磁盘，只有跨边界的当月走 mutation。重复点击会复用同一个在途任务。" />
          <Button variant="destructive" disabled={cleaning} onClick={() => void cleanup()}>
            {cleaning ? <Spinner className="mr-2 size-4" /> : <Trash2 className="mr-2 size-4" />}
            立即清理请求日志
          </Button>
        </section>
      </div> : null}
    </TabFrame>
  )
}

function DefaultFreezePolicyTab({ active }: { active: boolean }) {
  const state = useConfig<ChannelTabConfig>(active, getChannelTabConfig)
  const fp = state.value?.default_freeze_policy ?? { enabled: true, rules: [] as ProviderLimitFreezeRule[] }
  const rules = Array.isArray(fp.rules) ? fp.rules.map((r) => ({ ...r })) : []
  const setPolicy = (next: { enabled: boolean; rules: ProviderLimitFreezeRule[] }) =>
    state.setValue((current) => current ? { ...current, default_freeze_policy: next } : current)

  const save = async () => {
    if (!state.value) return
    state.setSaving(true)
    state.setError(null)
    try {
      await updateChannelTabConfig({ default_freeze_policy: { enabled: fp.enabled !== false, rules } })
      toast.success("新增渠道默认冻结策略已保存")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存默认冻结策略失败"))
    } finally {
      state.setSaving(false)
    }
  }

  return (
    <TabFrame description="配置新创建渠道的初始冻结策略快照。新建渠道时会把这里配置的规则作为该渠道的冻结策略落库；之后修改这里不影响任何已建渠道。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <div className="flex flex-col gap-4">
        <Alert><AlertDescription>这是「新增渠道」的默认冻结策略。保存后仅对后续新建的渠道生效：创建渠道时快照此配置写入该渠道，已建渠道的冻结策略保持不变。要改已有渠道，请到渠道弹窗的「冻结策略」Tab 单独调整。</AlertDescription></Alert>
        <FreezePolicyEditor value={{ enabled: safeBoolean(fp.enabled), rules }} onChange={setPolicy} />
      </div> : null}
    </TabFrame>
  )
}

function TestTemplatesTab({ active }: { active: boolean }) {
  const state = useConfig<ChannelTabConfig>(active, getChannelTabConfig)
  const [rows, setRows] = useState<TestTypeRow[]>([])
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!state.value) return
    const types = state.value.account_test.types?.length ? state.value.account_test.types : DEFAULT_TEST_TYPES
    setRows(types.map(toRow))
    setSelected(0)
  }, [state.value])

  const update = (index: number, patch: Partial<TestTypeRow>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const add = () => { setRows((current) => [...current, { key: "", label: "", operation: "", messagesText: "[\n  { \"role\": \"user\", \"content\": \"hi\" }\n]", bodyText: "{}" }]); setSelected(rows.length) }
  const remove = (index: number) => { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); setSelected((value) => Math.max(0, Math.min(value, rows.length - 2))) }

  const save = async () => {
    let types: TestTypeDef[]
    try { types = serializeTestRows(rows) } catch (error) { state.setError(errorMessage(error, "测试模板校验失败")); return }
    state.setSaving(true)
    state.setError(null)
    try {
      await updateChannelTabConfig({ account_test: { types } })
      toast.success("测试模板已保存")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存测试模板失败"))
    } finally {
      state.setSaving(false)
    }
  }

  return (
    <TabFrame description="维护账号测试页面可选择的请求模板，包括消息、工具调用、思考和媒体生成测试。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <div className="flex h-[calc(94vh-180px)] min-h-[520px] flex-col gap-4">
        <Alert><AlertDescription>每个模板定义一次账号测试请求。自定义模板按 messages 与 body 原样构造，标识 key 必须唯一。</AlertDescription></Alert>
        <div className="min-h-0 flex-1"><TestTypesEditor rows={rows} selectedIdx={selected} onSelect={setSelected} onUpdate={update} onAdd={add} onRemove={remove} onReset={() => { setRows(DEFAULT_TEST_TYPES.map(toRow)); setSelected(0) }} /></div>
      </div> : null}
    </TabFrame>
  )
}

function HeaderTemplatesTab({ active }: { active: boolean }) {
  const state = useConfig<ChannelTabConfig>(active, getChannelTabConfig)
  const [rows, setRows] = useState<HeaderTemplateRow[]>([])
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!state.value) return
    setRows(state.value.header_templates.map(toHeaderTemplateRow))
    setSelected(0)
  }, [state.value])

  const update = (index: number, patch: Partial<HeaderTemplateRow>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const add = () => { setRows((current) => [...current, { id: `template-${current.length + 1}`, name: "", headers: [{ key: "", value: "" }] }]); setSelected(rows.length) }
  const remove = (index: number) => { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); setSelected((value) => Math.max(0, Math.min(value, rows.length - 2))) }

  const save = async () => {
    let templates: HeaderTemplate[]
    try { templates = serializeHeaderRows(rows) } catch (error) { state.setError(errorMessage(error, "Headers 配置校验失败")); return }
    state.setSaving(true)
    state.setError(null)
    try {
      await updateChannelTabConfig({ header_templates: templates })
      toast.success("Headers 配置已保存并同步到运行时")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存 Headers 配置失败"))
    } finally {
      state.setSaving(false)
    }
  }

  return (
    <TabFrame description="" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <div className="flex h-[calc(94vh-180px)] min-h-[520px] flex-col gap-4">
        <div className="min-h-0 flex-1"><HeaderTemplatesEditor rows={rows} selectedIdx={selected} onSelect={setSelected} onUpdate={update} onAdd={add} onRemove={remove} /></div>
      </div> : null}
    </TabFrame>
  )
}

/**
 * 全局模型规则模版：渠道的「过滤及改写规则」可以插入一条引用条目指向这里的模版。
 * 引用是活引用——改这里的模版，所有引用它的渠道下次同步立即生效。
 * 模版内只能放内联规则（allowTemplateRefs=false），不允许模版再嵌模版。
 */
function ModelRuleTemplatesTab({ active }: { active: boolean }) {
  const state = useConfig<ChannelTabConfig>(active, getChannelTabConfig)
  const [rows, setRows] = useState<ModelRuleTemplate[]>([])
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!state.value) return
    setRows(state.value.model_rule_templates.map((row) => ({ ...row, rules: [...row.rules] })))
    setSelected(0)
  }, [state.value])

  const update = (index: number, patch: Partial<ModelRuleTemplate>) =>
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const add = () => {
    setRows((current) => [...current, { id: `tpl-${current.length + 1}`, name: "", rules: [] }])
    setSelected(rows.length)
  }
  const remove = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
    setSelected((value) => Math.max(0, Math.min(value, rows.length - 2)))
  }

  const save = async () => {
    const ids = new Set<string>()
    for (const row of rows) {
      if (!row.id.trim() || !row.name.trim()) { state.setError("模版的 ID 和名称不能为空"); return }
      if (ids.has(row.id.trim())) { state.setError(`模版 ID 重复：${row.id.trim()}`); return }
      ids.add(row.id.trim())
    }
    state.setSaving(true)
    state.setError(null)
    try {
      await updateChannelTabConfig({ model_rule_templates: rows })
      toast.success("模型规则模版已保存并同步到运行时")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存模型规则模版失败"))
    } finally {
      state.setSaving(false)
    }
  }

  const current = rows[selected]

  return (
    <TabFrame
      description="模版供渠道的「过滤及改写规则」引用。改模版会立即影响所有引用它的渠道，规则本身只作用于新获取到的模型。"
      loading={state.loading}
      saving={state.saving}
      error={state.error}
      onReload={state.load}
      onSave={() => void save()}
    >
      {state.value ? (
        <div className="grid min-h-[520px] grid-cols-[230px_minmax(0,1fr)] gap-4">
          <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/20 p-2">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((row, index) => (
                <button
                  key={`${row.id}-${index}`}
                  type="button"
                  onClick={() => setSelected(index)}
                  className={`mb-1 flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${index === selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <span className="truncate text-sm font-medium">{row.name || "未命名模版"}</span>
                  <span className={`truncate text-xs ${index === selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {row.rules.length} 条规则
                  </span>
                </button>
              ))}
              {rows.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">还没有模型规则模版</p>}
            </div>
            <div className="mt-2 border-t pt-2">
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={add}>新增模版</Button>
            </div>
          </aside>
          <div className="min-h-0 overflow-y-auto rounded-lg border p-4">
            {current ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="模版 ID" hint="渠道保存的是这个 ID；改 ID 会让已有引用失效。">
                    <Input value={current.id} placeholder="例如 tpl-common" onChange={(event) => update(selected, { id: event.target.value })} />
                  </Field>
                  <Field label="模版名称" hint="渠道引用下拉里展示的名称。">
                    <Input value={current.name} placeholder="例如 通用改名" onChange={(event) => update(selected, { name: event.target.value })} />
                  </Field>
                </div>
                <ModelIdRewriteEditor
                  value={current.rules}
                  onChange={(next) => update(selected, { rules: next as ModelRuleTemplate["rules"] })}
                  allowTemplateRefs={false}
                />
                <div className="flex justify-end border-t pt-4">
                  <Button type="button" variant="destructive" size="sm" onClick={() => remove(selected)}>删除此模版</Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">从左侧选择一个模版，或新建模版。</div>
            )}
          </div>
        </div>
      ) : null}
    </TabFrame>
  )
}

function OutputInterceptionTab({ active }: { active: boolean }) {
  const state = useConfig<ChannelTabConfig>(active, getChannelTabConfig)
  const rules = state.value?.retry.output_interception_rules ?? DEFAULT_OUTPUT_INTERCEPTION_RULES
  const setRules = (next: OutputInterceptionRulesConfig) => state.setValue((current) => current ? {
    ...current,
    retry: { ...current.retry, output_interception_rules: next },
  } : current)

  const save = async () => {
    if (!state.value) return
    for (const [index, rule] of rules.rules.entries()) {
      if (!rule.name.trim()) { state.setError(`第 ${index + 1} 条规则名称不能为空`); return }
      if (!rule.pattern.trim()) { state.setError(`第 ${index + 1} 条规则匹配内容不能为空`); return }
      if ((rule.match_type ?? "regex") === "regex" && !isValidRegex(rule.pattern)) {
        state.setError(`第 ${index + 1} 条规则不是有效正则表达式`)
        return
      }
    }
    state.setSaving(true)
    state.setError(null)
    try {
      await updateChannelTabConfig({ retry: { ...state.value.retry, output_interception_rules: rules } })
      toast.success("异常输出拦截规则已保存并热更新")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存异常输出拦截规则失败"))
    } finally {
      state.setSaving(false)
    }
  }

  return (
    <TabFrame description="识别上游返回的无效占位内容。命中后不会把该响应交给客户端，而是切换候选账号或渠道继续重试。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {state.value ? <div className="flex flex-col gap-4">
        <Alert><AlertDescription>规则按响应完整文本匹配，支持跨流式分片。正则适合格式变化的内容，字面文本适合精确的固定占位符。配置保存后会通过 Pub/Sub 同步到其他实例。</AlertDescription></Alert>
        <OutputInterceptionTable value={rules} onChange={setRules} />
      </div> : null}
    </TabFrame>
  )
}

function ModelsTab({ active }: { active: boolean }) {
  const state = useConfig<ModelTabConfig>(active, loadModels)
  const config = state.value
  const patchThinking = (patch: Partial<ModelTabConfig["thinking"]>) => state.setValue((current) => current ? { ...current, thinking: { ...current.thinking, ...patch } } : current)
  const patchDefault = (patch: Partial<ModelMetadataEntry>) => state.setValue((current) => current ? { ...current, default_metadata: { ...(current.default_metadata || {}), ...patch } } : current)
  const patchVocab = (patch: Partial<NonNullable<ModelTabConfig["tokenizer_vocab"]>>) => state.setValue((current) => current && current.tokenizer_vocab ? { ...current, tokenizer_vocab: { ...current.tokenizer_vocab, ...patch } } : current)

  const [warmingRepo, setWarmingRepo] = useState<string | null>(null)
  const [checkingVocab, setCheckingVocab] = useState(false)

  // 词表下载在服务端进行（可达数十 MB）。估算函数在请求热路径上，绝不能在那里联网，
  // 所以由管理员按需手动更新；未就绪的规则运行时自动降级。
  const updateVocab = async (repo: string) => {
    setWarmingRepo(repo)
    try {
      const result = await warmupTokenizerVocab(repo, config?.tokenizer_vocab?.mirror)
      if (result.warning) toast.warning(result.warning)
      else toast.success(`词表已更新：${repo}（${(result.bytes / 1024 / 1024).toFixed(1)}MB）`)
      await state.load()
    } catch (error) {
      toast.error(errorMessage(error, `更新词表失败：${repo}`))
    } finally {
      setWarmingRepo(null)
    }
  }

  const checkVocab = async () => {
    setCheckingVocab(true)
    try {
      await checkTokenizerVocabNow()
      toast.success("已检查词表版本")
      await state.load()
    } catch (error) {
      toast.error(errorMessage(error, "检查词表版本失败"))
    } finally {
      setCheckingVocab(false)
    }
  }

  const save = async () => {
    if (!config) return
    state.setSaving(true)
    state.setError(null)
    try {
      await updateModelTabConfig({
        context_detection_enabled: config.context_detection_enabled,
        thinking: config.thinking,
        default_metadata: config.default_metadata,
        ...(config.tokenizer_vocab ? { tokenizer_vocab: {
          enabled: config.tokenizer_vocab.enabled,
          interval_hours: config.tokenizer_vocab.interval_hours,
          mirror: config.tokenizer_vocab.mirror,
        } } : {}),
      })
      toast.success("模型配置已保存")
      await state.load()
    } catch (error) {
      state.setError(errorMessage(error, "保存模型配置失败"))
    } finally {
      state.setSaving(false)
    }
  }

  const vocabStatusLabel = (item: TokenizerVocabItem): { text: string; cls: string } => {
    switch (item.status) {
      case "current": return { text: "已就绪", cls: "text-emerald-600" }
      case "update_available": return { text: "有新版本", cls: "text-amber-600" }
      case "missing": return { text: "未就绪（降级中）", cls: "text-destructive" }
      case "check_failed": return { text: "检查失败", cls: "text-muted-foreground" }
      case "unknown": return { text: "已就绪（版本未知）", cls: "text-muted-foreground" }
      default: return { text: item.status, cls: "text-muted-foreground" }
    }
  }

  return (
    <TabFrame description="管理全局思考体系、上下文检测开关、Token 词表版本与默认模型元数据。Token 统计策略由系统按模型自动选择，无需用户配置。" loading={state.loading} saving={state.saving} error={state.error} onReload={state.load} onSave={() => void save()}>
      {config ? <div className="flex flex-col gap-5">
        <section className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold">推理与思考</h3>
          <p className="mt-1 text-xs text-muted-foreground">控制思考参数处理和模拟客户端缺省值。</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="flex items-start justify-between rounded-lg border p-4"><div><div className="font-medium">启用全局思考体系</div><p className="mt-1 text-xs text-muted-foreground">按模型能力处理 thinking 与 reasoning 参数。</p></div><Switch checked={config.thinking.thinking_global_enabled} onCheckedChange={(value) => patchThinking({ thinking_global_enabled: value })} /></div>
            <div className="rounded-lg border p-4"><div className="font-medium">模拟客户端默认值</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="默认推理强度"><NativeSelect value={config.thinking.simulated_client_defaults?.reasoning_effort || ""} onChange={(event) => patchThinking({ simulated_client_defaults: { ...config.thinking.simulated_client_defaults, reasoning_effort: event.target.value, auto_search: config.thinking.simulated_client_defaults?.auto_search === true } })}><NativeSelectOption value="">不设置</NativeSelectOption><NativeSelectOption value="low">低</NativeSelectOption><NativeSelectOption value="medium">中</NativeSelectOption><NativeSelectOption value="high">高</NativeSelectOption><NativeSelectOption value="xhigh">极高</NativeSelectOption></NativeSelect></Field><label className="flex cursor-pointer items-center gap-2 self-end rounded-md border px-3 py-2 text-sm"><Checkbox checked={config.thinking.simulated_client_defaults?.auto_search === true} onCheckedChange={(value) => patchThinking({ simulated_client_defaults: { ...config.thinking.simulated_client_defaults, reasoning_effort: config.thinking.simulated_client_defaults?.reasoning_effort || "", auto_search: value === true } })} />默认开启搜索</label></div></div>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-semibold">Token 统计策略</h3><p className="mt-1 text-xs text-muted-foreground">由系统按模型族自动识别，匹配到对应分词器估算。<strong>此处不可编辑。</strong></p></div></div>
          {config.tokenizer_policy ? <div className="flex flex-col gap-2">{config.tokenizer_policy.rules.map((rule, idx) => <div key={rule.pattern + idx} className="rounded-lg border p-3 bg-muted/30"><div className="font-mono text-xs flex flex-wrap items-center gap-2"><span className="opacity-60">{idx + 1}.</span><span className="font-semibold">{rule.family}</span><span className="opacity-60">↳</span><span className="font-mono">{rule.pattern}</span><span className="ml-auto text-xs opacity-60">{rule.type}{rule.encoding ? ` (${rule.encoding})` : ""}</span></div></div>)}</div> : <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">暂无内置策略，将使用系统默认估算。</div>}
        </section>

        {config.tokenizer_vocab ? <section className="rounded-lg border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">开源模型词表</h3>
              <p className="mt-1 text-xs text-muted-foreground">GLM / Qwen / DeepSeek 等开源模型用真实词表估算更准。系统只<strong>定时检查</strong>是否有新版本，<strong>下载与更新需手动触发</strong>（词表可达数十 MB，不能在请求链路联网）。词表存数据库，所有实例共享。</p>
            </div>
            <Button variant="outline" size="sm" disabled={checkingVocab} onClick={() => void checkVocab()}>{checkingVocab ? "检查中" : "立即检查"}</Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3 mb-4">
            <div className="flex items-start justify-between rounded-lg border p-4"><div><div className="font-medium">启用定时检查</div><p className="mt-1 text-xs text-muted-foreground">仅比对远端版本，不下载。</p></div><Switch checked={config.tokenizer_vocab.enabled} onCheckedChange={(value) => patchVocab({ enabled: value })} /></div>
            <Field label="检查间隔（小时）" hint="1~720，词表极少变动"><Input type="number" min={1} max={720} value={config.tokenizer_vocab.interval_hours} onChange={(event) => patchVocab({ interval_hours: Number(event.target.value) })} /></Field>
            <Field label="镜像地址" hint="huggingface.co 不可达时用镜像"><Input className="font-mono" value={config.tokenizer_vocab.mirror} placeholder="https://hf-mirror.com" onChange={(event) => patchVocab({ mirror: event.target.value })} /></Field>
          </div>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>词表仓库</TableHead><TableHead>状态</TableHead><TableHead>本地大小</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>{config.tokenizer_vocab.items.map((item) => { const label = vocabStatusLabel(item); const needUpdate = item.status === "missing" || item.status === "update_available"; return <TableRow key={item.repo}><TableCell className="font-mono text-xs">{item.repo}</TableCell><TableCell className={`text-xs ${label.cls}`}>{label.text}{item.error ? `：${item.error}` : ""}</TableCell><TableCell className="text-xs tabular-nums">{item.bytes ? `${(item.bytes / 1024 / 1024).toFixed(1)}MB` : "-"}</TableCell><TableCell className="text-right"><Button variant={needUpdate ? "default" : "outline"} size="sm" disabled={warmingRepo !== null} onClick={() => void updateVocab(item.repo)}>{warmingRepo === item.repo ? "更新中" : (item.present ? "更新" : "下载")}</Button></TableCell></TableRow> })}</TableBody>
            </Table>
          </div>
        </section> : null}

        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div className="flex-1"><h3 className="font-semibold">上下文超限检测</h3><p className="mt-1 text-xs text-muted-foreground">开启时按统计策略估算输入并对超过模型上下文的请求直接返回 context_too_large；关闭后不再拦截，渠道 token 预占与日志预测值不受影响。</p></div><Switch checked={config.context_detection_enabled} onCheckedChange={(value) => state.setValue((current) => current ? { ...current, context_detection_enabled: value } : current)} /></div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold">默认模型元数据</h3><p className="mt-1 text-xs text-muted-foreground">未单独配置元数据的模型使用这些默认值。</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Field label="名称"><Input value={config.default_metadata?.name || ""} onChange={(event) => patchDefault({ name: event.target.value })} /></Field>
            <Field label="所属厂商"><Input value={config.default_metadata?.owned_by || ""} onChange={(event) => patchDefault({ owned_by: event.target.value })} /></Field>
            <Field label="对象类型"><Input value={config.default_metadata?.object || "model"} onChange={(event) => patchDefault({ object: event.target.value })} /></Field>
            <Field label="最大上下文 Token"><Input type="number" value={config.default_metadata?.max_context_tokens ?? ""} onChange={(event) => patchDefault({ max_context_tokens: event.target.value ? Number(event.target.value) : undefined })} /></Field>
            <Field label="最大输出 Token"><Input type="number" value={config.default_metadata?.max_tokens ?? ""} onChange={(event) => patchDefault({ max_tokens: event.target.value ? Number(event.target.value) : undefined })} /></Field>
            <Field label="图标 URL"><Input value={config.default_metadata?.icon_url || ""} onChange={(event) => patchDefault({ icon_url: event.target.value })} /></Field>
            <Field label="输入模态" hint="逗号分隔，例如 text,image"><Input value={(config.default_metadata?.input_modalities || []).join(", ")} onChange={(event) => patchDefault({ input_modalities: splitList(event.target.value) })} /></Field>
            <Field label="输出模态" hint="逗号分隔，例如 text,image"><Input value={(config.default_metadata?.output_modalities || []).join(", ")} onChange={(event) => patchDefault({ output_modalities: splitList(event.target.value) })} /></Field>
            <div className="flex flex-wrap items-end gap-4"><label className="flex items-center gap-2 text-sm"><Checkbox checked={config.default_metadata?.function_calling === true} onCheckedChange={(value) => patchDefault({ function_calling: value === true })} />函数调用</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={config.default_metadata?.auto_thinking === true} onCheckedChange={(value) => patchDefault({ auto_thinking: value === true })} />自动思考</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={config.default_metadata?.auto_search === true} onCheckedChange={(value) => patchDefault({ auto_search: value === true })} />自动搜索</label></div>
          </div>
        </section>
      </div> : null}
    </TabFrame>
  )
}

export function GlobalConfig({ open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [active, setActive] = useState<TabKey>("run-mode")
  const contents = (
    <TooltipProvider>
      <Tabs orientation="vertical" value={active} onValueChange={(value) => setActive(value as TabKey)} className="flex min-h-0 flex-1 flex-row gap-0">
        <div className="min-w-0 flex-1 overflow-hidden">
          <TabsContent value="run-mode" className="mt-0 h-full min-h-0 overflow-hidden"><RunModeTab active={active === "run-mode"} /></TabsContent>
          <TabsContent value="node-global" className="mt-0 h-full min-h-0 overflow-hidden"><NodeGlobalTab active={active === "node-global"} /></TabsContent>
          <TabsContent value="channels" className="mt-0 h-full min-h-0 overflow-hidden"><ChannelsTab active={active === "channels"} /></TabsContent>
          <TabsContent value="retention" className="mt-0 h-full min-h-0 overflow-hidden"><RetentionTab active={active === "retention"} /></TabsContent>
          <TabsContent value="default-freeze" className="mt-0 h-full min-h-0 overflow-hidden"><DefaultFreezePolicyTab active={active === "default-freeze"} /></TabsContent>
          <TabsContent value="output-interception" className="mt-0 h-full min-h-0 overflow-hidden"><OutputInterceptionTab active={active === "output-interception"} /></TabsContent>
          <TabsContent value="test-types" className="mt-0 h-full min-h-0 overflow-hidden"><TestTemplatesTab active={active === "test-types"} /></TabsContent>
          <TabsContent value="header-templates" className="mt-0 h-full min-h-0 overflow-hidden"><HeaderTemplatesTab active={active === "header-templates"} /></TabsContent>
          <TabsContent value="model-rule-templates" className="mt-0 h-full min-h-0 overflow-hidden"><ModelRuleTemplatesTab active={active === "model-rule-templates"} /></TabsContent>
          <TabsContent value="models" className="mt-0 h-full min-h-0 overflow-hidden"><ModelsTab active={active === "models"} /></TabsContent>
        </div>
        <aside className="w-52 shrink-0 border-l bg-muted/20 p-3">
          <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">配置分类</p>
          <TabsList variant="line" className="h-auto w-full items-stretch justify-start gap-1 bg-transparent p-0">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => <TabsTrigger key={key} value={key} className="min-h-10 w-full flex-none justify-start px-3 py-2.5 text-left">{TAB_LABELS[key]}</TabsTrigger>)}
          </TabsList>
        </aside>
      </Tabs>
    </TooltipProvider>
  )

  if (open === undefined) return <AdminPage>{contents}</AdminPage>
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] flex-col gap-0 overflow-hidden p-0" style={{ width: "96vw", maxWidth: 1500 }}>
        <DialogHeader className="shrink-0 border-b px-6 py-4"><DialogTitle>全局配置</DialogTitle></DialogHeader>
        {contents}
      </DialogContent>
    </Dialog>
  )
}

export default GlobalConfig
