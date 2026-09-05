/**
 * 榜单条目共用的标签输入框：chip 在框内，回车添加，Backspace 删最后一个。
 *
 * 形态对齐渠道页的 ``ProviderTagInput``（Channels.tsx）——那边是管理端标签输入的既有惯例，
 * 区别只是这里用 Tailwind/shadcn 而非内联 style，视觉与 Input 组件一致。
 *
 * value 做防御收敛（``toStringArray``）：JSONB 字段在未重启的旧后端实例上会以 JSON
 * 字符串返回（'["a","b"]'），直接 .map 会炸；这里统一收成 string[]。
 */
import { useState } from "react"

export function LeaderboardTagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[] | unknown
  onChange: (next: string[]) => void
  /** 空态提示语；非空态自动变成「继续输入，按 Enter 添加」。 */
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")
  const items = toStringArray(value)
  const addDraft = () => {
    const tag = draft.trim()
    if (tag && !items.includes(tag)) onChange([...items, tag])
    setDraft("")
  }

  return (
    <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      {items.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {tag}
          <button
            type="button"
            aria-label={`移除标签 ${tag}`}
            onClick={() => onChange(items.filter((item) => item !== tag))}
            className="leading-none text-primary/60 hover:text-destructive"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            addDraft()
          } else if (e.key === "Backspace" && !draft && items.length > 0) {
            onChange(items.slice(0, -1))
          }
        }}
        placeholder={items.length > 0 ? "继续输入，按 Enter 添加" : (placeholder || "输入后按 Enter 添加")}
        className="min-w-20 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** 把任意输入收口成 string[]：数组取字符串项；JSON 字符串解析；其它回空数组。 */
export function toStringArray(raw: unknown): string[] {
  let list: unknown = raw
  if (typeof list === "string") {
    try { list = JSON.parse(list) } catch { list = list ? [list] : [] }
  }
  if (Array.isArray(list)) {
    return list.map((item) => String(item)).filter((item) => item.trim() !== "")
  }
  return []
}
