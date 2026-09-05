import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Send, Square } from "lucide-react"
import { toast } from "sonner"

import {
  cancelEditorSessionTurn,
  getEditorRequestLog,
  listEditorRequestLogs,
  sendEditorSessionMessage,
  type EditorRequestLog,
  type EditorSession,
} from "@/api/editorClient"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { PlanStepsBlock } from "@/components/console/task/chat-panel"
import type { TaskPlan } from "@/components/console/task/task-shared"
import {
  EditorSessionStreamClient,
  editorSessionEventsUrl,
  type EditorSessionSubAgent,
} from "@/components/console/editor/editor-session-stream-client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

/**
 * Editor task conversation. Live turns come from the session's SSE event stream
 * (runtime agent events bridged to JSON, reduced to the shared MessageType); past
 * turns are reconstructed from the session's gateway request logs so a freshly
 * opened session still shows history. Both feed the shared task-detail message
 * renderer (MessageItem/MessageType), matching the classic task page.
 */

function extractText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n")
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  if (typeof record.text === "string") return record.text
  if (typeof record.content === "string") return record.content
  for (const key of ["content", "message", "choices", "delta"] as const) {
    if (record[key]) {
      const text = extractText(record[key])
      if (text) return text
    }
  }
  return ""
}

function lastUserText(log: EditorRequestLog): string {
  const body = log.request_body
  if (!body || typeof body !== "object") return ""
  const messages = (body as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return ""
  const reversed = [...messages].reverse()
  const user = reversed.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).role === "user")
  return extractText(user)
}

function logToMessages(log: EditorRequestLog): MessageType[] {
  const time = Number(log.time || 0)
  const out: MessageType[] = []
  const userText = lastUserText(log)
  if (userText) {
    out.push({ id: `log-${log.id}-user`, time, role: "user", type: "user_input", data: { content: userText } })
  }
  const assistantText = extractText(log.response_body)
  if (assistantText) {
    out.push({ id: `log-${log.id}-agent`, time, role: "agent", type: "agent_message_chunk", data: { content: assistantText } })
  } else if (log.has_error || log.success === false) {
    out.push({ id: `log-${log.id}-error`, time, role: "agent", type: "error_message", data: { text: log.error_preview || "请求失败" } })
  }
  return out
}

/** Map a live stream message onto the task-detail renderer's MessageType. */

const PAGE_SIZE = 20

