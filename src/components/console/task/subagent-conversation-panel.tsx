/**
 * 子 Agent 会话面板。点击侧栏条目或主对话里的子 Agent 卡片后，对话区整体切换
 * 成这个子 Agent 的会话视图——不再用弹框。顶部带「返回」按钮、子 Agent 标题
 * 与任务，正文是该子 Agent 累积的输出与工具卡（形状与旧弹框正文一致）。
 *
 * 布局与主对话区完全一致：内容容器居中（mx-auto、max-w-[1400px]），
 * 同宽的内边距（px-3 / sm:px-5、pb-24）。从这里看出去，和主对话的观感一致，
 * 不会变成左边起浮、右窄的窄版对话。
 */
import { IconArrowLeft } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import { MessageItem } from "@/components/console/task/message"
import { itemToRootMessage } from "@/components/console/task/item-to-message"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"

export function SubagentConversationPanel({
  subAgent,
  onBack,
}: {
  subAgent: EditorSessionSubAgent
  onBack: () => void
}) {
  const running = subAgent.status === "running"
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="mx-auto flex w-full max-w-[1400px] shrink-0 items-center gap-2 px-3 pb-2 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="返回主对话"
        >
          <IconArrowLeft className="size-3.5" /> 返回
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          {running ? <Spinner className="size-3.5 shrink-0" /> : null}
          <span className="truncate text-sm font-medium">{subAgent.name}</span>
          {subAgent.task ? (
            <span className="truncate text-xs text-muted-foreground">· {subAgent.task}</span>
          ) : null}
        </div>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {running ? "进行中" : "已完成"}
        </span>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-1 overflow-auto px-3 pb-6 sm:px-5">
        {subAgent.content && (
          <div className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">
            {subAgent.content}
          </div>
        )}
        {subAgent.toolCalls.map((toolCall, index) => {
          const key = `${subAgent.id}-tool-${index}`
          // 复用共享映射器，让 Edit/Bash 等专用渲染器命中：kind + status + 它们读的
          // _meta.claudeCode.toolResponse。
          const mapped = itemToRootMessage(
            {
              id: key,
              type: "tool_call",
              title: toolCall.name,
              input: toolCall.args as Record<string, unknown>,
              output: toolCall.result,
              status: toolCall.status === "done" ? "done" : "running",
            },
            index,
          )
          if (!mapped) return null
          return <MessageItem key={key} message={mapped} isLatest={false} />
        })}
        {subAgent.summary && (
          <div className="mt-2 text-xs text-muted-foreground">小结：{subAgent.summary}</div>
        )}
        {!subAgent.content && subAgent.toolCalls.length === 0 && !subAgent.summary && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            该子 Agent 还没有输出
          </div>
        )}
      </div>
    </div>
  )
}

