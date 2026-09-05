/**
 * 通用 Agent 对话组件。
 *
 * 一个组件承载 Agent 选择、消息流（SSE）、清空、停止、审批裁决和空状态；
 * 不同宿主页通过入参提供上下文与扩展行为：
 * - 市场页（悬浮浮窗）：非受控，不传 messages/terminalContext/onApproval；
 * - 节点终端页：受控 messages（跨 tab 不丢）+ initialConversationId + onConversationIdChange
 *   持久化 + getTerminalContext 注入 cwd/terminal_id/recent_lines。
 *
 * 事件归约复用 agent-stream-events.ts 的 applyAssistantEvent，渲染复用
 * AgentMessageList；不再在各宿主页各写一份 SSE 循环与 reducer。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Check, Eraser, Info, LayoutGrid, Menu } from "lucide-react"
import { toast } from "sonner"
import {
  abortConversation,
  createConversation,
  getConversationMeta,
  listConversationMessagesPage,
  listChatModels,
  resolveApproval,
  sendMessageStream,
  updateConversation,
  uploadAgentConversationAttachment,
  type AgentExecutionMode,
  type AgentGoalConfig,
  type AgentInstance,
  type AgentMessage,
  type ConversationAttachment,
} from "@/api/agentClient"
import {
  AgentMessageList,
  type AgentDisplayMessage,
} from "@/components/console/agent/agent-message-list"
import { AgentHistoryPanel } from "@/components/console/agent/agent-history-panel"
import { AgentMcpDiagnosticsDialog } from "@/components/console/agent/agent-mcp-diagnostics-dialog"
import MessageComposer from "@/components/console/chat/message-composer"
import { ReasoningEffortMenu, resolveReasoningEffort, DEFAULT_REASONING_EFFORT, type ReasoningEffort } from "@/components/console/chat/reasoning-effort"
import { AgentModeMenu } from "@/components/console/chat/agent-mode-menu"
import { TurnNavigator } from "@/components/console/chat/turn-navigator"
import { TokenProgressPopover } from "@/components/console/agent/token-progress-popover"
import {
  applyAssistantEvent,
  type AgentApprovalRequest,
  type AgentStreamEvent,
} from "@/components/console/agent/agent-stream-events"
import { useApprovalExpiry } from "@/components/console/agent/use-approval-expiry"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export interface AgentConversationProps {
  agents: AgentInstance[]
  selectedAgentId: number | null
  onSelectedAgentIdChange: (id: number | null) => void
  /** 受控会话 id：提供则宿主持有（终端从 localStorage 恢复后能同步进来）；不提供则组件内部 state。 */
  conversationId?: string | null
  /** 初始会话 id：仅非受控时用于首挂种子。 */
  initialConversationId?: string | null
  /** 会话 id 变化（创建/清空）时通知宿主持久化。 */
  onConversationIdChange?: (id: string | null) => void
  /** 受控消息：提供则宿主持有（终端跨 tab 不丢）；不提供则组件内部 state。 */
  messages?: AgentDisplayMessage[]
  onMessagesChange?: React.Dispatch<React.SetStateAction<AgentDisplayMessage[]>>
  /** 新建会话的宿主上下文（终端传 node_id/title；市场页不传）。 */
  getCreateConversationPayload?: () => {
    title?: string
    node_id?: string
    context?: "marketplace_admin" | "code_channel"
  }
  /** 终端上下文：发送时实时调用取最新 cwd/terminal_id/recent_lines。 */
  getTerminalContext?: () => {
    cwd?: string
    terminalId?: string
    recentLines?: string[]
  }
  /** 限定浮窗历史到当前节点；市场浮窗不传。 */
  historyNodeId?: string
  /** 空状态文案。 */
  emptyHint?: { title: string; desc: string }
  placeholder?: string
  /** 终端 agentCommand 运行时锁输入。 */
  inputDisabled?: boolean
  /** 宿主的 Agent 配置入口；显示在「切换 Agent」菜单内，不占输入区按钮。 */
  onConfigureAgent?: () => void
  /** 打开完整 Agent 管理（增删改）。 */
  onManageAgents?: () => void
  /** 宿主注入的输入区快捷操作。 */
  composerActions?: React.ReactNode
  /** done 事件的 token usage 回调（完整页徽章用）。 */
  onUsage?: (prompt: number, completion: number) => void
  className?: string
}

