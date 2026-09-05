import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { CircularProgress } from "@/components/ui/circular-progress"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"

export interface TokenProgressPopoverProps {
  /** 当前轮实际输入 token（prompt_tokens）。 */
  inputTokens?: number | null
  /** 当前模型最大上下文 token。 */
  maxTokens?: number | null
  /** 当前轮输出 token，可选，仅用于详情展示。 */
  outputTokens?: number | null
  /** 缓存读取 token（输入 token 明细，不额外计入 total）。 */
  cachedTokens?: number | null
  /** 缓存创建/写入 token（输入 token 明细，不额外计入 total）。 */
  cacheCreationTokens?: number | null
  /** 推理 token（输出侧明细）。 */
  reasoningTokens?: number | null
  /** 当前轮总 token，可选，仅用于详情展示。 */
  totalTokens?: number | null
  /** 任务页传入：压缩上下文；Agent/聊天不传，不展示压缩入口。 */
  onCompact?: () => void | Promise<void>
  compactPending?: boolean
  onRestart?: () => void | Promise<void>
}

/**
 * 当前模型上下文 token 进度按钮：始终是一个圈圈，橙色填充表示占用比例。
 *
 * 三处（Agent / 聊天 / 任务）共用。点击弹框显示：模型上限、当前输入、当前输出、
 * 实际占比。任务页额外展示「压缩上下文 / 重启运行时」入口（onCompact 传入才出现）。
 *
 * 模型上限未知时圈圈仍渲染（橙色满轨 + 0% 填充），弹框里标注「上限未知」，
 * 不再退化成指针图标。
 */
export function TokenProgressPopover({
  inputTokens,
  maxTokens,
  outputTokens,
  cachedTokens,
  cacheCreationTokens,
  reasoningTokens,
  totalTokens,
  onCompact,
  compactPending = false,
  onRestart,
}: TokenProgressPopoverProps) {
  const input = Math.max(0, Number(inputTokens || 0))
  const max = Math.max(0, Number(maxTokens || 0))
  const { ratio, percent, color } = useMemo(() => {
    const r = max > 0 ? Math.min(Math.max(input / max, 0), 1) : 0
    const p = max > 0 ? Math.min(100, Math.round(r * 100)) : 0
    const c = r >= 0.8 ? "text-orange-600 dark:text-orange-400" : r >= 0.6 ? "text-amber-500" : "text-orange-500"
    return { ratio: r, percent: p, color: c }
  }, [input, max])
  const summary = max > 0 ? `${formatTokens(input)} / ${formatTokens(max)}` : `${formatTokens(input)} 输入`

  return (
    <HoverCard openDelay={100} closeDelay={160}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`上下文 Token：${summary}`}
          title={`上下文 Token：${summary}`}
        >
          <CircularProgress value={input} max={max > 0 ? max : 1} size={20} strokeWidth={3} indicatorClassName={color} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 p-0">
        <div className="overflow-hidden rounded-md bg-background">
          <div className="flex items-center gap-3 border-b bg-muted/35 px-3 py-3">
            <CircularProgress value={input} max={max > 0 ? max : 1} size={26} strokeWidth={3} indicatorClassName={color} />
            <div className={cn("text-sm font-medium", color)}>
              {max > 0 ? `上下文已用 ${percent}%` : "暂无上下文上限"}
            </div>
          </div>
          <div className="grid gap-1.5 px-3 py-3 text-xs">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">当前输入</span><span className="font-medium">{formatTokens(input)} tokens</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">模型上限</span><span className="font-medium">{max > 0 ? `${formatTokens(max)} tokens` : "上限未知"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">当前输出</span><span className="font-medium">{formatTokens(outputTokens ?? 0)} tokens</span></div>
            {/* 明细行：上游明确给了非零值才显示，避免不支持缓存的模型出现一排 0。 */}
            {(cachedTokens ?? 0) > 0 && <div className="flex justify-between gap-4"><span className="text-muted-foreground">缓存读取</span><span className="font-medium">{formatTokens(cachedTokens ?? 0)} tokens</span></div>}
            {(cacheCreationTokens ?? 0) > 0 && <div className="flex justify-between gap-4"><span className="text-muted-foreground">缓存写入</span><span className="font-medium">{formatTokens(cacheCreationTokens ?? 0)} tokens</span></div>}
            {(reasoningTokens ?? 0) > 0 && <div className="flex justify-between gap-4"><span className="text-muted-foreground">推理 Token</span><span className="font-medium">{formatTokens(reasoningTokens ?? 0)} tokens</span></div>}
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">实际占比</span><span className={cn("font-medium", color)}>{max > 0 ? `${percent}%` : "无法计算"}</span></div>
            {totalTokens != null && <div className="flex justify-between gap-4 border-t pt-1.5"><span className="text-muted-foreground">当前总计</span><span className="font-medium">{formatTokens(totalTokens)} tokens</span></div>}
          </div>
          {onCompact && (
            <div className="space-y-2 border-t bg-muted/15 p-2">
              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2.5 shadow-xs">
                <div className="min-w-0"><div className="text-sm font-medium">压缩上下文</div><div className="mt-1 text-xs leading-5 text-muted-foreground">让模型总结并精简历史，下一轮生效。</div></div>
                <Button type="button" size="sm" variant={ratio >= 0.5 ? "default" : "secondary"} className="shrink-0" disabled={compactPending} onClick={() => void onCompact()}>
                  {compactPending && <Spinner className="mr-2 size-3.5" />}压缩
                </Button>
              </div>
              {onRestart && (
                <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => void onRestart()}>重启运行时并清空上下文</Button>
              )}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
