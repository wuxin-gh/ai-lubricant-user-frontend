import { useCallback, useEffect, useRef, useState, type UIEvent } from "react"
import { History, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import type { ConversationPage } from "@/api/agentClient"
import type { ConversationHistoryItem } from "@/components/console/conversation-history-sidebar"
import { ConversationHistoryRows } from "@/components/console/conversation-history-sidebar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const DEFAULT_PAGE_SIZE = 20
const PREFETCH_PX = 64

type DeleteFailure = { id: string; error?: string }

export interface ConversationHistoryPopoverProps<T extends ConversationHistoryItem> {
  activeConversationId: string | null
  onSelect: (id: string) => void
  onDeleted?: (ids: string[]) => void
  fetchPage: (params: { limit: number; cursor: string | null; search?: string }) => Promise<ConversationPage<T>>
  deleteMany: (ids: string[]) => Promise<{ deleted: number; failed?: DeleteFailure[] }>
  variant?: "icon" | "button"
  align?: "start" | "end"
  side?: "top" | "bottom"
  disabled?: boolean
  searchable?: boolean
  pageSize?: number
  title?: string
  emptyText?: string
}

function formatHistoryTime(value?: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
}

export function ConversationHistoryPopover<T extends ConversationHistoryItem>({
  activeConversationId,
  onSelect,
  onDeleted,
  fetchPage,
  deleteMany,
  variant = "icon",
  align = "end",
  side = "top",
  disabled = false,
  searchable = false,
  pageSize = DEFAULT_PAGE_SIZE,
  title = "历史会话",
  emptyText = "暂无历史会话",
}: ConversationHistoryPopoverProps<T>) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<string[]>([])
  const cursorRef = useRef<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!searchable) return
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search, searchable])

  const fetchPageData = useCallback(async (mode: "reset" | "append") => {
    if (busyRef.current) return
    if (mode === "append" && !cursorRef.current) return
    busyRef.current = true
    if (mode === "reset") setLoading(true)
    else setLoadingMore(true)
    try {
      const result = await fetchPage({
        limit: pageSize,
        cursor: mode === "append" ? cursorRef.current : null,
        search: searchable ? debouncedSearch || undefined : undefined,
      })
      cursorRef.current = result.page.next_cursor
      setHasMore(Boolean(result.page.next_cursor))
      setRows((current) => {
        if (mode === "reset") return result.items
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.items.filter((item) => !seen.has(item.id))]
      })
      if (mode === "reset") setSelectedIds(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载历史会话失败")
    } finally {
      busyRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [debouncedSearch, fetchPage, pageSize, searchable])

  useEffect(() => {
    if (!open) return
    cursorRef.current = null
    void fetchPageData("reset")
  }, [debouncedSearch, fetchPageData, open])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= PREFETCH_PX) {
      void fetchPageData("append")
    }
  }, [fetchPageData])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      if (rows.length > 0 && rows.every((row) => current.has(row.id))) return new Set()
      return new Set(rows.map((row) => row.id))
    })
  }, [rows])

  const remove = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const result = await deleteMany(ids)
      const failedIds = new Set((result.failed || []).map((item) => item.id))
      const deletedIds = ids.filter((id) => !failedIds.has(id))
      setRows((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setSelectedIds((current) => {
        const next = new Set(current)
        deletedIds.forEach((id) => next.delete(id))
        return next
      })
      if (deletedIds.length > 0) onDeleted?.(deletedIds)
      if (failedIds.size > 0) toast.error(`${failedIds.size} 个会话删除失败`)
      else toast.success(`已删除 ${deletedIds.length} 个会话`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除会话失败")
    }
  }, [deleteMany, onDeleted])

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            cursorRef.current = null
            void fetchPageData("reset")
          }
        }}
      >
        <PopoverTrigger asChild>
          {variant === "icon" ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" title={title} disabled={disabled}>
              <History className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="shrink-0 gap-1" title={title} disabled={disabled}>
              <History className="size-4" /> {title}
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align={align} side={side} className="w-80 p-0">
          <div className="border-b px-3 py-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium">{title}</span>
              {loading && rows.length > 0 && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </div>
            {searchable && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题…" className="h-8 pl-8" />
              </div>
            )}
            {rows.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全选当前列表" />
                <span className="text-muted-foreground">已选 {selectedIds.size} 项</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs"
                  disabled={selectedIds.size === 0}
                  onClick={() => setPendingDelete(Array.from(selectedIds))}
                >
                  删除所选
                </Button>
              </div>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto" onScroll={handleScroll}>
            <ConversationHistoryRows
              conversations={rows}
              activeConversationId={activeConversationId}
              loading={loading && rows.length === 0}
              emptyText={searchable && debouncedSearch ? "没有匹配的会话" : emptyText}
              formatTime={formatHistoryTime}
              onSelect={(id) => {
                onSelect(id)
                setOpen(false)
              }}
              onDelete={(id) => setPendingDelete([id])}
              showSelect
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
            />
            {rows.length > 0 && (hasMore || loadingMore) && (
              <div className="px-1 pb-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 w-full text-[11px] text-muted-foreground" disabled={loadingMore} onClick={() => void fetchPageData("append")}>
                  {loadingMore ? <><Loader2 className="mr-1.5 size-3 animate-spin" />加载中…</> : "加载更多"}
                </Button>
              </div>
            )}
            {rows.length > 0 && !hasMore && !loadingMore && <div className="pb-2 pt-1 text-center text-[11px] text-muted-foreground">没有更多了</div>}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={pendingDelete.length > 0} onOpenChange={(next) => !next && setPendingDelete([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              删除后不可恢复，确认删除 {pendingDelete.length > 1 ? `这 ${pendingDelete.length} 个会话` : "该会话"}？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const ids = pendingDelete
                setPendingDelete([])
                void remove(ids)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
