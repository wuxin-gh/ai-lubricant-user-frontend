import {
  batchDeleteChatConversations,
  listChatConversationsPage,
  type ChatConversation,
} from "@/api/agentClient"
import { ConversationHistoryPopover } from "@/components/console/conversation-history-popover"

export interface ChatHistoryPanelProps {
  activeConversationId: string | null
  onSelect: (conversationId: string) => void
  onDeleted?: (conversationId: string) => void
  variant?: "icon" | "button"
  align?: "start" | "end"
  side?: "top" | "bottom"
}

/**
 * 聊天页历史会话弹框：复用 Agent 历史同款 Popover，只换 fetch/delete。
 * 不支持搜索（聊天历史后端未开 search 参数），其余分页/批量删除一致。
 */
export function ChatHistoryPanel({
  activeConversationId,
  onSelect,
  onDeleted,
  variant = "icon",
  align = "end",
  side = "bottom",
}: ChatHistoryPanelProps) {
  return (
    <ConversationHistoryPopover<ChatConversation>
      activeConversationId={activeConversationId}
      onSelect={onSelect}
      onDeleted={(ids) => {
        ids.forEach((id) => onDeleted?.(id))
      }}
      fetchPage={({ limit, cursor }) => listChatConversationsPage({ limit, cursor })}
      deleteMany={(ids) => batchDeleteChatConversations(ids)}
      variant={variant}
      align={align}
      side={side}
      searchable={false}
    />
  )
}
