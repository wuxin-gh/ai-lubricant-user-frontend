/**
 * Map a normalized conversation `item` to the shared MessageType, for both the
 * live SSE reducer and the persisted-history replay. One function, two callers
 * — so what the browser shows live and what it rebuilds on refresh agree by
 * construction instead of each decoding the item shape its own way.
 *
 * The item shape is the one the runtime emits (see claude.ts `claudeMessageToItems`):
 * `{id, type, text?, title?, input?, output?, status?, agent_name?, task?}`.
 * The MessageType shape is what the existing renderers in `toolcalls/` and
 * `message-*` expect — `kind`, `rawInput`, `rawOutput`, `_meta.claudeCode…`,
 * `status`. This module is the single adapter between them.
 */
import type { MessageType } from "./message"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"

export type AgentId = string

/**
 * Message id for one root conversation item.
 *
 * Lives here so the live stream reducer, the replay reducer, and the optimistic
 * user-input bubble all derive the same id from the same key: the item's
 * logical id (which the backend sets to the sender-minted `client_message_id`
 * for user input). Sharing the formula is what lets a live frame replace its
 * optimistic twin by id instead of stacking a duplicate bubble beside it.
 */
export function rootMessageIdFor(itemId: string, seq: number): string {
  return `item-${itemId || seq}`
}

export interface NormalizedItem {
  id: string
  type: string
  text?: string
  title?: string
  input?: unknown
  output?: unknown
  status?: string
  agent_name?: string
  task?: string
  /** Set by the backend when ClickHouse is unreachable for this frame. */
  content_unavailable?: boolean
  /**
   * Wall-clock time the frame happened, as epoch seconds. The data layer that
   * actually knows the time stamps it: the replay path parses the persisted
   * row's ``created_at``; the live path stamps arrival time. ``itemToRootMessage``
   * threads it onto ``message.time`` instead of hard-coding 0 (which rendered
   * every message as 1970-01-01).
   */
  created_at?: number
}

/** Parse a persisted row's ``created_at`` (ISO 8601, possibly tz-aware) to epoch
 * seconds. The mc_* tables store naive UTC, but asyncpg returns the value with
 * whatever tz the column carries; a string with no timezone designator is
 * treated as UTC so it does not slip into the browser's local zone. */
export function parseIsoToSeconds(value: string | number | null | undefined): number {
  if (value == null) return 0
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0
    // ms → s; seconds already; the renderer's normalizeTimestampToSeconds also
    // defends against magnitude, so just keep the number.
    return value >= 1e12 ? Math.floor(value / 1000) : Math.floor(value)
  }
  const text = value.trim()
  if (!text) return 0
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text)
  // Postgres naive-UTC isoformat uses a space; Date needs the T, and without a
  // designator JS treats the string as local time — force UTC.
  const normalized = `${text.replace(" ", "T")}${hasTz ? "" : "Z"}`
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

/** Claude tool name → message.data.kind the existing renderers route on. */
export function kindForTool(toolName: string): string {
  switch (toolName) {
    case "Read":
      return "read"
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit"
    case "Bash":
    case "BashOutput":
      return "execute"
    case "Grep":
    case "Glob":
      return "search"
    default:
      return "other"
  }
}

