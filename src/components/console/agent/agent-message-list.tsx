import { useEffect, useState } from "react"
import { Bot, Brain, ChevronDown, ChevronRight, Download, FileText, Image as ImageIcon, RefreshCw, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ImagePreview } from "@/components/common/image-preview"
import { Markdown } from "@/components/common/markdown"
import { isPreviewableImage, isSafeImageSource } from "@/lib/media-url"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { renewAttachment, type AgentMessage, type AttachmentMediaPart } from "@/api/agentClient"
import type { AgentApprovalRequest } from "./agent-stream-events"

export interface AgentToolCallDisplay {
  name: string
  args: unknown
  result?: unknown
  status: "running" | "done"
}

export interface AgentSubagentDisplay {
  id: string
  name: string
  task: string
  status: "running" | "done"
  content: string
  toolCalls: AgentToolCallDisplay[]
  summary?: string
}

/**
 * 按到达顺序排列的一段内容：一段正文文字或一次工具调用。
 * 用于把「AI 说了什么」和「紧接着做了什么」按真实发生顺序交织渲染，
 * 而不是把所有工具卡堆在上面、把整段文字堆在最下面。
 * - text：一段模型正文（content 事件分块累积；遇到 tool_call 就断开成新段）
 * - tool：引用 message.toolCalls[index]，工具结果回到该 index 上更新
 * - approval：引用 message.approvals[index]。审批卡必须进时间线，否则第 2 步
 *   触发的审批会渲染在第 6 步的工具卡下面——用户看到的是「卡片永远在最下方，
 *   模型新输出跑到卡片上面去了」。
 */
export type AgentSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; index: number }
  | { kind: "approval"; index: number }

export interface AgentDisplayMessage {
  id: string
  role: "user" | "assistant"
  content: string
  status: "pending" | "streaming" | "done" | "error"
  error?: string
  model?: string
  createdAt?: string
  retry?: {
    attempt: number
    max: number
    reason: string
    scope?: string
    delayMs?: number
  }
  /** 模型思考(reasoning)全文，与 content 分开累积；折叠展示，不参与上下文回灌。 */
  reasoning?: string
  /** done 事件携带的 token 用量；pickLatestUsage 从历史消息恢复徽章用。 */
  usage?: Record<string, unknown>
  toolCalls: AgentToolCallDisplay[]
  subagents: AgentSubagentDisplay[]
  approvals?: AgentApprovalRequest[]
  media?: AttachmentMediaPart[]
  /** 按到达顺序交织的文字/工具段；仅流式新消息有，历史回灌消息为 undefined 走旧版分组渲染。 */
  segments?: AgentSegment[]
}

const safeParseArgs = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const mergeAgentToolResults = (
  rawToolCalls: unknown[],
  results: unknown[] | null | undefined,
): AgentToolCallDisplay[] => {
  const toolCalls: AgentToolCallDisplay[] = (rawToolCalls || []).map((raw) => {
    if (!raw || typeof raw !== "object") {
      return { name: "unknown", args: {}, status: "done" as const }
    }
    const record = raw as Record<string, unknown>
    if ("name" in record) {
      return { name: String(record.name || "unknown"), args: record.args ?? {}, status: "done" as const }
    }
    const fn = record.function && typeof record.function === "object"
      ? (record.function as Record<string, unknown>)
      : undefined
    return {
      name: String(fn?.name || "unknown"),
      args: typeof fn?.arguments === "string" ? safeParseArgs(fn.arguments) : fn?.arguments ?? {},
      status: "done" as const,
    }
  })
  if (!Array.isArray(results) || results.length === 0) return toolCalls
  return toolCalls.map((toolCall, index) => {
    const result = results[index]
    return result != null ? { ...toolCall, result, status: "done" as const } : toolCall
  })
}

const truncate = (value: unknown, length: number) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!text) return ""
  return text.length > length ? text.slice(0, length) + "…" : text
}

/**
 * 把落库的 AgentMessage（role=user|assistant，含 tool_calls/tool_results）转成
 * 展示态 AgentDisplayMessage，供历史回放/定时任务执行记录详情复用。
 *
 * 与 agent-chat.tsx 的实时回灌共用同一份映射口径——streaming/pending 在无对应
 * 实时流时降级为中断态，否则会永远显示「思考中…」。tool_calls 走
 * mergeAgentToolResults 配对上 tool_results。
 */
