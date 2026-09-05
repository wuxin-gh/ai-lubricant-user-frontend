/**
 * Agent SSE 事件 → 展示态消息的纯函数归约层。
 *
 * `/agent/conversations/{id}/messages` 的 SSE 每行是一个 JSON 事件；这里把一个
 * 事件不可变地应用到一条 assistant 消息上。抽成独立模块是为了让用户侧 Agent 对话页
 * 与节点终端的 AI 助手面板共用同一套事件语义——两边渲染不同，但「事件怎么改变消息」
 * 必须一致，否则同一个后端流在两个页面会显示出不同的结果。
 */
import type { AgentDisplayMessage } from "./agent-message-list"

export type AgentStreamEvent = Record<string, unknown> & {
  type?: string
  text?: string
  name?: string
  args?: unknown
  data?: unknown
  message?: string
  /** Batch approval command list; single-command approvals may omit it. */
  commands?: unknown[]
  attempt?: number
  max?: number
  reason?: string
  scope?: string
  delay_ms?: number
  subagent_id?: string | number
  subagent_name?: string
  task?: string
  summary?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cached_tokens?: number
    cache_creation_tokens?: number
    reasoning_tokens?: number
    /** 个别上游用 input/output 命名，归一时已转成 prompt/completion，这里留兼容。 */
    input_tokens?: number
    output_tokens?: number
  }
  model?: string
}

