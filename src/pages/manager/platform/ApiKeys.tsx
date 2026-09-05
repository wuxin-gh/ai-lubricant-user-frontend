/**
 * API Keys 管理页 —— 从 admin-frontend 的 antd 版重写为 shadcn。
 * 数据层沿用 `@/@admin-port/api/*`（纯 axios），仅重写 view 层。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Plus, Check, ChevronsUpDown, X, Copy, CopyPlus } from "lucide-react"
import { AdminPage, SectionCard } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  addApiKey,
  copyApiKey,
  deleteApiKey,
  getApiKeyDetail,
  getApiKeyUsage,
  getApiKeys,
  toggleApiKeyDisabled,
  toggleApiKeysEnabled,
  updateApiKey,
} from "@/@admin-port/api/apiKeys"
import { getProviders } from "@/@admin-port/api/providers"
import type { CopyApiKeyPayload } from "@/@admin-port/api/apiKeys"
import { UsageGuideBody } from "./UsageGuide"
import type { ApiKey, ApiKeyConfig, ApiKeyUsageItem, ProviderLite } from "@/@admin-port/types/admin"

interface KeyFormValues {
  name: string
  requestsPerMinute?: number | null
  requestsPer5h?: number | null
  requestsPerDay?: number | null
  requestsPerWeek?: number | null
  tokensPerMinute?: number | null
  tokensPerDay?: number | null
  tokensPerWeek?: number | null
  concurrentRequests?: number | null
  maxIps?: number | null
  ipWindowSeconds?: number | null
  whitelist?: string[]
  blacklist?: string[]
  editorProviderWhitelist?: string[]
  editorProviderBlacklist?: string[]
  modelWhitelist?: string[]
  modelBlacklist?: string[]
  selectionStrategy?: string
  maxRequests?: number | null
  maxTotalTokens?: number | null
  /** epoch 秒；null/undefined = 永不过期 */
  expiresAt?: number | null
}

const SELECTION_STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "intelligent", label: "智能选择（推荐）" },
  { value: "fast_intelligent", label: "快速智能选择" },
  { value: "sequential", label: "顺序（按优先级依次尝试）" },
  { value: "random_member", label: "成员随机（按自定义模型成员随机）" },
  { value: "model_random", label: "模型随机" },
  { value: "random_all", label: "全局随机（所有可用渠道随机）" },
]

const DEFAULT_SELECTION_STRATEGY = "intelligent"

const EDITOR_PROVIDER_OPTIONS = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
]
const EDITOR_PROVIDER_VALUES = EDITOR_PROVIDER_OPTIONS.map((option) => option.value)

const USAGE_METRICS: { key: string; label: string }[] = [
  { key: "rpm", label: "RPM" },
  { key: "rp5h", label: "5H" },
  { key: "rpd", label: "RPD" },
  { key: "rpw", label: "RPW" },
  { key: "tpm", label: "TPM" },
  { key: "tpd", label: "TPD" },
  { key: "tpw", label: "TPW" },
  { key: "concurrent", label: "并发" },
  { key: "ip", label: "IP" },
]

function maskKey(key: string): string {
  if (!key) return "-"
  if (key.length <= 12) return "****"
  return `${key.slice(0, 8)}****${key.slice(-4)}`
}

function formatNum(n: number): string {
  return n.toLocaleString()
}