export function AgentConversation({
  agents,
  selectedAgentId,
  onSelectedAgentIdChange,
  conversationId: controlledConversationId,
  initialConversationId = null,
  onConversationIdChange,
  messages: controlledMessages,
  onMessagesChange,
  getCreateConversationPayload,
  getTerminalContext,
  historyNodeId,
  emptyHint,
  placeholder = "输入消息，Enter 发送，Shift+Enter 换行",
  inputDisabled = false,
  onConfigureAgent,
  onManageAgents,
  composerActions,
  onUsage,
  className,
}: AgentConversationProps) {
  const [internalMessages, setInternalMessages] = useState<AgentDisplayMessage[]>([])
  const [messageCursor, setMessageCursor] = useState<number | null>(null)
  const [messageHasMore, setMessageHasMore] = useState(false)
  const [messageLoadingMore, setMessageLoadingMore] = useState(false)
  const [internalConversationId, setInternalConversationId] = useState<string | null>(initialConversationId)
  const [input, setInput] = useState("")
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT)
  const [execMode, setExecMode] = useState<AgentExecutionMode>("interact")
  const [conversationModel, setConversationModel] = useState("")
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label?: string; description?: string; maxContextTokens?: number }>>([])
  const [latestUsage, setLatestUsage] = useState<{ prompt: number; completion: number } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [goalObjective, setGoalObjective] = useState("")
  const [goalBudgetMinutes, setGoalBudgetMinutes] = useState(15)
  const [loading, setLoading] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [composerResetKey, setComposerResetKey] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messageScrollRef = useRef<HTMLDivElement | null>(null)

  const messages = controlledMessages ?? internalMessages
  const setMessages: React.Dispatch<React.SetStateAction<AgentDisplayMessage[]>> =
    onMessagesChange ?? setInternalMessages

  const conversationId = controlledConversationId !== undefined ? controlledConversationId : internalConversationId
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const creatingConversationRef = useRef<Promise<string> | null>(null)

  const updateConversationId = useCallback((id: string | null) => {
    if (controlledConversationId === undefined) setInternalConversationId(id)
    onConversationIdChange?.(id)
  }, [controlledConversationId, onConversationIdChange])

  const toDisplayMessages = useCallback((rows: AgentMessage[]): AgentDisplayMessage[] => rows
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map<AgentDisplayMessage>((message) => ({
      id: String(message.id),
      role: message.role as "user" | "assistant",
      content: message.content || "",
      status: message.status,
      error: message.error || undefined,
      model: message.model,
      reasoning: message.reasoning || undefined,
      toolCalls: [],
      subagents: [],
      media: message.media || undefined,
    })), [])

  const selectHistoryConversation = useCallback(async (id: string) => {
    if (loading) return
    try {
      const [conversation, page] = await Promise.all([
        getConversationMeta(id),
        listConversationMessagesPage(id, null, 7),
      ])
      setMessages(toDisplayMessages(page.messages))
      setMessageCursor(page.page.next_cursor)
      setMessageHasMore(page.page.has_more)
      setInput("")
      setReasoningEffort(resolveReasoningEffort(conversation.chat_settings?.reasoning_effort))
      setComposerResetKey((current) => current + 1)
      conversationIdRef.current = id
      updateConversationId(id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载会话失败")
    }
  }, [loading, setMessages, toDisplayMessages, updateConversationId])

  const loadOlderMessages = useCallback(async () => {
    const convId = conversationIdRef.current
    if (!convId || !messageHasMore || messageLoadingMore || messageCursor == null) return
    const viewport = messageScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    const previousHeight = viewport?.scrollHeight || 0
    setMessageLoadingMore(true)
    try {
      const page = await listConversationMessagesPage(convId, messageCursor, 7)
      setMessages((current) => [...toDisplayMessages(page.messages), ...current])
      setMessageCursor(page.page.next_cursor)
      setMessageHasMore(page.page.has_more)
      requestAnimationFrame(() => { if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载更早消息失败")
    } finally {
      setMessageLoadingMore(false)
    }
  }, [messageCursor, messageHasMore, messageLoadingMore, setMessages, toDisplayMessages])

  const handleMessageScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop <= 48) void loadOlderMessages()
  }, [loadOlderMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => () => abortRef.current?.(), [])

  useApprovalExpiry(setMessages)

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents])
  const currentModelMaxTokens = modelOptions.find((item) => item.value === conversationModel)?.maxContextTokens

  // 只有一个可用 Agent 时不必让用户「选」——选择层在这种情况下只是一步空点击，
  // 直接落到那个 Agent；两个以上仍要先选，避免用错 Agent 发出第一条消息。
  useEffect(() => {
    if (selectedAgentId) {
      setPickerOpen(false)
      return
    }
    if (enabledAgents.length === 1) {
      onSelectedAgentIdChange(enabledAgents[0].id)
      setPickerOpen(false)
      return
    }
    if (enabledAgents.length > 1) setPickerOpen(true)
  }, [enabledAgents, onSelectedAgentIdChange, selectedAgentId])

  useEffect(() => {
    if (!selectedAgent) {
      setModelOptions([])
      setConversationModel("")
      return
    }
    const fallback = selectedAgent.main_model || selectedAgent.model || ""
    setConversationModel((current) => current || fallback)
    if (!selectedAgent.main_api_key_id) {
      setModelOptions([{ value: fallback, label: fallback || "默认模型" }])
      return
    }
    listChatModels(selectedAgent.main_api_key_id)
      .then((models) => setModelOptions(models.map((model) => ({
        value: model.id,
        label: model.name || model.remark || model.id,
        description: model.description || undefined,
        maxContextTokens: Number(model.max_context_tokens) || undefined,
      }))))
      .catch(() => setModelOptions([{ value: fallback, label: fallback || "默认模型" }]))
  }, [selectedAgent])

  const handleSwitchModel = useCallback(async (model: string) => {
    setConversationModel(model)
    if (conversationId) {
      try {
        await updateConversation(conversationId, { model })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存模型失败")
      }
    }
  }, [conversationId])

  const agentReady = Boolean(selectedAgent?.main_api_key_id && (selectedAgent.main_model || selectedAgent.model))

  const resolveApprovalFn = useCallback(async (approval: AgentApprovalRequest, result: "allow" | "deny") => {
    if (approval.state !== "pending") return
    const convId = conversationId
    if (!convId) return
    const key = approval.confirmationId
    const mutate = (transform: (item: AgentApprovalRequest) => AgentApprovalRequest) =>
      setMessages((prev) => prev.map((message) => {
        if (!message.approvals?.some((item) => item.confirmationId === key)) return message
        return {
          ...message,
          approvals: message.approvals.map((item) => item.confirmationId === key ? transform(item) : item),
        }
      }))
    mutate((item) => ({ ...item, state: "submitting", error: undefined }))
    try {
      await resolveApproval(convId, approval.confirmationId, result, approval.commandHash)
      mutate((item) => ({ ...item, state: result === "allow" ? "allowed" : "denied" }))
    } catch (error) {
      mutate((item) => ({
        ...item,
        state: "pending",
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [conversationId, setMessages])

  const handleStop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setLoading(false)
    const convId = conversationId
    if (convId) void abortConversation(convId).catch(() => {})
  }, [conversationId])

  const handleClear = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setLoading(false)
    const convId = conversationId
    if (convId) void abortConversation(convId).catch(() => {})
    setMessages([])
    setMessageCursor(null)
    setMessageHasMore(false)
    setInput("")
    conversationIdRef.current = null
    creatingConversationRef.current = null
    setComposerResetKey((current) => current + 1)
    updateConversationId(null)
  }, [conversationId, setMessages, updateConversationId])

  const ensureConversation = useCallback(async () => {
    if (conversationIdRef.current) return conversationIdRef.current
    if (creatingConversationRef.current) return creatingConversationRef.current
    if (!selectedAgentId || !agentReady) throw new Error("请先选择并配置可用 Agent")
    const pending = createConversation({
      agent_id: selectedAgentId,
      model: conversationModel || undefined,
      reasoning_effort: reasoningEffort,
      ...getCreateConversationPayload?.(),
    }).then((conv) => {
      conversationIdRef.current = conv.id
      updateConversationId(conv.id)
      return conv.id
    }).finally(() => {
      creatingConversationRef.current = null
    })
    creatingConversationRef.current = pending
    return pending
  }, [agentReady, conversationModel, getCreateConversationPayload, reasoningEffort, selectedAgentId, updateConversationId])

  const uploadAttachment = useCallback(async (file: File, onProgress: (percent: number) => void) => {
    const convId = await ensureConversation()
    return uploadAgentConversationAttachment(convId, file, onProgress)
  }, [ensureConversation])

  const handleSend = useCallback(async (value: string, attachments: ConversationAttachment[] = []) => {
    const typed = value.trim()
    if ((!typed && attachments.length === 0) || loading || !selectedAgentId || !agentReady) return
    let convId: string
    try {
      convId = await ensureConversation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    }
    const content = attachments.length > 0
      ? `${typed}\n\n[附件（在工作区内，可用文件工具读取）]\n${attachments.map((item) => `- ${item.path}`).join("\n")}`.trim()
      : typed
    const userMsg: AgentDisplayMessage = {
      id: makeId(),
      role: "user",
      content,
      status: "done",
      createdAt: new Date().toISOString(),
      toolCalls: [],
      subagents: [],
    }
    const assistantId = makeId()
    const assistantMsg: AgentDisplayMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
      toolCalls: [],
      subagents: [],
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setLoading(true)

    const applyEvent = (event: AgentStreamEvent) => {
      // confirmation_required 不再在这里拦下：交给 applyAssistantEvent 统一归约，
      // 它会把审批同时追加进 segments 时间线，卡片才能渲染在触发它的那一步位置，
      // 而不是永远堆在气泡最底部。
      if (event.type === "done") {
        const prompt = event.usage?.prompt_tokens
        const completion = event.usage?.completion_tokens
        if (
          typeof prompt === "number" && Number.isFinite(prompt) && prompt >= 0 &&
          typeof completion === "number" && Number.isFinite(completion) && completion >= 0
        ) {
          onUsage?.(prompt, completion)
          setLatestUsage({ prompt, completion })
        }
      }
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId
          ? applyAssistantEvent({ ...message, approvals: message.approvals || [] }, event)
          : message
      )))
    }

    try {
      const ctx = getTerminalContext?.()
      const goalConfig: AgentGoalConfig | undefined =
        execMode === "goal"
          ? {
              objective: goalObjective.trim() || content,
              budget_seconds: Math.max(60, Math.round(goalBudgetMinutes * 60)),
            }
          : undefined
      if (execMode === "goal" && !goalObjective.trim()) {
        toast.error("goal 模式请填写目标")
        return
      }
      const { response, abort } = sendMessageStream(
        convId,
        content,
        undefined,
        ctx ? {
          cwd: ctx.cwd,
          terminal_id: ctx.terminalId,
          recent_lines: ctx.recentLines,
        } : undefined,
        reasoningEffort,
        execMode,
        goalConfig,
      )
      abortRef.current = abort
      const resp = await response
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === "[DONE]") continue
          try {
            applyEvent(JSON.parse(payload) as AgentStreamEvent)
          } catch {
            // 忽略半截 SSE 行，等下一个完整事件。
          }
        }
      }
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId && message.status === "streaming" ? { ...message, status: "done" as const } : message
      )))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId ? { ...message, status: "error" as const, error: text } : message
      )))
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [
    loading,
    selectedAgentId,
    agentReady,
    ensureConversation,
    getTerminalContext,
    onUsage,
    reasoningEffort,
    execMode,
    goalObjective,
    goalBudgetMinutes,
    setMessages,
  ])

  const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
    setReasoningEffort(effort)
    const id = conversationIdRef.current
    if (!id) return
    try {
      await updateConversation(id, { reasoning_effort: effort })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存思考等级失败")
    }
  }, [])

  const switchAgent = useCallback((id: number | null) => {
    setInput("")
    setMessages([])
    setMessageCursor(null)
    setMessageHasMore(false)
    setLatestUsage(null)
    setConversationModel("")
    conversationIdRef.current = null
    creatingConversationRef.current = null
    updateConversationId(null)
    setComposerResetKey((current) => current + 1)
    onSelectedAgentIdChange(id)
    setPickerOpen(false)
  }, [onSelectedAgentIdChange, setMessages, updateConversationId])

  const hasMessages = messages.length > 0
  const turnEntries = messages.filter((message) => message.role === "user").map((message) => ({ id: message.id, content: message.content, createdAt: message.createdAt }))

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
      {/* 气泡标题栏：选好 Agent 后只在这里切换；输入区原 Agent 下拉改为模型。 */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" title="切换 Agent">
              <Menu className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuLabel>切换 Agent</DropdownMenuLabel>
            {enabledAgents.map((agent) => (
              <DropdownMenuItem key={agent.id} onSelect={() => switchAgent(agent.id)}>
                <span className="min-w-0 flex-1 truncate">{agent.display_name || agent.name}</span>
                {agent.id === selectedAgentId && <Check className="ml-2 size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
              <LayoutGrid className="size-4" /> 全部 Agent
            </DropdownMenuItem>
            {onConfigureAgent && (
              <DropdownMenuItem onSelect={onConfigureAgent} disabled={!selectedAgentId}>
                <Info className="size-4" /> 配置当前 Agent
              </DropdownMenuItem>
            )}
            {onManageAgents && (
              <DropdownMenuItem onSelect={onManageAgents}>
                <LayoutGrid className="size-4" /> 管理 Agent
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{selectedAgent?.display_name || selectedAgent?.name || "选择 Agent"}</div>
          <div className="truncate text-[11px] text-muted-foreground">{selectedAgent?.description || "选择一个 Agent 开始对话"}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          title={selectedAgentId ? "查看本会话的 MCP 服务与调用身份" : "先选择一个 Agent"}
          disabled={!selectedAgentId}
          onClick={() => setDiagnosticsOpen(true)}
        >
          <Info className="size-3.5" /> 查看详情
        </Button>
      </div>
      {pickerOpen && (
        <div className="absolute inset-0 z-20 flex min-h-0 flex-col gap-3 bg-background p-5 animate-in fade-in duration-150">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">选择一个 Agent</div>
              <div className="mt-1 text-xs text-muted-foreground">选择后可通过标题栏菜单随时切换。</div>
            </div>
            {onManageAgents && <Button type="button" size="sm" variant="outline" onClick={onManageAgents}>管理 Agent</Button>}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-2 pr-2 sm:grid-cols-2">
              {enabledAgents.map((agent) => {
                const active = agent.id === selectedAgentId
                return (
                  <button key={agent.id} type="button" className={`flex min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors animate-in fade-in slide-in-from-bottom-1 duration-150 ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary hover:bg-primary/5"}`} onClick={() => switchAgent(agent.id)}>
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.display_name || agent.name}</span>
                      {active && <Check className="size-4 shrink-0 text-primary" />}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{agent.description || agent.main_model || agent.model || "未填写描述"}</span>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      )}
      <AgentMcpDiagnosticsDialog
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        agentId={selectedAgentId}
      />
      <div ref={messageScrollRef} className="relative min-h-0 flex-1">
        <ScrollArea className="h-full" onScrollCapture={handleMessageScroll}>
          <div className="flex w-full flex-col gap-4 px-2 py-4">
          {hasMessages ? (
            <AgentMessageList messages={messages} onApproval={resolveApprovalFn} />
          ) : (
            <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="size-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {emptyHint?.title ?? (selectedAgent ? `与 ${selectedAgent.display_name || selectedAgent.name} 开始对话` : "选择一个 Agent")}
                </p>
                <p className="mt-1 text-xs">
                  {emptyHint?.desc ?? "输入需求后，Agent 会在这里展示思考、工具调用和子 Agent 进度。"}
                </p>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
        <TurnNavigator entries={turnEntries} getScrollContainer={() => messageScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") || null} hasMore={messageHasMore} loadingMore={messageLoadingMore} onLoadOlder={loadOlderMessages} compact />
      </div>
      <div className="shrink-0 border-t bg-card p-2">
        <MessageComposer<ConversationAttachment>
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          loading={loading}
          disabled={inputDisabled || !selectedAgentId || !agentReady}
          placeholder={placeholder}
          uploadFile={uploadAttachment}
          uploadEnabled={Boolean(selectedAgentId && agentReady)}
          maxFileSize={10 * 1024 * 1024}
          maxFiles={10}
          attachmentName={(attachment) => attachment.filename}
          resetKey={composerResetKey}
          className="rounded-xl bg-background p-2 shadow-none backdrop-blur-none"
          textareaClassName="min-h-[110px] max-h-60 px-1 py-1"
          modelValue={conversationModel}
          modelOptions={modelOptions}
          onSwitchModel={(model) => void handleSwitchModel(model)}
          beforeModelActions={
            // 允许换行 + min-w-0：悬浮浮窗宽度不够时这些按钮/输入框折行收缩而不是溢出。
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <ReasoningEffortMenu value={reasoningEffort} onChange={(effort) => void handleReasoningEffortChange(effort)} />
              <AgentModeMenu value={execMode} onChange={setExecMode} />
              {execMode === "goal" && (
                <div className="flex min-w-0 items-center gap-1">
                  <input
                    type="text"
                    className="h-7 w-40 min-w-0 rounded-full border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    placeholder="目标（一句话）"
                    value={goalObjective}
                    onChange={(e) => setGoalObjective(e.target.value)}
                  />
                  <input
                    type="number"
                    min={1}
                    className="h-7 w-14 min-w-0 rounded-full border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    placeholder="分钟"
                    value={goalBudgetMinutes}
                    onChange={(e) => setGoalBudgetMinutes(Math.max(1, Number(e.target.value) || 15))}
                  />
                  <span className="shrink-0 text-[11px] text-muted-foreground">分钟</span>
                </div>
              )}
            </div>
          }
          leadingActions={undefined}
          leftActions={
            <>
              <TokenProgressPopover
                inputTokens={latestUsage?.prompt}
                outputTokens={latestUsage?.completion}
                maxTokens={currentModelMaxTokens}
                totalTokens={latestUsage ? latestUsage.prompt + latestUsage.completion : undefined}
              />
              {loading ? <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Spinner className="size-3" /> 流式中…</span> : null}
            </>
          }
          trailingActions={
            <>
              {composerActions ? <div className="flex shrink-0 items-center gap-1">{composerActions}</div> : null}
              <AgentHistoryPanel
                agentId={selectedAgentId}
                nodeId={historyNodeId}
                activeConversationId={conversationId}
                onSelect={(id) => void selectHistoryConversation(id)}
                onDeleted={(id) => {
                  if (conversationIdRef.current !== id) return
                  setMessages([])
                  conversationIdRef.current = null
                  updateConversationId(null)
                  setComposerResetKey((current) => current + 1)
                }}
              />
              <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" title="清空对话（下次发送会创建新会话）" disabled={!hasMessages && !conversationId} onClick={handleClear}>
                <Eraser className="size-4" />
              </Button>
            </>
          }
        />
      </div>
    </div>
  )
}