export default function EditorSessionChat({
  editorId,
  session,
  active,
  onContextUsage,
  onSubAgents,
  onPendingApprovals,
  modelLabel,
  subAgents,
  activeSubAgentId,
  onSelectSubAgent,
}: {
  editorId: string
  session: EditorSession
  active: boolean
  /** Stream-reported context-window usage, lifted to the editor workspace header. */
  onContextUsage?: (usage: { size: number | null; used: number | null }) => void
  /** Sub-agents seen in this session's stream, lifted to the editor workspace panel. */
  onSubAgents?: (agents: EditorSessionSubAgent[]) => void
  /** Confirmation ids awaiting user action, lifted for the red-dot attention signal. */
  onPendingApprovals?: (ids: string[]) => void
  /** 当前会话模型/模式的可读标签，用于在输入框右侧紧凑显示。 */
  modelLabel?: { model?: string | null; mode?: string | null }
  /** 当前会话的子 Agent 列表。空数组表示没有子 Agent。 */
  subAgents?: EditorSessionSubAgent[]
  /** 选中查看对话的子 Agent id；空表示查看主对话。 */
  activeSubAgentId?: string | null
  /** 点击子 Agent 块查看其对话；null 表示返回主对话。 */
  onSelectSubAgent?: (id: string | null) => void
}) {
  const [logs, setLogs] = useState<EditorRequestLog[]>([])
  const [total, setTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState("")
  const [liveMessages, setLiveMessages] = useState<MessageType[]>([])
  const [plan, setPlan] = useState<TaskPlan>({ entries: [], version: 0 })
  const [running, setRunning] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const clientRef = useRef<EditorSessionStreamClient | null>(null)
  // 最近一轮发出去的原文，供错误卡上的「重试」重发。只记发送成功的轮次：发送本身
  // 就失败时草稿还在 composer 里，用户直接再点发送即可。
  const lastTurnRef = useRef<string | null>(null)
  const interactive = session.status === "active" || session.status === "pending_first_request"

  const hydrate = useCallback(async (rows: EditorRequestLog[]) => {
    return Promise.all(rows.map(async (row) => {
      try {
        return await getEditorRequestLog(editorId, row.id)
      } catch {
        return row
      }
    }))
  }, [editorId])

  const load = useCallback(async (offset: number, append: boolean) => {
    if (append) setHistoryLoading(true)
    else setLoading(true)
    try {
      const page = await listEditorRequestLogs(editorId, { editor_session_id: session.id, limit: PAGE_SIZE, offset })
      const hydrated = await hydrate(page.rows)
      setTotal(page.total)
      setLogs((current) => append ? [...current, ...hydrated] : hydrated)
    } catch (error) {
      if (!append) toast.error(error instanceof Error ? error.message : "加载任务对话失败")
    } finally {
      if (append) setHistoryLoading(false)
      else setLoading(false)
    }
  }, [editorId, hydrate, session.id])

  useEffect(() => { void load(0, false) }, [load])

  // Parent callbacks live in refs so a new inline function per render doesn't
  // tear down and re-open the event stream.
  const onContextUsageRef = useRef(onContextUsage)
  const onSubAgentsRef = useRef(onSubAgents)
  const onPendingApprovalsRef = useRef(onPendingApprovals)
  onContextUsageRef.current = onContextUsage
  onSubAgentsRef.current = onSubAgents
  onPendingApprovalsRef.current = onPendingApprovals

  // Live event stream: attach whenever the session is interactive and visible.
  useEffect(() => {
    if (!active || !interactive) {
      clientRef.current?.close()
      clientRef.current = null
      return
    }
    const client = new EditorSessionStreamClient(
      editorSessionEventsUrl(editorId, session.id),
      (state) => {
        setLiveMessages(state.messages)
        setPlan(state.plan)
        setRunning(state.running)
        onContextUsageRef.current?.(state.contextUsage)
        onSubAgentsRef.current?.(state.subAgents)
        onPendingApprovalsRef.current?.(state.pendingApprovals)
      },
    )
    clientRef.current = client
    client.connect()
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [active, interactive, editorId, session.id])

  const historyMessages = useMemo(() => [...logs].reverse().flatMap(logToMessages), [logs])
  const messages = useMemo(
    () => [...historyMessages, ...liveMessages],
    [historyMessages, liveMessages],
  )

  const activeSubAgent = useMemo(() => {
    if (!activeSubAgentId) return null
    return (subAgents || []).find((agent) => agent.id === activeSubAgentId) ?? null
  }, [activeSubAgentId, subAgents])

  useEffect(() => {
    const container = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    if (container) container.scrollTop = container.scrollHeight
  }, [messages.length, running])

  async function send() {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      await sendEditorSessionMessage(editorId, session.id, content)
      // Only remember (and only show) a turn that the server accepted. Appending
      // the card before the await left a phantom user message on a rejected send.
      lastTurnRef.current = content
      clientRef.current?.appendUserMessage(content)
      setDraft("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送消息失败")
    } finally {
      setSending(false)
    }
  }

  /**
   * Re-send the last turn, for the retry button on an error card.
   *
   * The runtime does not retry a turn it has given up on, and the LLM service in
   * front of it cannot wait out a rate limit on the caller's behalf — so when a
   * turn dies the user is left retyping what they already said. This re-sends the
   * original text verbatim: no rewritten prompt, no runtime restart, and no
   * second copy of the user's message in the transcript (the failed turn's card
   * is still there and still accurate).
   */
  const retryLastTurn = useCallback(async (): Promise<boolean> => {
    const last = lastTurnRef.current
    if (!last || sending || !interactive) return false
    setSending(true)
    try {
      await sendEditorSessionMessage(editorId, session.id, last)
      clientRef.current?.beginTurn()
      return true
    } finally {
      setSending(false)
    }
  }, [editorId, interactive, sending, session.id])

  async function cancelTurn() {
    try {
      await cancelEditorSessionTurn(editorId, session.id)
      setRunning(false)
      toast.success("已请求中断当前回复")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "中断失败")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {activeSubAgent && (
        <div className="mx-auto flex w-full max-w-[960px] shrink-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onSelectSubAgent?.(null)}>← 返回主对话</button>
          <span className="truncate font-medium text-primary">{activeSubAgent.name}</span>
          {activeSubAgent.task && <span className="truncate text-muted-foreground">· {activeSubAgent.task}</span>}
          <span className="ml-auto">{activeSubAgent.status === "running" ? "进行中" : "已完成"}</span>
        </div>
      )}
      <div ref={scrollRef} className="relative min-h-0 min-w-0 flex-1">
        <ScrollArea className="h-full [&>[data-radix-scroll-area-viewport]>div]:!block">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-3 sm:px-5">
            {activeSubAgent ? (
              <div className="space-y-2 py-2">
                {activeSubAgent.content && (
                  <div className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">{activeSubAgent.content}</div>
                )}
                {activeSubAgent.toolCalls.map((toolCall, index) => {
                  const key = `${activeSubAgent.id}-tool-${index}`
                  return <MessageItem key={key} message={{ id: key, time: 0, role: "agent", type: "tool_call", data: { title: toolCall.name, content: "", rawInput: toolCall.args, rawOutput: toolCall.result } }} isLatest={false} />
                })}
                {activeSubAgent.summary && (
                  <div className="text-xs text-muted-foreground">小结：{activeSubAgent.summary}</div>
                )}
                {!activeSubAgent.content && activeSubAgent.toolCalls.length === 0 && !activeSubAgent.summary && (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">该子 Agent 还没有输出</div>
                )}
              </div>
            ) : loading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : messages.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {interactive ? "等待首条消息" : "该任务还没有对话"}
              </div>
            ) : (
              <>
                {logs.length < total && (
                  <Button variant="ghost" size="sm" className="mx-auto" disabled={historyLoading} onClick={() => void load(logs.length, true)}>
                    {historyLoading && <Spinner className="mr-2 size-3.5" />}加载更早的对话
                  </Button>
                )}
                {messages.map((message, index) => (
                  <MessageItem
                    key={message.id}
                    // Only an error card needs the retry action, and only when
                    // there is a turn to re-send. MessageType.onRetry doubles as
                    // the flag that renders the button, so injecting it
                    // unconditionally would put a dead button on every message.
                    message={message.type === "error_message" && lastTurnRef.current
                      ? { ...message, onRetry: retryLastTurn }
                      : message}
                    isLatest={index === messages.length - 1}
                  />
                ))}
              </>
            )}
            {plan.entries.length > 0 && (
              <PlanStepsBlock plan={plan} streamStatus={running ? "executing" : "finished"} />
            )}
            {running && (
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Spinner className="size-3.5" /> 正在生成…
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
        <div className="mx-auto w-full max-w-[1400px] shrink-0 px-3 pb-3 pt-2 sm:px-5">
          <div className="flex items-end gap-2 rounded-2xl border bg-background p-3 shadow-sm">
            <Textarea
              disabled={!interactive}
              className="min-h-24 max-h-52 resize-none border-0 px-3 py-2 shadow-none focus-visible:ring-0"
              value={draft}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            {modelLabel && (
              <div className="flex shrink-0 items-center gap-1 self-end pb-0.5">
                {modelLabel.model && <span className="max-w-32 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={modelLabel.model}>{modelLabel.model}</span>}
                {modelLabel.mode && <span className="max-w-24 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={modelLabel.mode}>{modelLabel.mode}</span>}
              </div>
            )}
            {interactive && (running ? (
              <Button size="icon" variant="destructive" onClick={() => void cancelTurn()} title="停止">
                <Square className="size-4" />
              </Button>
            ) : (
              <Button size="icon" disabled={sending || !draft.trim()} onClick={() => void send()} title="发送">
                {sending ? <Spinner className="size-4" /> : <Send className="size-4" />}
              </Button>
            ))}
          </div>
        </div>
    </div>
  )
}