/** SDK `status` → the `data.status` values the renderers switch on. */
export function mapStatus(s: string | undefined): string {
  switch (s) {
    case "running":
      return "in_progress"
    case "done":
      return "completed"
    case "failed":
      return "failed"
    default:
      return s ?? "completed"
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Pull a flat string out of a tool_result `output` (string or content blocks). */
export function outputText(output: unknown): string {
  if (typeof output === "string") return output
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>
          return typeof record.text === "string" ? record.text : ""
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/**
 * Build the `_meta.claudeCode.toolResponse` the per-tool renderers read, from the
 * item's flat `input`/`output`. Each tool's renderer reaches for a different
 * path under this object; rather than rewrite the renderers, we seat the values
 * where they already look.
 */
function buildToolMeta(toolName: string, input: Record<string, unknown>, output: unknown): Record<string, unknown> | undefined {
  if (toolName === "Read") {
    return {
      file: {
        content: outputText(output),
        startLine: Number(input.offset ?? 1) || 1,
        filePath: asString(input.file_path),
      },
    }
  }
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "Write") {
    return {
      filePath: asString(input.file_path),
      oldString: asString(input.old_string),
      newString: asString(input.new_string ?? input.content),
    }
  }
  return undefined
}

/** Convert one item to a root-agent message, or null if it shouldn't render inline. */
/** Per-call token usage the runtime stamps on assistant items. */
export interface ItemUsage {
  input: number
  output: number
  cache_read: number
  cache_creation: number
  total: number
}

function itemUsageOf(item: NormalizedItem): ItemUsage | undefined {
  const raw = (item as { usage?: unknown }).usage
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const usage: ItemUsage = {
    input: Number(record.input ?? 0),
    output: Number(record.output ?? 0),
    cache_read: Number(record.cache_read ?? 0),
    cache_creation: Number(record.cache_creation ?? 0),
    total: Number(record.total ?? 0),
  }
  if (!usage.input && !usage.output && !usage.cache_read && !usage.cache_creation) return undefined
  return usage
}

function itemModelOf(item: NormalizedItem): string | undefined {
  const model = asString((item as { model?: unknown }).model)
  return model || undefined
}

export function itemToRootMessage(item: NormalizedItem, seq: number): MessageType | null {
  const id = rootMessageIdFor(String(item.id ?? ""), seq)
  // The data layer (persisted row's created_at / live arrival) stamps the item;
  // absent (legacy frames without the field threaded) falls back to 0, which
  // the renderer has always treated as "no timestamp to show".
  const time = item.created_at ?? 0
  // The backend marks a frame `content_unavailable` when ClickHouse cannot be
  // read for it. Rendering nothing would read as data loss (a gap where a turn
  // should be); a muted notice reads as a degraded store, which is what it is.
  if (item.content_unavailable) {
    return {
      id,
      time,
      role: "system",
      type: "system_message",
      data: { text: "该消息内容暂不可用（内容存储暂时不可达）" },
    }
  }
  switch (item.type) {
    case "user_input": {
      const text = asString(item.text)
      return text ? { id, time, role: "user", type: "user_input", data: { content: text } } : null
    }
    case "agent_message": {
      const text = asString(item.text)
      if (!text) return null
      return {
        id,
        time,
        role: "agent",
        type: "agent_message_chunk",
        data: { content: text, ...(itemModelOf(item) ? { model: itemModelOf(item) } : {}), ...(itemUsageOf(item) ? { usage: itemUsageOf(item) } : {}) },
      }
    }
    case "reasoning": {
      const text = asString(item.text)
      if (!text) return null
      return {
        id,
        time,
        role: "agent",
        type: "agent_thought_chunk",
        data: { content: text, ...(itemModelOf(item) ? { model: itemModelOf(item) } : {}), ...(itemUsageOf(item) ? { usage: itemUsageOf(item) } : {}) },
      }
    }
    case "error": {
      const text = asString(item.text) || "运行时报告错误"
      return { id, time, role: "agent", type: "error_message", data: { text } }
    }
    case "tool_call":
    case "command_execution":
    case "mcp_tool_call":
    case "file_change":
    case "web_search": {
      const toolName = asString(item.title)
      const input = (item.input && typeof item.input === "object" ? item.input : {}) as Record<string, unknown>
      return {
        id,
        time,
        role: "agent",
        type: "tool_call",
        data: {
          kind: kindForTool(toolName),
          title: toolName,
          status: mapStatus(item.status),
          rawInput: input,
          rawOutput: item.output,
          content: outputText(item.output),
          ...(buildToolMeta(toolName, input, item.output)
            ? { _meta: { claudeCode: { toolResponse: buildToolMeta(toolName, input, item.output) } } }
            : {}),
        },
      }
    }
    default:
      return null
  }
}

/**
 * Fold a later report of an item onto the earlier one.
 *
 * Only fields the new report actually carries win. A tool call's completion
 * frame is sparse — `{id, type, output, status}` — so a blind spread would erase
 * the `title` and `input` that only the opening frame had, turning a finished
 * card into an untitled blank. Text is replaced rather than concatenated because
 * the runtime re-sends the full text of a block, not a delta.
 *
 * Shared by the replay reducer and the live stream client so both merge the
 * same way on `logical_event_id`.
 */
export function mergeItems(previous: NormalizedItem, next: NormalizedItem): NormalizedItem {
  const merged = { ...previous } as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null) continue
    if (typeof value === "string" && !value) continue
    merged[key] = value
  }
  return merged as unknown as NormalizedItem
}

