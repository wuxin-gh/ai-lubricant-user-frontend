/**
 * 共享冻结策略编辑器，供渠道编辑弹窗与全局配置「默认冻结策略」Tab 共用。
 * 从 Channels.tsx 原内联编辑器抽取，内部样式自包含（CSS 变量来自平台页面根）。
 */
import { useCallback, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ComboSearchSelect } from "@/components/ui/combo-select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ProviderLimitFreezeRule } from "@/@admin-port/types/admin"

// ── 复用 Channels 同款兜底 helper，避免两套实现产生歧义 ──────────────────────
export function safeString(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  return String(value)
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function safeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value
  return value !== "false" && value !== 0 && value !== null && value !== undefined && value !== ""
}

// ── 冻结对象 × 周期选项（与后端 limit_policy_store.py 的定义一致） ──────────
export const FREEZE_OBJECT_OPTIONS = [
  { value: "account", label: "账号", short: "账号" },
  { value: "account_model", label: "账号模型", short: "账号模型" },
  { value: "channel", label: "渠道", short: "渠道" },
  { value: "channel_model", label: "渠道模型", short: "渠道模型" },
] as const

export const FREEZE_PERIOD_OPTIONS = [
  { value: "none", label: "不冻结" },
  { value: "disabled", label: "禁用" },
  { value: "permanent", label: "永久冻结（检测成功可解冻）" },
  { value: "seconds", label: "秒" },
  { value: "minutes", label: "分钟" },
  { value: "hours", label: "小时" },
  { value: "days", label: "天" },
  { value: "today", label: "今天（到当天结束）" },
  { value: "week", label: "本周（到本周日结束）" },
  { value: "month", label: "本月（到月末结束）" },
] as const

export const FREEZE_PERIODS_WITH_VALUE: string[] = ["seconds", "minutes", "hours", "days"]
export const FREEZE_OBJECTS_SUPPORT_DISABLED: string[] = ["account", "channel"]
export const FREEZE_OBJECTS_SUPPORT_PERMANENT: string[] = ["account"]

// ── 旧字段映射（共用）───────────────────────────────────────────────────────
export const LEGACY_FREEZE_MODE_MAP: Record<string, { object: ProviderLimitFreezeRule["freeze_object"]; period: ProviderLimitFreezeRule["freeze_period"]; fixed: number | null }> = {
  no_freeze: { object: "account", period: "none", fixed: 0 },
  account_daily: { object: "account", period: "today", fixed: 0 },
  account_model_daily: { object: "account_model", period: "today", fixed: 0 },
  account_permanent: { object: "account", period: "disabled", fixed: 0 },
  fixed_duration: { object: "account", period: "seconds", fixed: null },
  account_model_fixed: { object: "account_model", period: "seconds", fixed: null },
  account_model_weekly: { object: "account_model", period: "week", fixed: 0 },
  account_model_monthly: { object: "account_model", period: "month", fixed: 0 },
  channel_fixed: { object: "channel", period: "seconds", fixed: null },
  channel_model_fixed: { object: "channel_model", period: "seconds", fixed: null },
}

export function normalizeFreezeRuleInput(r: Record<string, any>): ProviderLimitFreezeRule {
  const base = {
    condition: (r.condition || "status_code") as ProviderLimitFreezeRule["condition"],
    key: safeString(r.key),
    operator: (r.operator || "==") as ProviderLimitFreezeRule["operator"],
    value: safeString(r.value),
  }
  // 缺省为开：历史规则没有 enabled 字段，读进来不能变成停用态。
  const ruleEnabled = r.enabled !== false
  if (r.freeze_object || r.freeze_period) {
    return {
      ...base,
      freeze_object: (safeString(r.freeze_object).trim().toLowerCase() || "account") as ProviderLimitFreezeRule["freeze_object"],
      freeze_period: (safeString(r.freeze_period).trim().toLowerCase() || "seconds") as ProviderLimitFreezeRule["freeze_period"],
      freeze_value: safeNumber(r.freeze_value, 60),
      enabled: ruleEnabled,
    }
  }
  const mapped = LEGACY_FREEZE_MODE_MAP[safeString(r.freeze_mode).trim().toLowerCase()] || LEGACY_FREEZE_MODE_MAP.fixed_duration
  return {
    ...base,
    freeze_object: mapped.object,
    freeze_period: mapped.period,
    freeze_value: mapped.fixed === null ? safeNumber(r.freeze_seconds, 60) : mapped.fixed,
    enabled: ruleEnabled,
  }
}

