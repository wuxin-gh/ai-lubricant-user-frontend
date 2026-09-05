/**
 * Live event stream for one editor session.
 *
 * The node reports a session's runtime frames upstream; the backend bridges them
 * onto a JSON SSE endpoint (`/sessions/{id}/events`) so the browser never has to
 * decode protobuf. This client owns the EventSource lifecycle, reconnection, and
 * the reduction of raw runtime frames into the shared task-detail MessageType so
 * the editor conversation renders identically to the classic task page (agent
 * text / reasoning / tool calls / plan), tracks turn-running state, and surfaces
 * the runtime's context-window usage.
 */

import type { MessageType } from "@/components/console/task/message"
import type { TaskPlan } from "@/components/console/task/task-shared"
import { itemToRootMessage, mergeItems, rootMessageIdFor, type NormalizedItem } from "@/components/console/task/item-to-message"

export type EditorStreamConnectionState = "connecting" | "connected" | "reconnecting" | "closed"

/**
 * One sub-agent of the running task. Runtime items carry an `agent_id`: empty
 * means the root agent, non-empty means the item belongs to a sub-agent the
 * root spawned. Shape matches AgentSubagentDisplay so the shared SubagentBlock
 * renders it unchanged.
 */
export interface EditorSessionSubAgent {
  id: string
  name: string
  task: string
  status: "running" | "done"
  content: string
  toolCalls: Array<{ name: string; args: unknown; result?: unknown; status: "running" | "done" }>
  summary?: string
}

export interface EditorStreamState {
  messages: MessageType[]
  plan: TaskPlan
  contextUsage: { size: number | null; used: number | null }
  /** Sub-agents seen in this session's stream, in first-seen order. */
  subAgents: EditorSessionSubAgent[]
  /** Confirmation ids the runtime has asked the user to approve and not yet resolved. */
  pendingApprovals: string[]
  connectionState: EditorStreamConnectionState
  /** True while a turn is in flight (between turn started and completed). */
  running: boolean
  /** Terminal error surfaced by the stream, if any. */
  error: string | null
}

interface StreamEvent {
  kind?: string
  event_type?: string
  item_type?: string
  agent_id?: string
  /** Canonical envelope — filled once by the runtime, kept verbatim upstream. */
  logical_event_id?: string
  event_name?: string
  event_kind?: string
  tool_name?: string
  subagent_id?: string
  phase?: string
  status?: string
  seq?: number
  text?: string
  payload?: unknown
  error?: string
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

/** Fold a streaming tool call into a sub-agent's tool list, matching by name+order. */
function mergeToolCall(
  existing: EditorSessionSubAgent["toolCalls"],
  next: EditorSessionSubAgent["toolCalls"][number],
): EditorSessionSubAgent["toolCalls"] {
  // Tool calls keyed by name aren't reliable (a sub-agent may call the same
  // tool twice); instead append a fresh running entry, and when the same call
  // arrives again with a result we can't reliably pair it back — so keep it
  // simple: append on new, leave prior running entries as-is. The block is a
  // live snapshot, not a strict log.
  if (!existing.length) return [next]
  // Replace a trailing running entry with the same name to avoid duplicates.
  const last = existing[existing.length - 1]
  if (last.status === "running" && last.name === next.name) {
    return [...existing.slice(0, -1), { ...last, ...next, status: next.result != null ? "done" : "running" }]
  }
  return [...existing, next]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === "string" && value) return value
  }
  return ""
}

function confirmationIdOf(payload: StreamEvent): string {
  const direct = (payload as StreamEvent & { confirmation_id?: unknown }).confirmation_id
  if (typeof direct === "string" && direct) return direct
  const body = isRecord(payload.payload) ? payload.payload : {}
  const inner = isRecord(body.event) ? body.event : body
  return stringField(inner, "confirmation_id") || stringField(body, "confirmation_id")
}