/**
 * Reduce an ordered list of items into (root messages, sub-agents).
 *
 * Root messages are the main transcript. Items carrying a non-empty `agent_id`
 * belong to a sub-agent: they are accumulated into the matching
 * `EditorSessionSubAgent` and a single inline entry is inserted at the first
 * item's position so the user can open that sub-agent's detail. Reused by both
 * live and replay so a refresh produces the same structure.
 *
 * A failed turn is reported twice (provider assistant text + runtime error
 * frame); :func:`collapseErrorDuplicates` folds them into one error card.
 */
/** Logical id behind a root-item message, for per-turn error boundaries.
 *
 * Root items carry id `item-<logicalId>` (see :func:`rootMessageIdFor`); the
 * slice recovers the logical id so two cards from two different turns (different
 * logical ids) are not treated as repeats of one another. Positional ids
 * (`user-N-M`, `subagent-entry-…`) have no logical id and each form their own
 * boundary. */
function logicalIdOf(message: MessageType): string {
  return message.id.startsWith("item-") ? message.id.slice("item-".length) : message.id
}

/**
 * One upstream failure reaches the transcript twice: the provider echoes the
 * error text as an `agent_message`, then the runtime's own error frame repeats
 * it. Rendering both showed the same "API Error: 429 …" as a plain bubble plus
 * an error card. Collapse them to ONE error card: the card is the canonical
 * presentation (it carries the retry affordance), so an `error_message` whose
 * text matches an earlier plain agent bubble of the same turn replaces it in
 * place, and a later `error_message` repeating the same text *and* logical id
 * (the live twin beside its persisted replay) is dropped.
 *
 * The dedupe key is `(text, logical_id)`, not text alone: the same provider
 * error text in two real turns has different logical ids and must both render.
 * Text-only keying swallowed the second turn's card whenever the turn boundary
 * — the user's own message — was missing from the rendered set, which was the
 * "first message gone → later errors disappear" symptom.
 *
 * Applied to both the replay reducer's output and the live∪replay merge, so a
 * failed turn renders exactly one card whether it is on screen live, replayed
 * after a refresh, or both.
 */
export function collapseErrorDuplicates(messages: MessageType[]): MessageType[] {
  const seenErrorKeys = new Set<string>()
  const out: MessageType[] = []
  let turnStart = 0
  for (const message of messages) {
    if (message.role === "user") {
      seenErrorKeys.clear()
      turnStart = out.length
      out.push(message)
      continue
    }
    if (message.type === "agent_message_chunk") {
      out.push(message)
      continue
    }
    if (message.type !== "error_message") {
      out.push(message)
      continue
    }
    const text = String(message.data.text || "")
    if (!text) {
      out.push(message)
      continue
    }
    const logicalId = logicalIdOf(message)
    // A plain bubble already carries this text: upgrade it to the error card
    // in place, keeping the timeline position. The twin always sits inside the
    // current turn (the provider text precedes the error frame).
    const bubbleIndex = out.findIndex((m, index) => (
      index >= turnStart
      && m.type === "agent_message_chunk"
      && String(m.data.content || "") === text
    ))
    if (bubbleIndex >= 0) {
      out[bubbleIndex] = message
      seenErrorKeys.add(`${text}::${logicalId}`)
      continue
    }
    // The same failure already has its card (same logical id): drop the repeat.
    const key = `${text}::${logicalId}`
    if (seenErrorKeys.has(key)) continue
    seenErrorKeys.add(key)
    out.push(message)
  }
  return out
}

/**
 * Reduce an ordered list of items into (root messages, sub-agents).
 *
 * Root messages are the main transcript. Items carrying a non-empty `agent_id`
 * belong to a sub-agent: they are accumulated into the matching
 * `EditorSessionSubAgent` and a single inline entry is inserted at the first
 * item's position so the user can open that sub-agent's detail. Reused by both
 * live and replay so a refresh produces the same structure.
 */