export function freezeObjectPeriodText(rule: ProviderLimitFreezeRule): string {
  if (rule.freeze_period === "none") return "不冻结"
  const objLabel = FREEZE_OBJECT_OPTIONS.find((o) => o.value === rule.freeze_object)?.short || rule.freeze_object
  if (rule.freeze_period === "disabled") return `禁用${objLabel}`
  if (rule.freeze_period === "permanent") return `永久冻结${objLabel}`
  const periodLabel = FREEZE_PERIOD_OPTIONS.find((p) => p.value === rule.freeze_period)?.label || rule.freeze_period
  const valueText = FREEZE_PERIODS_WITH_VALUE.includes(rule.freeze_period) ? `${rule.freeze_value}` : ""
  return `${objLabel}·${valueText}${periodLabel}`
}

const FREEZE_OPERATOR_LABEL: Record<string, string> = { in: "包括", "==": "==", "!=": "!=", "<=": "≤", ">=": "≥", "<": "<", ">": ">", contains: "包含" }

export function freezeRuleSummary(rule: ProviderLimitFreezeRule): string {
  const freezeText = `，${freezeObjectPeriodText(rule)}`
  const condMap: Record<string, string> = { status_code: "状态码", headers: "响应头", exception: "异常", error_type: "错误类型", body: "响应体" }
  const condText = condMap[rule.condition] || rule.condition
  const opValueText = rule.operator === "exists"
    ? "存在"
    : rule.operator === "in"
      ? `包括${rule.value || ""}`
      : `${FREEZE_OPERATOR_LABEL[rule.operator] || rule.operator}${rule.value || ""}`
  return `${condText} · ${opValueText}${freezeText}`
}

// ── 样式常量（样式随组件走，Channel 弹窗与 GlobalConfig 都能用） ─────────────
const inputStyle: React.CSSProperties = {
  height: "32px",
  border: "1px solid var(--admin-border)",
  borderRadius: "var(--admin-radius)",
  padding: "0 10px",
  fontSize: "13px",
  background: "var(--bg1)",
  color: "var(--text)",
  lineHeight: "20px",
  width: "100%",
}

const btnDanger: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "28px",
  padding: "0 10px",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid rgba(239,68,68,0.35)",
  borderRadius: "var(--admin-radius)",
  cursor: "pointer",
  background: "rgba(239,68,68,0.04)",
  color: "#ef4444",
}

const btnSubtle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "28px",
  padding: "0 10px",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid var(--admin-border)",
  borderRadius: "var(--admin-radius)",
  cursor: "pointer",
  background: "var(--bg1)",
  color: "var(--text)",
}

const grid2Style: React.CSSProperties = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
}

// ── 组件 ───────────────────────────────────────────────────────────────────
export interface FreezePolicyEditorProps {
  /** 当前冻结策略（enabled + rules） */
  value: { enabled: boolean; rules: ProviderLimitFreezeRule[] }
  /** 变更回调 */
  onChange: (next: { enabled: boolean; rules: ProviderLimitFreezeRule[] }) => void
  /** 可选：类名（嵌入不同布局） */
  className?: string
}

