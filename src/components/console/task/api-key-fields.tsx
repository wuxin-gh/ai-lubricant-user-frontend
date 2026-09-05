/**
 * 任务创建弹框「API Key」Tab 的字段组 + 共享常量。
 *
 * 这些字段其实是 API Key 的参数（可用模型/可用编辑器/速率限制/累计配额/过期/选择策略），
 * 参照管理端 KeyModal（pages/manager/platform/ApiKeys.tsx）补齐。创建时由弹框把选中值
 * 透传给 createUserTask，服务端 create_task_child_api_key 复用既有 api_keys 列收窄子 Key
 * （不加新 schema）：
 * - 可用模型 selectedModels → models（models_snapshot 运行态菜单）+ model_whitelist（鉴权）
 * - 可用编辑器单选 → editor_provider_whitelist
 * - 速率限制 → rate_limit（按单 Key 计数，不做父子约束）
 * - 选择策略 → selection_strategy
 *
 * KeyModal 的 SELECTION_STRATEGY_OPTIONS / EDITOR_PROVIDER_OPTIONS 在这里复用一份，避免
 * 跨 manager/console 目录直接 import admin 页面。语义与 KeyModal 保持一致。
 *
 * 本组件只渲染字段本身（不带折叠/边框容器），由弹框放进「API Key」Tab 的 TabsContent。
 */
import MultiSelect from "@/components/console/editor/multi-select"
import { Hint, NumberField } from "@/components/console/task/task-form-fields"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { GatewayModelOption } from "@/api/editorClient"
import type { TaskProvider } from "@/api/userTaskClient"

/** 与 KeyModal 一致的选择策略选项（intelligent/fast_intelligent/…）。 */
export const SELECTION_STRATEGY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "intelligent", label: "智能选择（推荐）" },
  { value: "fast_intelligent", label: "快速智能选择" },
  { value: "sequential", label: "顺序（按优先级依次尝试）" },
  { value: "random_member", label: "成员随机（按自定义模型成员随机）" },
  { value: "model_random", label: "模型随机" },
  { value: "random_all", label: "全局随机（所有可用渠道随机）" },
]

export const DEFAULT_SELECTION_STRATEGY = "intelligent"

/** 任务相关执行客户端，与弹框 PROVIDERS 同源。 */
export const EDITOR_PROVIDER_OPTIONS: Array<{ value: TaskProvider; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
]

/** 速率限制的字段定义：key=写入 rate_limit 的字段名，label=中文标签。 */
const RATE_LIMIT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "requests_per_minute", label: "每分钟请求数" },
  { key: "tokens_per_minute", label: "每分钟 Token 数" },
  { key: "requests_per_5h", label: "每 5 小时请求数" },
  { key: "tokens_per_day", label: "每日 Token 数" },
  { key: "requests_per_day", label: "每日请求数" },
  { key: "tokens_per_week", label: "每周 Token 数" },
  { key: "requests_per_week", label: "每周请求数" },
  { key: "concurrent_requests", label: "并发请求数" },
  { key: "max_ips", label: "IP 个数上限" },
]

/** IP 刷新区间候选（秒）。与 KeyModal 一致。 */
const IP_WINDOW_OPTIONS = [
  { value: "3600", label: "1 小时" },
  { value: "21600", label: "6 小时" },
  { value: "86400", label: "1 天" },
  { value: "604800", label: "7 天" },
]

/** 可用编辑器单选项。前端三选项映射成 editor_provider_whitelist。 */
export type EditorScopeMode = "current" | "all" | "specified"

export interface RateLimitState {
  requests_per_minute?: string
  tokens_per_minute?: string
  requests_per_5h?: string
  tokens_per_day?: string
  requests_per_day?: string
  tokens_per_week?: string
  requests_per_week?: string
  concurrent_requests?: string
  max_ips?: string
  ip_window_seconds?: string
}

/** 把 rate_limit 表单状态收成只含正数的 dict（留空/0 视为不限制，不写入）。 */
export function buildRateLimitPayload(state: RateLimitState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { key } of RATE_LIMIT_FIELDS) {
    const raw = Number((state as Record<string, string | undefined>)[key])
    if (Number.isFinite(raw) && raw > 0) out[key] = raw
  }
  // IP 刷新区间只在 max_ips>0 时才有意义；KeyModal 同样在 max_ips<=0 时禁用此控件。
  const ips = Number(state.max_ips)
  const window = Number(state.ip_window_seconds)
  if (Number.isFinite(ips) && ips > 0 && Number.isFinite(window) && window > 0) {
    out.ip_window_seconds = window
  }
  return out
}

export interface TaskApiKeyPanelProps {
  /**
   * 可用模型、可用编辑器、选择策略三段是可选的：只有传了对应的 onChange 才渲染。
   * 任务弹框全传（完整收窄子 Key）；Review 弹框只用限额/过期那几段——它的模型是
   * 单选、且没有编辑器白名单与选择策略的概念，那几段留空即可。
   */
  /** 父 API Key 选中的可用模型候选（已按父 Key 白/黑名单过滤）。 */
  models?: GatewayModelOption[]
  selectedModels?: string[]
  onSelectedModelsChange?: (next: string[]) => void
  /** 当前执行客户端；可用编辑器=只允许当前执行客户端 时用它。 */
  provider?: TaskProvider
  editorMode?: EditorScopeMode
  onEditorModeChange?: (next: EditorScopeMode) => void
  selectedEditors?: TaskProvider[]
  onSelectedEditorsChange?: (next: TaskProvider[]) => void
  rateLimit: RateLimitState
  onRateLimitChange: (next: RateLimitState) => void
  maxRequests: string
  onMaxRequestsChange: (next: string) => void
  maxTotalTokens: string
  onMaxTotalTokensChange: (next: string) => void
  expiresAt: string
  onExpiresAtChange: (next: string) => void
  selectionStrategy?: string
  onSelectionStrategyChange?: (next: string) => void
  /** 顶部说明文案。默认按「本任务」口吻，Review 侧改成「每次 Review」。 */
  intro?: string
  disabled?: boolean
}

