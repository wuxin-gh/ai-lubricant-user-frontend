/** Manager conversation detail dialog (read-only). */
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { AgentMessageList, mergeAgentToolResults, type AgentDisplayMessage } from "@/components/console/agent/agent-message-list"
import { ChatMessageList, type ChatDisplayMessage } from "@/components/console/chat/chat-message-list"
import ReadonlyTaskConversation from "@/components/manager/readonly-task-conversation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"

export type ConversationDetailKind = "project" | "agent" | "chat"

interface DetailConversation {
  id?: string
  title?: string
}

interface DetailMessage {
  id: number
  role: string
  content?: string
  status?: string
  error?: string | null
  tool_calls?: unknown[] | null
  tool_results?: unknown[] | null
  media?: ChatDisplayMessage["media"] | null
  created_at?: string
  model?: string | null
  reasoning?: string | null
}

const ENDPOINT_BY_KIND = {
  agent: "v1AdminAgentConversationsDetail",
  chat: "v1AdminChatConversationsDetail",
} as const

export default function ConversationDetailDialog({
  kind,
  conversationId,
  taskId,
  creatorName,
  open,
  onOpenChange,
}: {
  kind: ConversationDetailKind
  conversationId?: string
  taskId?: string
  creatorName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [conversation, setConversation] = useState<DetailConversation | null>(null)
  const [messages, setMessages] = useState<DetailMessage[]>([])

  useEffect(() => {
    if (!open || kind === "project" || !conversationId) {
      setConversation(null)
      setMessages([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setConversation(null)
    setMessages([])
    apiRequest(ENDPOINT_BY_KIND[kind], {}, [conversationId], (resp) => {
      if (controller.signal.aborted) return
      if (resp.code === 0) {
        setConversation((resp.data?.conversation || null) as DetailConversation | null)
        setMessages((resp.data?.messages || []) as DetailMessage[])
      } else {
        toast.error(resp.message || t("managerConversations.detail.fetchFailed"))
      }
    }, undefined, null, controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => {
      controller.abort()
    }
  }, [conversationId, kind, open, t])

  const agentMessages = useMemo<AgentDisplayMessage[]>(() => messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: String(message.id),
      role: message.role as "user" | "assistant",
      content: message.content || "",
      status: (message.status as AgentDisplayMessage["status"]) || "done",
      error: message.error || undefined,
      model: message.model || undefined,
      reasoning: message.reasoning || undefined,
      createdAt: message.created_at || undefined,
      toolCalls: mergeAgentToolResults(message.tool_calls || [], message.tool_results),
      subagents: [],
    })), [messages])

  const chatMessages = useMemo<ChatDisplayMessage[]>(() => messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .map((message) => ({
      id: String(message.id),
      role: message.role as ChatDisplayMessage["role"],
      content: message.content || "",
      status: (message.status as ChatDisplayMessage["status"]) || "done",
      error: message.error || undefined,
      media: message.media || undefined,
    })), [messages])

  const description = kind === "project"
    ? creatorName || t("managerConversations.fallback.untitled")
    : [conversation?.title || t("managerConversations.fallback.untitled"), creatorName].filter(Boolean).join(" · ")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] min-h-0 flex-col overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t("managerConversations.detail.title")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {kind === "project" && taskId ? (
          <ReadonlyTaskConversation taskId={taskId} />
        ) : loading ? (
          <div className="flex min-h-40 flex-1 items-center justify-center"><Spinner /></div>
        ) : messages.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("managerConversations.detail.empty")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto bg-background px-3">
            {kind === "agent" ? <AgentMessageList messages={agentMessages} /> : <ChatMessageList messages={chatMessages} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
