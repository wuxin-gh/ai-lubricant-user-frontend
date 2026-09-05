/**
 * model_id 改写条目编辑器（渠道模型列表 Tab 的弹窗入口）。
 *
 * 条目把上游模型 ID 转成对外 model_id：先切掉 "owner/" 前缀，再自上而下逐条
 * 跑正则替换。顺序敏感且不是命中即停，多条会叠加，所以行序可调。
 * 条目分两种——内联规则，与对全局模版的活引用（就地展开，位置即优先级）。
 * 内部样式自包含（CSS 变量来自平台页面根），与 FreezePolicyEditor 同款。
 */
import { useCallback, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type {
  ModelIdRewriteRule,
  ModelIdRewriteTemplateRef,
  ModelIdRewriteEntry,
  ModelRuleTemplate,
} from "@/@admin-port/types/admin"
import { isModelIdRewriteTemplateRef } from "@/@admin-port/types/admin"

export type { ModelIdRewriteRule, ModelIdRewriteEntry, ModelRuleTemplate }
export { isModelIdRewriteTemplateRef }

/** 与后端 channel.py 的 strip_model_owner_prefix 同源实现。 */
export function stripModelOwnerPrefix(modelId: string): string {
  if (!modelId || !modelId.includes("/")) return modelId
  const tail = modelId.slice(modelId.indexOf("/") + 1).trim()
  return tail || modelId
}

/**
 * 读取侧宽松归一：丢弃非对象、pattern 为空的规则行、template_id 为空的引用行。
 * 不校验正则、不校验模版是否存在——与后端 normalize_model_id_rewrite_rules 同口径。
 */
export function normalizeModelIdRewriteRules(raw: unknown): ModelIdRewriteEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: ModelIdRewriteEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (row.kind === "template") {
      const templateId = typeof row.template_id === "string" ? row.template_id.trim() : ""
      if (!templateId) continue
      entries.push({ kind: "template", template_id: templateId, enabled: row.enabled !== false })
      continue
    }
    const pattern = typeof row.pattern === "string" ? row.pattern : ""
    if (!pattern.trim()) continue
    entries.push({
      name: typeof row.name === "string" ? row.name.trim() : "",
      enabled: row.enabled !== false,
      pattern,
      replacement: typeof row.replacement === "string" ? row.replacement : "",
    })
  }
  return entries
}

/**
 * 把混合条目展开成扁平规则列表，与后端 expand_model_id_rewrite_rules 同源。
 * 停用的模版整条跳过；模版不存在时跳过（活引用，可能尚未建）。
 */
export function expandModelIdRewriteRules(
  entries: ModelIdRewriteEntry[],
  templates: ModelRuleTemplate[] = [],
): ModelIdRewriteRule[] {
  const byId = new Map(templates.map((t) => [t.id, t]))
  const expanded: ModelIdRewriteRule[] = []
  for (const entry of entries) {
    if (!isModelIdRewriteTemplateRef(entry)) {
      expanded.push(entry)
      continue
    }
    if (!entry.enabled) continue
    const template = byId.get(entry.template_id)
    if (!template) continue
    expanded.push(...normalizeModelIdRewriteRules(template.rules).filter(
      (row): row is ModelIdRewriteRule => !isModelIdRewriteTemplateRef(row),
    ))
  }
  return expanded
}

/**
 * 预览用：与后端 apply_model_id_rewrite_rules 同源。
 * JS 正则语法与 Python 不完全一致，预览只作调试参考，最终以服务端结果为准。
 */
export function applyModelIdRewriteRules(
  modelId: string,
  entries: ModelIdRewriteEntry[],
  templates: ModelRuleTemplate[] = [],
): { result: string; errors: string[] } {
  const errors: string[] = []
  let result = stripModelOwnerPrefix(modelId)
  if (!result) return { result, errors }
  for (const [idx, rule] of expandModelIdRewriteRules(entries, templates).entries()) {
    if (!rule.enabled || !rule.pattern.trim()) continue
    try {
      // 后端 re.sub 默认替换全部命中，这里用 g 对齐。
      const rewritten = result.replace(new RegExp(rule.pattern, "g"), rule.replacement)
      if (rewritten.trim()) result = rewritten.trim()
    } catch (err) {
      errors.push(`${rule.name || `第 ${idx + 1} 条`}: ${err instanceof Error ? err.message : "正则不合法"}`)
    }
  }
  return { result: result || stripModelOwnerPrefix(modelId), errors }
}