export function FreezePolicyEditor({ value, onChange, className = "" }: FreezePolicyEditorProps) {
  const { enabled, rules } = value
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const patch = useCallback(
    (next: { enabled?: boolean; rules?: ProviderLimitFreezeRule[] }) => {
      onChange({ enabled: next.enabled ?? enabled, rules: next.rules ?? rules })
    },
    [enabled, rules, onChange],
  )

  const setRules = useCallback(
    (fn: (prev: ProviderLimitFreezeRule[]) => ProviderLimitFreezeRule[]) => patch({ rules: fn(rules) }),
    [rules, patch],
  )

  const addRule = useCallback(() => {
    setRules((prev) => [
      ...prev,
      { condition: "status_code", key: "", operator: "in", value: "429", freeze_object: "account", freeze_period: "seconds", freeze_value: 60, enabled: true },
    ])
    setExpanded((s) => new Set([...s, rules.length]))
  }, [rules.length, setRules])

  const moveRule = useCallback(
    (idx: number, direction: -1 | 1) => {
      const target = idx + direction
      if (target < 0 || target >= rules.length) return
      setRules((prev) => {
        const next = [...prev]
        ;[next[idx], next[target]] = [next[target], next[idx]]
        return next
      })
      // 只交换展开态对应的索引，移动操作本身不会触发折叠/展开。
      setExpanded((prev) => {
        const next = new Set<number>()
        prev.forEach((i) => {
          if (i === idx) next.add(target)
          else if (i === target) next.add(idx)
          else next.add(i)
        })
        return next
      })
    },
    [rules.length, setRules],
  )

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "var(--admin-radius)", border: "1px solid var(--admin-border)", background: "var(--bg3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>启用冻结策略</span>
          <Switch checked={enabled} onCheckedChange={(checked) => patch({ enabled: checked === true })} />
        </div>
        {rules.length === 0 && (
          <div style={{ fontSize: "13px", color: "var(--text2)", textAlign: "center", padding: "8px" }}>暂无冻结规则</div>
        )}
        {rules.map((rule, idx) => {
          const isExpanded = expanded.has(idx)
          const summary = freezeRuleSummary(rule)
          const ruleEnabled = rule.enabled !== false
          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px", background: "var(--bg3)", borderRadius: "var(--admin-radius)", border: "1px solid var(--admin-border)", opacity: ruleEnabled ? 1 : 0.55 }}>
              <div
                role="button"
                onClick={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(idx)) next.delete(idx)
                    else next.add(idx)
                    return next
                  })
                }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                  <span style={{ color: "var(--text2)", fontSize: "12px", flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--textH)" }}>规则 {idx + 1}</span>
                  {!ruleEnabled && (
                    <span style={{ fontSize: "12px", color: "var(--text2)", border: "1px solid var(--admin-border)", borderRadius: "4px", padding: "0 5px", flexShrink: 0 }}>已停用</span>
                  )}
                  {!isExpanded && (
                    <span style={{ color: "var(--text2)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
                  )}
                </div>
                {/* 移动顺序：首条禁上移、末条禁下移；点移动只换位置不触发折叠。 */}
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "4px", flexShrink: 0, marginRight: "8px" }}>
                  <button
                    disabled={idx === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveRule(idx, -1)
                    }}
                    style={{ ...btnSubtle, padding: "3px 6px", fontSize: "12px", opacity: idx === 0 ? 0.4 : 1, cursor: idx === 0 ? "not-allowed" : "pointer" }}
                  >
                    ↑
                  </button>
                  <button
                    disabled={idx === rules.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveRule(idx, 1)
                    }}
                    style={{ ...btnSubtle, padding: "3px 6px", fontSize: "12px", opacity: idx === rules.length - 1 ? 0.4 : 1, cursor: idx === rules.length - 1 ? "not-allowed" : "pointer" }}
                  >
                    ↓
                  </button>
                </div>
                {/* 单条规则开关：关掉即失效但保留配置，不必删了重建。 */}
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", flexShrink: 0, marginRight: "8px" }}>
                  <Switch
                    checked={ruleEnabled}
                    onCheckedChange={(checked) =>
                      setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, enabled: checked === true } : item)))
                    }
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // 副本插在原规则后面，便于对照着改差异项（如只换匹配值）。
                    setRules((prev) => [...prev.slice(0, idx + 1), { ...prev[idx] }, ...prev.slice(idx + 1)])
                    // 插入位靠后的展开态整体后移一位，并展开新副本——复制就是为了接着改。
                    setExpanded((prev) => {
                      const next = new Set<number>()
                      prev.forEach((i) => {
                        if (i <= idx) next.add(i)
                        else next.add(i + 1)
                      })
                      next.add(idx + 1)
                      return next
                    })
                  }}
                  style={{ ...btnSubtle, padding: "3px 8px", fontSize: "12px", marginRight: "8px" }}
                >
                  复制
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRules((prev) => prev.filter((_, i) => i !== idx))
                    // 删除后靠后的展开态整体前移一位，避免展开标记错位到别的规则。
                    setExpanded((prev) => {
                      const next = new Set<number>()
                      prev.forEach((i) => {
                        if (i < idx) next.add(i)
                        else if (i > idx) next.add(i - 1)
                      })
                      return next
                    })
                  }}
                  style={{ ...btnDanger, padding: "3px 8px", fontSize: "12px" }}
                >
                  删除
                </button>
              </div>
              {!isExpanded && <div style={{ fontSize: "12px", color: "var(--text2)" }}>{summary}</div>}
              {isExpanded && (
                <div style={grid2Style}>
                  <div>
                    <Label>触发条件</Label>
                    <ComboSearchSelect
                      value={rule.condition}
                      onChange={(v) =>
                        setRules((prev) =>
                          prev.map((item, i) => {
                            if (i !== idx) return item
                            const condition = (v ?? "status_code") as ProviderLimitFreezeRule["condition"]
                            if (condition === "exception") return { ...item, condition, key: "", operator: "" as ProviderLimitFreezeRule["operator"], value: "" }
                            if (condition === "error_type") return { ...item, condition, key: "", operator: (item.operator || "in") as ProviderLimitFreezeRule["operator"], value: item.value || "upstream_incomplete_stream" }
                            if (condition === "status_code") return { ...item, condition, key: "", operator: (item.operator || "in") as ProviderLimitFreezeRule["operator"], value: item.value || "429" }
                            if (condition === "body") return { ...item, condition, key: item.key || "error.code", operator: (item.operator || "==") as ProviderLimitFreezeRule["operator"], value: item.value || "" }
                            return { ...item, condition, operator: (item.operator || "in") as ProviderLimitFreezeRule["operator"] }
                          }),
                        )
                      }
                      options={[
                        { value: "status_code", label: "状态码" },
                        { value: "headers", label: "响应头" },
                        { value: "exception", label: "异常" },
                        { value: "error_type", label: "错误类型" },
                        { value: "body", label: "响应体" },
                      ]}
                      contentZIndex={1101}
                    />
                  </div>
                  {rule.condition !== "exception" && (
                    <div>
                      <Label>比较运算</Label>
                      <ComboSearchSelect
                        value={rule.operator}
                        onChange={(v) =>
                          setRules((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, operator: (v ?? "in") as ProviderLimitFreezeRule["operator"] } : item)),
                          )
                        }
                        options={[
                          { value: "in", label: "包括（多值，逗号分隔）" },
                          { value: "==", label: "等于 (==)" },
                          { value: "!=", label: "不等于 (!=)" },
                          { value: "<=", label: "小于等于 (≤)" },
                          { value: ">=", label: "大于等于 (≥)" },
                          { value: "<", label: "小于 (<)" },
                          { value: ">", label: "大于 (>)" },
                          { value: "exists", label: "存在" },
                          { value: "contains", label: "包含" },
                        ]}
                        contentZIndex={1101}
                      />
                    </div>
                  )}
                  {rule.condition === "headers" && (
                    <div>
                      <Label>匹配字段</Label>
                      <Input value={rule.key} placeholder="header 名" style={inputStyle} onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)))} />
                    </div>
                  )}
                  {rule.condition === "status_code" && (
                    <div>
                      <Label>匹配值</Label>
                      <Input
                        value={rule.value}
                        placeholder={rule.operator === "in" ? "如 429,500,502（逗号分隔多个）" : "如 429"}
                        style={inputStyle}
                        onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))}
                      />
                    </div>
                  )}
                  {rule.condition === "headers" && (
                    <div>
                      <Label>匹配值</Label>
                      <Input value={rule.value} placeholder="如 429" style={inputStyle} onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))} />
                    </div>
                  )}
                  {rule.condition === "error_type" && (
                    <div>
                      <Label>错误码</Label>
                      <Input
                        value={rule.value}
                        placeholder="如 upstream_incomplete_stream"
                        list="freeze-error-code-options"
                        style={inputStyle}
                        onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))}
                      />
                      <datalist id="freeze-error-code-options">
                        <option value="upstream_incomplete_stream" />
                        <option value="upstream_incomplete_usage" />
                        <option value="upstream_empty_non_stream_response" />
                      </datalist>
                    </div>
                  )}
                  {rule.condition === "body" && (
                    <div>
                      <Label>字段路径</Label>
                      <Input value={rule.key} placeholder="如 error.code / error.message / request_id" style={inputStyle} onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)))} />
                    </div>
                  )}
                  {rule.condition === "body" && (
                    <div>
                      <Label>匹配值</Label>
                      <Input
                        value={rule.value}
                        placeholder={rule.operator === "contains" ? "如 exceeded" : rule.operator === "in" ? "如 insufficient_quota,rate_limit" : "如 insufficient_quota"}
                        style={inputStyle}
                        onChange={(e) => setRules((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))}
                      />
                    </div>
                  )}
                  <div>
                    <Label>冻结对象</Label>
                    <ComboSearchSelect
                      value={rule.freeze_object}
                      onChange={(v) =>
                        setRules((prev) =>
                          prev.map((item, i) => {
                            if (i !== idx) return item
                            const freeze_object = (v ?? "account") as ProviderLimitFreezeRule["freeze_object"]
                            const invalidDisabled = !FREEZE_OBJECTS_SUPPORT_DISABLED.includes(freeze_object) && item.freeze_period === "disabled"
                            const invalidPermanent = !FREEZE_OBJECTS_SUPPORT_PERMANENT.includes(freeze_object) && item.freeze_period === "permanent"
                            return { ...item, freeze_object, freeze_period: invalidDisabled || invalidPermanent ? "seconds" : item.freeze_period }
                          }),
                        )
                      }
                      options={FREEZE_OBJECT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      contentZIndex={1101}
                    />
                  </div>
                  <div>
                    <Label>冻结周期</Label>
                    <ComboSearchSelect
                      value={rule.freeze_period}
                      onChange={(v) =>
                        setRules((prev) =>
                          prev.map((item, i) => {
                            if (i !== idx) return item
                            const freeze_period = (v ?? "seconds") as ProviderLimitFreezeRule["freeze_period"]
                            const hasValue = FREEZE_PERIODS_WITH_VALUE.includes(freeze_period)
                            return { ...item, freeze_period, freeze_value: hasValue ? (item.freeze_value > 0 ? item.freeze_value : 1) : 0 }
                          }),
                        )
                      }
                      options={FREEZE_PERIOD_OPTIONS.filter((p) => {
                        if (p.value === "disabled") return FREEZE_OBJECTS_SUPPORT_DISABLED.includes(rule.freeze_object)
                        if (p.value === "permanent") return FREEZE_OBJECTS_SUPPORT_PERMANENT.includes(rule.freeze_object)
                        return true
                      }).map((p) => ({ value: p.value, label: p.label }))}
                      contentZIndex={1101}
                    />
                  </div>
                  {FREEZE_PERIODS_WITH_VALUE.includes(rule.freeze_period) && (
                    <div>
                      <Label>{FREEZE_PERIOD_OPTIONS.find((p) => p.value === rule.freeze_period)?.label || "数值"}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={String(rule.freeze_value)}
                        style={inputStyle}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, freeze_value: Math.max(1, Number(e.target.value) || 1) } : item)),
                          )
                        }
                      />
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "var(--text2)", lineHeight: 1.6, background: "var(--bg3)", padding: "6px 10px", borderRadius: "6px" }}>
                    冻结对象：账号=冻结单个账号；账号模型=冻结该账号的对应模型；渠道=冻结渠道下所有账号；渠道模型=冻结渠道下所有账号的该模型。冻结周期：禁用=关闭账号 switch 或渠道 enabled，不进入定时检测；永久冻结=仅账号，置 is_frozen，可在定时检测成功后解冻；分钟/小时/天/秒=填具体数值；今天/本周/本月=冻结到当天/本周日/月末结束（含跨边界缓冲）。
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={addRule}>
          <Plus className="mr-2 size-4" />添加规则
        </Button>
      </div>
    </div>
  )
}