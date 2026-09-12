import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconChevronDown } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  cancelUserTask,
  listUserTaskEvents,
  newClientMessageId,
  sendUserTaskMessage,
  uploadUserTaskAttachment,
  userTaskEventsUrl,
  type UserTaskAttachment,
  type UserTaskEventRow,
} from "@/api/userTaskClient"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { PlanStepsBlock } from "@/components/console/task/chat-panel"
import type { TaskPlan } from "@/components/console/task/task-shared"
import {
  EditorSessionStreamClient,
  type EditorSessionSubAgent,
} from "@/components/console/editor/editor-session-stream-client"
import {
  collapseErrorDuplicates,
  parseIsoToSeconds,
  reduceItems,
  type AgentId,
  type NormalizedItem,
} from "@/components/console/task/item-to-message"
import { SubagentSideRail } from "@/components/console/task/subagent-side-rail"
import { SubagentConversationPanel } from "@/components/console/task/subagent-conversation-panel"
import { SubagentInlineEntry } from "@/components/console/task/subagent-inline-entry"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TokenProgressPopover } from "@/components/console/agent/token-progress-popover"
import MessageComposer from "@/components/console/chat/message-composer"
import { ReasoningEffortMenu, type ReasoningEffort } from "@/components/console/chat/reasoning-effort"
import { TurnNavigator } from "@/components/console/chat/turn-navigator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { formatTokens } from "@/utils/common"
import { isClaudeReservedModelAlias, CLAUDE_RESERVED_MODEL_HINT } from "@/utils/claude-models"

/**
 * 任务对话面板。实时轮次来自任务的 SSE 事件流（节点运行时事件被后端桥接成 JSON，
 * 归一为共享 MessageType）；历史轮次从任务的网关请求日志重建，所以刚打开的任务也能
 * 看到过往对话。两者都喂给共享的消息渲染器（MessageItem/MessageType）。
 *
 * 流式 reducer 直接复用编辑器侧的 EditorSessionStreamClient——任务事件流与编辑器会话
 * 事件流后端都桥接同一个 follow_session_events，事件 JSON 形状完全一致，只是 URL 不同。
 */

/**
 * Rebuild one visible message from a persisted conversation item.
 *
 * The stored shape is the same normalized `item` the live stream carries (see
 * EditorSessionStreamClient), so replay and live rendering agree by construction
 * instead of each decoding a provider's own shape. One row is one item; the
 * item's own `id` is reused so a re-sent item replaces rather than duplicates.
 */
/** Parse one persisted row into the shared NormalizedItem + agentId shape. */
function rowToItem(row: UserTaskEventRow): { item: NormalizedItem; agentId: AgentId; seq: number } | null {
  const root = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {}
  const rawItem = root.item && typeof root.item === "object" ? root.item as Record<string, unknown> : null
  if (!rawItem) return null
  // The join key is the merge identity for append-only frames. The item usually
  // carries it as `id`, but a `content_unavailable` marker (or a frame written
  // before the id was threaded) leaves it empty — fall back to the row-level
  // `logical_event_id` so the reducer still keys all of one item's frames
  // together and the card renders once, not once per frame.
  const logicalId = typeof row.logical_event_id === "string" && row.logical_event_id
    ? row.logical_event_id
    : (typeof root.logical_event_id === "string" ? root.logical_event_id : "")
  if (logicalId && !(typeof rawItem.id === "string" && rawItem.id)) {
    rawItem.id = logicalId
  }
  // `subagent_id` is the single routing fact (empty = root transcript,
  // non-empty = that sub-agent's detail). The history endpoint backfills it
  // from the legacy `agent_id` alias for rows written before the field
  // existed, so this reader never guesses.
  const subagentId = typeof root.subagent_id === "string" ? root.subagent_id : ""
  // The row's own persisted timestamp is the honest time this frame happened —
  // it is what itemToRootMessage threads onto message.time so the transcript
  // shows real wall-clock instead of 1970. Parsed here, where the row is
  // decoded, because that is the layer that owns the timestamp.
  const createdAt = parseIsoToSeconds(row.created_at)
  if (createdAt) (rawItem as { created_at?: number }).created_at = createdAt
  return {
    item: rawItem as unknown as NormalizedItem,
    agentId: subagentId,
    seq: row.seq,
  }
}

/** Reduce persisted rows into (messages, subAgents) via the shared mapper. */
function eventRowsToMessages(rows: UserTaskEventRow[]): {
  messages: MessageType[]
  subAgents: EditorSessionSubAgent[]
} {
  const items = rows.map(rowToItem).filter(Boolean) as { item: NormalizedItem; agentId: AgentId; seq: number }[]
  return reduceItems(items)
}

const PAGE_SIZE = 50

const IN_FLIGHT_DELIVERY = new Set(["pending", "dispatching", "received", "running"])