const inputStyle: React.CSSProperties = {
  height: "32px",
  border: "1px solid var(--admin-border)",
  borderRadius: "var(--admin-radius)",
  padding: "0 10px",
  fontSize: "13px",
  background: "var(--bg1)",
  color: "var(--text)",
  lineHeight: "20px",
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
  background: "transparent",
  color: "#ef4444",
  cursor: "pointer",
}

const btnMove: React.CSSProperties = {
  ...btnDanger,
  border: "1px solid var(--admin-border)",
  color: "var(--text2)",
  padding: "0 8px",
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  flex: 1,
  minWidth: 0,
  appearance: "auto",
}

export interface ModelIdRewriteEditorProps {
  value: ModelIdRewriteEntry[]
  onChange: (next: ModelIdRewriteEntry[]) => void
  /** 全局模型规则模版库；空数组时「引用模版」按钮禁用。 */
  templates?: ModelRuleTemplate[]
  /** 编辑全局模版本身时设 false，模版内不允许再引用模版。 */
  allowTemplateRefs?: boolean
  className?: string
}

export function ModelIdRewriteEditor({
  value,
  onChange,
  templates = [],
  allowTemplateRefs = true,
  className = "",
}: ModelIdRewriteEditorProps) {
  const rules = value
  const [probe, setProbe] = useState("")

  const setRules = useCallback(
    (fn: (prev: ModelIdRewriteEntry[]) => ModelIdRewriteEntry[]) => onChange(fn(rules)),
    [rules, onChange],
  )

  const patchRule = useCallback(
    (idx: number, patch: Partial<ModelIdRewriteRule> | Partial<ModelIdRewriteTemplateRef>) =>
      setRules((prev) => prev.map((row, i) => (i === idx ? ({ ...row, ...patch } as ModelIdRewriteEntry) : row))),
    [setRules],
  )

  const moveRule = useCallback(
    (idx: number, delta: number) =>
      setRules((prev) => {
        const target = idx + delta
        if (target < 0 || target >= prev.length) return prev
        const next = [...prev]
        ;[next[idx], next[target]] = [next[target], next[idx]]
        return next
      }),
    [setRules],
  )

  const addRule = useCallback(
    () => setRules((prev) => [...prev, { name: "", enabled: true, pattern: "", replacement: "" }]),
    [setRules],
  )

  const addTemplateRef = useCallback(
    () =>
      setRules((prev) => [
        ...prev,
        { kind: "template", template_id: templates[0]?.id ?? "", enabled: true },
      ]),
    [setRules, templates],
  )

  const preview = useMemo(
    () => (probe.trim() ? applyModelIdRewriteRules(probe.trim(), rules, templates) : null),
    [probe, rules, templates],
  )

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "12px", color: "var(--text2)", lineHeight: 1.6 }}>
        规则只作用于<b>新获取到的模型</b>：已在列表里的模型沿用现有 model_id，加规则不会追溯改名。
        改写只影响对外 model_id，发给上游的原始模型名不变。
        顺序自上而下逐条应用（不是命中即停），可用 <code>\1</code> 引用捕获组。
        引用全局模版的条目会在其所在位置就地展开——模版与内联规则同列排序，改模版即时对所有引用它的渠道生效。
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "var(--admin-radius)", border: "1px solid var(--admin-border)", background: "var(--bg3)" }}>
        {rules.length === 0 && (
          <div style={{ fontSize: "13px", color: "var(--text2)", textAlign: "center", padding: "8px" }}>
            暂无改写条目，仅按默认行为切掉 “owner/” 前缀
          </div>
        )}

        {rules.map((rule, idx) => {
          const templateRef = isModelIdRewriteTemplateRef(rule)
          let patternError = ""
          if (!templateRef && rule.pattern.trim()) {
            try {
              new RegExp(rule.pattern)
            } catch (err) {
              patternError = err instanceof Error ? err.message : "正则不合法"
            }
          }
          const templateName = templateRef
            ? templates.find((template) => template.id === rule.template_id)?.name
            : undefined
          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px", background: "var(--bg1)", borderRadius: "var(--admin-radius)", border: `1px solid ${patternError ? "rgba(239,68,68,0.45)" : "var(--admin-border)"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "var(--text2)", flexShrink: 0 }}>优先级 {idx + 1}</span>
                {templateRef ? (
                  <select
                    value={rule.template_id}
                    onChange={(event) => patchRule(idx, { template_id: event.target.value })}
                    style={selectStyle}
                    title={templateName ? `当前模版：${templateName}` : "模版不存在或尚未加载"}
                  >
                    {!templates.length && <option value="">暂无可引用模版</option>}
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name} ({template.id})</option>)}
                    {!!rule.template_id && !templates.some((template) => template.id === rule.template_id) && (
                      <option value={rule.template_id}>未找到：{rule.template_id}</option>
                    )}
                  </select>
                ) : (
                  <Input
                    value={rule.name}
                    onChange={(e) => patchRule(idx, { name: e.target.value })}
                    placeholder="规则名（可选，便于定位）"
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                )}
                <Switch checked={rule.enabled} onCheckedChange={(checked) => patchRule(idx, { enabled: checked === true })} />
                <button onClick={() => moveRule(idx, -1)} disabled={idx === 0} style={{ ...btnMove, opacity: idx === 0 ? 0.4 : 1 }}>上移</button>
                <button onClick={() => moveRule(idx, 1)} disabled={idx === rules.length - 1} style={{ ...btnMove, opacity: idx === rules.length - 1 ? 0.4 : 1 }}>下移</button>
                <button onClick={() => setRules((prev) => prev.filter((_, i) => i !== idx))} style={btnDanger}>删除</button>
              </div>
              {templateRef ? (
                <div style={{ fontSize: "12px", color: templateName ? "var(--text2)" : "#ef4444" }}>
                  {templateName ? `引用全局模版「${templateName}」；模版内容会在此位置展开。` : `模版「${rule.template_id}」不存在或尚未加载，运行时将跳过。`}
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--text2)" }}>
                      匹配正则
                      <Input
                        value={rule.pattern}
                        onChange={(e) => patchRule(idx, { pattern: e.target.value })}
                        placeholder="例：^gemini- 或 -latest$"
                        style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--text2)" }}>
                      替换为
                      <Input
                        value={rule.replacement}
                        onChange={(e) => patchRule(idx, { replacement: e.target.value })}
                        placeholder="留空表示删除匹配部分"
                        style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)" }}
                      />
                    </label>
                  </div>
                  {patternError && (
                    <div style={{ fontSize: "12px", color: "#ef4444" }}>正则不合法：{patternError}（保存会被拒绝）</div>
                  )}
                </>
              )}
            </div>
          )
        })}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button variant="outline" size="sm" onClick={addRule}>
            <Plus style={{ width: "14px", height: "14px", marginRight: "4px" }} />
            新增规则
          </Button>
          {allowTemplateRefs && (
            <Button variant="outline" size="sm" onClick={addTemplateRef} disabled={!templates.length}>
              引用全局模版
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "12px", borderRadius: "var(--admin-radius)", border: "1px solid var(--admin-border)", background: "var(--bg3)" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>规则预览</span>
        <Input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="填一个上游模型 ID，实时查看改写结果"
          style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)" }}
        />
        {preview && (
          <div style={{ fontSize: "13px", color: "var(--text2)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            <code style={{ color: "var(--text2)" }}>{probe.trim()}</code>
            <span>→</span>
            <code style={{ color: "var(--textH)", fontWeight: 600 }}>{preview.result}</code>
          </div>
        )}
        {preview?.errors.map((err, i) => (
          <div key={i} style={{ fontSize: "12px", color: "#ef4444" }}>{err}</div>
        ))}
        <div style={{ fontSize: "11px", color: "var(--text2)" }}>
          预览用浏览器正则引擎，与服务端 Python 正则在少数语法上有差异，最终结果以服务端为准。
        </div>
      </div>
    </div>
  )
}
