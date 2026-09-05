/**
 * 左侧悬浮子 Agent 栏。与底部输入框同款观感（rounded-2xl + 半透明背景 +
 * backdrop-blur + shadow-lg），悬浮在对话区左侧、不占布局宽度：对话内容的
 * 宽度和内边距在有没有子 Agent 时完全一致，长文字从它背后穿过而不是被挤开。
 *
 * 与右侧对话轮次导航（TurnNavigator）对称，差别只有一点：这个默认展开，
 * 不需要 hover。没有子 Agent 时整块不渲染。
 */
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"

export function SubagentSideRail({
  subAgents,
  activeSubAgentId,
  onSelect,
}: {
  subAgents: EditorSessionSubAgent[]
  activeSubAgentId?: string | null
  onSelect: (id: string | null) => void
}) {
  if (subAgents.length === 0) return null
  // 运行中的排前面，组内保持出现顺序。
  const ordered = [...subAgents].sort((a, b) => {
    const aRun = a.status === "running" ? 0 : 1
    const bRun = b.status === "running" ? 0 : 1
    return aRun - bRun
  })
  return (
    <div
      className="absolute left-2 top-1/2 z-30 -translate-y-1/2 overflow-x-hidden overflow-y-auto rounded-2xl border bg-background/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/70"
      style={{ width: 200, maxHeight: "min(392px, 65vh)" }}
    >
      <div className="sticky top-0 z-10 border-b bg-background/80 px-3 py-2 text-[11px] font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70">
        子 Agent
      </div>
      <div className="py-1">
        {ordered.map((agent) => {
          const running = agent.status === "running"
          const active = agent.id === activeSubAgentId
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(active ? null : agent.id)}
              title={agent.task || agent.name}
              className={cn(
                "flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                active && "bg-accent text-foreground",
              )}
            >
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", active || running ? "bg-primary" : "bg-muted-foreground/45")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  {running ? <Spinner className="size-3 shrink-0" /> : null}
                  <span className="truncate">{agent.name}</span>
                </span>
                {agent.task ? (
                  <span className="line-clamp-2 break-all leading-5 text-muted-foreground">{agent.task}</span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
