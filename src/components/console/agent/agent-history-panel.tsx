import {
  batchDeleteConversations,
  listConversationsPage,
  type AgentConversation,
} from "@/api/agentClient"
import { ConversationHistoryPopover } from "@/components/console/conversation-history-popover"

export interface AgentHistoryPanelProps {
  agentId: number | null
  /** 限定到某节点的会话（节点终端气泡传）。 */
  nodeId?: string
  activeConversationId: string | null
  /** 选中一条历史会话。 */
  onSelect: (conversationId: string) => void
  /** 会话被删除后通知宿主（宿主决定是否清空当前对话）。 */
  onDeleted?: (conversationId: string) => void
  /** 触发按钮形态：icon 给气泡输入区，button 给标题栏。 */
  variant?: "icon" | "button"
  align?: "start" | "end"
  side?: "top" | "bottom"
}

export function AgentHistoryPanel({
  agentId,
  nodeId,
  activeConversationId,
  onSelect,
  onDeleted,
  variant = "icon",
  align = "end",
  side = "top",
}: AgentHistoryPanelProps) {
  return (
    <ConversationHistoryPopover<AgentConversation>
      activeConversationId={activeConversationId}
      onSelect={onSelect}
      onDeleted={(ids) => {
        // 兼容现有调用方按 id 判断当前会话的写法：逐条回调即可。
        ids.forEach((id) => onDeleted?.(id))
      }}
      fetchPage={({ limit, cursor, search }) =>
        listConversationsPage({ limit, cursor, agentId: agentId ?? undefined, nodeId: nodeId ?? undefined, search: search ?? undefined })
      }
      deleteMany={(ids) => batchDeleteConversations(ids)}
      variant={variant}
      align={align}
      side={side}
      disabled={!agentId}
      searchable
    />
  )
}
