/**
 * 非模态悬浮浮窗：可拖拽 + 可缩放，无遮罩，不抢焦点，页面照常可操作。
 *
 * 与 Dialog 的区别：不锁外层交互、不暗化背景、点外部不关闭；适合「边操作页面
 * 边与 Agent 对话」的场景。层级约定：浮窗默认 z-40，嵌进模态弹框时由调用方抬到
 * z-[60]（盖过 Dialog 的 z-50）；菜单/气泡等 portaled 浮层统一 z-[70]，保证从
 * 浮窗里点开的下拉、弹框仍浮在浮窗之上。位置/尺寸用 localStorage 记录（传
 * storageKey），刷新后还原。Esc 收起。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface FloatingPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  /** 记位置/尺寸到 localStorage 的键；不传则不持久化。 */
  storageKey?: string
  children: React.ReactNode
  className?: string
}

interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}

const DEFAULT_RECT: PanelRect = {
  x: Math.max(8, window.innerWidth - 460),
  y: Math.max(8, window.innerHeight - 640),
  w: 440,
  h: 600,
}

function clampRect(rect: PanelRect): PanelRect {
  const w = Math.max(280, Math.min(rect.w, window.innerWidth - 16))
  const h = Math.max(240, Math.min(rect.h, window.innerHeight - 16))
  const x = Math.max(8, Math.min(rect.x, window.innerWidth - w - 8))
  const y = Math.max(8, Math.min(rect.y, window.innerHeight - h - 8))
  return { x, y, w, h }
}

export function FloatingPanel({ open, onOpenChange, title, storageKey, children, className }: FloatingPanelProps) {
  const [rect, setRect] = useState<PanelRect>(() => {
    if (!storageKey) return DEFAULT_RECT
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return clampRect(JSON.parse(saved) as PanelRect)
    } catch {
      // 忽略损坏的存储，回落默认。
    }
    return DEFAULT_RECT
  })
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)

  const persist = useCallback((next: PanelRect) => {
    setRect(next)
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* 忽略配额/隐私模式 */ }
    }
  }, [storageKey])

  // 窗口缩放时把面板拉回视口内，避免飞到屏幕外。
  useLayoutEffect(() => {
    if (!open) return
    const onResize = () => persist(clampRect(rect))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open, rect, persist])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const onHeaderPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    // 关闭按钮等交互元素不触发拖拽。
    if (target.closest("button") || target.closest("[data-no-drag]")) return
    setDragging(true)
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.x,
      originY: rect.y,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onHeaderPointerMove = (event: React.PointerEvent) => {
    if (!dragging || !dragState.current) return
    const dx = event.clientX - dragState.current.startX
    const dy = event.clientY - dragState.current.startY
    persist(clampRect({
      ...rect,
      x: dragState.current.originX + dx,
      y: dragState.current.originY + dy,
    }))
  }

  const endDrag = (event: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    dragState.current = null
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
  }

  const onResizeHandlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    setResizing(true)
    resizeState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originW: rect.w,
      originH: rect.h,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onResizeHandlePointerMove = (event: React.PointerEvent) => {
    if (!resizing || !resizeState.current) return
    const dx = event.clientX - resizeState.current.startX
    const dy = event.clientY - resizeState.current.startY
    persist(clampRect({
      ...rect,
      w: resizeState.current.originW + dx,
      h: resizeState.current.originH + dy,
    }))
  }

  const endResize = (event: React.PointerEvent) => {
    if (!resizing) return
    setResizing(false)
    resizeState.current = null
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
  }

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      className={cn(
        // 模态 Dialog 打开时 Radix 会把 body 设为 pointer-events:none（DismissableLayer），
        // 本浮窗 portal 在 body 上、处于弹框 DOM 之外，不显式恢复 auto 就整块点不动。
        "pointer-events-auto fixed z-40 flex flex-col overflow-hidden rounded-xl border bg-background shadow-xl",
        (dragging || resizing) && "select-none",
        className,
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 border-b bg-muted/40 px-3 py-2",
          dragging && "cursor-grabbing",
        )}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="关闭"
          onClick={() => onOpenChange(false)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {children}
        {/* 缩放手柄收窄到 12px：16px 时会压住输入区右下角的发送/停止按钮，
            点按钮角落会误触成缩放。 */}
        <div
          aria-hidden
          className="absolute bottom-0 right-0 size-3 cursor-nwse-resize"
          onPointerDown={onResizeHandlePointerDown}
          onPointerMove={onResizeHandlePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <div className="absolute bottom-0.5 right-0.5 size-2 border-b-2 border-r-2 border-muted-foreground/50" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
