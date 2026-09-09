/**
 * 左侧悬浮子 Agent 栏。与底部输入框同款观感（rounded-2xl + 半透明背景 +
 * backdrop-blur + shadow-lg），悬浮在对话区左侧、不占布局宽度：对话内容的
 * 宽度和内边距在有没有子 Agent 时完全一致，长文字从它背后穿过而不是被挤开。
 *
 * 可折叠：头部的隐藏按钮把整栏收起，只留一枚小圆钮悬浮在原位；再点展开。
 * 折叠状态存组件内 state——面板与主对话视图切换时这块常驻挂载，状态自然
 * 保留；刷新页面回到默认展开。没有子 Agent 时整块不渲染。
 */
import { useState } from "react"
import { IconChevronLeft, IconUsers } from "@tabler/icons-react"
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
  const [collapsed, setCollapsed] = useState(false)
  if (subAgents.length === 0) return null

  if (collapsed) {
    // 收起态：只留一枚与主对话同款观感的小圆钮，悬停提示有几个子 Agent。
    const runningCount = subAgents.filter((agent) => agent.status === "running").length
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={`展开子 Agent（${subAgents.length}）`}
        className="absolute left-2 top-1/2 z-30 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent hover:text-foreground supports-[backdrop-filter]:bg-background/70"
      >
        <IconUsers className="size-4" />
        {runningCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-primary" />
        ) : null}
      </button>
    )
  }

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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-1 border-b bg-background/80 px-3 py-2 text-[11px] font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <span>子 Agent</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="收起，只留展开按钮"
          className="flex size-5 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconChevronLeft className="size-3.5" />
        </button>
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
