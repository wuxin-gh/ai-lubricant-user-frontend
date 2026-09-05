import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export interface ConversationHistoryItem {
  id: string
  title?: string
  updated_at?: string
}

interface ConversationHistorySidebarProps<T extends ConversationHistoryItem> {
  conversations: T[]
  activeConversationId: string | null
  header: ReactNode
  emptyText?: string
  formatTime: (value?: string) => string
  onSelect: (conversationId: string) => void
  onDelete: (conversationId: string) => void
  loading?: boolean
  page?: number
  hasPreviousPage?: boolean
  hasNextPage?: boolean
  onPreviousPage?: () => void
  onNextPage?: () => void
  className?: string
}

export interface ConversationHistoryRowsProps<T extends ConversationHistoryItem> {
  conversations: T[]
  activeConversationId: string | null
  emptyText?: string
  formatTime: (value?: string) => string
  onSelect: (conversationId: string) => void
  onDelete: (conversationId: string) => void
  loading?: boolean
  /** 批量选择模式：行首渲染勾选框，点击行不再触发选中而是勾选。 */
  showSelect?: boolean
  selectedIds?: Set<string> | null
  onToggleSelect?: (conversationId: string) => void
}

export function ConversationHistoryRows<T extends ConversationHistoryItem>({
  conversations,
  activeConversationId,
  emptyText = "暂无对话",
  formatTime,
  onSelect,
  onDelete,
  loading = false,
  showSelect = false,
  selectedIds = null,
  onToggleSelect,
}: ConversationHistoryRowsProps<T>) {
  if (loading) return <div className="flex justify-center p-4"><Spinner className="size-4" /></div>
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-0.5 overflow-hidden p-1">
      {conversations.map((conversation) => {
        const isSelected = showSelect && selectedIds ? selectedIds.has(conversation.id) : false
        return (
          <div
            key={conversation.id}
            className={cn(
              "group flex w-full min-w-0 max-w-full cursor-pointer items-center gap-1 overflow-hidden rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              activeConversationId === conversation.id && "bg-accent",
              showSelect && isSelected && "ring-1 ring-primary/40",
            )}
            onClick={() => onSelect(conversation.id)}
          >
            {showSelect && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect?.(conversation.id)}
                onClick={(event) => event.stopPropagation()}
                className="size-3.5 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 truncate">{conversation.title || "新对话"}</div>
            <span className="shrink-0 text-xs text-muted-foreground">{formatTime(conversation.updated_at)}</span>
            <button type="button" className="shrink-0 opacity-0 group-hover:opacity-100" title="删除对话" aria-label={`删除对话：${conversation.title || "新对话"}`} onClick={(event) => { event.stopPropagation(); onDelete(conversation.id) }}>
              <X className="size-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        )
      })}
      {conversations.length === 0 && <div className="p-3 text-center text-xs text-muted-foreground">{emptyText}</div>}
    </div>
  )
}

export function ConversationHistoryPager({
  page = 1,
  hasPreviousPage,
  hasNextPage,
  onPreviousPage,
  onNextPage,
}: Pick<ConversationHistorySidebarProps<ConversationHistoryItem>, "page" | "hasPreviousPage" | "hasNextPage" | "onPreviousPage" | "onNextPage">) {
  if (!hasPreviousPage && !hasNextPage) return null
  return (
    <div className="flex shrink-0 items-center justify-between border-t px-1 py-1">
      <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!hasPreviousPage} onClick={onPreviousPage} title="上一页"><ChevronLeft className="size-4" /></Button>
      <span className="text-[11px] text-muted-foreground">第 {page} 页</span>
      <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!hasNextPage} onClick={onNextPage} title="下一页"><ChevronRight className="size-4" /></Button>
    </div>
  )
}

export default function ConversationHistorySidebar<T extends ConversationHistoryItem>({
  conversations,
  activeConversationId,
  header,
  emptyText,
  formatTime,
  onSelect,
  onDelete,
  loading,
  page,
  hasPreviousPage,
  hasNextPage,
  onPreviousPage,
  onNextPage,
  className,
}: ConversationHistorySidebarProps<T>) {
  return (
    <div className={cn("flex h-full w-64 min-w-0 shrink-0 flex-col gap-2 overflow-hidden", className)}>
      <div className="min-w-0 shrink-0">{header}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <ConversationHistoryRows conversations={conversations} activeConversationId={activeConversationId} emptyText={emptyText} formatTime={formatTime} onSelect={onSelect} onDelete={onDelete} loading={loading} />
        </div>
        <ConversationHistoryPager page={page} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onPreviousPage={onPreviousPage} onNextPage={onNextPage} />
      </div>
    </div>
  )
}