/** 从历史消息的最新投递状态恢复页面打开时的当前轮次状态。 */
function turnRunningFromHistory(rows: UserTaskEventRow[]): boolean {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const status = String(rows[index]?.delivery_status || "").toLowerCase()
    if (status) return IN_FLIGHT_DELIVERY.has(status)
  }
  return false
}

export default function TaskWorkspaceChat({
  taskId,
  status,
  nodeSessionId,
  nodeId,
  dispatchError,
  runtimeStage,
  active,
  contextUsage,
  onContextUsage,
  onSubAgents,
  onPendingApprovals,
  modelLabel,
  models,
  onSwitchModel,
  onAddModel,
  modeOptions,
  onSwitchMode,
  reasoningEffort,
  onSwitchReasoningEffort,
  onRestartRuntime,
  onStartRuntime,
  totalTokens = 0,
  modelMaxTokens,
  activeSubAgentId,
  onSelectSubAgent,
  onSessionTerminal,
}: {
  taskId: string
  /** 任务状态（pending / processing / finished / error），决定是否可发消息。 */
  status: string
  /** 活跃运行时句柄；为空表示任务没派发，不能开 SSE 也不能发消息。 */
  nodeSessionId?: string | null
  /** 任务绑定的执行节点；有节点但无 session 时允许首条消息懒派发。 */
  nodeId?: string | null
  /** 派发失败原因（workspace_state=dispatch_failed 时非空）。 */
  dispatchError?: string | null
  /**
   * 节点上报的最近一步准备阶段（准备工作目录 / 拉取代码 / 检查运行环境 / 启动运行环境）。
   * 用来在失败时指出「卡在哪一步」，而不是只说一句失败。
   */
  /**
   * 节点上报的环境准备步骤。`preparing` 为真表示还在准备（未失败、未就绪），
   * 此时任务不可输入；`ok===false` 表示卡在 `label` 这一步，`detail` 是原因。
   */
  runtimeStage?: {
    stage?: string | null
    label?: string | null
    ok?: boolean
    detail?: string | null
    index?: number
    total?: number
    preparing?: boolean
  } | null
  active: boolean
  /** 当前上下文窗口占用（由父组件持有，流变化时同步）。 */
  contextUsage?: { size: number | null; used: number | null }
  /** 流上报的上下文窗口占用，上抛给工作区。 */
  onContextUsage?: (usage: { size: number | null; used: number | null }) => void
  /** 本任务流里出现的子 Agent，上抛给工作区侧栏。 */
  onSubAgents?: (agents: EditorSessionSubAgent[]) => void
  /** 等待用户裁决的审批 id，上抛用于红点提醒。 */
  onPendingApprovals?: (ids: string[]) => void
  /** 当前模型/模式的可读标签，在输入框工具区显示。 */
  modelLabel?: { model?: string | null; mode?: string | null }
  /** 当前任务允许切换的模型集合。 */
  models?: string[]
  /** 模型切换回调；任务无运行时也可先改快照。 */
  onSwitchModel?: (modelId: string) => void | Promise<void>
  /** 模型菜单里的「添加模型…」入口。 */
  onAddModel?: () => void
  /** 可选模式集合（value/label）；空则不展示模式切换。 */
  modeOptions?: Array<{ value: string; label: string }>
  /** 模式切换回调；写任务快照，下一轮消息生效。 */
  onSwitchMode?: (mode: string) => void | Promise<void>
  /** 任务级思考等级；写任务配置快照，下一轮消息生效。 */
  reasoningEffort?: ReasoningEffort
  onSwitchReasoningEffort?: (effort: ReasoningEffort) => void | Promise<void>
  /** 重启运行时（清空上下文）回调。 */
  onRestartRuntime?: () => void | Promise<void>
  /** 为存储态任务启动或重试运行时。 */
  onStartRuntime?: () => void | Promise<void>
  /** 该任务累计消耗 token 数，输入区显示。 */
  totalTokens?: number
  /** 当前模型最大上下文 token（来自任务父 Key 的模型列表）。 */
  modelMaxTokens?: number
  /** 选中查看的子 Agent id；空表示未打开任何子 Agent 详情。
   * 子 Agent 列表由本组件自己从「回放 + 实时」合并得出（不再由父组件传入），
   * 因为只有这里同时握有两个来源；父组件仍通过 onSubAgents 拿到合并结果。 */
  activeSubAgentId?: string | null
  /** 点击子 Agent 块查看其对话；null 表示返回主对话。 */
  onSelectSubAgent?: (id: string | null) => void
  /** 会话终止（result 帧）时回调：任务状态已在服务端落库，用于回拉详情刷新状态徽标。 */
  onSessionTerminal?: () => void
}) {
  // Conversation history comes from ONE source: the persisted item timeline
  // (mc_task_events). request_logs is billing/attempt telemetry — mixing it in
  // duplicated replies and turned each upstream retry into its own bubble.
  const [eventRows, setEventRows] = useState<UserTaskEventRow[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  // 空态重试按钮的短暂 pending，避免连点触发多次派发。
  const [retrying, setRetrying] = useState(false)
  const [draft, setDraft] = useState("")
  const [liveMessages, setLiveMessages] = useState<MessageType[]>([])
  const [liveSubAgents, setLiveSubAgents] = useState<EditorSessionSubAgent[]>([])
  const [plan, setPlan] = useState<TaskPlan>({ entries: [], version: 0 })
  const [running, setRunning] = useState(false)
  const [compactPending, setCompactPending] = useState(false)
  // 实时事件流上报的终态错误（如节点控制面不可用）。SSE 在流内通过
  // event: error 抛出，没有这条 banner 用户只会看到「连接断开」却不知真因。
  const [streamError, setStreamError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 子 Agent 会话面板会卸载主对话的 ScrollArea，返回时重新挂载会让 scrollTop 归零
  // （跟随尾部的 effect 只在接近底部时才滚，所以停在顶部）。离开前记下当前
  // scrollTop 与所点子 Agent 卡片 id，返回时优先滚到那张卡片、卡片不在视口
  // （翻页出去了）则恢复上次位置——用户从哪里点进去，就回到哪里。
  const mainScrollRestoreRef = useRef<{ scrollTop: number; cardId: string | null } | null>(null)
  const prevActiveSubAgentRef = useRef<string | null>(activeSubAgentId ?? null)
  const clientRef = useRef<EditorSessionStreamClient | null>(null)
  // 最近一次发出去的轮次（原文 + 附件 + 幂等键）。失败后的「重新发送」重发的
  // 是这一条而不是另造一句 prompt —— 用 ref 而非 state：只在点击时读取，不该
  // 触发重渲染。clientMessageId 必须复用：重试走后端 failed→pending(attempt+1)
  // 路径，换 id 会变成一条新消息、旧气泡也不去重了。
  const lastTurnRef = useRef<{
    content: string
    attachments: UserTaskAttachment[]
    clientMessageId: string
  } | null>(null)
  const hasRuntime = Boolean(nodeSessionId)
  const hasNode = Boolean(nodeId)
  // 节点还在准备环境（建目录 / 拉代码 / 检查并启动运行环境）时不能收消息：
  // runtime 进程尚未就绪，此刻发送只会 409 或写进一个马上被替换的 stdin。
  // 服务端已经算好 preparing，前端不再自己按阶段名推导，避免两边判断漂移。
  const preparing = Boolean(runtimeStage?.preparing)
  // 能否发消息：唯一硬门禁是「节点是否可用」与「运行时是否在准备」。后端
  // send_task_message 对任何非删除任务都自动恢复运行时（stopped/finished/error
  // 发消息即接着上次继续），所以这四个状态都能输入——状态只影响徽标与按钮
  // 文案，不影响能否发送。无节点（被删/吊销）才是真的不能发。
  const canSend = hasNode && !preparing
  const canStart = !hasRuntime && canSend
  const canRestartAfterError = hasRuntime && status === "error" && Boolean(onRestartRuntime)
  // canStream = 有活跃运行时才能开 SSE 跟流；终态任务（stopped/finished 无
  // runtime）不连流，但输入框仍可用——发消息会由后端恢复运行时，再由详情
  // 刷新把 node_session_id 回填，SSE 这时才连上。
  const canStream = hasRuntime && !preparing
  const canInteract = canSend
  // 模型可选多个而当前没选：发送前必须先挑一个（用户要求「警告让我选择模型」，
  // 而不是停在「不限制」态默默发出去）。快照为空 = 不限制，只在可选项 ≥2 时
  // 强制选——单模型没有选择余地、零个无从选起，都静默放行走默认。
  const requireModel = (models || []).length > 1 && !modelLabel?.model
  // 上下文用量：流上报 size/used 时用它做进度；否则回退累计 token 作输入、上限未知。
  const ctxSize = contextUsage?.size ?? 0
  const ctxUsed = contextUsage?.used ?? 0

  // 任务处于「跑不起来」的各形态时，空态要给用户的一句话 + 一个动作。
  // 终态（stopped/finished/error）的恢复统一走发消息；但「环境准备失败/派发失败」
  // 是还没有对话的空任务，发消息无从谈起，所以这两个分支保留重试按钮。
  const blocked = useMemo(() => {
    const runStart = () => {
      if (!onStartRuntime) return
      void Promise.resolve(onStartRuntime()).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "启动失败"))
    }
    const runRestart = () => {
      if (!onRestartRuntime) return
      void Promise.resolve(onRestartRuntime()).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "重新运行失败"))
    }
    // 终态（stopped / finished / error）：历史只读展示，但输入框仍可用。
    if (status === "stopped") {
      return {
        title: "任务已停止",
        reason: canSend
          ? "运行时已释放，工作区与对话都保留。发送消息即可继续。"
          : "运行时已释放；任务没有可用执行节点，请联系管理员。",
      }
    }
    if (status === "finished") {
      return {
        title: "任务已完成",
        reason: canSend
          ? "本轮对话已结束。发送新消息可在同一工作区继续。"
          : "本轮对话已结束；任务没有可用执行节点，无法继续。",
      }
    }
    // 环境准备失败（某一步 ok=false）：标题写卡在哪一步，原因放可滚动框，
    // 并给重试按钮——重试动作按是否还有运行时句柄选「重启」或「重新派发」。
    if (runtimeStage && runtimeStage.ok === false) {
      const canRetry = hasRuntime ? Boolean(onRestartRuntime) : canSend
      return {
        title: `环境准备失败 · ${runtimeStage.label || "未知步骤"}`,
        reason: runtimeStage.detail || dispatchError || "未返回具体原因。",
        actionLabel: canRetry ? "重试" : "",
        onAction: canRetry ? (hasRuntime ? runRestart : runStart) : null,
      }
    }
    if (status === "error" && !canRestartAfterError && !canStart) {
      // 异常但无法自动重试（节点被删/吊销等）：给原因，无按钮。
      return {
        title: "任务异常",
        reason: dispatchError || "运行时报错，未返回具体原因。发送消息即可重试。",
      }
    }
    // 环境还在准备：运行时没起来，发消息会失败，只展示进度。
    if (preparing && runtimeStage) {
      const step = runtimeStage.index && runtimeStage.total
        ? `（第 ${runtimeStage.index}/${runtimeStage.total} 步）`
        : ""
      return {
        title: `正在准备运行环境${step}`,
        reason: runtimeStage.detail || `${runtimeStage.label || "准备中"}…请稍候，准备好后即可开始对话。`,
      }
    }
    if (canRestartAfterError) {
      // 会话派发成功但 agent 启动失败，原因已由服务端翻译成用户语言。
      return {
        title: "任务没能运行起来",
        reason: dispatchError || "节点的运行环境启动失败，未返回具体原因。",
        actionLabel: "重试",
        onAction: runRestart,
      }
    }
    if (!hasRuntime && dispatchError && canStart) {
      return {
        title: "任务没能运行起来",
        reason: dispatchError,
        actionLabel: "重试",
        onAction: runStart,
      }
    }
    if (!hasRuntime && dispatchError) {
      // 没有句柄且不可重试：通常是节点被删/吊销，重建任务才有解。
      return {
        title: "任务没能运行起来",
        reason: `${dispatchError}（当前无法自动重试，请联系管理员处理节点后再试）`,
      }
    }
    if (!hasRuntime && canStart) {
      return {
        title: "任务还没开始",
        reason: "发送第一条消息即可开始运行。",
      }
    }
    if (!hasRuntime && hasNode) {
      return {
        title: "任务还没开始",
        reason: "任务尚未调度到节点，请稍后重试。",
      }
    }
    if (!hasRuntime) {
      return {
        title: "任务没有可用的执行节点",
        reason: "请联系管理员为任务分配执行节点。",
      }
    }
    return null
  }, [canRestartAfterError, canStart, canSend, dispatchError, hasNode, hasRuntime, onRestartRuntime, onStartRuntime, preparing, runtimeStage, status])

  // 「轮次在途」只在真有流可跟时成立。放 ref 读最新值，而不是进 load 的依赖：
  // 后者会让每次运行时翻转都重建 load，把下面的「运行时从无到有重拉一次」变成
  // 每次状态抖动都重拉。
  const canStreamRef = useRef(canStream)
  canStreamRef.current = canStream
  // 已经首屏加载过的任务 id。重拉（运行时就绪、发完首条补拉）不该再挂全屏
  // spinner —— 那会把已经读到的对话整块换成加载态，闪一下再回来。
  const loadedTaskRef = useRef<string | null>(null)

  const load = useCallback(async (before: number | null, append: boolean, silent = false) => {
    const viewport = append ? scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") : null
    const previousHeight = viewport?.scrollHeight || 0
    if (append) setHistoryLoading(true)
    else if (!silent) setLoading(true)
    try {
      const page = await listUserTaskEvents(taskId, before ?? undefined, PAGE_SIZE)
      const rows = page.rows || []
      setHistoryCursor(page.next_before ?? null)
      setHasMoreHistory(Boolean(page.next_before))
      // Rows arrive oldest-first within a page; older pages prepend.
      setEventRows((current) => append ? [...rows, ...current] : rows)
      // 轮次在途状态只能由历史投递状态恢复（SSE 只播报它连接之后的帧，从外部
      // 进入一个正在运行的任务时 agent_turn_started 早已错过）——只在首页加载
      // 时推导一次，翻页不覆盖。没有流可跟时一律不在途：终态任务的历史里可能
      // 留着一条 running 的投递行（进程被杀，状态没来得及收尾）。
      if (!append) setRunning(canStreamRef.current ? turnRunningFromHistory(rows) : false)
      if (append) requestAnimationFrame(() => { if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight })
    } catch (error) {
      if (!append && !silent) toast.error(error instanceof Error ? error.message : "加载任务对话失败")
    } finally {
      if (append) setHistoryLoading(false)
      else if (!silent) setLoading(false)
    }
  }, [taskId])

  // 首屏加载，以及运行时从无到有时再拉一次。后者覆盖「首条消息已落库但首屏
  // load 跑得太早没读到」的窗口：空任务发首条、准备中→就绪、懒启动派发成功都会
  // 让 hasRuntime 翻 true，此刻重拉把提问补上——正是旧的「有答无问」症状。
  useEffect(() => {
    const silent = loadedTaskRef.current === taskId
    loadedTaskRef.current = taskId
    void load(null, false, silent)
  }, [load, taskId, hasRuntime])

  // 「轮次在途」只在真的有运行时可跟流时成立。任务进入终态（stopped/finished/
  // error，runtime 已释放）时必须清掉，否则历史推导出的 running 会让一个已停止
  // 的任务永远停在「正在生成…」。
  useEffect(() => {
    if (!canStream) setRunning(false)
  }, [canStream])

  // 父组件回调放 ref：每次渲染新建的内联函数不该拆掉重连事件流。
  const onContextUsageRef = useRef(onContextUsage)
  const onSubAgentsRef = useRef(onSubAgents)
  const onPendingApprovalsRef = useRef(onPendingApprovals)
  const onSessionTerminalRef = useRef(onSessionTerminal)
  onContextUsageRef.current = onContextUsage
  onSubAgentsRef.current = onSubAgents
  onPendingApprovalsRef.current = onPendingApprovals
  onSessionTerminalRef.current = onSessionTerminal

  // 实时事件流：必须有活跃运行时；存储态任务不应请求 /events（会 409 并重连）。
  // 用 canStream（hasRuntime && !preparing）而非 canInteract：终态任务（stopped/
  // finished 无 runtime）输入框仍可用，但没有运行时就没有流可跟——发消息恢复
  // 运行时后，详情刷新回填 node_session_id，canStream 翻 true 才连上。
  useEffect(() => {
    if (!active || !canStream) {
      clientRef.current?.close()
      clientRef.current = null
      return
    }
    const client = new EditorSessionStreamClient(
      userTaskEventsUrl(taskId),
      (state) => {
        setLiveMessages(state.messages)
        setLiveSubAgents(state.subAgents)
        setPlan(state.plan)
        setRunning(state.running)
        onContextUsageRef.current?.(state.contextUsage)
        onSubAgentsRef.current?.(state.subAgents)
        onPendingApprovalsRef.current?.(state.pendingApprovals)
        setStreamError(state.error)
      },
      () => onSessionTerminalRef.current?.(),
    )
    clientRef.current = client
    client.connect()
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [active, canStream, taskId])

  // The conversation is the union of the persisted item timeline and the live
  // SSE deltas. Both speak the same normalized item shape, so they concatenate
  // directly — no per-source decoding, no merge dedup, no second history source.
  const replay = useMemo(() => eventRowsToMessages(eventRows), [eventRows])
  const allSubAgents = useMemo(() => {
    // Live sub-agents override persisted ones (they carry fresher content/status);
    // persisted ones fill any id not yet seen live so a refresh keeps the list.
    const map = new Map<string, EditorSessionSubAgent>()
    for (const agent of replay.subAgents) map.set(agent.id, agent)
    for (const agent of liveSubAgents) map.set(agent.id, agent)
    return [...map.values()]
  }, [replay.subAgents, liveSubAgents])
  // 子 Agent id 集合。主 Agent 派发子 Agent 的那次 Agent tool_use，其 id 就是
  // subagent_id（runtime 按 parent_tool_use_id 关联两者），用它识别派发帧。
  const subAgentIds = useMemo(() => new Set(allSubAgents.map((a) => a.id)), [allSubAgents])
  // Live entries supersede persisted ones with the same id instead of stacking
  // beside them. Both sources describe the same turn: the message the user just
  // sent is appended optimistically *and* recorded server-side, and every live
  // item is persisted as it arrives. Concatenating meant each of those appeared
  // twice the moment history was (re)loaded — most visibly as a duplicated
  // instruction after paging up. Live wins because it is the fresher copy.
  const messages = useMemo(() => {
    const byId = new Map<string, MessageType>()
    for (const message of replay.messages) byId.set(message.id, message)
    for (const message of liveMessages) byId.set(message.id, message)
    // 同一轮失败的 provider 文本 / error 帧 / live 帧（id 各异）在 union 后仍是
    // 多条同文消息；这里统一折叠成一张错误卡。
    return collapseErrorDuplicates([...byId.values()])
  }, [replay.messages, liveMessages])
  // Surface the merged sub-agent list to the parent (left rail, dialog). Live
  // deltas already drove the prop onSubAgents; mirror the merged list there too
  // so the parent's state stays in sync with what this view renders.
  useEffect(() => {
    onSubAgents?.(allSubAgents)
  }, [allSubAgents, onSubAgents])
  const turnEntries = useMemo(() => messages
    .filter((message) => message.role === "user" && message.type === "user_input")
    .map((message) => ({ id: message.id, content: typeof message.data.content === "string" ? message.data.content : "", createdAt: message.time })), [messages])

  const handleMessageScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop <= 48 && hasMoreHistory && !historyLoading) void load(historyCursor, true)
  }, [hasMoreHistory, historyCursor, historyLoading, load])

  const activeSubAgent = useMemo(() => {
    if (!activeSubAgentId) return null
    return allSubAgents.find((agent) => agent.id === activeSubAgentId) ?? null
  }, [activeSubAgentId, allSubAgents])

  // Follow the tail only while the user is already at the tail. Keying this on
  // `messages.length` alone also fired when older turns were *prepended*, so
  // paging up scrolled straight back to the bottom — fighting the scroll-anchor
  // restore in `load` and making history unreadable. Anchoring on the last id
  // ignores growth at the head, and the near-bottom test keeps a user who has
  // scrolled up from being dragged along by incoming output.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : ""
  useEffect(() => {
    const container = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom > 160) return
    container.scrollTop = container.scrollHeight
  }, [lastMessageId, running])

  // 离开主对话进子 Agent 视图前，抓一份当前滚动位置 + 所点卡片 id。
  const captureMainScroll = useCallback((cardId: string | null) => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
    mainScrollRestoreRef.current = { scrollTop: viewport?.scrollTop ?? 0, cardId }
  }, [])

  // 从子 Agent 视图返回主对话：ScrollArea 已被卸载过、重新挂载停在顶部。
  // 等 React 把主对话铺好（两帧 rAF 后布局稳定），定位到子 Agent 卡片；找不到
  // （卡片被翻页带出视口）就恢复离开时的 scrollTop。
  useEffect(() => {
    const wasId = prevActiveSubAgentRef.current
    prevActiveSubAgentRef.current = activeSubAgentId ?? null
    if (!wasId || activeSubAgentId) return
    const saved = mainScrollRestoreRef.current
    mainScrollRestoreRef.current = null
    if (!saved) return
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
      if (!viewport) return
      const card = saved.cardId
        ? viewport.querySelector<HTMLElement>(`[data-subagent-card="${CSS.escape(saved.cardId)}"]`)
        : null
      if (card) {
        const vRect = viewport.getBoundingClientRect()
        const cRect = card.getBoundingClientRect()
        viewport.scrollTop = Math.max(0, cRect.top - vRect.top + viewport.scrollTop - 48)
      } else {
        viewport.scrollTop = saved.scrollTop
      }
    }))
    return () => cancelAnimationFrame(raf)
  }, [activeSubAgentId])

  async function send(value: string, pendingAttachments: UserTaskAttachment[] = []) {
    const content = value.trim()
    if ((!content && pendingAttachments.length === 0) || sending) return
    // 幂等键在 fetch 离开前就造好：乐观气泡、持久化行、live 帧共用它，byId 才能
    // 把三者折成一个气泡。造在懒启动之前，保证即便运行时刚拉起、SSE 还没建上，
    // 这条 id 也已经定下来。
    const clientMessageId = newClientMessageId()
    // 处理中（running=true）也能发：composer 在 loading+有输入时已经切回发送按钮
    // 暴露这条路径。后端按 (message-id, attempt) 幂等，runtime 排队按顺序消费；
    // 不做门禁，避免 UI 上有发送按钮但实际按了没反应。
    // 没有运行时但有节点：发送首条消息前先懒启动一次，失败则交给 toast 提示并保持 composer 可用。
    if (!hasRuntime && hasNode && onStartRuntime) {
      try {
        await onStartRuntime()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "启动任务运行时失败")
        return
      }
    }
    setSending(true)
    try {
      const optimistic = content || (pendingAttachments.length === 1 ? `附件：${pendingAttachments[0].filename}` : `发送 ${pendingAttachments.length} 个附件`)
      await sendUserTaskMessage(taskId, content, pendingAttachments, clientMessageId)
      // 记在发送成功之后：这一轮确实进了运行时，之后若 agent 侧报错（429 无可用账号、
      // 上游瞬时失败），「重新发送」重发的就是它。发送本身失败的轮次不记录 —— 那种
      // 情况 composer 里的草稿还在，用户直接再点发送即可。带上幂等键，重试复用它。
      lastTurnRef.current = { content, attachments: pendingAttachments, clientMessageId }
      // 用同一幂等键打乐观气泡：replay 行的 item.id 就是它，byId 会把两者折成一个。
      if (clientRef.current) {
        clientRef.current.appendUserMessage(optimistic, clientMessageId)
      } else {
        // SSE client 还没建上（懒启动刚把运行时拉起，canStream 翻 true 到连上
        // EventSource 有一个 tick 的窗口）。此刻首条消息已经落库，静默重拉一次
        // 历史让提问出现在对话里——这正是旧的「有答无问」症状。运行时就绪后
        // hasRuntime 的 effect 还会再拉一次，两次都是幂等的整页替换。
        void load(null, false, true)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送消息失败")
      throw error
    } finally {
      setSending(false)
    }
  }

  /**
   * 重发最近一轮消息。给错误气泡上的「重新发送」用：多数失败（模型无可用账号、
   * 上游瞬时错误）在配置改好后重发原文即可，不需要重建运行时、也不该改写用户原话。
   * 返回 false 让按钮显示失败提示（没有可重发的轮次，或运行时此刻不可交互）。
   */
  const retryLastTurn = useCallback(async (): Promise<boolean> => {
    const last = lastTurnRef.current
    if (!last || sending) return false
    if (!canSend) return false
    setSending(true)
    try {
      // 复用原 clientMessageId：后端按它走 failed→pending(attempt+1) 的重试路径，
      // 换 id 会变成一条新消息、旧错误气泡也去重不掉。
      await sendUserTaskMessage(taskId, last.content, last.attachments, last.clientMessageId)
      // 不再补一条用户卡：原话在第一次尝试时就已经在对话里了，重发只是让同一轮再跑
      // 一次。之前每点一次重试就多一条相同的用户输入，把补救动作记成了新指令。
      clientRef.current?.beginTurn()
      return true
    } finally {
      setSending(false)
    }
  }, [canSend, sending, taskId])

  function uploadAttachment(file: File, onProgress: (percent: number) => void) {
    return uploadUserTaskAttachment(taskId, file, onProgress)
  }

  async function cancelTurn() {
    try {
      await cancelUserTask(taskId)
      setRunning(false)
      toast.success("已请求中断当前回复")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "中断失败")
    }
  }

  /** 压缩上下文：向运行时发 /compact，让模型总结并精简历史。 */
  async function compactContext() {
    setCompactPending(true)
    try {
      await sendUserTaskMessage(taskId, "/compact")
      toast.success("已请求压缩上下文，下一轮生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "压缩上下文失败")
    } finally {
      setCompactPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {streamError && (
        <div className="mx-auto flex w-full max-w-[860px] shrink-0 items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
          <span className="leading-relaxed">{streamError}</span>
          <button
            type="button"
            className="ml-auto shrink-0 text-red-600/70 hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-400"
            onClick={() => setStreamError(null)}
          >
            关闭
          </button>
        </div>
      )}
      <div ref={scrollRef} className="relative min-h-0 min-w-0 flex-1">
        {/* 左侧悬浮子 Agent 栏（有子 Agent 才渲染），与右侧轮次导航对称、与底部
            输入框同款观感。不占布局宽度——对话内容的内边距恒定，长文字从它背后
            穿过。子 Agent 会话视图也共用这个容器与内边距，两边观感一致。 */}
        <SubagentSideRail
          subAgents={allSubAgents}
          activeSubAgentId={activeSubAgentId}
          onSelect={(id) => {
            captureMainScroll(id)
            onSelectSubAgent?.(id)
          }}
        />
        {activeSubAgent ? (
          <SubagentConversationPanel
            subAgent={activeSubAgent}
            onBack={() => onSelectSubAgent?.(null)}
          />
        ) : (
        <>
        <ScrollArea className="h-full [&>[data-radix-scroll-area-viewport]>div]:!block" onScrollCapture={handleMessageScroll}>
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-3 pb-24 sm:px-5">
            {loading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center px-4 py-6">
                {canInteract && !blocked ? (
                  <span className="text-sm text-muted-foreground">等待首条消息</span>
                ) : blocked ? (
                  // 任务跑不起来 / 处于终态时，用户只关心三件事：现在是什么状态、
                  // 为什么、我能做什么。原因可能是一大段 git/运行时 stderr（几十行），
                  // 所以放在有上限的可滚动框里——之前它顶开容器，把标题挤出可视区。
                  <div className="flex w-full max-w-xl flex-col items-center gap-2.5">
                    <div className="shrink-0 text-center text-sm font-medium text-foreground">{blocked.title}</div>
                    {blocked.reason && (
                      <div className="max-h-56 w-full overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground">
                        <pre className="whitespace-pre-wrap break-all font-sans">{blocked.reason}</pre>
                      </div>
                    )}
                    {blocked.onAction && (
                      <button
                        type="button"
                        className="shrink-0 inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                        disabled={retrying}
                        onClick={() => {
                          setRetrying(true)
                          try { blocked.onAction?.() } finally { setTimeout(() => setRetrying(false), 800) }
                        }}
                      >
                        {retrying && <Spinner className="size-3.5" />} {blocked.actionLabel}
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">该任务还没有对话</span>
                )}
              </div>
            ) : (
              <>
                {historyLoading && (
                  <div className="flex justify-center py-1 text-xs text-muted-foreground"><Spinner className="mr-1.5 size-3" />加载更早轮次…</div>
                )}
                {messages.map((message, index) => {
                  // 主 Agent 派发子 Agent 的 Agent tool_use（id == subagent_id）落在
                  // 「子 Agent」入口卡的上方，完成后还把子 Agent 的最终文本当 output
                  // 顶在轮次最前面。入口卡已经是该轮次的标记，这张派发帧不再当普通
                  // 工具卡重复渲染；结果去子 Agent 面板看，跟在它的工具卡之后。
                  if (message.type === "tool_call" && subAgentIds.has(message.id.slice("item-".length))) return null
                  if (message.type === "system_message" && message.data.toolCallId) {
                    return (
                      <div
                        key={message.id}
                        data-subagent-card={message.data.toolCallId ?? undefined}
                      >
                        <SubagentInlineEntry
                          subAgent={allSubAgents.find((a) => a.id === message.data.toolCallId) ?? null}
                          onOpen={() => {
                            captureMainScroll(message.data.toolCallId ?? null)
                            onSelectSubAgent?.(message.data.toolCallId ?? null)
                          }}
                        />
                      </div>
                    )
                  }
                  return (
                    <MessageItem
                      key={message.id}
                      // 只给错误气泡挂重发：它是唯一需要「原文再来一次」的位置，
                      // 且只在真的有可重发轮次时挂，否则 ErrorMessageItem 不渲染按钮。
                      message={message.type === "error_message" && lastTurnRef.current && canInteract
                        ? { ...message, onRetry: retryLastTurn }
                        : message}
                      isLatest={index === messages.length - 1}
                    />
                  )
                })}
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
        <TurnNavigator
          entries={turnEntries}
          getScrollContainer={() => scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") || null}
          hasMore={hasMoreHistory}
          loadingMore={historyLoading}
          onLoadOlder={() => load(historyCursor, true)}
        />
        </>
        )}
      </div>
      {/* 统一输入框：任务通过左右扩展位增加模式、token、压缩和重启能力。
          子 Agent 会话是只读视图（消息只能发给根 Agent，后端没有直接向子 Agent
          投递的通道），所以进入子 Agent 时不渲染输入框，避免一个看起来能对它说话
          实际发给根 Agent 的框。 */}
      {!activeSubAgent && (
      <div className="pointer-events-none sticky bottom-3 z-10 mx-auto -mt-16 w-full max-w-[860px] px-4">
        <MessageComposer<UserTaskAttachment>
          className="pointer-events-auto"
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={() => void cancelTurn()}
          loading={running}
          // 真正不能发消息只有两种：准备中（运行时没起）、无节点（被删/吊销）。
          // 其余状态（含 stopped/finished/error）后端发消息即恢复运行时，输入启用。
          disabled={!canSend}
          placeholder={canSend
            ? status === "stopped"
              ? "任务已停止，发送消息即可继续"
              : status === "finished"
                ? "发送新消息，在同一工作区继续"
                : status === "error"
                  ? "发送消息重试，或点上方「重新运行」"
                  : hasRuntime
                    ? "输入消息，Enter 发送，Shift+Enter 换行"
                    : "输入消息，发送后任务会自动开始"
            : preparing
              ? `正在${runtimeStage?.label || "准备运行环境"}，准备好后即可开始对话`
              : "任务没有可用的执行节点"}
          uploadFile={uploadAttachment}
          uploadEnabled={canSend}
          maxFileSize={10 * 1024 * 1024}
          maxFiles={10}
          attachmentName={(attachment) => attachment.filename}
          modelValue={modelLabel?.model || ""}
          modelOptions={(models || []).map((modelId) => ({ value: modelId, label: modelId }))}
          onSwitchModel={(modelId) => void onSwitchModel?.(modelId)}
          onAddModel={onAddModel}
          disabledModels={(models || []).filter((m) => isClaudeReservedModelAlias(m))}
          disabledModelHint={CLAUDE_RESERVED_MODEL_HINT}
          requireModel={requireModel}
          leftActions={
            <>
              {totalTokens > 0 && <span className="shrink-0 text-[11px] text-muted-foreground" title="该任务累计消耗 Token">{formatTokens(totalTokens)}</span>}
              <TokenProgressPopover
                inputTokens={ctxSize > 0 ? ctxUsed : totalTokens}
                maxTokens={ctxSize > 0 ? ctxSize : modelMaxTokens}
                onCompact={canInteract ? compactContext : undefined}
                compactPending={compactPending}
                onRestart={onRestartRuntime}
              />
            </>
          }
          beforeModelActions={(
            <>
              <ReasoningEffortMenu value={reasoningEffort || ""} onChange={(effort) => void onSwitchReasoningEffort?.(effort)} />
              {modeOptions && modeOptions.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex h-7 max-w-[150px] shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" title="权限/审批方式，下一轮消息生效">
                      <span className="truncate">{modelLabel?.mode || "默认模式"}</span>
                      <IconChevronDown className="size-3 shrink-0 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="min-w-[200px]">
                    <DropdownMenuRadioGroup value={modeOptions.find((option) => option.label === modelLabel?.mode)?.value ?? ""}>
                      {modeOptions.map((option) => <DropdownMenuRadioItem key={option.value || "__default__"} value={option.value} onSelect={() => void onSwitchMode?.(option.value)}>{option.label}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          )}
        />
      </div>
      )}
    </div>
  )
}