/**
 * 「API Key」Tab 的字段组。只渲染字段，容器/标题由弹框的 Tab 提供。
 *
 * rate_limit 用 grid 2 列 + NumberField（复用 task-form-fields）；过期用 datetime-local
 * （区别于 KeyModal 的 date-only——任务侧可精确到时分）。
 */
export function TaskApiKeyPanel(props: TaskApiKeyPanelProps) {
  const {
    models, selectedModels, onSelectedModelsChange,
    provider, editorMode, onEditorModeChange, selectedEditors, onSelectedEditorsChange,
    rateLimit, onRateLimitChange,
    maxRequests, onMaxRequestsChange, maxTotalTokens, onMaxTotalTokensChange,
    expiresAt, onExpiresAtChange,
    selectionStrategy, onSelectionStrategyChange,
    intro,
    disabled,
  } = props

  const setRate = (key: keyof RateLimitState, value: string) =>
    onRateLimitChange({ ...rateLimit, [key]: value })

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {intro || "这些参数会写进本任务派生的子 API Key，省略的字段继承父 Key。"}
        <Hint label="可用模型收窄 model_whitelist、可用编辑器收窄 editor_provider_whitelist、速率限制/累计配额/过期/选择策略同管理端 Key。" />
      </p>
      {/* 可用模型 */}
      {onSelectedModelsChange && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1">
            <Label>可用模型</Label>
            <Hint label="按所选父 API Key 的授权范围过滤；同时写入运行态菜单(models_snapshot)与子 Key 的 model_whitelist，使这把 Key 只允许调用这些模型。" />
          </div>
          <MultiSelect
            options={models || []}
            value={selectedModels || []}
            onChange={onSelectedModelsChange}
            placeholder="选择该任务可切换的模型（可多选）"
            emptyHint="暂无可用模型"
            className="min-h-11"
          />
        </div>
      )}

      {/* 可用编辑器 */}
      {onEditorModeChange && (
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            <Label>可用编辑器</Label>
            <Hint label="只允许当前执行客户端=子 Key 仅可用于本任务所选客户端；所有=不限制(继承父级)；指定客户端=多选若干(须落在父级允许范围内)。" />
          </div>
          <Select value={editorMode || DEFAULT_EDITOR_MODE} onValueChange={(v) => onEditorModeChange(v as EditorScopeMode)} disabled={disabled}>
            <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current">只允许当前执行客户端（{editorLabelOf(provider)}）</SelectItem>
              <SelectItem value="all">所有</SelectItem>
              <SelectItem value="specified">指定客户端</SelectItem>
            </SelectContent>
          </Select>
          {editorMode === "specified" && onSelectedEditorsChange && (
            <MultiSelect
              options={EDITOR_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={selectedEditors || []}
              onChange={(next) => onSelectedEditorsChange(next as TaskProvider[])}
              placeholder="选择允许的客户端（可多选）"
              emptyHint="暂无可选客户端"
              className="min-h-11"
            />
          )}
        </div>
      )}

      {/* 速率限制 */}
      <div className="grid grid-cols-2 gap-3">
        {RATE_LIMIT_FIELDS.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            value={(rateLimit as Record<string, string | undefined>)[field.key] || ""}
            onChange={(value) => setRate(field.key as keyof RateLimitState, value)}
            hint="留空=不限制"
            placeholder="不限制"
          />
        ))}
        {/* IP 刷新区间：只在填了 IP 个数时才可设，与 KeyModal 一致。 */}
        <div className="grid gap-1.5">
          <Label className="text-xs">IP 刷新区间</Label>
          <Select
            value={rateLimit.ip_window_seconds || "3600"}
            disabled={disabled || !Number(rateLimit.max_ips) || Number(rateLimit.max_ips) <= 0}
            onValueChange={(v) => setRate("ip_window_seconds", v)}
          >
            <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IP_WINDOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 累计配额 + 过期 */}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="最大请求次数" value={maxRequests} onChange={onMaxRequestsChange} hint="该任务派生 Key 的最大请求次数" placeholder="不限制" />
        <NumberField label="最大总 Token" value={maxTotalTokens} onChange={onMaxTotalTokensChange} hint="该任务派生 Key 的最大累计 token" placeholder="不限制" />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">过期时间</Label>
        <Input type="datetime-local" value={expiresAt} onChange={(e) => onExpiresAtChange(e.target.value)} disabled={disabled} />
      </div>

      {/* 选择策略 */}
      {onSelectionStrategyChange && (
        <div className="grid gap-1.5">
          <Label>选择策略</Label>
          <Select value={selectionStrategy || DEFAULT_SELECTION_STRATEGY} onValueChange={onSelectionStrategyChange} disabled={disabled}>
            <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SELECTION_STRATEGY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">决定命中多个可用渠道时如何挑选</span>
        </div>
      )}
    </div>
  )
}

/** 把 provider 转成可用编辑器摘要文案。 */
function editorLabelOf(provider?: TaskProvider): string {
  if (!provider) return "当前客户端"
  return EDITOR_PROVIDER_OPTIONS.find((o) => o.value === provider)?.label || provider
}

/** 重置默认值，供弹框 open 时调用。 */
export const DEFAULT_RATE_LIMIT: RateLimitState = {}
export const DEFAULT_EDITOR_MODE: EditorScopeMode = "current"
export const DEFAULT_SELECTION_STRATEGY_VALUE = DEFAULT_SELECTION_STRATEGY
