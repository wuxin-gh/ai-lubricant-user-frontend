/**
 * 主对话里的子 Agent 卡片：标记这个子 Agent 的轮次在对话中的位置。点击把对话区
 * 切换成该子 Agent 的会话面板（SubagentConversationPanel），不再弹框。
 *
 * 样式刻意与工具卡区分（用户明确要求：不能看着跟其他工具执行一样）——主色
 * 描边 + 主色浅底 + 主色「子 Agent」徽标；普通工具卡保持中性的 border/bg-card，
 * 两族卡在对话流里一眼可分。
 */
import { IconChevronRight, IconUsers } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"

export function SubagentInlineEntry({
  subAgent,
  onOpen,
}: {
  subAgent: EditorSessionSubAgent | null
  onOpen: () => void
}) {
  const name = subAgent?.name ?? "子 Agent"
  const task = subAgent?.task
  const running = subAgent?.status === "running"
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full max-w-[80%] items-center gap-2 overflow-hidden rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:bg-primary/10"
    >
      {running ? (
        <Spinner className="size-3.5 shrink-0 text-primary" />
      ) : (
        <IconUsers className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{name}</span>
          <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[10px] text-primary">子 Agent</span>
        </span>
        {task && <span className="mt-0.5 block truncate text-muted-foreground">{task}</span>}
      </span>
      <span className="shrink-0 text-muted-foreground">{running ? "进行中" : "已完成"}</span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
