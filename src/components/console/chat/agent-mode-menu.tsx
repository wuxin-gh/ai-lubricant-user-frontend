import { IconRoute, IconChevronDown } from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentExecutionMode } from "@/api/agentClient"

/** 执行模式选项：标签中英并显；hint 只做原生 tooltip，不占版面以保持与思考等级同款。 */
export const AGENT_MODE_OPTIONS: Array<{ value: AgentExecutionMode; label: string; hint: string }> = [
  { value: "interact", label: "普通 Interact", hint: "一问一答的普通交互" },
  // 免审规则（哪些操作可自动放行）还在调研中，当前执行语义与「普通」一致。
  { value: "auto", label: "自动 Auto", hint: "一问一答；免审批范围待定，当前与普通模式一致" },
  { value: "plan", label: "规划 Plan", hint: "复杂任务先规划再分步执行" },
  { value: "goal", label: "目标 Goal", hint: "开放目标 + 时间预算，自驱跑到预算耗尽" },
]

export function agentModeLabel(value: unknown): string {
  return AGENT_MODE_OPTIONS.find((option) => option.value === value)?.label || AGENT_MODE_OPTIONS[0].label
}

export function AgentModeMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentExecutionMode
  onChange: (value: AgentExecutionMode) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-7 max-w-[130px] shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          title="执行模式，下一轮消息生效"
        >
          <IconRoute className="size-3.5 shrink-0" />
          <span className="truncate">{agentModeLabel(value)}</span>
          <IconChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[160px]">
        <DropdownMenuRadioGroup value={value}>
          {AGENT_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} title={option.hint} onSelect={() => onChange(option.value)}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
