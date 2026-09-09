/**
 * Agent 对话页（用户侧）。
 *
 * 选择一个可用 Agent（自建 + 平台公共），与之多轮对话。后端走 /agent/conversations*，
 * SSE 流式返回；事件状态机（content / tool_call / tool_result / subagent_* / retry）
 * 从旧 admin AgentChat.tsx 移植。数据按 user_id 隔离。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import {
  Bot,
  Check,
  Clock,
  LayoutGrid,
  Menu,
  Plus,
  SlidersHorizontal,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import AgentManagerDialog from "./agent-manager-dialog"
import { useSearchParams } from "react-router-dom"
import {
  abortConversation,
  createConversation,
  getConversationMeta,
  listAgents,
  listApprovals,
  listChatModels,
  listConversationsPage,
  listConversationMessagesPage,
  resolveApproval,
  getConversation,
  retryConversationMessage,
  sendMessageStream,
  updateConversation,
  uploadAgentConversationAttachment,
  type AgentConversation,
  type AgentExecutionMode,
  type AgentGoalConfig,
  type AgentInstance,
  type ConversationAttachment,
} from "@/api/agentClient"
import MessageComposer from "@/components/console/chat/message-composer"
import { ReasoningEffortMenu, resolveReasoningEffort, DEFAULT_REASONING_EFFORT, type ReasoningEffort } from "@/components/console/chat/reasoning-effort"
import { AgentModeMenu } from "@/components/console/chat/agent-mode-menu"
import { TurnNavigator } from "@/components/console/chat/turn-navigator"
import { TokenProgressPopover } from "@/components/console/agent/token-progress-popover"
import { AgentHistoryPanel } from "@/components/console/agent/agent-history-panel"
import { ScheduledTasksDialog } from "@/components/console/agent/scheduled-tasks-dialog"
import {
  AgentMessageBubble,
  agentMessagesToDisplay,
  type AgentDisplayMessage,
} from "@/components/console/agent/agent-message-list"
// 事件归约走共享模块：与 agent-conversation.tsx（节点终端 AI 面板）同一套语义，
// 避免各页面手抄一份导致新事件类型只在一边生效。
import {
  approvalFromRow,
  applyAssistantEvent,
  type AgentApprovalRequest,
  type AgentStreamEvent,
} from "@/components/console/agent/agent-stream-events"
import { useApprovalExpiry } from "@/components/console/agent/use-approval-expiry"

interface AgentTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
}

const AGENT_STORAGE_KEY = "agentChatAgentId"

function rememberedAgentId(): number | null {
  const value = Number(localStorage.getItem(AGENT_STORAGE_KEY) || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

function rememberAgentId(id: number | null): void {
  if (id) localStorage.setItem(AGENT_STORAGE_KEY, String(id))
  else localStorage.removeItem(AGENT_STORAGE_KEY)
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`


export default function AgentChatPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialAgentId = Number(searchParams.get("agentId") || 0) || null
  const initialConversationId = searchParams.get("conversationId")
  // 智能任务快捷入口带来的首条消息：会话已在入口建好，进来后自动发出。
  const initialSendText = searchParams.get("send") || ""
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(initialAgentId)
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<AgentDisplayMessage[]>([])
  const [messageCursor, setMessageCursor] = useState<number | null>(null)
  const [messageHasMore, setMessageHasMore] = useState(false)
  const [messageLoadingMore, setMessageLoadingMore] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [convModel, setConvModel] = useState("")
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT)
  const [execMode, setExecMode] = useState<AgentExecutionMode>("interact")
  const [goalObjective, setGoalObjective] = useState("")
  const [goalBudgetMinutes, setGoalBudgetMinutes] = useState(15)
  const [agentModels, setAgentModels] = useState<Array<{ value: string; label?: string; description?: string; maxContextTokens?: number }>>([])
  const [latestUsage, setLatestUsage] = useState<AgentTokenUsage | null>(null)
  const [composerResetKey, setComposerResetKey] = useState(0)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerInitialCreate, setManagerInitialCreate] = useState(false)
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false)
  // 首屏：picker = 选 Agent（与气泡面板 showPicker 同款），chat = 对话。
  // 初值 picker，挂载后按 ?agentId= / 记住的选择决定是否直接进 chat。
  const [view, setView] = useState<"picker" | "chat">("chat")

  const abortRef = useRef<(() => void) | null>(null)
  const creatingConversationRef = useRef<Promise<string> | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messageScrollRef = useRef<HTMLDivElement | null>(null)

  // 只维护一份「当前 Agent 的会话列表」用于深链恢复与本地 upsert；翻页/搜索/删除
  // 的完整交互在 AgentHistoryPanel 里，不再由本页驱动。
  const refreshConversations = useCallback(async () => {
    if (!selectedAgentId) {
      setConversations([])
      return
    }
    try {
      const result = await listConversationsPage({ limit: 20, agentId: selectedAgentId })
      setConversations(Array.isArray(result.items) ? result.items : [])
    } catch {
      // 列表仅用于深链恢复，静默失败即可，用户可从历史面板重新进入。
    }
  }, [selectedAgentId])

  // 本地增量 upsert：把某会话插到列表首位或就地更新标题/时间，避免整页重拉造成的闪烁。
  const upsertConversation = useCallback((conv: AgentConversation) => {
    setConversations((current) => {
      const rest = current.filter((item) => item.id !== conv.id)
      return [{ ...current.find((item) => item.id === conv.id), ...conv }, ...rest]
    })
  }, [])

  const refreshAgents = useCallback(async () => {
    try {
      const list = await listAgents()
      setAgents(list)
      // 同步更新下拉选中：若当前选中项已不存在，回退到第一个可用 Agent
      if (selectedAgentId != null && !list.find((a) => a.id === selectedAgentId)) {
        const firstEnabled = list.find((a) => a.enabled) || list[0]
        if (firstEnabled) setSelectedAgentId(firstEnabled.id)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [selectedAgentId])

  useEffect(() => {
    listAgents()
      .then((list) => {
        setAgents(list)
        const enabled = list.filter((a) => a.enabled)
        // 首屏是否直接进对话，按「明确的选择」优先级决定，与气泡面板 openFlow 同口径：
        // ?agentId= → 上次记住的 Agent → 只有一个可用 Agent 就直接进 → 否则停在选择页。
        const requested = initialAgentId ? enabled.find((a) => a.id === initialAgentId) : null
        const remembered = requested ? null : enabled.find((a) => a.id === rememberedAgentId())
        const soleAgent = !requested && !remembered && enabled.length === 1 ? enabled[0] : null
        const picked = requested || remembered || soleAgent
        if (picked) {
          setSelectedAgentId(picked.id)
          setView("chat")
        } else {
          setSelectedAgentId(null)
          setView("picker")
        }
      })
      .catch((e) => toast.error((e as Error).message))
    // initial query params are intentionally applied once when opening the page.
  }, [])

  useEffect(() => {
    void refreshConversations()
  }, [selectedAgentId, refreshConversations])

  useEffect(() => {
    setLatestUsage(null)
  }, [selectedAgentId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => () => abortRef.current?.(), [])

  const pickLatestUsage = useCallback((items: AgentDisplayMessage[]): AgentTokenUsage | null => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const usage = items[i].usage as Record<string, number> | undefined
      if (!usage) continue
      const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens) || 0
      const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens) || 0
      if (promptTokens || completionTokens) {
        return {
          promptTokens,
          completionTokens,
          totalTokens: Number(usage.total_tokens) || promptTokens + completionTokens,
          cachedTokens: Number(usage.cached_tokens) || 0,
          cacheCreationTokens: Number(usage.cache_creation_tokens) || 0,
          reasoningTokens: Number(usage.reasoning_tokens) || 0,
        }
      }
    }
    return null
  }, [])

  // 历史回灌映射走共享模块 agentMessagesToDisplay（agent-message-list.tsx），
  // 与定时任务执行记录详情同一份口径。
  const toDisplayMessages = useCallback(
    (history: Awaited<ReturnType<typeof listConversationMessagesPage>>["messages"]): AgentDisplayMessage[] =>
      agentMessagesToDisplay(history),
    [],
  )

  const selectConversation = useCallback(async (convId: string) => {
    setComposerResetKey((current) => current + 1)
    setActiveConvId(convId)
    try {
      const [conversation, page] = await Promise.all([
        getConversationMeta(convId),
        listConversationMessagesPage(convId, null, 7),
      ])
      if (conversation.agent_id) {
        setSelectedAgentId(conversation.agent_id)
        setSearchParams(
          { agentId: String(conversation.agent_id), conversationId: convId },
          { replace: true },
        )
      } else {
        setSearchParams({ conversationId: convId }, { replace: true })
      }
      if (conversation.model) setConvModel(conversation.model)
      setReasoningEffort(resolveReasoningEffort(conversation.chat_settings?.reasoning_effort))
      // 执行模式是每条消息的入参、不随会话持久化，切会话后回到默认交互模式。
      setExecMode("interact")
      setGoalObjective("")
      const restored = toDisplayMessages(page.messages)
      // 恢复断线前仍挂起的审批（code_run/节点命令）：后端 approval_registry 仍在内存里，
      // 不重新拉一次的话刷新后审批卡就消失，用户无从批准 → 那一轮会卡到超时。
      try {
        const { approvals: pending } = await listApprovals(convId)
        if (pending.length && restored.length) {
          const pendingCards = pending
            .map((row) => approvalFromRow(row as unknown as Record<string, unknown>))
            .filter((card): card is AgentApprovalRequest => card !== null && card.state === "pending")
          if (pendingCards.length) {
            // 挂到最后一条 assistant 消息上，与实时 confirmation_required 一致。
            const lastAssistant = [...restored].reverse().find((m) => m.role === "assistant")
            if (lastAssistant) {
              lastAssistant.approvals = [...(lastAssistant.approvals || []), ...pendingCards]
            }
          }
        }
      } catch {
        // 审批恢复非关键路径，失败就用历史里现有的状态。
      }
      setMessages(restored)
      setMessageCursor(page.page.next_cursor)
      setMessageHasMore(page.page.has_more)
      setLatestUsage(pickLatestUsage(restored))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [pickLatestUsage, setSearchParams, toDisplayMessages])

  const loadOlderMessages = useCallback(async () => {
    if (!activeConvId || !messageHasMore || messageLoadingMore || messageCursor == null) return
    const viewport = messageScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    const previousHeight = viewport?.scrollHeight || 0
    setMessageLoadingMore(true)
    try {
      const page = await listConversationMessagesPage(activeConvId, messageCursor, 7)
      setMessages((current) => [...toDisplayMessages(page.messages), ...current])
      setMessageCursor(page.page.next_cursor)
      setMessageHasMore(page.page.has_more)
      requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载更早消息失败")
    } finally {
      setMessageLoadingMore(false)
    }
  }, [activeConvId, messageCursor, messageHasMore, messageLoadingMore, toDisplayMessages])

  const handleMessageScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop <= 48) void loadOlderMessages()
  }, [loadOlderMessages])

  const turnEntries = useMemo(() => messages.filter((message) => message.role === "user").map((message) => ({ id: message.id, content: message.content, createdAt: message.createdAt })), [messages])

  useEffect(() => {
    if (!initialConversationId || conversations.length === 0) return
    const conversation = conversations.find((item) => item.id === initialConversationId)
    if (!conversation) return
    if (conversation.agent_id) {
      setSelectedAgentId(conversation.agent_id)
    }
    void selectConversation(initialConversationId)
    // only restore a deep-linked conversation once.
  }, [conversations.length, initialConversationId, selectConversation])

  const handleNewConversation = useCallback((agentId?: number) => {
    setLatestUsage(null)
    setReasoningEffort(DEFAULT_REASONING_EFFORT)
    setExecMode("interact")
    setGoalObjective("")
    setComposerResetKey((current) => current + 1)
    if (agentId) {
      setSelectedAgentId(agentId)
      setSearchParams({ agentId: String(agentId) }, { replace: true })
    } else if (selectedAgentId) {
      setSearchParams({ agentId: String(selectedAgentId) }, { replace: true })
    }
    setActiveConvId(null)
    setMessages([])
    const nextAgentId = agentId || selectedAgentId
    const nextAgent = agents.find((item) => item.id === nextAgentId)
    setConvModel(nextAgent?.main_model || nextAgent?.model || "")
  }, [agents, selectedAgentId, setSearchParams])

  /**
   * 选中一个 Agent 并进入对话：首屏选择卡片与「切换 Agent」菜单共用这一条路径。
   * 记住选择，下次进页面直接进对话（与气泡面板 rememberAgentId 同款行为）。
   */
  const handleSelectAgent = useCallback((agentId: number) => {
    rememberAgentId(agentId)
    setView("chat")
    handleNewConversation(agentId)
  }, [handleNewConversation])

  const handleStop = useCallback(async () => {
    abortRef.current?.()
    if (activeConvId) {
      try {
        await abortConversation(activeConvId)
      } catch {
        // ignore
      }
    }
    setLoading(false)
  }, [activeConvId])

  // 审批裁决：把 approval 翻成 submitting→allowed/denied，调后端 resolveApproval。
  // code_run/节点命令审批命中时，用户点「允许/拒绝」才能让挂起的整轮继续。
  const resolveApprovalFn = useCallback(async (approval: AgentApprovalRequest, result: "allow" | "deny") => {
    if (approval.state !== "pending" || !activeConvId) return
    const key = approval.confirmationId
    const mutate = (transform: (item: AgentApprovalRequest) => AgentApprovalRequest) =>
      setMessages((prev) => prev.map((message) => {
        if (!message.approvals?.some((item) => item.confirmationId === key)) return message
        return {
          ...message,
          approvals: message.approvals.map((item) => (item.confirmationId === key ? transform(item) : item)),
        }
      }))
    mutate((item) => ({ ...item, state: "submitting", error: undefined }))
    try {
      await resolveApproval(activeConvId, approval.confirmationId, result, approval.commandHash)
      mutate((item) => ({ ...item, state: result === "allow" ? "allowed" : "denied" }))
    } catch (e) {
      mutate((item) => ({
        ...item,
        state: "pending",
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [activeConvId])

  // 审批过期本地翻态：逻辑与 agent-conversation.tsx 共用同一个 hook。
  useApprovalExpiry(setMessages)

  const handleSend = useCallback(async (value: string, pendingAttachments: ConversationAttachment[] = []) => {
    const typed = value.trim()
    if ((!typed && pendingAttachments.length === 0) || loading) return
    if (!selectedAgentId) {
      toast.error("请先选择一个 Agent")
      return
    }
    // goal 模式必须先有目标：后端 goal_config.objective 是必填项，缺了会 400。
    if (execMode === "goal" && !goalObjective.trim()) {
      toast.error("目标模式请先填写目标")
      return
    }

    let convId = activeConvId
    if (!convId) {
      try {
        const conv = await createConversation({ agent_id: selectedAgentId, model: convModel || undefined, reasoning_effort: reasoningEffort })
        convId = conv.id
        setActiveConvId(convId)
        upsertConversation(conv)
      } catch (e) {
        toast.error((e as Error).message)
        return
      }
    }

    // 附件已落在 Agent 工作区，正文只带相对路径，Agent 用 file 工具读取。
    const content = pendingAttachments.length > 0
      ? `${typed}\n\n[附件（在工作区内，可用文件工具读取）]\n${pendingAttachments.map((item) => `- ${item.path}`).join("\n")}`.trim()
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
      if (event.type === "done") {
        const promptTokens = event.usage?.prompt_tokens
        const completionTokens = event.usage?.completion_tokens
        if (
          typeof promptTokens === "number" && Number.isFinite(promptTokens) && promptTokens >= 0 &&
          typeof completionTokens === "number" && Number.isFinite(completionTokens) && completionTokens >= 0
        ) {
          setLatestUsage({
            promptTokens,
            completionTokens,
            totalTokens: Number(event.usage?.total_tokens) || promptTokens + completionTokens,
            cachedTokens: Number(event.usage?.cached_tokens) || 0,
            cacheCreationTokens: Number(event.usage?.cache_creation_tokens) || 0,
            reasoningTokens: Number(event.usage?.reasoning_tokens) || 0,
          })
        }
      }
      setMessages((prev) => {
        if (event.type === "done" && event.model) {
          return prev.map((m) =>
            m.id === assistantId
              ? applyAssistantEvent({ ...m, model: m.model || event.model }, event)
              : m,
          )
        }
        return prev.map((m) => (m.id === assistantId ? applyAssistantEvent(m, event) : m))
      })
    }

    try {
      const goalConfig: AgentGoalConfig | undefined =
        execMode === "goal"
          ? {
              objective: goalObjective.trim() || content,
              budget_seconds: Math.max(60, Math.round(goalBudgetMinutes * 60)),
            }
          : undefined
      const { response, abort } = sendMessageStream(convId, content, undefined, undefined, reasoningEffort, execMode, goalConfig)
      abortRef.current = abort
      const resp = await response
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`)
      }
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
            // ignore malformed line
          }
        }
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId && m.status === "streaming" ? { ...m, status: "done" } : m)),
      )
    } catch (e) {
      const errMsg = (e as Error).message
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, status: "error", error: errMsg } : m)),
      )
    } finally {
      setLoading(false)
      abortRef.current = null
      // 只静默同步标题/时间，不显示加载态，避免看起来像整页刷新。
      if (convId) {
        void getConversationMeta(convId).then(upsertConversation).catch(() => {})
      }
    }
  }, [convModel, reasoningEffort, execMode, goalObjective, goalBudgetMinutes, loading, selectedAgentId, activeConvId, upsertConversation])

  const retryMessage = useCallback(async (message: AgentDisplayMessage) => {
    if (loading || message.role !== "assistant" || message.status !== "error") return
    if (!activeConvId) {
      toast.error("请先选择一个 Agent 对话")
      return
    }
    try {
      const persisted = await getConversation(activeConvId)
      const failed = [...persisted.messages].reverse().find((item) => item.role === "assistant" && item.status === "error")
      if (!failed) {
        toast.error("找不到可重试的消息")
        return
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
      setMessages((prev) => [...prev.filter((m) => m.id !== message.id), assistantMsg])
      setLoading(true)

      const applyEvent = (event: AgentStreamEvent) => {
        if (event.type === "done") {
          const promptTokens = event.usage?.prompt_tokens
          const completionTokens = event.usage?.completion_tokens
          if (
            typeof promptTokens === "number" && Number.isFinite(promptTokens) && promptTokens >= 0 &&
            typeof completionTokens === "number" && Number.isFinite(completionTokens) && completionTokens >= 0
          ) {
            setLatestUsage({
              promptTokens,
              completionTokens,
              totalTokens: Number(event.usage?.total_tokens) || promptTokens + completionTokens,
              cachedTokens: Number(event.usage?.cached_tokens) || 0,
              cacheCreationTokens: Number(event.usage?.cache_creation_tokens) || 0,
              reasoningTokens: Number(event.usage?.reasoning_tokens) || 0,
            })
          }
        }
        setMessages((prev) => {
          if (event.type === "done" && event.model) {
            return prev.map((m) =>
              m.id === assistantId
                ? applyAssistantEvent({ ...m, model: m.model || event.model }, event)
                : m,
            )
          }
          return prev.map((m) => (m.id === assistantId ? applyAssistantEvent(m, event) : m))
        })
      }

      const { response, abort } = retryConversationMessage(activeConvId, failed.id)
      abortRef.current = abort
      const resp = await response
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`)
      }
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
            // ignore malformed line
          }
        }
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId && m.status === "streaming" ? { ...m, status: "done" } : m)),
      )
    } catch (e) {
      const errMsg = (e as Error).message
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, status: "error", error: errMsg } : m)),
      )
    } finally {
      setLoading(false)
      abortRef.current = null
      if (activeConvId) {
        void getConversationMeta(activeConvId).then(upsertConversation).catch(() => {})
      }
    }
  }, [activeConvId, loading, upsertConversation])

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  )

  // 可选 Agent：首屏卡片列表与切换菜单同一个来源，只列启用的。
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents])

  // 选中的 Agent 变化：默认模型回退到 Agent 的 main_model，并拉该 key 白名单内的可选模型。
  useEffect(() => {
    if (!selectedAgent) {
      setAgentModels([])
      return
    }
    if (!convModel) setConvModel(selectedAgent.main_model || selectedAgent.model || "")
    const apiKeyId = selectedAgent.main_api_key_id
    if (!apiKeyId) {
      setAgentModels([{ value: selectedAgent.main_model || selectedAgent.model || "", label: selectedAgent.main_model || "默认模型" }])
      return
    }
    listChatModels(apiKeyId)
      .then((list) => setAgentModels(list.map((item) => ({
        value: item.id,
        label: item.name || item.remark || item.id,
        description: item.description || undefined,
        maxContextTokens: Number(item.max_context_tokens) || undefined,
      }))))
      .catch(() => setAgentModels([{ value: selectedAgent.main_model || selectedAgent.model || "", label: selectedAgent.main_model || "默认模型" }]))
  }, [selectedAgent, convModel])

  // 进度圈口径：当前轮实际输入 token / 当前模型上下文上限。
  const currentModelMaxTokens = useMemo(
    () => agentModels.find((item) => item.value === convModel)?.maxContextTokens,
    [agentModels, convModel],
  )

  async function handleSwitchModel(nextModel: string) {
    if (!nextModel || nextModel === convModel) return
    setConvModel(nextModel)
    if (activeConvId) {
      try {
        await updateConversation(activeConvId, { model: nextModel })
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
  }

  async function handleSwitchReasoningEffort(nextEffort: ReasoningEffort) {
    setReasoningEffort(nextEffort)
    if (activeConvId) {
      try {
        await updateConversation(activeConvId, { reasoning_effort: nextEffort })
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
  }

  async function ensureAttachmentConversation() {
    if (activeConvId) return activeConvId
    if (creatingConversationRef.current) return creatingConversationRef.current
    if (!selectedAgentId) throw new Error("请先选择 Agent")
    const pending = createConversation({ agent_id: selectedAgentId, model: convModel || undefined, reasoning_effort: reasoningEffort })
      .then((conv) => {
        setActiveConvId(conv.id)
        upsertConversation(conv)
        return conv.id
      })
      .finally(() => { creatingConversationRef.current = null })
    creatingConversationRef.current = pending
    return pending
  }

  async function uploadAttachment(file: File, onProgress: (percent: number) => void) {
    const convId = await ensureAttachmentConversation()
    return uploadAgentConversationAttachment(convId, file, onProgress)
  }

  // 智能任务快捷入口：会话已在入口建好并带 ?conversationId&send=，进来后自动发首条。
  const autoSentRef = useRef(false)
  useEffect(() => {
    if (autoSentRef.current || !initialSendText || !activeConvId) return
    autoSentRef.current = true
    const text = initialSendText
    const next = new URLSearchParams(searchParams)
    next.delete("send")
    setSearchParams(next, { replace: true })
    void handleSend(text)
  }, [initialSendText, activeConvId, searchParams, setSearchParams, handleSend])

  // 历史会话的翻页/加载态已经收进 AgentHistoryPanel；这里只保留一份会话列表，
  // 用于 ?conversationId= 深链恢复和发送后就地 upsert 标题，不再自己翻页。


  return (
    <div className="flex h-full min-h-0">
      {/* 主区：与首页智能任务一致的留白消息流 + 圆角悬浮输入框 */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
        {view === "picker" ? (
          /* 首屏 Agent 选择（与气泡面板 showPicker 同款）：没有明确选择时先选人，
             不默认挑第一个 Agent —— 免得用错 Agent 发出第一条消息。 */
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-6 animate-in fade-in duration-150">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">选择一个 Agent</div>
                <div className="mt-1 text-xs text-muted-foreground">选中后进入对话，也可以打开管理页完成增删改。</div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => { setManagerInitialCreate(true); setManagerOpen(true) }}>
                  <Plus className="size-4" />
                  新建 Agent
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setManagerInitialCreate(false); setManagerOpen(true) }}>管理 Agent</Button>
              </div>
            </div>
            {enabledAgents.length === 0 ? (
              <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">暂无可用 Agent</p>
                  <p className="mt-1 text-xs">请先在 Agent 管理页创建一个，并绑定网关 Key 与模型。</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid gap-2 pr-3 sm:grid-cols-2">
                  {enabledAgents.map((agent) => {
                    const active = agent.id === selectedAgentId
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        className={`flex min-w-0 flex-col items-start gap-1 rounded-xl border bg-background p-3 text-left transition-colors animate-in fade-in slide-in-from-bottom-1 duration-150 ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary hover:bg-primary/5"}`}
                        onClick={() => handleSelectAgent(agent.id)}
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {agent.display_name || agent.name}
                          </span>
                          {active && <Check className="size-4 shrink-0 text-primary" />}
                        </span>
                        <span className="line-clamp-2 w-full text-xs text-muted-foreground">
                          {agent.description || agent.main_model || agent.model || "未填写描述"}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : (
        <>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 animate-in fade-in duration-150">
          {/* 切换 Agent：菜单图标（与气泡面板标题栏同语义）。会话历史从原左侧常驻栏
              改为标题栏按钮弹出，与气泡共用 AgentHistoryPanel 一个实现。 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" title="切换 Agent">
                <Menu className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              <DropdownMenuLabel>切换 Agent</DropdownMenuLabel>
              {enabledAgents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => handleSelectAgent(agent.id)}
                  className="min-w-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{agent.display_name || agent.name}</span>
                    {agent.description && (
                      <span className="truncate text-xs text-muted-foreground">{agent.description}</span>
                    )}
                  </span>
                  {agent.id === selectedAgentId && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setView("picker")}>
                <LayoutGrid className="size-4" /> 全部 Agent
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setManagerOpen(true)}>
                <SlidersHorizontal className="size-4" /> 管理 Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium">
                {selectedAgent?.display_name || selectedAgent?.name || "Agent 对话"}
              </div>
            </div>
            {/* 这里只写 Agent 描述：模型由输入区的模型下拉显示，标题栏再写一遍
                就是同一个值出现两处，切换后还容易看着不一致。 */}
            <div className="truncate text-xs text-muted-foreground">
              {selectedAgent?.description || "描述需求，Agent 会调用工具完成任务"}
            </div>
          </div>
          {loading && <Spinner className="size-4" />}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-lg"
            onClick={() => handleNewConversation()}
            disabled={!selectedAgentId}
            title={selectedAgent ? `新建 ${selectedAgent.display_name || selectedAgent.name} 对话` : "先选择一个 Agent"}
          >
            <Plus className="size-4" />
          </Button>
          <AgentHistoryPanel
            agentId={selectedAgentId}
            activeConversationId={activeConvId}
            onSelect={(conversationId) => void selectConversation(conversationId)}
            onDeleted={(conversationId) => {
              if (activeConvId === conversationId) handleNewConversation()
            }}
            variant="icon"
            align="end"
            side="bottom"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            disabled={!selectedAgentId}
            onClick={() => setScheduledTasksOpen(true)}
            title={selectedAgent ? `管理 ${selectedAgent.display_name || selectedAgent.name} 的定时任务` : "先选择一个 Agent"}
          >
            <Clock className="size-3.5" /> 定时任务
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            disabled={!selectedAgentId}
            onClick={() => setManagerOpen(true)}
            title={selectedAgent ? `配置 ${selectedAgent.display_name || selectedAgent.name}` : "先选择一个 Agent"}
          >
            <SlidersHorizontal className="size-3.5" /> Agent 设置
          </Button>
        </div>
        <div ref={messageScrollRef} className="relative min-h-0 flex-1">
          <ScrollArea className="h-full" onScrollCapture={handleMessageScroll}>
            <div className="flex w-full flex-col gap-6 px-3 pt-6 pb-24">
            {messages.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {selectedAgent ? `与 ${selectedAgent.display_name || selectedAgent.name} 开始新对话` : "选择一个 Agent"}
                  </p>
                  <p className="mt-1 text-xs">输入需求后，Agent 会在这里展示思考、工具调用和子 Agent 进度。</p>
                </div>
              </div>
            ) : (
              (() => {
                const lastAssistantId = [...messages].reverse().find((mm) => mm.role === "assistant")?.id
                return messages.map((m) => (
                  <AgentMessageBubble
                    key={m.id}
                    message={m}
                    onApproval={resolveApprovalFn}
                    onRetry={m.id === lastAssistantId ? retryMessage : undefined}
                  />
                ))
              })()
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
          <TurnNavigator
            entries={turnEntries}
            getScrollContainer={() => messageScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") || null}
            hasMore={messageHasMore}
            loadingMore={messageLoadingMore}
            onLoadOlder={loadOlderMessages}
          />
        </div>
        {/* 悬浮居中输入框，与节点气泡同款：贴底、半透明毛玻璃。 */}
        <div className="pointer-events-none sticky bottom-3 z-10 mx-auto w-full max-w-[860px] px-3">
          <MessageComposer
            className="pointer-events-auto rounded-2xl bg-background/90 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75"
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStop={handleStop}
            loading={loading}
            disabled={!selectedAgentId}
            uploadFile={uploadAttachment}
            uploadEnabled={!!selectedAgentId}
            maxFileSize={10 * 1024 * 1024}
            maxFiles={10}
            resetKey={composerResetKey}
            attachmentName={(attachment) => attachment.filename}
            modelValue={convModel}
            modelOptions={agentModels}
            onSwitchModel={(model) => void handleSwitchModel(model)}
            beforeModelActions={
              <div className="flex items-center gap-1">
                <ReasoningEffortMenu value={reasoningEffort} onChange={(effort) => void handleSwitchReasoningEffort(effort)} />
                <AgentModeMenu value={execMode} onChange={setExecMode} />
                {execMode === "goal" && (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      className="h-7 w-40 rounded-full border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      placeholder="目标（一句话）"
                      value={goalObjective}
                      onChange={(e) => setGoalObjective(e.target.value)}
                    />
                    <input
                      type="number"
                      min={1}
                      className="h-7 w-14 rounded-full border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      placeholder="分钟"
                      value={goalBudgetMinutes}
                      onChange={(e) => setGoalBudgetMinutes(Math.max(1, Number(e.target.value) || 15))}
                    />
                    <span className="shrink-0 text-[11px] text-muted-foreground">分钟</span>
                  </div>
                )}
              </div>
            }
            leftActions={
              <TokenProgressPopover
                inputTokens={latestUsage?.promptTokens}
                outputTokens={latestUsage?.completionTokens}
                totalTokens={latestUsage?.totalTokens}
                cachedTokens={latestUsage?.cachedTokens}
                cacheCreationTokens={latestUsage?.cacheCreationTokens}
                reasoningTokens={latestUsage?.reasoningTokens}
                maxTokens={currentModelMaxTokens}
              />
            }
          />
        </div>
        </>
        )}
      </div>

      <AgentManagerDialog
        open={managerOpen}
        onOpenChange={(open) => { setManagerOpen(open); if (!open) setManagerInitialCreate(false) }}
        initialAgentId={selectedAgentId}
        initialCreate={managerInitialCreate}
        showAgentList
        onChanged={refreshAgents}
      />

      <ScheduledTasksDialog
        open={scheduledTasksOpen}
        onOpenChange={setScheduledTasksOpen}
        agentId={selectedAgentId}
        agentName={selectedAgent?.display_name || selectedAgent?.name}
      />
    </div>
  )
}
