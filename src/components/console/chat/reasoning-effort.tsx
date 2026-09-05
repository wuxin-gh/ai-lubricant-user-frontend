import { IconBrain, IconChevronDown } from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ReasoningEffort = "" | "low" | "medium" | "high" | "xhigh"

/** 未显式设置时的默认思考等级。 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium"

/** 恢复已存会话：显式存过（含空串=关闭）就用存的，从未存过则回退默认。 */
export function resolveReasoningEffort(value: unknown): ReasoningEffort {
  if (value === undefined || value === null) return DEFAULT_REASONING_EFFORT
  return normalizeReasoningEffort(value)
}

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: "", label: "关闭思考" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
]

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "max") return "xhigh"
  return REASONING_EFFORT_OPTIONS.some((option) => option.value === normalized)
    ? normalized as ReasoningEffort
    : ""
}

export function reasoningEffortLabel(value: unknown): string {
  const normalized = normalizeReasoningEffort(value)
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === normalized)?.label || "关闭思考"
}

export function ReasoningEffortMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: ReasoningEffort | string
  onChange: (value: ReasoningEffort) => void
  disabled?: boolean
}) {
  const normalized = normalizeReasoningEffort(value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-7 max-w-[130px] shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          title="思考等级，下一轮消息生效"
        >
          <IconBrain className="size-3.5 shrink-0" />
          <span className="truncate">{reasoningEffortLabel(normalized)}</span>
          <IconChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[160px]">
        <DropdownMenuRadioGroup value={normalized}>
          {REASONING_EFFORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value || "off"} value={option.value} onSelect={() => onChange(option.value)}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