/**
 * Pull the human-readable reason out of a runtime `error` frame.
 *
 * The runtime emits `{type:"error", code:"runtime_stream_error", message:"<why>"}`;
 * the node wraps that whole frame verbatim into the structured event's
 * `payload`. So the reason lives at `payload.message` — NOT at the top-level
 * `error` field, which the runtime never sets. Reading only `payload.error`
 * meant every failure (a 429 "No available account", a provider auth error, a
 * crashed turn) rendered as the same useless "运行时报告错误" with the real
 * cause silently discarded. Falls back through the nested shapes other
 * providers use, then to the raw text, before giving up on a generic label.
 */
function runtimeErrorText(payload: StreamEvent): string {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error
  const body = isRecord(payload.payload) ? payload.payload : {}
  const direct = stringField(body, "message", "error", "detail")
  if (direct) return direct
  const inner = isRecord(body.error) ? body.error : isRecord(body.event) ? body.event : {}
  const nested = stringField(inner, "message", "detail")
  if (nested) return nested
  if (typeof payload.text === "string" && payload.text.trim()) return payload.text
  return "运行时报告错误"
}

/**
 * Read a retry notice off an `llm_call_retry` frame.
 *
 * Two producers write this shape: the runtime's own turn-level backoff, and the
 * Claude SDK's per-call `api_retry` which the runtime forwards verbatim. Both use
 * the same field names, so one reader covers them — the difference is only that
 * the SDK's arrives mid-turn and keeps the completed work.
 */