/** 后端 jsonb 字段偶发返回 JSON 文本而非数组，渲染前一律归一为字符串数组。 */
function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  if (typeof value === "string" && value.trim()) {
    try {
      return asStringList(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

function valueFromRateLimit(rateLimit: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rateLimit[key]
    if (typeof value === "number") return value
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

/** usage_limit 只认 max_requests / max_total_tokens，读出为正数或 undefined。 */
function usageCap(key: ApiKey, field: "max_requests" | "max_total_tokens"): number | undefined {
  const raw = (key.usage_limit as Record<string, unknown> | undefined)?.[field]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function keyToFormData(key: ApiKey): KeyFormValues {
  const rl = key.rate_limit || {}
  return {
    name: key.name,
    requestsPerMinute: valueFromRateLimit(rl, ["requests_per_minute", "rpm"]),
    requestsPer5h: valueFromRateLimit(rl, ["requests_per_5h", "requests_per_5_hours"]),
    requestsPerDay: valueFromRateLimit(rl, ["requests_per_day", "rpd"]),
    requestsPerWeek: valueFromRateLimit(rl, ["requests_per_week", "rpw"]),
    tokensPerMinute: valueFromRateLimit(rl, ["tokens_per_minute", "tpm"]),
    tokensPerDay: valueFromRateLimit(rl, ["tokens_per_day", "tpd"]),
    tokensPerWeek: valueFromRateLimit(rl, ["tokens_per_week", "tpw"]),
    concurrentRequests: valueFromRateLimit(rl, ["concurrent_requests", "concurrent"]),
    maxIps: valueFromRateLimit(rl, ["max_ips"]),
    ipWindowSeconds: valueFromRateLimit(rl, ["ip_window_seconds"]),
    whitelist: asStringList(key.provider_whitelist),
    blacklist: asStringList(key.provider_blacklist),
    editorProviderWhitelist: asStringList(key.editor_provider_whitelist),
    editorProviderBlacklist: asStringList(key.editor_provider_blacklist),
    modelWhitelist: asStringList(key.model_whitelist),
    modelBlacklist: asStringList(key.model_blacklist),
    selectionStrategy: key.selection_strategy || DEFAULT_SELECTION_STRATEGY,
    maxRequests: usageCap(key, "max_requests"),
    maxTotalTokens: usageCap(key, "max_total_tokens"),
    expiresAt: key.expires_at ?? null,
  }
}

function addPositiveNumber(target: Record<string, number>, key: string, value?: number | null) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) target[key] = value
}

function formDataToPayload(data: KeyFormValues): Record<string, unknown> {
  const rateLimit: Record<string, number> = {}
  addPositiveNumber(rateLimit, "requests_per_minute", data.requestsPerMinute)
  addPositiveNumber(rateLimit, "requests_per_5h", data.requestsPer5h)
  addPositiveNumber(rateLimit, "requests_per_day", data.requestsPerDay)
  addPositiveNumber(rateLimit, "requests_per_week", data.requestsPerWeek)
  addPositiveNumber(rateLimit, "tokens_per_minute", data.tokensPerMinute)
  addPositiveNumber(rateLimit, "tokens_per_day", data.tokensPerDay)
  addPositiveNumber(rateLimit, "tokens_per_week", data.tokensPerWeek)
  addPositiveNumber(rateLimit, "concurrent_requests", data.concurrentRequests)
  addPositiveNumber(rateLimit, "max_ips", data.maxIps)
  addPositiveNumber(rateLimit, "ip_window_seconds", data.ipWindowSeconds)

  const usageLimit: Record<string, number> = {}
  addPositiveNumber(usageLimit, "max_requests", data.maxRequests)
  addPositiveNumber(usageLimit, "max_total_tokens", data.maxTotalTokens)

  return {
    name: data.name.trim(),
    rate_limit: rateLimit,
    provider_whitelist: data.whitelist || [],
    provider_blacklist: data.blacklist || [],
    editor_provider_whitelist: (data.editorProviderWhitelist || []).filter((provider) => EDITOR_PROVIDER_VALUES.includes(provider)),
    editor_provider_blacklist: (data.editorProviderBlacklist || []).filter((provider) => EDITOR_PROVIDER_VALUES.includes(provider)),
    model_whitelist: (data.modelWhitelist || []).map((m) => m.trim()).filter(Boolean),
    model_blacklist: (data.modelBlacklist || []).map((m) => m.trim()).filter(Boolean),
    selection_strategy: data.selectionStrategy || DEFAULT_SELECTION_STRATEGY,
    usage_limit: usageLimit,
    expires_at: data.expiresAt ?? null,
  }
}

/** 把 KeyFormValues 转成子 Key 创建入参（copyApiKey）。语义同 formDataToPayload，
 *  但省略缺省字段以便后端"未给出=继承父"。 */
function formDataToCopyPayload(data: KeyFormValues): CopyApiKeyPayload {
  const base = formDataToPayload(data)
  return base as CopyApiKeyPayload
}

/** epoch 秒 → yyyy-MM-dd（本地）供 date input 使用；空返回 ""。 */
function epochToDateInput(epoch?: number | null): string {
  if (!epoch) return ""
  const d = new Date(epoch * 1000)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** yyyy-MM-dd → 当天 23:59:59 的 epoch 秒；空串返回 null（永不过期）。 */
function dateInputToEpoch(value: string): number | null {
  if (!value) return null
  const d = new Date(`${value}T23:59:59`)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000)
}

async function copyText(text: string, msg = "已复制") {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error("复制失败")
  }
}

// ---------------------------------------------------------------------------
// MultiSelect —— 替代 antd `Select mode="multiple"`（从固定 options 里多选）。
// ---------------------------------------------------------------------------
function MultiSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string[]
  options: string[]
  placeholder: string
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {v}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(v)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索..." />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const checked = value.includes(opt)
                return (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <Check className={cn("size-4", checked ? "opacity-100" : "opacity-0")} />
                    {opt}
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

// ---------------------------------------------------------------------------
// TagsInput —— 替代 antd `Select mode="tags"`（可从 options 选，也可自由输入回车新增）。
// ---------------------------------------------------------------------------
function TagsInput({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string[]
  options: string[]
  placeholder: string
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const add = (raw: string) => {
    const v = raw.trim()
    if (!v || value.includes(v)) return
    onChange([...value, v])
  }
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }
  const remove = (v: string) => onChange(value.filter((x) => x !== v))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {v}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(v)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            placeholder="输入模型名后回车新增"
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) {
                e.preventDefault()
                add(search)
                setSearch("")
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {search.trim() ? (
                <button
                  type="button"
                  className="text-sm text-foreground hover:underline"
                  onClick={() => {
                    add(search)
                    setSearch("")
                  }}
                >
                  添加 “{search.trim()}”
                </button>
              ) : (
                "输入以添加"
              )}
            </CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const checked = value.includes(opt)
                return (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <Check className={cn("size-4", checked ? "opacity-100" : "opacity-0")} />
                    {opt}
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

// ---------------------------------------------------------------------------
// 数字输入 —— 替代 antd InputNumber（留空/0 视为不限制）。
// ---------------------------------------------------------------------------
function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value?: number | null
  disabled?: boolean
  onChange: (next: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        disabled={disabled}
        placeholder="不限"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === "" ? null : Number(raw))
        }}
      />
    </div>
  )
}

function UsageMetric({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const barColor =
    percent > 90
      ? "bg-red-500"
      : percent > 60
        ? "bg-yellow-500"
        : "bg-green-500"
  return (
    <div className="flex min-w-[180px] flex-nowrap items-center gap-1.5 whitespace-nowrap">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono text-xs">
        {formatNum(used)}/{limit > 0 ? formatNum(limit) : "∞"}
      </span>
      {limit > 0 ? (
        <Progress value={percent} indicatorClassName={barColor} className="w-[54px]" />
      ) : null}
    </div>
  )
}

function KeyModal({
  open,
  editingKey,
  parentKey,
  saving,
  error,
  newKey,
  allChannelTags,
  allModels,
  onSave,
  onClose,
}: {
  open: boolean
  editingKey: ApiKey | null
  /** 非空 = 子 Key 创建模式：所有权限维度只能在该父 Key 范围内收窄 */
  parentKey?: ApiKey | null
  saving: boolean
  error: string | null
  newKey: string | null
  allChannelTags: string[]
  allModels: string[]
  onSave: (data: KeyFormValues) => void
  onClose: () => void
}) {
  const isChild = !!parentKey
  const isEdit = editingKey !== null
  const showSuccess = newKey !== null

  // 子 Key 模式下，白名单候选收窄为父白名单（父为空=不限制则沿用全量候选）。
  const parentProviderWhitelist = parentKey ? asStringList(parentKey.provider_whitelist) : []
  const parentModelWhitelist = parentKey ? asStringList(parentKey.model_whitelist) : []
  const parentEditorProviderWhitelist = parentKey ? asStringList(parentKey.editor_provider_whitelist) : []
  const parentProviderBlacklist = parentKey ? asStringList(parentKey.provider_blacklist) : []
  const parentModelBlacklist = parentKey ? asStringList(parentKey.model_blacklist) : []
  const parentEditorProviderBlacklist = parentKey ? asStringList(parentKey.editor_provider_blacklist) : []
  const channelOptions = isChild && parentProviderWhitelist.length > 0 ? parentProviderWhitelist : allChannelTags
  const modelOptions = isChild && parentModelWhitelist.length > 0 ? parentModelWhitelist : allModels
  const parentMaxRequests = parentKey ? usageCap(parentKey, "max_requests") : undefined
  const parentMaxTokens = parentKey ? usageCap(parentKey, "max_total_tokens") : undefined
  const parentExpiresAt = parentKey?.expires_at ?? null

  const [data, setData] = useState<KeyFormValues>({ name: "", selectionStrategy: DEFAULT_SELECTION_STRATEGY })
  const [nameError, setNameError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNameError(null)
    setLimitError(null)
    if (editingKey) {
      setData(keyToFormData(editingKey))
    } else if (parentKey) {
      // 子 Key 以父配置为初始值，用户在此基础上收窄。
      setData({ ...keyToFormData(parentKey), name: `${parentKey.name} (子 Key)` })
    } else {
      setData({
        name: "",
        whitelist: [],
        blacklist: [],
        editorProviderWhitelist: [],
        editorProviderBlacklist: [],
        modelWhitelist: [],
        modelBlacklist: [],
        selectionStrategy: DEFAULT_SELECTION_STRATEGY,
      })
    }
  }, [open, editingKey, parentKey])

  const set = <K extends keyof KeyFormValues>(key: K, value: KeyFormValues[K]) =>
    setData((d) => ({ ...d, [key]: value }))

  // 子 Key 的前端预校验，与后端 _narrow_child_config 同规则（后端才是权威）。
  const validateAgainstParent = (): string | null => {
    if (!isChild) return null
    if (parentProviderWhitelist.length > 0) {
      const extra = (data.whitelist || []).filter((v) => !parentProviderWhitelist.includes(v))
      if (extra.length) return `渠道标签白名单超出父 Key 范围：${extra.join(", ")}`
    }
    if (parentModelWhitelist.length > 0) {
      const extra = (data.modelWhitelist || []).filter((v) => !parentModelWhitelist.includes(v))
      if (extra.length) return `模型白名单超出父 Key 范围：${extra.join(", ")}`
    }
    if (parentEditorProviderWhitelist.length > 0) {
      const extra = (data.editorProviderWhitelist || []).filter((v) => !parentEditorProviderWhitelist.includes(v))
      if (extra.length) return `编辑器客户端白名单超出父 Key 范围：${extra.join(", ")}`
    }
    const missingChannelBlack = parentProviderBlacklist.filter((v) => !(data.blacklist || []).includes(v))
    if (missingChannelBlack.length) return `父 Key 的渠道标签黑名单不可移除：${missingChannelBlack.join(", ")}`
    const missingModelBlack = parentModelBlacklist.filter((v) => !(data.modelBlacklist || []).includes(v))
    if (missingModelBlack.length) return `父 Key 的模型黑名单不可移除：${missingModelBlack.join(", ")}`
    const missingEditorProviderBlack = parentEditorProviderBlacklist.filter((v) => !(data.editorProviderBlacklist || []).includes(v))
    if (missingEditorProviderBlack.length) return `父 Key 的编辑器客户端黑名单不可移除：${missingEditorProviderBlack.join(", ")}`
    if (parentMaxRequests) {
      const own = data.maxRequests || 0
      if (!own || own > parentMaxRequests) return `累计请求数上限必须 ≤ 父 Key（${parentMaxRequests}）`
    }
    if (parentMaxTokens) {
      const own = data.maxTotalTokens || 0
      if (!own || own > parentMaxTokens) return `累计 Token 数上限必须 ≤ 父 Key（${parentMaxTokens}）`
    }
    if (parentExpiresAt) {
      if (!data.expiresAt) return "父 Key 有过期时间，子 Key 不能设为永不过期"
      if (data.expiresAt > parentExpiresAt) return "过期时间不能晚于父 Key"
    }
    return null
  }

  const submit = () => {
    if (!data.name.trim()) {
      setNameError("请输入名称")
      return
    }
    setNameError(null)
    const violation = validateAgainstParent()
    setLimitError(violation)
    if (violation) return
    onSave(data)
  }

  const dialogTitle = showSuccess
    ? isChild
      ? "子 Key 创建成功"
      : "密钥创建成功"
    : isChild
      ? `创建子 Key（父：${parentKey?.name}）`
      : isEdit
        ? "编辑密钥"
        : "新建密钥"

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        {showSuccess ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertDescription>
                请立即复制并妥善保存以下密钥，此后将无法再次查看完整内容。
              </AlertDescription>
            </Alert>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {newKey}
              </code>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => void copyText(newKey!)}
                aria-label="复制密钥"
              >
                <Copy />
              </Button>
            </div>
            <div className="text-right">
              <Button onClick={onClose}>关闭</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isChild ? (
              <Alert>
                <AlertDescription>
                  子 Key 的权限只能在父 Key「{parentKey?.name}」的基础上收窄：白名单只能是父的子集、
                  父的黑名单不可移除、累计用量与过期时间不得超过父。用量会汇总到父 Key，父被停用/
                  过期/额度打满时子 Key 立即失效。
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">名称</Label>
              <Input
                id="key-name"
                autoFocus
                disabled={saving}
                placeholder="例如：生产环境密钥"
                value={data.name}
                aria-invalid={!!nameError}
                onChange={(e) => set("name", e.target.value)}
              />
              {nameError ? <span className="text-xs text-destructive">{nameError}</span> : null}
            </div>

            <Card size="sm" className="shadow-none">
              <CardHeader>
                <CardTitle>速率限制</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  留空表示不限制，填 0 也视为不限制。
                  {isChild ? "速率限制按单 Key 独立计数，不与父 Key 共享，可自由设定。" : ""}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="每分钟请求数" value={data.requestsPerMinute} disabled={saving} onChange={(v) => set("requestsPerMinute", v)} />
                  <NumberField label="每分钟 Token 数" value={data.tokensPerMinute} disabled={saving} onChange={(v) => set("tokensPerMinute", v)} />
                  <NumberField label="每 5 小时请求数" value={data.requestsPer5h} disabled={saving} onChange={(v) => set("requestsPer5h", v)} />
                  <NumberField label="每日 Token 数" value={data.tokensPerDay} disabled={saving} onChange={(v) => set("tokensPerDay", v)} />
                  <NumberField label="每日请求数" value={data.requestsPerDay} disabled={saving} onChange={(v) => set("requestsPerDay", v)} />
                  <NumberField label="每周 Token 数" value={data.tokensPerWeek} disabled={saving} onChange={(v) => set("tokensPerWeek", v)} />
                  <NumberField label="每周请求数" value={data.requestsPerWeek} disabled={saving} onChange={(v) => set("requestsPerWeek", v)} />
                  <NumberField label="并发请求数" value={data.concurrentRequests} disabled={saving} onChange={(v) => set("concurrentRequests", v)} />
                  <NumberField label="IP 个数上限" value={data.maxIps} disabled={saving} onChange={(v) => set("maxIps", v)} />
                  <div className="flex flex-col gap-1.5">
                    <Label>IP 刷新区间</Label>
                    <Select
                      value={String(data.ipWindowSeconds || 3600)}
                      disabled={saving || !data.maxIps || data.maxIps <= 0}
                      onValueChange={(v) => set("ipWindowSeconds", Number(v))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3600">1 小时</SelectItem>
                        <SelectItem value="21600">6 小时</SelectItem>
                        <SelectItem value="86400">1 天</SelectItem>
                        <SelectItem value="604800">7 天</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  限制该 Key 在窗口内可调用的不同客户端 IP 数；窗口从首次访问起算，到期自动清空重置。
                  子 Key 独立计数，不汇总到父 Key。
                </p>
              </CardContent>
            </Card>

            <Card size="sm" className="shadow-none">
              <CardHeader>
                <CardTitle>累计配额与有效期</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  累计配额按成功请求的历史总量计（不是周期重置），留空=不限。
                  {isChild ? "子 Key 的用量同时计入父 Key 的累计配额。" : "父 Key 的配额会把所有子 Key 的用量一并计入。"}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label={`累计请求数上限${parentMaxRequests ? `（父：${parentMaxRequests}）` : ""}`}
                    value={data.maxRequests}
                    disabled={saving}
                    onChange={(v) => set("maxRequests", v)}
                  />
                  <NumberField
                    label={`累计 Token 数上限${parentMaxTokens ? `（父：${parentMaxTokens}）` : ""}`}
                    value={data.maxTotalTokens}
                    disabled={saving}
                    onChange={(v) => set("maxTotalTokens", v)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="key-expires">
                    过期时间
                    {parentExpiresAt ? `（父：${epochToDateInput(parentExpiresAt)}）` : ""}
                  </Label>
                  <Input
                    id="key-expires"
                    type="date"
                    disabled={saving}
                    max={parentExpiresAt ? epochToDateInput(parentExpiresAt) : undefined}
                    value={epochToDateInput(data.expiresAt)}
                    onChange={(e) => set("expiresAt", dateInputToEpoch(e.target.value))}
                  />
                  <span className="text-xs text-muted-foreground">留空表示永不过期；到期当日 23:59:59 后拒绝请求</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-1.5">
              <Label>渠道标签白名单</Label>
              <MultiSelect
                value={data.whitelist || []}
                options={channelOptions}
                placeholder={isChild && parentProviderWhitelist.length > 0 ? "留空表示继承父 Key 全部允许的渠道标签" : "留空表示允许所有渠道标签"}
                disabled={saving}
                onChange={(v) => set("whitelist", v)}
              />
              {isChild && parentProviderWhitelist.length > 0 ? (
                <span className="text-xs text-muted-foreground">候选已收窄为父 Key 允许的渠道标签</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>渠道标签黑名单</Label>
              <MultiSelect
                value={data.blacklist || []}
                options={allChannelTags}
                placeholder="留空表示不屏蔽任何渠道标签"
                disabled={saving}
                onChange={(v) => set("blacklist", v)}
              />
              {isChild && parentProviderBlacklist.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  父 Key 已屏蔽 {parentProviderBlacklist.join(", ")}，不可移除
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>编辑器客户端白名单</Label>
                <MultiSelect
                  value={data.editorProviderWhitelist || []}
                  options={parentEditorProviderWhitelist.length > 0 ? parentEditorProviderWhitelist : EDITOR_PROVIDER_VALUES}
                  placeholder={isChild && parentEditorProviderWhitelist.length > 0 ? "留空表示继承父 Key 允许的客户端" : "留空表示允许所有客户端"}
                  disabled={saving}
                  onChange={(v) => set("editorProviderWhitelist", v)}
                />
                <span className="text-xs text-muted-foreground">
                  只在创建 Claude/Codex/OpenCode 编辑器会话时检查，不影响渠道重试。
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>编辑器客户端黑名单</Label>
                <MultiSelect
                  value={data.editorProviderBlacklist || []}
                  options={EDITOR_PROVIDER_VALUES}
                  placeholder="留空表示不屏蔽任何客户端"
                  disabled={saving}
                  onChange={(v) => set("editorProviderBlacklist", v)}
                />
                {isChild && parentEditorProviderBlacklist.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    父 Key 已屏蔽 {parentEditorProviderBlacklist.join(", ")}，不可移除
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>选择策略</Label>
              <Select
                value={data.selectionStrategy || DEFAULT_SELECTION_STRATEGY}
                disabled={saving}
                onValueChange={(v) => set("selectionStrategy", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="默认：顺序" />
                </SelectTrigger>
                <SelectContent>
                  {SELECTION_STRATEGY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">决定命中多个可用渠道时如何挑选</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>模型白名单</Label>
              <TagsInput
                value={data.modelWhitelist || []}
                options={modelOptions}
                placeholder="输入模型名后回车，可多个"
                disabled={saving}
                onChange={(v) => set("modelWhitelist", v)}
              />
              <span className="text-xs text-muted-foreground">
                {isChild && parentModelWhitelist.length > 0
                  ? "只能填父 Key 允许的模型；留空表示继承父 Key 的全部允许模型"
                  : "留空表示允许所有模型；填写后仅允许调用列出的模型名（含自定义模型名/别名）"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>模型黑名单</Label>
              <TagsInput
                value={data.modelBlacklist || []}
                options={allModels}
                placeholder="输入模型名后回车，可多个"
                disabled={saving}
                onChange={(v) => set("modelBlacklist", v)}
              />
              <span className="text-xs text-muted-foreground">
                {isChild && parentModelBlacklist.length > 0
                  ? `父 Key 已屏蔽 ${parentModelBlacklist.join(", ")}，不可移除`
                  : "留空表示不屏蔽任何模型"}
              </span>
            </div>

            {limitError ? (
              <Alert variant="destructive">
                <AlertDescription>{limitError}</AlertDescription>
              </Alert>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? <Spinner /> : null}
                {isEdit ? "保存修改" : isChild ? "创建子 Key" : "创建密钥"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ApiKeys() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<ApiKeyConfig | null>(null)
  const [usage, setUsage] = useState<ApiKeyUsageItem[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null)
  /** 编辑弹窗拉详情期间禁用按钮，避免重复点击 */
  const [editingLoadingId, setEditingLoadingId] = useState<number | null>(null)
  /** 非 null = 当前处于子 Key 创建模式（父 Key）；与 editingKey 互斥 */
  const [parentKey, setParentKey] = useState<ApiKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [togglingGlobal, setTogglingGlobal] = useState(false)
  const [confirmKey, setConfirmKey] = useState<ApiKey | null>(null)
  const [usageGuideOpen, setUsageGuideOpen] = useState(false)
  /** 非空 = 当前打开子密钥管理弹框（作用域为该父密钥） */
  const [childManageKey, setChildManageKey] = useState<ApiKey | null>(null)

  const allChannelTags = useMemo(() => {
    const tags = new Set<string>()
    providers.forEach((provider) => (provider.tags || []).forEach((tag) => {
      const value = String(tag).trim()
      if (value) tags.add(value)
    }))
    return Array.from(tags).sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [providers])
  const allModelNames = useMemo(() => {
    const set = new Set<string>()
    providers.forEach((p) => (p.models || []).forEach((m) => { if (m) set.add(m) }))
    return Array.from(set).sort()
  }, [providers])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [configData, usageData, providersData] = await Promise.all([
        getApiKeys(),
        getApiKeyUsage(),
        getProviders({ lite: true }).catch(() => []),
      ])
      setConfig(configData)
      setUsage(usageData)
      setProviders(providersData)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  const handleCreate = () => {
    setEditingKey(null)
    setParentKey(null)
    setModalError(null)
    setNewKey(null)
    setModalOpen(true)
  }

  const handleEdit = async (key: ApiKey) => {
    // 列表已裁字段（rate_limit/whitelist/thinking_config/usage_limit 等为空占位），
    // 弹窗 keyToFormData 需要全字段，故点编辑时先拉详情再开弹窗——避免表单
    // 先用裁剪后的空数据初始化、用户看到空白配置误以为数据丢失。
    setEditingLoadingId(key.id)
    try {
      const full = await getApiKeyDetail(key.id)
      setEditingKey(full)
      setParentKey(null)
      setModalError(null)
      setNewKey(null)
      setModalOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载 Key 详情失败")
    } finally {
      setEditingLoadingId(null)
    }
  }

  // 打开子 Key 配置对话框：以父 Key 配置为初始值，用户在父范围内收窄后提交。
  const handleCreateChild = (key: ApiKey) => {
    setEditingKey(null)
    setParentKey(key)
    setModalError(null)
    setNewKey(null)
    setModalOpen(true)
  }

  const handleSave = async (data: KeyFormValues) => {
    setSaving(true)
    setModalError(null)
    try {
      if (editingKey) {
        const payload = formDataToPayload(data)
        await updateApiKey(editingKey.id, payload)
        setModalOpen(false)
        toast.success("密钥已更新")
      } else if (parentKey) {
        const result = await copyApiKey(parentKey.id, formDataToCopyPayload(data))
        setNewKey(result.key.key)
        toast.success("子 Key 已创建")
      } else {
        const result = await addApiKey(formDataToPayload(data))
        setNewKey(result.key.key)
        toast.success("密钥已创建")
      }
      await fetchData()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await deleteApiKey(id)
      toast.success("密钥已删除")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggle = async (key: ApiKey) => {
    setTogglingId(key.id)
    try {
      await toggleApiKeyDisabled(key.id, !key.disabled)
      toast.success(key.disabled ? "密钥已启用" : "密钥已停用")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换状态失败")
    } finally {
      setTogglingId(null)
    }
  }

  const handleToggleGlobal = async (enabled: boolean) => {
    setTogglingGlobal(true)
    try {
      await toggleApiKeysEnabled(enabled)
      toast.success(enabled ? "API Key 认证已启用" : "API Key 认证已关闭")
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换总开关失败")
    } finally {
      setTogglingGlobal(false)
    }
  }

  const usageMap = useMemo(() => {
    const map = new Map<number, ApiKeyUsageItem>()
    usage.forEach((item) => map.set(item.id, item))
    return map
  }, [usage])

  const keys = config?.keys ?? []
  const showTableSpinner = loading && !config

  // 子密钥均带 parent_id；从 parent_id 派生子密钥列表与计数，无需后端改动。
  const childrenOf = useCallback(
    (parentId: number) => keys.filter((k) => k.parent_id === parentId),
    [keys],
  )
  const childCount = useCallback((k: ApiKey) => childrenOf(k.id).length, [childrenOf])

  // 主表格只保留父密钥行；孤儿子密钥（parent_id 指向已不存在的父）退化为根行展示，避免被隐藏。
  const rootRows = useMemo(() => {
    const byId = new Map(keys.map((k) => [k.id, k]))
    return keys.filter((k) => !k.parent_id || !byId.has(k.parent_id))
  }, [keys])

  // 陈旧选择保护：父密钥被并发删除后，管理弹框自动关闭；编辑/刷新后引用最新对象。
  const currentManageKey = childManageKey
    ? keys.find((k) => k.id === childManageKey.id) ?? null
    : null
  useEffect(() => {
    if (childManageKey && !currentManageKey) setChildManageKey(null)
  }, [childManageKey, currentManageKey])

  // 删除确认同样用最新对象，使「是否存在子密钥」判定反映刷新后状态。
  const currentConfirmKey = confirmKey
    ? keys.find((k) => k.id === confirmKey.id) ?? confirmKey
    : null

  const renderKeyCell = (keyObj: ApiKey, depth = 0) => (
    <div className={cn("flex flex-col items-center gap-1.5 text-center", depth > 0 && "border-l-2 border-muted pl-4")}>
      {/* 一行一个：名称、状态徽章、密钥各占一行，避免横向堆叠把列撑宽、挤压操作列 */}
      <span className={cn("max-w-full break-words font-medium", keyObj.disabled ? "text-muted-foreground line-through" : "")}>
        {keyObj.name}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {keyObj.disabled ? <Badge variant="secondary">已停用</Badge> : <Badge variant="outline" className="text-green-600 dark:text-green-400">启用</Badge>}
        {keyObj.parent_id ? (
          <Badge variant="outline" className="text-blue-600 dark:text-blue-400">
            {keyObj.editor_id ? "编辑器副本" : "Key 副本"}
          </Badge>
        ) : null}
      </div>
      {keyObj.editor_name ? <div className="text-xs text-muted-foreground">绑定编辑器：{keyObj.editor_name}</div> : null}
      <div className="flex items-center gap-1.5">
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{maskKey(keyObj.key)}</code>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => void copyText(keyObj.key)}
          aria-label="复制完整密钥"
        >
          <Copy />
        </Button>
      </div>
    </div>
  )

  const renderUsageCell = (keyObj: ApiKey) => {
    const u = usageMap.get(keyObj.id)?.usage as Record<string, unknown> | undefined
    const ledger = usageMap.get(keyObj.id)?.ledger_usage
    const metrics = USAGE_METRICS.flatMap((m) => {
      const used = Number(u?.[`${m.key}_used`] || 0)
      const limit = Number(u?.[`${m.key}_limit`] || 0)
      return used > 0 || limit > 0 ? [{ label: m.label, used, limit }] : []
    })
    const ledgerRows: { label: string; value: string }[] = []
    if (ledger) {
      const reqs = Number(ledger.requests || 0)
      const tokens = Number(ledger.total_tokens || 0)
      if (reqs || tokens) {
        ledgerRows.push({ label: "累计请求", value: String(reqs) })
        ledgerRows.push({ label: "累计 Token", value: tokens.toLocaleString() })
      }
    }
    return metrics.length > 0 || ledgerRows.length > 0 ? (
      <div className="flex flex-col items-center gap-1.5 text-center">
        {metrics.length > 0 ? (
          <div className="grid grid-cols-[repeat(2,max-content)] justify-center gap-x-2 gap-y-1.5">
            {metrics.map((m) => (
              <UsageMetric key={m.label} {...m} />
            ))}
          </div>
        ) : null}
        {ledgerRows.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {ledgerRows.map((r) => (
              <span key={r.label}>{r.label}: {r.value}{keyObj.parent_id == null ? " (含子 Key)" : ""}</span>
            ))}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="text-center text-muted-foreground">暂无用量</div>
    )
  }

  const renderChannelCell = (keyObj: ApiKey) => {
    const whitelist = asStringList(keyObj.provider_whitelist)
    const blacklist = asStringList(keyObj.provider_blacklist)
    if (whitelist.length === 0 && blacklist.length === 0)
      return <div className="text-center text-muted-foreground">无限制</div>
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        {whitelist.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            <span className="text-muted-foreground">白名单：</span>
            {whitelist.map((name) => (
              <Badge key={name} variant="outline" className="text-green-600 dark:text-green-400">
                {name}
              </Badge>
            ))}
          </div>
        ) : null}
        {blacklist.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            <span className="text-muted-foreground">黑名单：</span>
            {blacklist.map((name) => (
              <Badge key={name} variant="destructive">
                {name}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const renderModelCell = (keyObj: ApiKey) => {
    const whitelist = asStringList(keyObj.model_whitelist)
    const blacklist = asStringList(keyObj.model_blacklist)
    const strategy = SELECTION_STRATEGY_OPTIONS.find((o) => o.value === keyObj.selection_strategy)
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="text-muted-foreground">策略：</span>
          <Badge variant="outline" className="text-blue-600 dark:text-blue-400">
            {strategy?.label ?? keyObj.selection_strategy ?? DEFAULT_SELECTION_STRATEGY}
          </Badge>
        </div>
        {whitelist.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            <span className="text-muted-foreground">白名单：</span>
            {whitelist.map((name) => (
              <Badge key={name} variant="outline" className="text-green-600 dark:text-green-400">
                {name}
              </Badge>
            ))}
          </div>
        ) : null}
        {blacklist.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            <span className="text-muted-foreground">黑名单：</span>
            {blacklist.map((name) => (
              <Badge key={name} variant="destructive">
                {name}
              </Badge>
            ))}
          </div>
        ) : null}
        {whitelist.length === 0 && blacklist.length === 0 ? (
          <span className="text-muted-foreground">模型不限制</span>
        ) : null}
      </div>
    )
  }

  return (
    <AdminPage
      title="密钥"
      description="管理 OpenAI 兼容接口的访问密钥"
      primaryActions={
        <>
          <ManagerRefreshButton loading={loading} onClick={() => void fetchData()} />
          <Button onClick={handleCreate}>
            <Plus />
            新建密钥
          </Button>
        </>
      }
      overflowActions={
        <Button variant="outline" onClick={() => setUsageGuideOpen(true)}>
          使用方法
        </Button>
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void fetchData()}>
              重试
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <SectionCard
        title="密钥列表"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">共 {rootRows.length} 个密钥</span>
            <span className="text-sm text-muted-foreground">认证总开关</span>
            <Switch
              checked={!!config?.enabled}
              disabled={togglingGlobal}
              onCheckedChange={handleToggleGlobal}
            />
          </div>
        }
      >
        {showTableSpinner ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">密钥</TableHead>
                <TableHead className="w-[90px] text-center">子密钥</TableHead>
                <TableHead className="w-[420px] min-w-[420px] text-center">用量 / 限制</TableHead>
                <TableHead className="w-[260px] text-center">渠道限制</TableHead>
                <TableHead className="w-[260px] text-center">模型与策略</TableHead>
                <TableHead className="w-[300px] text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    暂无 API Key，点击「新建密钥」创建
                  </TableCell>
                </TableRow>
              ) : (
                rootRows.map((keyObj) => (
                  <TableRow key={keyObj.id}>
                    <TableCell className="align-middle">{renderKeyCell(keyObj)}</TableCell>
                    <TableCell className="align-middle text-center">
                      {childCount(keyObj) > 0 ? (
                        <Badge variant="secondary">{childCount(keyObj)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="align-middle whitespace-normal">{renderUsageCell(keyObj)}</TableCell>
                    <TableCell className="align-middle whitespace-normal">{renderChannelCell(keyObj)}</TableCell>
                    <TableCell className="align-middle whitespace-normal">{renderModelCell(keyObj)}</TableCell>
                    <TableCell className="align-middle">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Switch
                          checked={!keyObj.disabled}
                          disabled={togglingId === keyObj.id}
                          onCheckedChange={() => void handleToggle(keyObj)}
                          size="sm"
                        />
                        <Button size="sm" variant="outline" disabled={editingLoadingId === keyObj.id} onClick={() => void handleEdit(keyObj)}>
                          {editingLoadingId === keyObj.id ? "加载中…" : "编辑"}
                        </Button>
                        {/* 子密钥管理入口：点击打开该父密钥的子密钥管理弹框 */}
                        {keyObj.parent_id ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setChildManageKey(keyObj)}
                          >
                            <CopyPlus />
                            子密钥
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingId === keyObj.id}
                          onClick={() => setConfirmKey(keyObj)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Dialog
        open={childManageKey !== null}
        onOpenChange={(o) => (o ? undefined : setChildManageKey(null))}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-[1000px]"
          style={{ maxWidth: "min(1000px, 92vw)" }}
        >
          <DialogHeader>
            <DialogTitle>管理子密钥（父：{currentManageKey?.name}）</DialogTitle>
          </DialogHeader>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (currentManageKey) handleCreateChild(currentManageKey)
              }}
            >
              <CopyPlus />
              新建子密钥
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px] text-center">密钥</TableHead>
                <TableHead className="w-[420px] min-w-[420px] text-center">用量 / 限制</TableHead>
                <TableHead className="w-[260px] text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!currentManageKey || childrenOf(currentManageKey.id).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    暂无子密钥
                  </TableCell>
                </TableRow>
              ) : (
                childrenOf(currentManageKey.id).map((child) => (
                  <TableRow key={child.id}>
                    <TableCell className="align-middle">{renderKeyCell(child)}</TableCell>
                    <TableCell className="align-middle whitespace-normal">{renderUsageCell(child)}</TableCell>
                    <TableCell className="align-middle">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Switch
                          checked={!child.disabled}
                          disabled={togglingId === child.id}
                          onCheckedChange={() => void handleToggle(child)}
                          size="sm"
                        />
                        <Button size="sm" variant="outline" disabled={editingLoadingId === child.id} onClick={() => void handleEdit(child)}>
                          {editingLoadingId === child.id ? "加载中…" : "编辑"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingId === child.id}
                          onClick={() => setConfirmKey(child)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setChildManageKey(null)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <KeyModal
        open={modalOpen}
        editingKey={editingKey}
        parentKey={parentKey}
        saving={saving}
        error={modalError}
        newKey={newKey}
        allChannelTags={allChannelTags}
        allModels={allModelNames}
        onSave={handleSave}
        onClose={() => setModalOpen(false)}
      />

      <AlertDialog
        open={confirmKey !== null}
        onOpenChange={(o) => (o ? undefined : setConfirmKey(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复。
              {currentConfirmKey && keys.some((k) => k.parent_id === currentConfirmKey.id)
                ? "该 Key 存在子密钥，删除后子密钥将解除父子关系并独立保留。"
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmKey ? deletingId === confirmKey.id : false}
              onClick={() => {
                if (confirmKey) void handleDelete(confirmKey.id)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 使用方法（从独立页降级为弹框） */}
      <Dialog open={usageGuideOpen} onOpenChange={setUsageGuideOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-[900px]"
          style={{ maxWidth: 'min(900px, 92vw)' }}
        >
          <DialogHeader>
            <DialogTitle>使用方法</DialogTitle>
          </DialogHeader>
          <UsageGuideBody />
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}

export default ApiKeys
