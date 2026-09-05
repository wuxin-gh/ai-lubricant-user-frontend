import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export interface TurnNavigatorEntry {
  id: string
  content: string
  createdAt?: string | number | null
}

const MAX_VISIBLE_ROUNDS = 7

function nearestUserMessage(container: HTMLElement): string | null {
  const viewport = container.getBoundingClientRect()
  const center = viewport.top + viewport.height / 2
  let nearest: { id: string; distance: number } | null = null
  for (const element of container.querySelectorAll<HTMLElement>('[data-message-role="user"]')) {
    const id = element.dataset.messageId || ""
    if (!id) continue
    const rect = element.getBoundingClientRect()
    const distance = Math.abs(rect.top + rect.height / 2 - center)
    if (!nearest || distance < nearest.distance) nearest = { id, distance }
  }
  return nearest?.id || null
}

export function TurnNavigator({
  entries,
  getScrollContainer,
  hasMore = false,
  loadingMore = false,
  onLoadOlder,
  compact = false,
}: {
  entries: TurnNavigatorEntry[]
  getScrollContainer: () => HTMLElement | null
  hasMore?: boolean
  loadingMore?: boolean
  onLoadOlder?: () => void | Promise<void>
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(entries.at(-1)?.id || null)
  const frameRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)

  const updateActive = useCallback(() => {
    const container = getScrollContainer()
    if (!container) return
    const next = nearestUserMessage(container)
    if (next) setActiveId(next)
  }, [getScrollContainer])

  useEffect(() => {
    const container = getScrollContainer()
    if (!container) return
    const schedule = () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(updateActive)
    }
    container.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    schedule()
    return () => {
      container.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [entries, getScrollContainer, updateActive])

  useEffect(() => {
    if (entries.length && !entries.some((entry) => entry.id === activeId)) setActiveId(entries.at(-1)?.id || null)
  }, [activeId, entries])

  // 首次展开时让列表滚到最新轮次（底部）。后续不再强制滚动，避免打断用户翻看。
  useEffect(() => {
    if (!expanded) return
    const list = listRef.current
    const active = activeItemRef.current
    if (list && active) active.scrollIntoView({ block: "center" })
    else if (list) list.scrollTop = list.scrollHeight
  }, [expanded])

  const visibleEntries = useMemo(() => {
    if (entries.length <= MAX_VISIBLE_ROUNDS) return entries
    const activeIndex = Math.max(0, entries.findIndex((entry) => entry.id === activeId))
    const start = Math.max(0, Math.min(activeIndex - 3, entries.length - MAX_VISIBLE_ROUNDS))
    return entries.slice(start, start + MAX_VISIBLE_ROUNDS)
  }, [activeId, entries])

  const jump = useCallback((id: string) => {
    const container = getScrollContainer()
    const target = container?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
    if (!container || !target) return
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 8
    container.scrollTo({ top, behavior: "smooth" })
    target.classList.add("jump-highlight")
    target.addEventListener("animationend", () => target.classList.remove("jump-highlight"), { once: true })
    setActiveId(id)
  }, [getScrollContainer])

  function handleListScroll(event: UIEvent<HTMLDivElement>) {
    if (event.currentTarget.scrollTop <= 16 && hasMore && !loadingMore) void onLoadOlder?.()
  }

  if (entries.length < 2 && !loadingMore) return null

  return (
    <div
      className={cn("absolute right-2 top-1/2 z-30 -translate-y-1/2", compact && "right-1")}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <button
        type="button"
        aria-label="对话轮次导航"
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "relative flex flex-col items-center rounded-full border bg-popover/90 px-2.5 py-3 shadow-md backdrop-blur-sm transition-opacity",
          expanded ? "pointer-events-none absolute right-0 opacity-0" : "opacity-65 hover:opacity-100",
        )}
      >
        <span className="absolute bottom-4 top-4 w-px bg-border" />
        {visibleEntries.map((entry, index) => (
          <span key={entry.id} className="relative z-10 flex h-5 items-center" title={`第 ${entries.indexOf(entry) + 1} 轮`}>
            <span className={cn("size-2 rounded-full border-2 border-popover transition-all", entry.id === activeId ? "size-3 bg-primary ring-2 ring-primary/20" : "bg-muted-foreground/55")} />
            {index < visibleEntries.length - 1 ? null : null}
          </span>
        ))}
      </button>

      <div
        ref={listRef}
        onScroll={handleListScroll}
        className={cn(
          "overflow-x-hidden overflow-y-auto rounded-xl border bg-popover/95 shadow-xl backdrop-blur-sm transition-all origin-right",
          expanded ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 scale-95 opacity-0",
        )}
        style={{ width: compact ? 240 : 300, maxHeight: "min(392px, 65vh)" }}
      >
        {(hasMore || loadingMore) && (
          <div className="sticky top-0 z-10 flex h-8 items-center justify-center border-b bg-popover/95 text-[11px] text-muted-foreground">
            {loadingMore ? <><Spinner className="mr-1.5 size-3" />加载更早轮次…</> : "向上滚动加载更早轮次"}
          </div>
        )}
        <div className="py-1.5">
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              ref={(node) => { if (entry.id === activeId) activeItemRef.current = node }}
              onClick={() => jump(entry.id)}
              title={entry.content || "（空输入）"}
              className={cn(
                "flex w-full min-w-0 gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                entry.id === activeId && "bg-accent text-foreground",
              )}
            >
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", entry.id === activeId ? "bg-primary" : "bg-muted-foreground/45")} />
              <span className="line-clamp-2 min-w-0 flex-1 break-all leading-5">{entry.content || "（空输入）"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