export function agentMessagesToDisplay(history: AgentMessage[]): AgentDisplayMessage[] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const rawStatus = (message.status as AgentDisplayMessage["status"]) || "done"
      const stuckStreaming = rawStatus === "streaming" || rawStatus === "pending"
      return {
        id: String(message.id),
        role: message.role as "user" | "assistant",
        content: message.content || "",
        status: stuckStreaming ? "error" : rawStatus,
        error: stuckStreaming ? "任务未正常结束（可能已中断或在后台继续运行，重新发送即可恢复）" : message.error || undefined,
        model: message.model || undefined,
        createdAt: message.created_at,
        reasoning: message.reasoning || undefined,
        toolCalls: mergeAgentToolResults(message.tool_calls || [], message.tool_results),
        subagents: [],
        approvals: [],
        media: message.media || undefined,
        usage: message.usage || undefined,
      }
    })
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

const formatFileSize = (size?: number) => {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

const formatDate = (value?: string) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

/** media part 渲染：图片内联大图，其它文件显示为下载/续期卡。 */
function MediaPartView({ part }: { part: AttachmentMediaPart }) {
  const [renewing, setRenewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState(part.status)
  const [expiresAt, setExpiresAt] = useState(part.expires_at)
  const mime = part.mime_type || ""
  const isImage = mime.startsWith("image/")
  const isPreviewable = isImage && isPreviewableImage({ mime, name: part.name })
  const isExpired = status === "expired"
  const isPurged = status === "purged"
  const renewable = !isPurged

  // 图片来源优先级：服务端签名 content_url（免登录）> 公网 url > 裸 id 登录态端点。
  const safeSignedContent = isSafeImageSource(part.content_url) ? part.content_url : ""
  const safePartUrl = isSafeImageSource(part.url) ? part.url : ""
  const imgSrc = isPreviewable
    ? (safeSignedContent || safePartUrl || (part.attachment_id != null ? `/agent/attachments/${part.attachment_id}/content` : ""))
    : ""
  const safeImgSrc = isSafeImageSource(imgSrc) ? imgSrc : ""
  const thumbnailSrc = isSafeImageSource(part.thumbnail_url)
    ? part.thumbnail_url
    : (part.attachment_id != null ? `/agent/attachments/${part.attachment_id}/thumbnail` : "")

  const handleRenew = async () => {
    if (!renewable || renewing || part.attachment_id == null) return
    setRenewing(true)
    setError(null)
    try {
      const meta = await renewAttachment(part.attachment_id)
      setStatus(meta.status ?? "active")
      setExpiresAt(meta.expires_at ?? expiresAt)
    } catch (e) {
      setError((e as Error).message || "续期失败")
    } finally {
      setRenewing(false)
    }
  }

  if (isPreviewable && safeImgSrc && !isPurged && !isExpired) {
    return (
      <ImagePreview
        src={safeImgSrc}
        alt={part.name || "图片"}
        title={part.name}
        imageClassName="max-h-80 rounded-md border border-border/60"
        triggerClassName="max-w-full"
      />
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs">
      {isPreviewable && !isPurged && part.attachment_id != null ? (
        isSafeImageSource(thumbnailSrc) ? (
          <ImagePreview
            src={thumbnailSrc}
            alt={part.name || "附件"}
            title={part.name}
            imageClassName="size-10 rounded object-cover"
          />
        ) : (
          <img
            src={thumbnailSrc}
            alt={part.name || "附件"}
            className="size-10 rounded object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )
      ) : (
        <div className="flex size-10 items-center justify-center rounded bg-muted">
          {isImage ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{part.name || "未命名文件"}</div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="truncate">{formatFileSize(part.size) || (part.url ? "网络文件" : "未知大小")}</span>
          {mime && <span className="truncate">· {mime}</span>}
          {expiresAt && (
            <span className={cn("truncate", isExpired && "text-amber-500")}>
              · {isPurged ? "已清理" : isExpired ? `已过期 ${formatDate(expiresAt)}` : `至 ${formatDate(expiresAt)}`}
            </span>
          )}
        </div>
        {error && <div className="text-destructive">{error}</div>}
      </div>
      {!isPurged && !isExpired && (
        part.attachment_id != null ? (
          <a
            href={`/agent/attachments/${part.attachment_id}/content`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="下载或预览附件"
            title="下载/预览"
          >
            <Download className="size-4" />
          </a>
        ) : safePartUrl ? (
          <a
            href={safePartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="在新标签打开附件"
            title="打开"
          >
            <Download className="size-4" />
          </a>
        ) : null
      )}
      {renewable && isExpired && (
        <Button size="sm" variant="outline" onClick={handleRenew} disabled={renewing} className="h-7 px-2 text-[11px]">
          {renewing ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
          续期
        </Button>
      )}
    </div>
  )
}

function ToolCallCard({ toolCall }: { toolCall: AgentToolCallDisplay }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs">
      <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((value) => !value)}>
        {toolCall.status === "running" ? <Spinner className="size-3" /> : <Wrench className="size-3 text-muted-foreground" />}
        <span className="font-medium">{toolCall.name}</span>
        <span className="ml-auto text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-border/60 px-2 py-1.5">
          <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">参数: {truncate(toolCall.args, 400)}</pre>
          {toolCall.result != null && (
            <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">结果: {truncate(toolCall.result, 800)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 审批卡剩余时间文案。expiresAt 为 0 表示后端配成了「不过期」。
 *
 * 只在 pending 且有到期时刻时才起每秒定时器，裁决完/不过期的卡片不空转。
 */
function useApprovalCountdown(expiresAt: number, active: boolean): string {
  const [now, setNow] = useState(() => Date.now())
  const ticking = active && expiresAt > 0
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  if (!active) return ""
  if (expiresAt <= 0) return "不过期，等你裁决"
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000))
  if (seconds <= 0) return "已超时"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`
  if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `剩余 ${minutes} 分 ${seconds % 60} 秒`
  return `剩余 ${seconds} 秒`
}

function ApprovalCard({
  approval,
  onApproval,
}: {
  approval: AgentApprovalRequest
  onApproval?: (approval: AgentApprovalRequest, result: "allow" | "deny") => void
}) {
  const multi = approval.commands.length > 1
  const remaining = useApprovalCountdown(approval.expiresAt, approval.state === "pending")
  const codeRuns = Array.isArray(approval.metadata?.runs)
    ? approval.metadata.runs as Array<Record<string, unknown>>
    : []
  const isCodeRun = approval.toolName === "code_run"
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <div className="font-medium">
        {isCodeRun
          ? (multi ? `代码执行审批（${approval.commands.length} 段，需一并授权）` : "代码执行审批")
          : (multi ? `命令执行审批（${approval.commands.length} 条，需一并授权）` : "命令执行审批")}
      </div>
      {approval.message ? <div className="mt-1 text-muted-foreground">{approval.message}</div> : null}
      <div className="mt-2 space-y-1">
        {isCodeRun && codeRuns.length > 0
          ? codeRuns.map((run, index) => (
            <div key={index} className="space-y-1 rounded bg-background/60 p-2">
              <div className="text-muted-foreground">{String(run.type || "python")} · SHA-256 {String(run.code_hash || "")}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{String(run.code || "")}</pre>
            </div>
          ))
          : (approval.commands.length ? approval.commands : [approval.command]).map((command, index) => (
            <pre key={index} className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px]">{command}</pre>
          ))}
      </div>
      {approval.nodeId || approval.shellFlavor ? (
        <div className="mt-1 text-muted-foreground">
          {approval.nodeId ? `节点：${approval.nodeId}` : ""}
          {approval.nodeId && approval.shellFlavor ? " · " : ""}
          {approval.shellFlavor ? `Shell：${{ powershell: "PowerShell", cmd: "CMD", posix: "POSIX", unknown: "未知" }[approval.shellFlavor] || approval.shellFlavor}` : ""}
        </div>
      ) : null}
      {approval.error ? <div className="mt-1 text-destructive">{approval.error}</div> : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {approval.state === "pending" && (
          <span className="mr-auto text-muted-foreground">{remaining}</span>
        )}
        {approval.state === "pending" ? (
          onApproval ? (
            <>
              <Button size="sm" variant="outline" onClick={() => onApproval(approval, "deny")}>{multi ? "全部拒绝" : "拒绝"}</Button>
              <Button size="sm" onClick={() => onApproval(approval, "allow")}>{multi ? "全部允许" : "允许执行"}</Button>
            </>
          ) : (
            <Badge variant="secondary">待审批</Badge>
          )
        ) : approval.state === "submitting" ? (
          <span className="flex items-center gap-1 text-muted-foreground"><Spinner className="size-3" />提交中…</span>
        ) : (
          <Badge variant="secondary">{{
            allowed: "已允许",
            denied: "已拒绝",
            // 超时后端会中止本轮（不再把「被拒绝」喂回模型继续跑），把这点写进文案，
            // 免得用户以为还在后台跑。
            expired: "已过期 · 本轮已中止",
            interrupted: "已中断",
          }[approval.state]}</Badge>
        )}
      </div>
    </div>
  )
}

/** 重试 scope → 中文短标签。仅 agent 自身两层重试会发 retry 事件（见 agent_loop.py）。 */
const RETRY_SCOPE_LABELS: Record<string, string> = {
  network: "网络异常",
  stream: "上游异常",
}

const RETRY_REASON_CLAMP = 140

/**
 * 重试倒计时：把「还要等多久」变成可见的秒数。
 *
 * 后端 retry 事件只带 delay_ms（本次退避时长），不带截止时刻——事件到达前端的那一刻
 * 才是计时起点，所以 deadline 只能在这里算，并且只在「换了一次重试」时重算。
 *
 * 返回 null 表示这次重试没有退避等待（delay_ms 缺失/为 0），此时不显示倒计时。
 */
function useRetryCountdown(retry: AgentDisplayMessage["retry"]): number | null {
  const delayMs = retry?.delayMs ?? 0
  // 同一次重试的身份。依赖它而不是 retry 对象：流式 content 一直在刷新父组件，
  // 按对象比较会每次重渲染都把 deadline 拨回满值，倒计时永远停在起点。
  const key = `${retry?.scope ?? ""}#${retry?.attempt ?? 0}`
  const [deadline, setDeadline] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (delayMs <= 0) {
      setDeadline(0)
      return
    }
    setNow(Date.now())
    setDeadline(Date.now() + delayMs)
  }, [key, delayMs])

  useEffect(() => {
    if (deadline <= 0) return
    // 每 250ms 刷新，秒数跳变看起来才跟手；到点即停，不留空转定时器。
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= deadline) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [deadline])

  if (deadline <= 0) return null
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

/**
 * 重试提示条。三件事：第几次 / 还有多久 / 为什么。
 *
 * 异常原文可能是一整段上游 JSON，默认截断到一行，点「展开」看全文——否则一次 429
 * 的 detail 就能把整个气泡顶下去，正文反而看不见了。
 */
function RetryNotice({ retry }: { retry: NonNullable<AgentDisplayMessage["retry"]> }) {
  const [expanded, setExpanded] = useState(false)
  const seconds = useRetryCountdown(retry)
  const scopeLabel = retry.scope ? RETRY_SCOPE_LABELS[retry.scope] || retry.scope : ""
  const reason = retry.reason || ""
  const clamped = reason.length > RETRY_REASON_CLAMP
  const shownReason = expanded || !clamped ? reason : reason.slice(0, RETRY_REASON_CLAMP) + "…"
  // 按「第 n/m 次重试」说明进度；无 max（如纯网络重试）则只说「正在重试」。
  const headline = retry.max > 0
    ? `第 ${retry.attempt}/${retry.max} 次重试`
    : "正在重试"

  return (
    <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
        <Spinner className="size-3 shrink-0" />
        <span className="font-medium">{headline}</span>
        {scopeLabel && <span className="opacity-70">· {scopeLabel}</span>}
        {seconds != null && (
          <span className="ml-auto shrink-0 tabular-nums opacity-80">
            {seconds > 0 ? `${seconds}s 后重试` : "正在发起…"}
          </span>
        )}
      </div>
      {reason && (
        <div className="text-muted-foreground">
          <span className="whitespace-pre-wrap break-all">{shownReason}</span>
          {clamped && (
            <button
              type="button"
              className="ml-1 shrink-0 underline underline-offset-2 hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 折叠的思考过程块：流式 reasoning 增量的展示容器。默认展开，便于实时观察。 */
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 text-xs">
      <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Brain className="size-3 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">思考过程</span>
        {streaming && <Spinner className="size-3" />}
        <span className="ml-auto text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="border-t border-border/60 px-2 py-1.5">
          <div className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{reasoning}</div>
        </div>
      )}
    </div>
  )
}

export function SubagentBlock({ subagent }: { subagent: AgentSubagentDisplay }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 text-xs">
      <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Bot className="size-3 text-primary" />
        <span className="font-medium">{subagent.name}</span>
        {subagent.status === "running" && <Spinner className="size-3" />}
        <span className="ml-auto truncate text-muted-foreground">{truncate(subagent.task, 40)}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-primary/20 px-2 py-1.5">
          {subagent.content && <div className="whitespace-pre-wrap text-[11px]">{subagent.content}</div>}
          {subagent.toolCalls.map((toolCall, index) => <ToolCallCard key={index} toolCall={toolCall} />)}
          {subagent.summary && <div className="text-[11px] text-muted-foreground">小结: {subagent.summary}</div>}
        </div>
      )}
    </div>
  )
}

export function AgentMessageBubble({
  message,
  onApproval,
  onRetry,
}: {
  message: AgentDisplayMessage
  onApproval?: (approval: AgentApprovalRequest, result: "allow" | "deny") => void
  onRetry?: (message: AgentDisplayMessage) => void
}) {
  const isUser = message.role === "user"
  const canRetry = !isUser && message.status === "error" && !!onRetry
  // 转圈现在挂在时间线末尾，所以文案要跟着「上一段发生了什么」走：工具还在跑就是
  // 「执行中」，已经吐过字就是「继续输出」，什么都没有才是「思考中」。
  const runningTool = message.toolCalls.some((t) => t.status === "running")
  const waitingLabel = runningTool
    ? "工具执行中…"
    : (message.content || message.reasoning)
      ? "继续输出…"
      : "思考中…"
  // 已经作为时间线一项渲染过的审批下标；尾部兜底跳过这些，避免同一张卡出现两次。
  const approvalIndexesInTimeline = new Set(
    (message.segments || []).flatMap((segment) => segment.kind === "approval" ? [segment.index] : []),
  )
  return (
    <div className="flex justify-start" data-message-id={message.id} data-message-role={isUser ? "user" : "assistant"}>
      <div className={cn("max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
        <div className="flex items-center gap-2 text-xs opacity-60">
          <span>{isUser ? "你" : "Agent"}</span>
          {message.createdAt && <span className="ml-auto">{formatMessageTime(message.createdAt)}</span>}
        </div>
        {message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} streaming={message.status === "streaming" || message.status === "pending"} />
        )}
        {message.subagents.map((subagent) => <SubagentBlock key={subagent.id} subagent={subagent} />)}
        {message.segments?.length ? (
          // 流式消息：文字与工具卡按事件到达顺序交织渲染——「说一句、做一步」。
          message.segments.map((segment, index) => (
            segment.kind === "text" ? (
              <Markdown key={`seg-${index}`} allowHtml>{segment.text}</Markdown>
            ) : segment.kind === "approval" ? (
              message.approvals?.[segment.index] != null && (
                <ApprovalCard
                  key={`seg-${index}`}
                  approval={message.approvals[segment.index]}
                  onApproval={onApproval}
                />
              )
            ) : (
              message.toolCalls[segment.index] != null && (
                <ToolCallCard key={`seg-${index}`} toolCall={message.toolCalls[segment.index]} />
              )
            )
          ))
        ) : (
          // 历史回灌消息没有事件顺序信息，退回旧版分组渲染。
          <>
            {message.toolCalls.map((toolCall, index) => <ToolCallCard key={index} toolCall={toolCall} />)}
            {message.content && (
              isUser
                ? <div className="whitespace-pre-wrap break-words">{message.content}</div>
                : <Markdown allowHtml>{message.content}</Markdown>
            )}
          </>
        )}
        {/* 兜底：没有对应 segment 的审批卡（历史回灌 / 重连后 GET /approvals 恢复的
            未决审批没有到达顺序信息）挂在气泡尾部。已在时间线里渲染过的不再重复。 */}
        {message.approvals?.map((approval, index) => (
          approvalIndexesInTimeline.has(index) ? null : (
            <ApprovalCard key={approval.confirmationId} approval={approval} onApproval={onApproval} />
          )
        ))}
        {message.media?.map((part, index) => <MediaPartView key={`${part.attachment_id ?? part.url}-${index}`} part={part} />)}
        {/* 「在等什么」始终挂在气泡最末尾——即最后一段正文/最后一张工具卡的下方，
            而不是只在气泡完全空白时出现。重试提示条自带转圈，两者互斥不叠加。 */}
        {message.retry ? (
          <RetryNotice retry={message.retry} />
        ) : (message.status === "pending" || message.status === "streaming") && !message.approvals?.some((a) => a.state === "pending") ? (
          <div className="flex items-center gap-1 opacity-60">
            <Spinner className="size-3" /> {waitingLabel}
          </div>
        ) : null}
        {message.status === "error" && message.error && <div className="text-xs text-destructive">错误：{message.error}</div>}
        {canRetry && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onRetry?.(message)}
          >
            <RefreshCw className="size-3" /> 重试
          </button>
        )}
        {!isUser && message.model && (
          <div className="text-[11px] text-muted-foreground">模型：{message.model}</div>
        )}
      </div>
    </div>
  )
}

export function AgentMessageList({
  messages,
  onApproval,
  onRetry,
}: {
  messages: AgentDisplayMessage[]
  onApproval?: (approval: AgentApprovalRequest, result: "allow" | "deny") => void
  onRetry?: (message: AgentDisplayMessage) => void
}) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id
  return (
    <div className="flex w-full flex-col gap-3 px-1 py-4">
      {messages.map((message) => (
        <AgentMessageBubble
          key={message.id}
          message={message}
          onApproval={onApproval}
          onRetry={onRetry && message.id === lastAssistantId ? onRetry : undefined}
        />
      ))}
    </div>
  )
}