export function reduceItems(rows: { item: NormalizedItem; agentId: AgentId; seq: number }[]): {
  messages: MessageType[]
  subAgents: EditorSessionSubAgent[]
} {
  const messages: MessageType[] = []
  const subAgentMap = new Map<AgentId, EditorSessionSubAgent>()
  const subAgentSeenInline = new Set<AgentId>()
  // Per-sub-agent merged raw items by id, mirroring the root branch's rawById:
  // a sub-agent's tool call also arrives twice (opening frame with title/input,
  // closing frame with only output/status), and the closing frame must update
  // the opening card rather than stack a forever-running twin beside it.
  const subAgentRawById = new Map<AgentId, Map<string, NormalizedItem>>()
  // Position of each already-emitted message id, so a re-sent item updates its
  // entry in place. The runtime reports one logical item several times as it
  // advances (a tool call arrives `running`, then again `done` with its output)
  // and every report is persisted as its own row. Appending each one rendered
  // the same tool call twice — the first copy stuck at `in_progress`, spinning
  // forever beside its own completed twin. The live reducer has always replaced
  // by id; this makes replay agree with it.
  const indexById = new Map<string, number>()
  // Latest merged raw item per id, so each new report builds on the last.
  const rawById = new Map<string, NormalizedItem>()

  for (const { item, agentId, seq } of rows) {
    if (agentId) {
      // First sighting of this sub-agent → insert an inline entry in the root
      // transcript so the conversation marks where the sub-agent's turn began.
      if (!subAgentSeenInline.has(agentId)) {
        subAgentSeenInline.add(agentId)
        const existing = subAgentMap.get(agentId)
        messages.push({
          id: `subagent-entry-${agentId}`,
          // The entry card sits at the sub-agent's first frame; show that
          // frame's time, not 0.
          time: item.created_at ?? 0,
          role: "system",
          type: "system_message",
          data: { text: existing?.name || `子 Agent ${agentId.slice(0, 8)}`, toolCallId: agentId },
        })
      }
      // Fold the item into the sub-agent record. Status comes from the item —
      // replay delivers the merged `done`/`failed` frame, and hard-coding
      // "running" here is what left sub-agent cards spinning after a refresh.
      const prev = subAgentMap.get(agentId)
      const name = asString(item.agent_name) || prev?.name || `子 Agent ${agentId.slice(0, 8)}`
      const task = asString(item.task) || prev?.task || ""
      // Sub-agent overall status: once a `done` frame lands on any item, the
      // agent has finished; a later `running` frame must not resurrect it.
      const agentDone = prev?.status === "done" || item.status === "done"
      if (item.type === "agent_message") {
        const text = asString(item.text)
        subAgentMap.set(agentId, {
          ...prev!,
          id: agentId,
          name,
          task,
          status: agentDone ? "done" : "running",
          content: (prev?.content || "") + (prev?.content ? "\n" : "") + text,
          toolCalls: prev?.toolCalls || [],
        })
      } else if (item.type === "tool_call" || item.type === "command_execution" || item.type === "mcp_tool_call") {
        // Merge by id onto the previous report of the same tool call: the
        // closing frame carries only output/status, so a fresh entry would
        // lose the opening frame's title/input and never reach `done`.
        const rawMap = subAgentRawById.get(agentId) || new Map<string, NormalizedItem>()
        subAgentRawById.set(agentId, rawMap)
        const key = String(item.id ?? asString(item.title))
        const previousRaw = rawMap.get(key)
        const merged = previousRaw ? mergeItems(previousRaw, item) : item
        rawMap.set(key, merged)
        const mergedStatus = asString(merged.status) || "done"
        const toolCall = {
          name: asString(merged.title),
          args: merged.input ?? {},
          result: merged.output,
          // toolCalls only model running|done; a failed call still produced a
          // result, so it is `done` (the error is in the result text).
          status: (mergedStatus === "running" ? "running" : "done") as "running" | "done",
        }
        subAgentMap.set(agentId, {
          ...prev!,
          id: agentId,
          name,
          task,
          status: agentDone ? "done" : "running",
          content: prev?.content || "",
          toolCalls: [...(prev?.toolCalls || []), toolCall],
        })
      }
      continue
    }
    // Merge onto the previous report rather than replacing it: a tool call's
    // completion carries only `output` and `status`, so overwriting would drop
    // the `title` and `input` that arrived with the opening report and leave the
    // card blank.
    const key = String(item.id ?? seq)
    const previous = rawById.get(key)
    const merged = previous ? mergeItems(previous, item) : item
    rawById.set(key, merged)
    const msg = itemToRootMessage(merged, seq)
    if (!msg) continue
    const existing = indexById.get(msg.id)
    if (existing !== undefined) {
      messages[existing] = msg
      continue
    }
    indexById.set(msg.id, messages.length)
    messages.push(msg)
  }

  return { messages: collapseErrorDuplicates(messages), subAgents: [...subAgentMap.values()] }
}