/** 一条待管理员裁决的节点命令审批。 */
export interface AgentApprovalRequest {
  confirmationId: string
  toolName: string
  /** 一次审批可能覆盖多条命令（同轮批量授权）；单命令时长度为 1。 */
  commands: string[]
  /** 兼容字段：commands[0] 或后端返回的合并文本。 */
  command: string
  message: string
  nodeId: string
  shellFlavor: string
  commandHash: string
  /**
   * 到期时刻，**毫秒**时间戳，可直接与 Date.now() 比较；0 表示不过期。
   *
   * 协议上后端发的是 POSIX 秒（approvals.py 的 expires_at），秒→毫秒的换算只在
   * 下面两个归一函数里做一次。别在消费侧再乘一遍：早先各页面直接拿秒去和
   * Date.now() 比，恒成立，卡片出现一秒后就被判过期。
   */
  expiresAt: number
  /** 本地裁决态：提交中 / 已裁决 / 已过期 / 服务重启导致中断。 */
  state: "pending" | "submitting" | "allowed" | "denied" | "expired" | "interrupted"
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * 后端 expires_at（POSIX 秒）→ 毫秒时间戳。缺失/0 保持 0，表示不过期。
 */
function expiresAtMs(raw: unknown): number {
  const seconds = Number(raw ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return seconds * 1000
}

function readCommands(event: Record<string, unknown>): string[] {
  const raw = event.commands
  if (Array.isArray(raw)) {
    const list = raw.map((item) => String(item ?? "").trim()).filter(Boolean)
    if (list.length) return list
  }
  const single = String(event.command ?? "").trim()
  return single ? [single] : []
}

/** 从 `confirmation_required` 事件构造一张审批卡。 */
export function approvalFromEvent(event: AgentStreamEvent): AgentApprovalRequest | null {
  const confirmationId = String(event.confirmation_id ?? "")
  if (!confirmationId) return null
  const commands = readCommands(event as Record<string, unknown>)
  return {
    confirmationId,
    toolName: String(event.tool_name ?? "node_shell_exec"),
    commands,
    command: commands[0] ?? String(event.command ?? ""),
    message: String(event.message ?? ""),
    nodeId: String(event.node_id ?? ""),
    shellFlavor: String(event.shell_flavor ?? "unknown"),
    commandHash: String(event.command_hash ?? ""),
    expiresAt: expiresAtMs(event.expires_at),
    metadata: typeof event.metadata === "object" && event.metadata ? event.metadata as Record<string, unknown> : undefined,
    state: "pending",
  }
}

/** 后端 `GET .../approvals` 的一行 → 审批卡（重连后恢复未决审批用）。 */
export function approvalFromRow(row: Record<string, unknown>): AgentApprovalRequest | null {
  const confirmationId = String(row.confirmation_id ?? "")
  if (!confirmationId) return null
  const resolved = String(row.resolved ?? row.status ?? "pending")
  const state: AgentApprovalRequest["state"] = resolved === "allow"
    ? "allowed"
    : resolved === "deny"
      ? "denied"
      : resolved === "timeout"
        ? "expired"
        : resolved === "interrupted"
          ? "interrupted"
          : "pending"
  const commands = readCommands(row)
  return {
    confirmationId,
    toolName: String(row.tool_name ?? "node_shell_exec"),
    commands,
    command: commands[0] ?? String(row.command ?? ""),
    message: String(row.message ?? ""),
    nodeId: String(row.node_id ?? ""),
    shellFlavor: String(row.shell_flavor ?? "unknown"),
    commandHash: String(row.command_hash ?? ""),
    expiresAt: expiresAtMs(row.expires_at),
    metadata: typeof row.metadata === "object" && row.metadata ? row.metadata as Record<string, unknown> : undefined,
    state,
  }
}

function appendTextSegment(segments: AgentDisplayMessage["segments"], text: string): AgentDisplayMessage["segments"] {
  if (!text) return segments
  const next = [...(segments || [])]
  const last = next[next.length - 1]
  if (last?.kind === "text") {
    next[next.length - 1] = { kind: "text", text: last.text + text }
  } else {
    next.push({ kind: "text", text })
  }
  return next
}

// 把后端透传的 status 字符串归一为 AttachmentMediaPart 的字面量联合；
// 直接写 `status === "active" || ... ? status : undefined` 进对象字面量会被 TS
// 做字面量拓宽成 string，这里用显式返回类型的函数提供上下文类型以避免拓宽。
function mediaStatus(value: unknown): "active" | "expired" | "purged" | undefined {
  return value === "active" || value === "expired" || value === "purged" ? value : undefined
}

// 将一个 SSE 事件不可变地应用到某条 assistant 消息。
export const applyAssistantEvent = (
  msg: AgentDisplayMessage,
  event: AgentStreamEvent,
): AgentDisplayMessage => {
  const t = event?.type
  if (t === "confirmation_required") {
    // 审批卡按到达顺序进时间线，与文字/工具卡同一条队列——否则它会被固定渲染在
    // 气泡末尾，看起来像「模型的新输出跑到审批卡上面」。
    const approval = approvalFromEvent(event)
    if (!approval) return msg
    const approvals = [...(msg.approvals || []), approval]
    return {
      ...msg,
      retry: undefined,
      approvals,
      segments: [...(msg.segments || []), { kind: "approval", index: approvals.length - 1 }],
    }
  }
  if (t === "retry") {
    return {
      ...msg,
      retry: {
        attempt: Number(event.attempt ?? 0),
        max: Number(event.max ?? 0),
        reason: String(event.reason ?? ""),
        scope: event.scope,
        delayMs: Number(event.delay_ms ?? 0) || undefined,
      },
    }
  }
  if (t === "content") {
    const text = event.text ?? ""
    return {
      ...msg,
      content: (msg.content ?? "") + text,
      retry: undefined,
      segments: appendTextSegment(msg.segments, text),
    }
  }
  if (t === "reasoning") {
    // 思考与正文分开累积：后端 agent_loop 把 reasoning 增量单独成事件，
    // 这里只喂 reasoning 字段，绝不拼进 content。
    return { ...msg, reasoning: (msg.reasoning ?? "") + (event.text ?? ""), retry: undefined }
  }
  if (t === "tool_call") {
    const toolCalls = [...msg.toolCalls, { name: String(event.name || "unknown"), args: event.args, status: "running" as const }]
    return {
      ...msg,
      retry: undefined,
      toolCalls,
      segments: [...(msg.segments || []), { kind: "tool", index: toolCalls.length - 1 }],
    }
  }
  if (t === "tool_result") {
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : null
    // show_file 工具：kind=attachment 带 id（工作区文件），kind=url 直接透传公网地址。
    const isShowFile = String(event.name || "") === "show_file"
    const attachmentId = Number(data?.id)
    const url = typeof data?.url === "string" ? data.url : undefined
    const key = Number.isFinite(attachmentId) ? attachmentId : url
    const part = isShowFile && data && key != null
      ? {
          type: "attachment" as const,
          attachment_id: Number.isFinite(attachmentId) ? attachmentId : undefined,
          url,
          name: typeof data.name === "string" ? data.name : undefined,
          mime_type: typeof data.mime_type === "string" ? data.mime_type : undefined,
          size: typeof data.size === "number" ? data.size : undefined,
          status: mediaStatus(data.status),
          expires_at: typeof data.expires_at === "string" ? data.expires_at : undefined,
        }
      : null
    const media = part
      ? [...(msg.media || []).filter((p) => (p.attachment_id ?? p.url) !== key), part]
      : msg.media
    return {
      ...msg,
      media,
      toolCalls: msg.toolCalls.map((x) =>
        x.name === event.name && x.status === "running"
          ? { ...x, result: event.data, status: "done" as const }
          : x,
      ),
    }
  }
  if (t === "question") {
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}
    const question = String(data.question ?? event.message ?? "需要补充信息")
    // ask_user 现在可带 media（合并了原 show_file）：附件/图片随问题一起渲染。
    const rawMedia = Array.isArray(data.media) ? data.media as Array<Record<string, unknown>> : []
    const parts = rawMedia
      .map((item) => {
        const attachmentId = Number(item.id ?? item.attachment_id)
        const url = typeof item.url === "string" ? item.url : undefined
        if (!Number.isFinite(attachmentId) && !url) return null
        return {
          type: "attachment" as const,
          attachment_id: Number.isFinite(attachmentId) ? attachmentId : undefined,
          url,
          name: typeof item.name === "string" ? item.name : undefined,
          mime_type: typeof item.mime_type === "string" ? item.mime_type : undefined,
          size: typeof item.size === "number" ? item.size : undefined,
          status: mediaStatus(item.status),
          expires_at: typeof item.expires_at === "string" ? item.expires_at : undefined,
        }
      })
      .filter((part): part is NonNullable<typeof part> => part !== null)
    const media = parts.length ? [...(msg.media || []), ...parts] : msg.media
    return {
      ...msg,
      media,
      content: `${msg.content ? `${msg.content}\n\n` : ""}${question}`,
      segments: appendTextSegment(msg.segments, `${msg.segments?.length ? "\n\n" : ""}${question}`),
      status: "done" as const,
      retry: undefined,
    }
  }
  if (t === "done") {
    // done 事件带 token usage（agent_loop 累积的 prompt/completion/total/cached/cache_creation/reasoning）；
    // 落到消息上，刷新后 pickLatestUsage 仍能从历史消息恢复徽章显示。
    return { ...msg, status: "done" as const, model: event.model || msg.model, usage: event.usage, retry: undefined }
  }
  if (t === "error") {
    return { ...msg, status: "error" as const, error: String(event.message ?? "出错"), retry: undefined }
  }
  if (t === "subagent_start") {
    return {
      ...msg,
      subagents: [
        ...msg.subagents,
        {
          id: String(event.subagent_id || "subagent"),
          name: String(event.subagent_name || "子 Agent"),
          task: String(event.task || ""),
          status: "running" as const,
          content: "",
          toolCalls: [],
        },
      ],
    }
  }
  if (t === "subagent_end") {
    return {
      ...msg,
      subagents: msg.subagents.map((s) =>
        s.id === String(event.subagent_id)
          ? { ...s, status: "done" as const, summary: event.summary ?? s.summary }
          : s,
      ),
    }
  }
  if (t === "subagent_content") {
    return {
      ...msg,
      subagents: msg.subagents.map((s) =>
        s.id === String(event.subagent_id) ? { ...s, content: (s.content ?? "") + (event.text ?? "") } : s,
      ),
    }
  }
  if (t === "subagent_tool_call") {
    return {
      ...msg,
      subagents: msg.subagents.map((s) =>
        s.id === String(event.subagent_id)
          ? { ...s, toolCalls: [...s.toolCalls, { name: String(event.name || "unknown"), args: event.args, status: "running" as const }] }
          : s,
      ),
    }
  }
  if (t === "subagent_tool_result") {
    return {
      ...msg,
      subagents: msg.subagents.map((s) =>
        s.id === String(event.subagent_id)
          ? {
              ...s,
              toolCalls: s.toolCalls.map((x) =>
                x.name === event.name && x.status === "running"
                  ? { ...x, result: event.data, status: "done" as const }
                  : x,
              ),
            }
          : s,
      ),
    }
  }
  return msg
}
