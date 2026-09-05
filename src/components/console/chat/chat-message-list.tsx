import type { ChatMediaItem } from "@/api/agentClient"
import { IconReload } from "@tabler/icons-react"
import { Markdown } from "@/components/common/markdown"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type ChatMessageStatus = "pending" | "streaming" | "done" | "error"

export interface ChatTokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens?: number
  cache_creation_tokens?: number
  reasoning_tokens?: number
}

export interface ChatDisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  status: ChatMessageStatus
  usage?: ChatTokenUsage
  error?: string
  media?: ChatMediaItem[]
  model?: string
  createdAt?: string
}

const formatMessageTime = (value?: string) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function MediaGallery({ items }: { items: ChatMediaItem[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item, i) => {
        if (item.type === "image") {
          const src = item.url || (item.b64 ? `data:${item.mimeType || "image/png"};base64,${item.b64}` : "")
          return src ? (
            <a key={i} href={item.url || src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt={`生成图片 ${i + 1}`} className="max-h-80 max-w-80 rounded-md border" />
            </a>
          ) : null
        }
        if (item.type === "video") {
          return item.url ? (
            <video key={i} controls className="max-h-[480px] max-w-full rounded-md border">
              <source src={item.url} />
            </video>
          ) : null
        }
        if (item.type === "audio") {
          const src = item.url || (item.b64 ? `data:${item.mimeType || "audio/mpeg"};base64,${item.b64}` : "")
          return src ? (
            <audio key={i} controls className="w-full">
              <source src={src} />
            </audio>
          ) : null
        }
        return null
      })}
    </div>
  )
}

export function ChatMessageBubble({ message, onRetry }: { message: ChatDisplayMessage; onRetry?: (message: ChatDisplayMessage) => void }) {
  const isUser = message.role === "user"
  const hasMedia = message.media && message.media.length > 0
  const canRetry = !isUser && message.status === "error" && !!onRetry
  return (
    <div className="flex w-full justify-start" data-message-id={message.id} data-message-role={isUser ? "user" : "assistant"}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-2.5 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {message.content ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <Markdown allowHtml className="min-w-0 overflow-hidden break-words pb-0 [&>*:last-child]:mb-0">
              {message.content}
            </Markdown>
          )
        ) : ((message.status === "pending" || message.status === "streaming") ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Spinner className="size-3" /> 等待响应…
          </span>
        ) : hasMedia ? null : <span className="text-muted-foreground">（无内容）</span>)}
        {hasMedia && <MediaGallery items={message.media!} />}
        {message.error && (
          <div className="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{message.error}</div>
        )}
        {canRetry && (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onRetry?.(message)}
          >
            <IconReload className="size-3" /> 重试
          </button>
        )}
        {message.role === "assistant" && (message.model || message.usage || message.createdAt) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {message.model && <span className="rounded bg-background/60 px-1.5 py-0.5">{message.model}</span>}
            {message.usage && (
              <>
                <span>输入 {message.usage.prompt_tokens}</span>
                <span>输出 {message.usage.completion_tokens}</span>
                <span>总计 {message.usage.total_tokens}</span>
              </>
            )}
            {message.createdAt && <span className="ml-auto">{formatMessageTime(message.createdAt)}</span>}
          </div>
        )}
        {message.role === "user" && message.createdAt && (
          <div className="mt-1.5 text-right text-[11px] opacity-70">{formatMessageTime(message.createdAt)}</div>
        )}
      </div>
    </div>
  )
}

export function ChatMessageList({ messages, onRetry }: { messages: ChatDisplayMessage[]; onRetry?: (message: ChatDisplayMessage) => void }) {
  // 只有最后一条 assistant 消息可重试：重放历史中间轮会破坏上下文。
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id
  return (
    <div className="flex w-full flex-col gap-4 px-5 py-6">
      {messages.map((message) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          onRetry={onRetry && message.id === lastAssistantId ? onRetry : undefined}
        />
      ))}
    </div>
  )
}
