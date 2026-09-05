/**
 * 主对话里的子 Agent 卡片：标记这个子 Agent 的轮次在对话中的位置。点击把对话区
 * 切换成该子 Agent 的会话面板（SubagentConversationPanel），不再弹框。
 *
 * 样式上与工具卡同族——实线边框 + 左侧主色竖条标明「这是一条子 Agent 分支」，
 * 而不是原来的虚线弱化框：它是可点进去的入口，不是占位提示。
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
      className="group mx-auto flex w-full max-w-[860px] items-center gap-2 overflow-hidden rounded-lg border border-l-2 border-border border-l-primary bg-card px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:bg-accent"
    >
      {running ? (
        <Spinner className="size-3.5 shrink-0 text-primary" />
      ) : (
        <IconUsers className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{name}</span>
          <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">子 Agent</span>
        </span>
        {task && <span className="mt-0.5 block truncate text-muted-foreground">{task}</span>}
      </span>
      <span className="shrink-0 text-muted-foreground">{running ? "进行中" : "已完成"}</span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