function retryInfoOf(payload: StreamEvent): {
  attempt: number
  max: number
  delayMs: number
  status: string
  message: string
} {
  const body = isRecord(payload.payload) ? payload.payload : {}
  const inner = isRecord(body.event) ? body.event : body
  const num = (key: string): number => {
    for (const source of [inner, body]) {
      const value = (source as Record<string, unknown>)[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
    return 0
  }
  const errorStatus = num("error_status")
  return {
    attempt: num("attempt") || 1,
    max: num("max_retries"),
    delayMs: num("retry_delay_ms"),
    status: errorStatus > 0 ? String(errorStatus) : "",
    message: stringField(inner, "message") || stringField(body, "message"),
  }
}

/**
 * Render a `compact_status` frame, or "" for a status worth no line.
 *
 * Token counts are the point of showing this at all: "压缩完成" alone reads as
 * noise, while the before/after makes it obvious why the context gauge dropped.
 */
function compactStatusText(payload: StreamEvent): string {
  const body = isRecord(payload.payload) ? payload.payload : {}
  const inner = isRecord(body.event) ? body.event : body
  const record = inner as Record<string, unknown>
  const status = stringField(record, "status")
  const auto = stringField(record, "trigger") === "auto"
  const prefix = auto ? "自动压缩上下文" : "压缩上下文"
  const pre = typeof record.pre_tokens === "number" ? record.pre_tokens : 0
  const post = typeof record.post_tokens === "number" ? record.post_tokens : 0
  if (status === "started") {
    return pre > 0 ? `${prefix}开始（当前 ${formatTokens(pre)}）` : `${prefix}开始`
  }
  if (status === "ended") {
    if (pre > 0 && post > 0) return `${prefix}完成（${formatTokens(pre)} → ${formatTokens(post)}）`
    return `${prefix}完成`
  }
  if (status === "failed") {
    const message = stringField(record, "message")
    return message ? `${prefix}失败：${message}` : `${prefix}失败`
  }
  return ""
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value)
}

/**
 * Read a `usage_update` frame into the context gauge's shape.
 *
 * The gauge existed before anything emitted these numbers, so it read
 * `item.usage` off conversation items — a field no runner ever set, leaving it
 * pinned at zero. This is the frame that actually carries them.
 */
function usageOf(payload: StreamEvent): { size: number | null; used: number | null } | null {
  const body = isRecord(payload.payload) ? payload.payload : {}
  const inner = isRecord(body.event) ? body.event : body
  const record = inner as Record<string, unknown>
  const used = typeof record.used === "number" ? record.used : null
  const size = typeof record.size === "number" ? record.size : null
  if (used === null && size === null) return null
  return { used, size }
}

/** Map a runtime agent_event item.type onto the shared MessageType.type. */
function messageTypeForItem(itemType: string): MessageType["type"] | null {
  switch (itemType) {
    case "agent_message":
      return "agent_message_chunk"
    case "reasoning":
    case "thinking":
      return "agent_thought_chunk"
    case "command_execution":
    case "mcp_tool_call":
    case "file_change":
    case "web_search":
    case "tool_call":
      return "tool_call"
    case "error":
      return "error_message"
    default:
      return null
  }
}

/** Human-readable title for tool-call style items. */
function toolTitle(itemType: string, item: Record<string, unknown>): string {
  // The Claude runner already resolves a tool title (the tool name) into `title`.
  const explicit = stringField(item, "title")
  if (explicit) return explicit
  if (itemType === "command_execution") return stringField(item, "command") || "命令执行"
  if (itemType === "mcp_tool_call") {
    // Both halves can be absent; a bare "/" is worse than the generic label.
    const parts = [stringField(item, "server"), stringField(item, "tool")].filter(Boolean)
    return parts.length ? parts.join("/") : "MCP 调用"
  }
  if (itemType === "file_change") return "文件变更"
  if (itemType === "web_search") return stringField(item, "query") || "联网搜索"
  return itemType
}

/** Pull display text out of a runtime item for text/thought/tool bodies. */
function itemText(itemType: string, item: Record<string, unknown>): string {
  const direct = stringField(item, "text", "message", "content")
  if (direct) return direct
  if (itemType === "command_execution") {
    const output = stringField(item, "aggregated_output", "output")
    return output
  }
  if (itemType === "file_change" && Array.isArray(item.changes)) {
    return item.changes
      .map((change) => (isRecord(change) ? `${String(change.kind)}: ${String(change.path)}` : ""))
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

export class EditorSessionStreamClient {
  private source: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closedByCaller = false
  /** Latest normalized item report by canonical logical lifecycle id. */
  private readonly rawById = new Map<string, NormalizedItem>()
  /** Sub-agent ids that already have a root-transcript placeholder. */
  private readonly subAgentEntryIds = new Set<string>()
  private state: EditorStreamState = {
    messages: [],
    plan: { entries: [], version: 0 },
    contextUsage: { size: null, used: null },
    subAgents: [],
    pendingApprovals: [],
    connectionState: "closed",
    running: false,
    error: null,
  }

  constructor(
    private readonly url: string,
    private readonly onState: (state: EditorStreamState) => void,
    // Fired once when the stream reports a terminal `result` frame. The task's
    // status has just advanced server-side (finished/error); the caller uses
    // this to re-fetch the task so the status badge reflects it without a manual
    // page refresh. Optional so existing editor callers are unaffected.
    private readonly onTerminal?: () => void,
  ) {}

  getState(): EditorStreamState {
    return this.state
  }

  connect(): void {
    this.closedByCaller = false
    this.open()
  }

  /**
   * Optimistically append the message the user just sent.
   *
   * Pass the same `logicalId` the POST body carried (the `client_message_id`):
   * the persisted row's `item.id` and `logical_event_id` are set to it, so the
   * replay message reuses this id and the live∪replay union collapses the two
   * on `byId`. Without it the bubble gets a positional id (`user-N-M`) that the
   * replay row can never match, so a history reload left the turn doubled.
   */
  appendUserMessage(text: string, logicalId?: string): void {
    const id = logicalId
      ? rootMessageIdFor(logicalId, 0)
      : `user-${this.state.messages.length}-${text.length}`
    // A live frame for this id may already have landed between the POST
    // resolving and this call; drop it so the optimistic copy owns the slot.
    const filtered = logicalId
      ? this.state.messages.filter((message) => message.id !== id)
      : this.state.messages
    this.patch({
      messages: [
        ...filtered,
        { id, time: 0, role: "user", type: "user_input", data: { content: text } },
      ],
      running: true,
    })
  }

  /**
   * Mark a turn in flight without adding a message.
   *
   * For re-sending a turn that already failed: the user's words are on screen
   * from the first attempt, so appending them again would bill the retry as a
   * second instruction — exactly the noise re-typing the prompt was supposed to
   * avoid. Only the spinner needs to come back.
   */
  beginTurn(): void {
    this.patch({ running: true })
  }

  close(): void {
    this.closedByCaller = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.source?.close()
    this.source = null
    this.patch({ connectionState: "closed" })
  }

  private open(): void {
    this.source?.close()
    this.patch({
      connectionState: this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
      error: null,
    })
    const source = new EventSource(this.url, { withCredentials: true })
    this.source = source

    source.onopen = () => {
      this.reconnectAttempts = 0
      this.patch({ connectionState: "connected" })
    }
    source.addEventListener("agent_event", (event) => this.handleEvent(event as MessageEvent))
    source.addEventListener("output", (event) => this.handleEvent(event as MessageEvent))
    source.addEventListener("result", (event) => this.handleEvent(event as MessageEvent))
    source.addEventListener("error", (event) => {
      const data = (event as MessageEvent).data
      if (typeof data === "string" && data) {
        // A named `error` SSE event carries a payload: this is the SERVER telling
        // us why (control plane down, runtime failure), not the browser reporting
        // a dropped connection. Surface it in the transcript too — patching only
        // `error` left the reason in a banner the user may have scrolled past,
        // with no record of which turn died.
        let message = "会话事件流出错"
        try {
          const parsed = JSON.parse(data) as { message?: string; error?: string }
          message = parsed.message || parsed.error || message
        } catch {
          message = data
        }
        this.patch({
          messages: [...this.state.messages, { id: `stream-error-${this.state.messages.length}`, time: 0, role: "agent", type: "error_message", data: { text: message } }],
          error: message,
          running: false,
        })
        return
      }
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller) return
    this.source?.close()
    this.source = null
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts += 1
    this.patch({ connectionState: "reconnecting" })
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private handleEvent(event: MessageEvent): void {
    let payload: StreamEvent
    try {
      payload = JSON.parse(event.data) as StreamEvent
    } catch {
      return
    }
    if (payload.kind === "result") {
      this.patch({ running: false })
      // The session ended: the server has persisted finished/error by now, so
      // let the page re-read the task instead of showing a stale "运行中" badge.
      this.onTerminal?.()
      return
    }
    if (payload.kind === "output") {
      // Raw stdio is noise once structured events are rendered.
      return
    }
    this.handleStructured(payload)
  }

  private handleStructured(payload: StreamEvent): void {
    const type = payload.event_type || ""
    if (type === "confirmation_required") {
      // Runtime is asking the user to approve a command. Track the pending id so
      // the workspace surfaces a red dot until it is resolved.
      const confirmationId = confirmationIdOf(payload)
      if (confirmationId && !this.state.pendingApprovals.includes(confirmationId)) {
        this.patch({ pendingApprovals: [...this.state.pendingApprovals, confirmationId] })
      }
      return
    }
    if (type === "confirmation_resolved" || type === "confirmation_expired") {
      const confirmationId = confirmationIdOf(payload)
      if (confirmationId) {
        this.patch({ pendingApprovals: this.state.pendingApprovals.filter((id) => id !== confirmationId) })
      }
      return
    }
    if (type === "agent_turn_started") {
      this.patch({ running: true })
      return
    }
    if (type === "agent_turn_completed" || type === "result") {
      // A finished turn means nothing can still be running — not the sub-agents,
      // and not the root tool cards either. Without settling the tool calls here
      // any card whose completion frame never arrived (dropped stream, a turn
      // that died mid-call) span its spinner forever while the turn was visibly
      // over. Only in-flight statuses are touched, so a recorded `failed` stays.
      this.patch({
        running: false,
        subAgents: this.state.subAgents.map((agent) => (agent.status === "running" ? { ...agent, status: "done" } : agent)),
        messages: this.state.messages.map((message) => (
          message.type === "tool_call" && (message.data.status === "in_progress" || message.data.status === "pending")
            ? { ...message, data: { ...message.data, status: "completed" } }
            : message
        )),
      })
      return
    }
    // Retry / compaction / usage frames are session telemetry, not conversation
    // items: they report what the runtime is doing between the user's turns.
    if (type === "llm_call_retry") {
      const info = retryInfoOf(payload)
      const seconds = Math.max(1, Math.round(info.delayMs / 1000))
      const attempt = info.max > 0 ? `${info.attempt}/${info.max}` : String(info.attempt)
      const status = info.status ? `${info.status} ` : ""
      this.patch({
        messages: [...this.state.messages, {
          id: `llm-retry-${payload.seq ?? this.state.messages.length}`,
          time: 0,
          role: "system",
          type: "alert_message",
          data: {
            level: "warning",
            text: `${status}模型调用失败，${seconds} 秒后重试（第 ${attempt} 次）${info.message ? `：${info.message}` : ""}`,
          },
        }],
      })
      return
    }
    if (type === "compact_status") {
      const text = compactStatusText(payload)
      if (!text) return
      this.patch({
        messages: [...this.state.messages, {
          id: `compact-${payload.seq ?? this.state.messages.length}`,
          time: 0,
          role: "system",
          type: "alert_message",
          data: { level: "info", text },
        }],
      })
      return
    }
    if (type === "usage_update") {
      const usage = usageOf(payload)
      if (usage) this.patch({ contextUsage: usage })
      return
    }
    if (type === "error") {
      // Show the runtime's own words. `error` is also set so the page's banner
      // states the cause even when the message list is scrolled away — a failed
      // turn otherwise just stopped the spinner with nothing to read.
      const message = runtimeErrorText(payload)
      // One failure, one card: the provider echoes the upstream error text as an
      // assistant message first, and this frame follows with the same text.
      // Emitting both rendered the same "API Error …" twice (bubble + card).
      if (
        this.state.messages.some((m) => (
          m.type === "agent_message_chunk" && String(m.data.content || "") === message
        ))
      ) {
        // Replace the plain bubble with the error card (it carries retry), not add.
        this.patch({
          messages: this.state.messages.map((m) => (
            m.type === "agent_message_chunk" && String(m.data.content || "") === message
              ? { id: `error-${payload.seq ?? this.state.messages.length}`, time: 0, role: "agent" as const, type: "error_message" as const, data: { text: message } }
              : m
          )),
          running: false,
          error: message,
        })
        return
      }
      this.patch({
        messages: [...this.state.messages, { id: `error-${payload.seq ?? this.state.messages.length}`, time: 0, role: "agent", type: "error_message", data: { text: message } }],
        running: false,
        error: message,
      })
      return
    }
    if (type !== "agent_event") return

    const body = isRecord(payload.payload) ? payload.payload : {}
    const inner = isRecord(body.event) ? body.event : body
    const item = isRecord(inner.item) ? inner.item : null
    if (!item) return

    const itemType = String(item.type || payload.item_type || "")
    // Sub-agent attribution reads the canonical envelope field ONLY — the
    // runtime fills `subagent_id` (empty = root transcript, non-empty = that
    // sub-agent's detail), and the legacy `agent_id` alias carries the same
    // value for streams that predate the field. No other heuristics.
    const agentId =
      stringField(payload as Record<string, unknown>, "subagent_id") ||
      stringField(item, "subagent_id") ||
      stringField(inner, "subagent_id") ||
      stringField(payload as Record<string, unknown>, "agent_id") ||
      stringField(item, "agent_id") ||
      stringField(inner, "agent_id") ||
      ""

    // Todo lists drive the plan strip, not the message list.
    if (itemType === "todo_list" && Array.isArray(item.items)) {
      const entries = item.items
        .filter(isRecord)
        .map((entry) => ({ content: stringField(entry, "content", "text"), priority: "", status: stringField(entry, "status") || "pending" }))
        .filter((entry) => entry.content)
      this.patch({ plan: { entries, version: this.state.plan.version + 1 } })
      return
    }

    // Context/token usage frames update the usage indicator.
    const usage = isRecord(item.usage) ? item.usage : (isRecord(inner.usage) ? inner.usage : null)
    if (usage) {
      const size = Number(usage.context_window ?? usage.max_context ?? usage.window ?? this.state.contextUsage.size ?? 0) || this.state.contextUsage.size
      const used = Number(usage.used ?? usage.total_tokens ?? usage.tokens ?? this.state.contextUsage.used ?? 0) || this.state.contextUsage.used
      this.patch({ contextUsage: { size, used } })
    }

    const mappedType = messageTypeForItem(itemType)
    if (!mappedType) return

    const isTool = mappedType === "tool_call"
    const text = itemText(itemType, item)
    if (!isTool && !text) return

    // Sub-agent attribution: items with a non-empty subagent_id belong to a
    // sub-agent, not the root agent. They are mirrored into the matching
    // EditorSessionSubAgent (creating one on first sight) and the root list
    // gets EXACTLY ONE placeholder entry marking where the sub-agent's turn
    // began — the same id the replay reducer uses (`subagent-entry-${id}`), so
    // live and replay dedupe into one entry instead of stacking.
    if (agentId) {
      const toolCall = isTool
        ? {
            // `tool_name` is the canonical field; `toolTitle` is the display
            // fallback for streams that predate it.
            name: stringField(payload as Record<string, unknown>, "tool_name") || toolTitle(itemType, item),
            args: item.input ?? item,
            result: item.output,
            status: "running" as const,
          }
        : null
      const subAgents = this.state.subAgents.slice()
      const index = subAgents.findIndex((agent) => agent.id === agentId)
      const existing = index >= 0 ? subAgents[index] : null
      const updated: EditorSessionSubAgent = existing
        ? {
            ...existing,
            status: "running",
            task: existing.task || stringField(item, "task", "goal") || stringField(inner, "task", "goal"),
            content: !isTool && text ? text : existing.content,
            toolCalls: toolCall
              ? mergeToolCall(existing.toolCalls, toolCall)
              : existing.toolCalls,
          }
        : {
            id: agentId,
            name: stringField(item, "agent_name", "name") || stringField(inner, "agent_name", "name") || `子 Agent ${agentId.slice(0, 8)}`,
            task: stringField(item, "task", "goal") || stringField(inner, "task", "goal"),
            status: "running",
            content: !isTool && text ? text : "",
            toolCalls: toolCall ? [toolCall] : [],
          }
      if (index >= 0) subAgents[index] = updated
      else subAgents.push(updated)
      const entryId = `subagent-entry-${agentId}`
      const firstSighting = !this.subAgentEntryIds.has(agentId)
      this.subAgentEntryIds.add(agentId)
      this.patch({
        subAgents,
        // First sighting only: a single card placeholder in the root
        // transcript. Filtering out an existing same-id entry guards against a
        // replay row that already inserted it, which would otherwise double.
        ...(firstSighting
          ? {
              messages: [
                ...this.state.messages.filter((message) => message.id !== entryId),
                {
                  id: entryId,
                  time: 0,
                  role: "system" as const,
                  type: "system_message" as const,
                  data: { text: updated.name, toolCallId: agentId },
                },
              ],
            }
          : {}),
      })
      return
    }

    // Root item: merge onto the earlier report of the same logical event
    // BEFORE mapping. A tool call's completion frame is sparse ({id, type,
    // output, status}); replacing the opening report outright erased its
    // title/input and left the finished card blank.
    const itemKey = String(
      item.logical_event_id ?? payload.logical_event_id ?? item.id ?? payload.seq ?? this.state.messages.length,
    )
    const normalized = item as unknown as NormalizedItem
    const previous = this.rawById.get(itemKey)
    const merged = previous ? mergeItems(previous, normalized) : normalized
    this.rawById.set(itemKey, merged)
    const mapped = itemToRootMessage(merged, Number(item.id ?? payload.seq ?? this.state.messages.length))
    if (!mapped) return
    const message: MessageType = mapped
    const existingIndex = this.state.messages.findIndex((m) => m.id === message.id)
    if (existingIndex >= 0) {
      // Runtime items stream incrementally; replace in place so text grows.
      const messages = this.state.messages.slice()
      messages[existingIndex] = message
      this.patch({ messages })
      return
    }
    this.patch({ messages: [...this.state.messages, message] })
  }

  private patch(next: Partial<EditorStreamState>): void {
    this.state = { ...this.state, ...next }
    this.onState(this.state)
  }
}

export function editorSessionEventsUrl(editorId: string, sessionId: string): string {
  return `/api/v1/users/editors/${encodeURIComponent(editorId)}/sessions/${encodeURIComponent(sessionId)}/events`
}
