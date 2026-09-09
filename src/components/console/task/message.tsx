import { ErrorMessageItem } from "./message-error"
import { TextMessageItem } from "./message-text"
import { ThoughtMessageItem } from "./message-thought"
import { ToolCallMessageItem } from "./message-toolcall"
import dayjs from "dayjs"
import { AskUserQuestionMessageItem } from "./message-ask-user-question"
import { UserInputMessageItem } from "./message-userinput"
import { SystemMessageItem } from "./message-system"
import type { ConstsCliName } from "@/api/Api"
import { RestartSessionMessageItem } from "./message-restart-session"
import { AlertMessageItem } from "./message-alert"
import type { TaskUserInput, TaskUserInputAttachment } from "./task-shared"

const normalizeTimestampToSeconds = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return timestamp
  if (timestamp >= 1e17) return Math.floor(timestamp / 1e9)
  if (timestamp >= 1e14) return Math.floor(timestamp / 1e6)
  if (timestamp >= 1e11) return Math.floor(timestamp / 1e3)
  return Math.floor(timestamp)
}

interface MessageType {
  id: string
  time: number
  role: 'agent' | 'user' | 'system'
  type: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_input' | 'user_cancel' | 'tool_call' | 'tool_call_update' | 'available_commands_update' | 'plan' | 'error_message' | 'alert_message' | 'ask_user_question' | 'system_message' | 'restart_session'
  data: {

    _meta?: any
    requestId?: string
    details?: string
    text?: string
    level?: 'info' | 'warning'

    content?: any
    kind?: string
    status?: string
    title?: string
    toolCallId?: string
    /** 该消息所用模型；只 assistant 帧带（runtime 从 SDK 的 message.model 取）。 */
    model?: string
    /** 该次 API 调用的 token 用量；只 assistant 帧带，用于在时间旁显示。 */
    usage?: { input: number; output: number; cache_read: number; cache_creation: number; total: number }

    rawInput?: any

    rawOutput?: any
    locations?: string
    entries?: {
      content: string
      priority: string
      status: string
    }[]
    attachments?: TaskUserInputAttachment[]
    askId?: string
    questions?: {
      custom: boolean
      header: string
      multiSelect: boolean
      question: string
      answer?: string | string[]
      options: {
        label: string
        description: string
      }[]
    }[]
  }

  onResponseAskUserQuestion?: (askId: string, answers: any) => "sent" | "queued" | "rejected"
  onReloadSession?: () => Promise<boolean> | boolean
  onUserInput?: (content: TaskUserInput) => Promise<boolean> | boolean
  /**
   * 重发导致本条错误的那一轮用户消息。由对话面板注入（它才知道最后发出去的是什么）。
   * 与 onUserInput 的区别：不重写 prompt、不重载运行时，就把原文再送一次 —— 多数
   * 失败（429 无可用账号、上游瞬时错误）改完配置重发即可。未注入时不渲染重试按钮。
   */
  onRetry?: () => Promise<boolean> | boolean
}

const shouldRenderMessage = (message: MessageType) => {
  if (message.type === 'agent_message_chunk' && message.data.content?.trim() === '(no content)') {
    return false
  }

  if (message.type === 'agent_thought_chunk' && message.data.content?.trim() === '') {
    return false
  }

  return true
}

const MessageItem = ({ message, cli, isLatest = false }: { message: MessageType, cli?: ConstsCliName, isLatest?: boolean }) => {
  const renderMessage = (message: MessageType) => {
    switch (message.type) {
      case 'agent_message_chunk':
        return <TextMessageItem message={message} />
      case 'agent_thought_chunk':
        return <ThoughtMessageItem message={message} isLatest={isLatest} />
      case 'user_input':
        return <UserInputMessageItem message={message} />
      case 'tool_call':
        return <ToolCallMessageItem message={message} cli={cli} />
      case 'error_message':
        return <ErrorMessageItem message={message} />
      case 'alert_message':
        return <AlertMessageItem message={message} />
      case 'ask_user_question':
        return <AskUserQuestionMessageItem message={message} onResponse={message.onResponseAskUserQuestion} />
      case 'system_message':
        return <SystemMessageItem message={message} />
      case 'restart_session':
        return <RestartSessionMessageItem message={message} />
      default:
        console.error('Received unknown message data', message);
        return null;
    }
  }

  if (!shouldRenderMessage(message)) {
    return null
  }

  // assistant 消息在时间旁边带上这次调用的模型与 token 用量——用户不必去
  // 请求日志页面对账。用量缺失（旧帧/非 assistant）时只显示时间。
  // 模型与用量常驻可见（用户要求对话消息标出所用模型）；时间戳仍只在悬停时
  // 显出，避免每条消息都顶一行 10px 时间噪声。
  const usage = message.data?.usage
  const usageLabel = usage
    ? `${message.data.model ? `${message.data.model} · ` : ""}${usage.total.toLocaleString()} tokens`
    : message.data?.model || ""

  return (
    <div className="flex flex-col w-full group" data-message-id={message.id} data-message-type={message.type} data-message-role={message.role}>
      {message.role !== 'system' && (
        <div className="flex items-center gap-2 text-[10px] px-1 text-left">
          <span className="text-transparent group-hover:text-muted-foreground transition-colors">
            {dayjs.unix(normalizeTimestampToSeconds(message.time)).format('MM-DD HH:mm:ss')}
          </span>
          {usageLabel ? <span className="text-muted-foreground">{usageLabel}</span> : null}
        </div>
      )}
      <div className="flex text-sm w-full mr-auto justify-start">
        {renderMessage(message)}
      </div>
    </div>
  )
}

export {
  MessageItem,
  shouldRenderMessage,
  type MessageType
}
