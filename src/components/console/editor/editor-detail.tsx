import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Ban, Copy, KeyRound, Pencil, Play, RefreshCw, Trash2, X } from "lucide-react"
import { IconChevronDown, IconDeviceDesktop, IconFolder, IconInfoCircle, IconList, IconPlayerStop, IconRestore, IconRobot, IconTerminal2 } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import { SubagentBlock } from "@/components/console/agent/agent-message-list"
import CreateTaskDialog from "@/components/console/editor/create-task-dialog"
import EditorSessionChat from "@/components/console/editor/editor-session-chat"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"
import EditEditorSessionDialog from "@/components/console/editor/edit-editor-session-dialog"
import EditorFileExplorer from "@/components/console/editor/editor-file-explorer"
import { EditorTerminalPanel } from "@/components/console/editor/editor-terminal-panel"
import {
  ARCH_LABEL,
  OS_LABEL,
  ROLE_LABEL,
  STATUS_META,
  machineInfoLine,
  machineSpecs,
  nodeEditorVersions,
  nodeNetwork,
} from "@/pages/manager/platform/nodes/types"
import { editorNodeHealth, type EditorNodeHealth, type NodeInfo } from "@/api/nodes"
import type { DomainVMPort } from "@/api/Api"
import {
  deleteEditorSession,
  disableEditorSessionApiKey,
  editorDisplayName,
  getProjectEditorDetail,
  listEditorPorts,
  restartEditorSessionRuntime,
  rotateEditorSessionApiKey,
  sendEditorSessionMessage,
  stopEditorSession,
  switchEditorSessionModel,
  switchEditorSessionMode,
  editorModeOptions,
  type EditorInstance,
  type EditorSession,
  type ParentKeyItem,
} from "@/api/editorClient"

const STATUS_LABELS: Record<string, string> = {
  provisioning: "准备中",
  pending_first_request: "等待首次请求",
  active: "运行中",
  closed: "已关闭",
  error: "错误",
}

function statusLabel(value: string): string {
  return STATUS_LABELS[value] || value || "未知"
}

/** 已关闭/出错的任务标题走灰色，运行中的任务标题保持正常色。 */
function taskTitleClassName(status: string): string {
  return status === "closed" || status === "error" ? "text-muted-foreground" : ""
}

/**
 * 红点：任务需要用户介入。两种来源——
 * 1) 运行时发来 confirmation_required 且还没裁决（命令审批，必须用户点允许/拒绝）；
 * 2) 任务落到 error 状态（跑不动了，等用户处理）。
 */
function AttentionDot({ className }: { className?: string }) {
  return (
    <span
      aria-label="需要处理"
      title="需要你处理或确认"
      className={cn("inline-block size-2 shrink-0 rounded-full bg-destructive", className)}
    />
  )
}

function formatTime(value?: string | null): string {
  if (!value) return "尚未使用"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function mask(value?: string | null): string {
  if (!value) return "未返回"
  if (value.length <= 12) return value
  return `${value.slice(0, 7)}...${value.slice(-4)}`
}

function formatLimit(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置"
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString() : String(value)
}

/**
 * 编辑器详情工作区。布局沿用任务详情页那套交互词汇：顶部切换按钮 + 主区上下分栏，
 * 终端作为底部可折叠面板独立于内容区，端口预览作为弹窗。
 *
 * 关键：终端 / 文件 / 端口是**编辑器级**，不随选中任务切换——编辑器绑定的节点上，
 * 所有任务共享同一工作目录（editor_workdir）。浏览器只发 editor_id，后端取编辑器任一
 * 活跃任务的 node_session_id 作节点句柄。只要编辑器有运行中的任务，工作区就可用，
 * 与列表里选中哪个任务无关。任务列表只用于查看/操作各任务的对话状态与 Key。
 */
export default function EditorDetail({
  projectId,
  editor: editorSummary,
  parentKeys,
  models,
  nodes,
  autoOpenTask = false,
  initialContent = "",
  initialModels = [],
  onRefreshNodes,
  onBack,
  onRemoved,
  onEditConfig,
  onMutated,
}: {
  projectId: string
  editor: EditorInstance
  parentKeys: ParentKeyItem[]
  /** 模型下拉的回退集合（来自网关模型目录）；优先用各任务自带的 models。 */
  models: Array<{ value: string; label?: string }>
  /** 用户被授权的节点，用于展示编辑器绑定节点的系统/CPU/内存/在线状态。 */
  nodes: NodeInfo[]
  /** 进入详情时是否自动弹「创建任务」。 */
  autoOpenTask?: boolean
  /** 自动弹「创建任务」时预填的任务内容（来自智能任务快捷入口）。 */
  initialContent?: string
  /** 自动弹「创建任务」时预选的模型集合（来自智能任务快捷入口）。 */
  initialModels?: string[]
  onRefreshNodes: () => Promise<unknown>
  onBack: () => void
  onRemoved: () => void
  onEditConfig: () => void
  onMutated: () => void
}) {
  const [detail, setDetail] = useState<EditorInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [taskOpen, setTaskOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [taskListOpen, setTaskListOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [newlyIssuedKey, setNewlyIssuedKey] = useState<{ sessionId: string; key: string } | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [hiddenSessionIds, setHiddenSessionIds] = useState<Set<string>>(() => new Set())
  const [sessionToEnd, setSessionToEnd] = useState<EditorSession | null>(null)
  const [sessionActionPending, setSessionActionPending] = useState(false)
  const [sessionToEdit, setSessionToEdit] = useState<EditorSession | null>(null)
  const [ports, setPorts] = useState<DomainVMPort[] | undefined>(undefined)
  const [portsSupported, setPortsSupported] = useState(true)
  const [filesSignal, setFilesSignal] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState<"stop" | "delete" | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  // 上下文占用来自当前活跃会话的事件流，由 EditorSessionChat 上抛。
  const [contextUsage, setContextUsage] = useState<{ size: number | null; used: number | null }>({ size: null, used: null })
  const [contextPopoverOpen, setContextPopoverOpen] = useState(false)
  const [contextCompactPending, setContextCompactPending] = useState(false)
  const [sessionToRestart, setSessionToRestart] = useState<EditorSession | null>(null)
  const [subAgents, setSubAgents] = useState<EditorSessionSubAgent[]>([])
  // 每个任务待用户确认的审批 id（来自运行时 confirmation_required），驱动红点提醒。
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, string[]>>({})

  const loadDetail = useCallback(async () => {
    const next = await getProjectEditorDetail(projectId, editorSummary.id)
    setDetail(next)
    return next
  }, [projectId, editorSummary.id])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await loadDetail()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载编辑器详情失败")
    } finally {
      setLoading(false)
    }
  }, [loadDetail])

  async function refreshAll() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([loadDetail(), onRefreshNodes(), loadPorts()])
      setFilesSignal((value) => value + 1)
      toast.success("刷新成功")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (autoOpenTask) setTaskOpen(true)
  }, [autoOpenTask])

  const selected = detail || editorSummary
  const node = nodes.find((item) => item.node_id === selected.node_id) || null
  const nodeHealth = editorNodeHealth(selected.node_id, nodes)
  const sessions = useMemo(() => (selected.sessions || []) as EditorSession[], [selected.sessions])
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !hiddenSessionIds.has(session.id)),
    [hiddenSessionIds, sessions],
  )

  // 某个任务是否需要用户介入：有未裁决的命令审批，或任务本身已出错。
  const sessionNeedsAttention = useCallback(
    (session: EditorSession) => (pendingApprovals[session.id]?.length ?? 0) > 0 || session.status === "error",
    [pendingApprovals],
  )
  const anySessionNeedsAttention = useMemo(
    () => sessions.some(sessionNeedsAttention),
    [sessions, sessionNeedsAttention],
  )

  // 默认选中运行中的任务，否则第一个；被选任务消失时回落。
  useEffect(() => {
    setSelectedSessionId((current) => {
      if (current && visibleSessions.some((item) => item.id === current)) return current
      const active = visibleSessions.find((item) => item.status === "active")
      return active?.id || visibleSessions[0]?.id || null
    })
  }, [visibleSessions])

  const loadPorts = useCallback(async () => {
    try {
      const result = await listEditorPorts(selected.id)
      setPortsSupported(Boolean(result.supported))
      setPorts((result.ports || []).map((port) => ({
        port: port.port,
        status: port.status as DomainVMPort["status"],
        preview_url: port.preview_url,
        error_message: port.error_message,
      })))
    } catch {
      setPorts([])
    }
  }, [selected.id])

  useEffect(() => { void loadPorts() }, [loadPorts])

  async function stopSession(session: EditorSession) {
    setSessionActionPending(true)
    try {
      await stopEditorSession(selected.id, session.id)
      await reload()
      onMutated()
      toast.success("任务已停止，详情和历史记录仍可查看")
      setSessionToEnd(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停止任务失败")
    } finally {
      setSessionActionPending(false)
    }
  }

  async function deleteSession(session: EditorSession) {
    setSessionActionPending(true)
    try {
      await deleteEditorSession(selected.id, session.id)
      setHiddenSessionIds((current) => {
        const next = new Set(current)
        next.delete(session.id)
        return next
      })
      await reload()
      onMutated()
      toast.success("任务数据已删除，请求日志仍按审计要求保留")
      setSessionToEnd(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除任务失败")
    } finally {
      setSessionActionPending(false)
    }
  }

  function hideSession(session: EditorSession) {
    setHiddenSessionIds((current) => new Set(current).add(session.id))
    setSessionToEnd(null)
    toast.success("任务已转到后台运行，可从任务列表恢复显示")
  }

  function restoreSession(session: EditorSession) {
    setHiddenSessionIds((current) => {
      const next = new Set(current)
      next.delete(session.id)
      return next
    })
    setSelectedSessionId(session.id)
  }

  async function switchModel(session: EditorSession, nextModel: string) {
    if (!nextModel || nextModel === (session.model || "")) return
    try {
      await switchEditorSessionModel(selected.id, session.id, nextModel)
      await reload()
      toast.success("模型已切换，下一轮消息生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换模型失败")
    }
  }

  async function switchMode(session: EditorSession, nextMode: string) {
    if (nextMode === (session.mode || "")) return
    try {
      await switchEditorSessionMode(selected.id, session.id, nextMode)
      await reload()
      toast.success("模式已切换，下一轮消息生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换模式失败")
    }
  }

  async function compactContext(session: EditorSession) {
    setContextCompactPending(true)
    try {
      await sendEditorSessionMessage(selected.id, session.id, "/compact")
      toast.success("已请求压缩上下文，下一轮生效")
      setContextPopoverOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "压缩上下文失败")
    } finally {
      setContextCompactPending(false)
    }
  }

  async function restartContext(session: EditorSession) {
    setSessionToRestart(session)
    setContextPopoverOpen(false)
  }

  async function confirmRestartRuntime() {
    if (!sessionToRestart) return
    const session = sessionToRestart
    setSessionActionPending(true)
    try {
      await restartEditorSessionRuntime(selected.id, session.id)
      setContextUsage({ size: null, used: null })
      setSubAgents([])
      toast.success("任务运行时已重启，上下文已清空")
      setSessionToRestart(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重启运行时失败")
    } finally {
      setSessionActionPending(false)
    }
  }

  async function copySessionKey(session: EditorSession) {
    const key = newlyIssuedKey && newlyIssuedKey.sessionId === session.id ? newlyIssuedKey.key : null
    if (!key) return toast.info("出于安全原因，密钥只在创建/轮换响应中返回一次")
    await navigator.clipboard.writeText(key)
    toast.success("已复制任务 API Key")
  }

  async function rotateSessionKey(session: EditorSession) {
    try {
      const result = await rotateEditorSessionApiKey(selected.id, session.id)
      setNewlyIssuedKey({ sessionId: session.id, key: result.key })
      await reload()
      toast.success("任务 API Key 已轮换，新 Key 仅本次可复制")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "轮换 API Key 失败")
    }
  }

  async function disableSessionKey(session: EditorSession) {
    try {
      await disableEditorSessionApiKey(selected.id, session.id)
      await reload()
      toast.success("任务 API Key 已停用")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停用 API Key 失败")
    }
  }

  async function removeEditor() {
    if (!window.confirm(`确认删除编辑器“${editorDisplayName(selected)}”？`)) return
    try {
      const { deleteProjectEditor } = await import("@/api/editorClient")
      await deleteProjectEditor(projectId, selected.id)
      onRemoved()
      toast.success("编辑器已删除，历史日志保留")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除编辑器失败")
    }
  }

  async function bulkHide() {
    if (selectedTaskIds.size === 0) return
    setHiddenSessionIds((current) => {
      const next = new Set(current)
      selectedTaskIds.forEach((id) => next.add(id))
      return next
    })
    setSelectedTaskIds(new Set())
    toast.success(`已将 ${selectedTaskIds.size} 个任务转到后台`)
  }

  async function bulkStop() {
    if (selectedTaskIds.size === 0 || bulkPending) return
    setBulkPending(true)
    try {
      const ids = Array.from(selectedTaskIds)
      const results = await Promise.allSettled(ids.map((id) => stopEditorSession(selected.id, id)))
      const failed = results.filter((r) => r.status === "rejected")
      await reload()
      onMutated()
      setSelectedTaskIds(new Set())
      setBulkAction(null)
      if (failed.length) toast.error(`${ids.length - failed.length}/${ids.length} 个任务已停止，${failed.length} 个失败`)
      else toast.success(`已停止 ${ids.length} 个任务`)
    } finally {
      setBulkPending(false)
    }
  }

  async function bulkDelete() {
    if (selectedTaskIds.size === 0 || bulkPending) return
    setBulkPending(true)
    try {
      const ids = Array.from(selectedTaskIds)
      const results = await Promise.allSettled(ids.map((id) => deleteEditorSession(selected.id, id)))
      const failed = results.filter((r) => r.status === "rejected")
      setHiddenSessionIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
      await reload()
      onMutated()
      setSelectedTaskIds(new Set())
      setBulkAction(null)
      if (failed.length) toast.error(`${ids.length - failed.length}/${ids.length} 个任务已删除，${failed.length} 个失败`)
      else toast.success(`已删除 ${ids.length} 个任务`)
    } finally {
      setBulkPending(false)
    }
  }

  function TaskListSidebar() {
    const allSelected = sessions.length > 0 && sessions.every((s) => selectedTaskIds.has(s.id))
    const selectedCount = selectedTaskIds.size
    return (
      <div className="flex h-full min-h-0 flex-col rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1.5">
          <span className="flex items-center gap-1 text-xs font-medium"><IconList className="size-3.5" />任务列表 · {sessions.length}</span>
          <Button variant="ghost" size="icon" className="size-7" title="关闭任务列表" onClick={() => setTaskListOpen(false)}><X className="size-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/10 px-1.5 py-1.5">
          <Checkbox checked={allSelected} onCheckedChange={(v) => setSelectedTaskIds(v ? new Set(sessions.map((s) => s.id)) : new Set())} title="全选/取消全选" />
          <span className="text-[11px] text-muted-foreground">{selectedCount > 0 ? `已选 ${selectedCount}` : "全选"}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={selectedCount === 0} onClick={() => void bulkHide()} title="转到后台（仅隐藏）">后台</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={selectedCount === 0} onClick={() => setBulkAction("stop")} title="批量停止">停止</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-destructive" disabled={selectedCount === 0} onClick={() => setBulkAction("delete")} title="批量删除">删除</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {sessions.map((session) => {
            const hidden = hiddenSessionIds.has(session.id)
            const checked = selectedTaskIds.has(session.id)
            const modeLabel = editorModeOptions(selected.provider).find((o) => o.value === (session.mode || ""))?.label
            return (
              <div
                key={session.id}
                className={`mb-1 flex items-start gap-1.5 rounded-md border p-2 transition-colors ${session.id === selectedSessionId && !hidden ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"}`}
              >
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={checked}
                  onCheckedChange={(v) => setSelectedTaskIds((current) => {
                    const next = new Set(current)
                    if (v) next.add(session.id)
                    else next.delete(session.id)
                    return next
                  })}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => hidden ? restoreSession(session) : setSelectedSessionId(session.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {sessionNeedsAttention(session) && <AttentionDot />}
                      <span className={cn("truncate text-sm font-medium", taskTitleClassName(session.status))}>{session.task_name || "未命名任务"}</span>
                    </span>
                    <Badge variant={session.status === "active" ? "default" : "outline"} className="text-[10px]">{hidden ? "后台" : statusLabel(session.status)}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{session.model || "默认模型"}{modeLabel && modeLabel !== "编辑器默认" ? ` · ${modeLabel}` : ""}</span>
                    <span>{hidden ? "点击恢复" : formatTime(session.last_request_at)}</span>
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function SessionWorkspace({ session, editor }: { session: EditorSession | null; editor: EditorInstance }) {
    if (!session) return null

    const switchable = session.status === "active" || session.status === "pending_first_request"
    const modeLabel = editorModeOptions(editor.provider).find((option) => option.value === (session.mode || ""))?.label || session.mode || "编辑器默认"
    const modelOptions = session.models?.length ? session.models : models.map((item) => item.value)
    const totalTokens = Number(session.total_tokens || 0)
    const contextSize = contextUsage.size ?? 0
    const contextUsed = contextUsage.used ?? 0
    const contextProgress = contextSize > 0 ? Math.min(Math.max(contextUsed / contextSize, 0), 1) : 0
    const contextProgressClassName = contextProgress >= 0.8
      ? "text-danger"
      : contextProgress >= 0.6
        ? "text-warning"
        : "text-foreground"

    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {/* 任务级一排：模型 / 模式 / 上下文圆环 / 累计 token，右侧任务信息与 Key 操作。对齐旧任务详情页。 */}
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border bg-background px-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* 状态与标题不在这排重复：标题在 tabs 居中显示，状态细节在任务信息里。 */}
            {/* 模型 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7 max-w-[220px] shrink-0 gap-1 px-2 text-xs font-normal" disabled={!switchable}>
                  <span className="truncate">{session.model || "默认模型"}</span>
                  <IconChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
                {modelOptions.length === 0 ? (
                  <DropdownMenuItem disabled>暂无可用模型</DropdownMenuItem>
                ) : (
                  <DropdownMenuRadioGroup value={session.model || ""}>
                    {modelOptions.map((modelId) => (
                      <DropdownMenuRadioItem key={modelId} value={modelId} onSelect={() => void switchModel(session, modelId)}>{modelId}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 模式 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7 max-w-[180px] shrink-0 gap-1 px-2 text-xs font-normal" disabled={!switchable} title="权限/审批模式，下一轮消息生效">
                  <span className="truncate">{modeLabel}</span>
                  <IconChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuRadioGroup value={session.mode || ""}>
                  {editorModeOptions(editor.provider).map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} onSelect={() => void switchMode(session, option.value)}>{option.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 上下文占用 */}
            <HoverCard open={contextPopoverOpen} onOpenChange={setContextPopoverOpen} openDelay={120} closeDelay={180}>
              <HoverCardTrigger asChild>
                <button type="button" className="inline-flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="上下文占用" disabled={!switchable}>
                  <CircularProgress value={contextUsed} max={contextSize} size={20} strokeWidth={3} indicatorClassName={contextProgressClassName} />
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="bottom" align="start" className="w-80 p-0">
                <div className="overflow-hidden rounded-md bg-background">
                  <div className="flex items-center gap-3 border-b bg-muted/35 px-3 py-3">
                    <CircularProgress value={contextUsed} max={contextSize} size={24} strokeWidth={3} indicatorClassName={contextProgressClassName} />
                    <div className="min-w-0">
                      <div className={cn("text-sm font-medium", contextProgressClassName)}>
                        上下文已用 {contextSize > 0 ? Math.min(100, Math.round((contextUsed / contextSize) * 100)) : 0}%
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-2.5 text-xs leading-5 text-foreground">
                    上下文接近上限时建议压缩或重启清空，避免影响响应质量。
                  </div>
                  <div className="space-y-2 border-t bg-muted/15 p-2">
                    <div className="rounded-md border bg-background px-3 py-2.5 shadow-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">压缩上下文</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">向任务发送 /compact，让模型总结并精简历史。</div>
                        </div>
                        <Button type="button" size="sm" variant={contextUsed / Math.max(contextSize, 1) >= 0.5 ? "default" : "secondary"} className="shrink-0" disabled={!switchable || contextCompactPending} onClick={() => void compactContext(session)}>
                          {contextCompactPending && <Spinner className="mr-2 size-3.5" />}压缩
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2.5 shadow-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">重启运行时</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">重启任务运行时进程，会清空进程内上下文，历史记录保留。</div>
                        </div>
                        <Button type="button" size="sm" variant="secondary" className="shrink-0" disabled={!switchable} onClick={() => void restartContext(session)}>重启</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>

            {totalTokens > 0 && (
              <span className="hidden shrink-0 lg:inline text-xs text-muted-foreground" title="累计消耗 Token">
                已用 {formatTokens(totalTokens)}
              </span>
            )}
          </div>

          {/* 与编辑器头部按钮同一套样式：ghost + size=sm + 图标加文字。 */}
          <div className="flex shrink-0 items-center gap-0.5">
            <TaskInfoPopover session={session} editor={editor} />
            <SubAgentsPopover subAgents={subAgents} />
            <Button variant="ghost" size="sm" title="修改任务" onClick={() => setSessionToEdit(session)}><Pencil className="size-3.5" /> 修改</Button>
            <Button variant="ghost" size="sm" title="复制任务 API Key" onClick={() => void copySessionKey(session)}><Copy className="size-3.5" /> 复制 Key</Button>
            <Button variant="ghost" size="sm" title="轮换任务 API Key" onClick={() => void rotateSessionKey(session)}><KeyRound className="size-3.5" /> 轮换</Button>
            <Button variant="ghost" size="sm" title="停用任务 API Key" disabled={session.api_key_copy?.disabled} onClick={() => void disableSessionKey(session)}><Ban className="size-3.5 text-destructive" /> 停用</Button>
          </div>
        </div>
        {/* 主区：对话占满。 */}
        <EditorSessionChat
          editorId={editor.id}
          session={session}
          active={session.id === selectedSessionId}
          onContextUsage={setContextUsage}
          onSubAgents={setSubAgents}
          onPendingApprovals={(ids) => setPendingApprovals((current) => {
            const previous = current[session.id] || []
            if (previous.length === ids.length && previous.every((id, index) => id === ids[index])) return current
            return { ...current, [session.id]: ids }
          })}
        />
      </div>
    )
  }

  if (loading && !detail) {
    return <div className="flex justify-center py-16"><Spinner /></div>
  }

  const previewPortCount = (ports ?? []).length

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 头部：编辑器身份 + 终端/预览切换 + 编辑器操作 */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" />返回列表</Button>
            <h2 className="truncate font-medium" title={selected.id}>{editorDisplayName(selected)}</h2>
            <Badge variant="secondary">{selected.provider}</Badge>
            {/* 绑定节点的实时健康：节点被删/吊销/掉线时编辑器跑不起来，这里直接标异常。 */}
            <Badge
              variant={nodeHealth.abnormal ? "destructive" : "outline"}
              className={nodeHealth.state === "ok" ? "text-green-600 dark:text-green-400" : undefined}
              title={nodeHealth.abnormal ? `绑定节点 ${selected.node_id}：${nodeHealth.reason}` : undefined}
            >
              {nodeHealth.label}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => setTaskOpen(true)}><Play className="size-3.5" /> 创建任务</Button>
            <Button
              variant="ghost"
              size="sm"
              className={terminalOpen ? "bg-accent text-primary" : ""}
              onClick={() => setTerminalOpen((prev) => !prev)}
              title="在编辑器工作目录打开终端"
            >
              <IconTerminal2 className="size-3.5" /> 终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={previewOpen ? "bg-accent text-primary" : ""}
              onClick={() => setPreviewOpen((prev) => !prev)}
              title="端口预览"
            >
              <IconDeviceDesktop className="size-3.5" /> 预览{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
            </Button>
            {/* 任务列表 / 目录与「节点信息」同一种交互：点按钮就地弹出，不占对话宽度。 */}
            <Popover open={taskListOpen} onOpenChange={setTaskListOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={taskListOpen ? "bg-accent text-primary" : ""} title={anySessionNeedsAttention ? "任务列表：有任务需要你处理" : "任务列表"}>
                  <IconList className="size-3.5" /> 任务列表{sessions.length > 0 ? ` (${sessions.length})` : ""}
                  {anySessionNeedsAttention && <AttentionDot className="ml-0.5" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
                <div className="max-h-[min(32rem,var(--radix-popover-content-available-height))]">
                  <TaskListSidebar />
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={directoryOpen} onOpenChange={setDirectoryOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={directoryOpen ? "bg-accent text-primary" : ""} title="编辑器目录">
                  <IconFolder className="size-3.5" /> 目录
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] p-0">
                <div className="h-[min(32rem,var(--radix-popover-content-available-height))]">
                  <EditorFileExplorer editorId={selected.id} disabled={false} refreshSignal={filesSignal} onClosePanel={() => setDirectoryOpen(false)} />
                </div>
              </PopoverContent>
            </Popover>
            <NodeInfoPopover node={node} selected={selected} health={nodeHealth} />
            <Button variant="ghost" size="sm" onClick={onEditConfig} title="编辑配置"><Pencil className="size-3.5" /> 编辑</Button>
            <Button variant="ghost" size="sm" onClick={() => void removeEditor()} title="删除编辑器"><Trash2 className="size-3.5 text-destructive" /> 删除</Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refreshAll()} title="刷新">
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 刷新
            </Button>
          </div>
        </div>
      </div>

      {/* 主区：任务 tabs + 对话占满；终端在底部可拖拽；任务列表/目录/子 Agent 悬浮在对话之上，不挤占宽度。 */}
      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
          <ResizablePanel defaultSize={terminalOpen ? 65 : 100} minSize={30} className="relative min-h-0">
            <div className="flex h-full min-h-0 flex-col">
              {visibleSessions.length === 0 ? (
                <Card className="flex h-full min-h-0 items-center justify-center">
                  <CardContent className="flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-muted-foreground">{sessions.length ? "任务均在后台运行，可从任务列表恢复" : "还没有任务"}</p>
                    {sessions.length ? (
                      <Button variant="outline" onClick={() => setTaskListOpen(true)}><IconList className="size-4" /> 打开任务列表</Button>
                    ) : (
                      <Button onClick={() => setTaskOpen(true)}><Play className="size-4" /> 创建任务</Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Tabs value={selectedSessionId || visibleSessions[0].id} onValueChange={setSelectedSessionId} className="flex h-full min-h-0 flex-col gap-0">
                  {/* 下划线式标签：不铺满、按内容宽度、无可见滚动条，仍可横向滚动。 */}
                  <TabsList variant="line" className="no-scrollbar w-full shrink-0 justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-b p-0 pb-[5px] whitespace-nowrap">
                    {visibleSessions.map((session) => (
                      <TabsTrigger key={session.id} value={session.id} className="group/task-tab max-w-48 flex-none gap-1 px-2 pr-1 text-xs data-[state=active]:max-w-md">
                        {sessionNeedsAttention(session) && <AttentionDot />}
                        <span className={cn("max-w-40 truncate text-center", taskTitleClassName(session.status))} title={session.task_name || ""}>
                          {session.task_name || "未命名任务"}
                        </span>
                        {session.status !== "closed" && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-data-active/task-tab:opacity-100"
                            title="结束任务"
                            aria-label={`结束任务 ${session.id}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setSessionToEnd(session)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return
                              event.preventDefault()
                              event.stopPropagation()
                              setSessionToEnd(session)
                            }}
                          >
                            <X className="size-3" />
                          </span>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="min-h-0 flex-1">
                    {visibleSessions.map((session) => (
                      <TabsContent key={session.id} value={session.id} className="mt-0 h-full data-[state=inactive]:hidden">
                        <SessionWorkspace session={session} editor={selected} />
                      </TabsContent>
                    ))}
                  </div>
                </Tabs>
              )}
            </div>

          </ResizablePanel>
          {terminalOpen && (
            <>
              <ResizableHandle withHandle className="my-1 shrink-0 bg-transparent after:hidden" />
              <ResizablePanel defaultSize={35} minSize={15} className="min-h-0">
                <EditorTerminalPanel editorId={selected.id} onClosePanel={() => setTerminalOpen(false)} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <EditEditorSessionDialog
        editorId={selected.id}
        session={sessionToEdit}
        gatewayModels={models}
        open={Boolean(sessionToEdit)}
        onOpenChange={(open) => { if (!open) setSessionToEdit(null) }}
        onSaved={reload}
      />

      <AlertDialog open={Boolean(sessionToEnd)} onOpenChange={(open) => { if (!open && !sessionActionPending) setSessionToEnd(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>如何处理“{sessionToEnd?.task_name || "未命名任务"}”？</AlertDialogTitle>
            <AlertDialogDescription>
              后台运行只关闭当前标签；停止任务会终止运行时但保留任务详情；删除任务会终止运行时并永久删除任务数据。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" className="h-auto justify-start gap-3 p-3 text-left" disabled={sessionActionPending} onClick={() => sessionToEnd && hideSession(sessionToEnd)}>
              <IconRestore className="size-4" />
              <span><span className="block font-medium">后台运行</span><span className="block text-xs font-normal text-muted-foreground">仅隐藏标签，任务继续运行，可从任务列表恢复。</span></span>
            </Button>
            <Button variant="outline" className="h-auto justify-start gap-3 p-3 text-left" disabled={sessionActionPending || sessionToEnd?.status === "closed"} onClick={() => sessionToEnd && void stopSession(sessionToEnd)}>
              <IconPlayerStop className="size-4" />
              <span><span className="block font-medium">停止任务</span><span className="block text-xs font-normal text-muted-foreground">关闭标签并终止运行时，任务详情和历史仍可查看。</span></span>
            </Button>
            <Button variant="destructive" className="h-auto justify-start gap-3 p-3 text-left" disabled={sessionActionPending} onClick={() => sessionToEnd && void deleteSession(sessionToEnd)}>
              <Trash2 className="size-4" />
              <span><span className="block font-medium">删除任务</span><span className="block text-xs font-normal opacity-80">终止运行时并删除任务数据，此操作不可恢复。</span></span>
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sessionActionPending}>取消</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重启运行时（清空上下文）确认 */}
      <AlertDialog open={Boolean(sessionToRestart)} onOpenChange={(open) => { if (!open && !sessionActionPending) setSessionToRestart(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重启任务运行时？</AlertDialogTitle>
            <AlertDialogDescription>
              将重启“{sessionToRestart?.task_name || "未命名任务"}”的运行时进程，清空进程内上下文。任务记录和历史请求会保留，不可恢复上下文本身。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sessionActionPending}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={sessionActionPending} onClick={() => void confirmRestartRuntime()}>
              {sessionActionPending && <Spinner className="mr-2 size-4" />}重启运行时
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量操作确认框 */}
      <AlertDialog open={Boolean(bulkAction)} onOpenChange={(open) => { if (!open && !bulkPending) setBulkAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkAction === "delete" ? `批量删除 ${selectedTaskIds.size} 个任务？` : `批量停止 ${selectedTaskIds.size} 个任务？`}</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === "delete"
                ? "将终止所选任务运行时并永久删除其任务数据，请求日志按审计口径保留。此操作不可恢复。"
                : "将停止所选任务的运行时，任务详情和历史记录仍保留，可重新查看。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={bulkAction === "delete" ? "destructive" : "default"}
              disabled={bulkPending}
              onClick={() => void (bulkAction === "delete" ? bulkDelete() : bulkStop())}
            >
              {bulkPending && <Spinner className="mr-2 size-4" />}
              {bulkAction === "delete" ? "删除任务" : "停止任务"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 端口预览弹窗：复用任务详情的 TaskPreviewPanel（编辑器级） */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader className="flex-row items-center justify-start gap-2 pr-8">
            <DialogTitle>端口预览</DialogTitle>
            {!portsSupported && (
              <span className="text-xs text-muted-foreground">当前节点未提供端口能力</span>
            )}
          </DialogHeader>
          <TaskPreviewPanel
            ports={ports}
            onRefresh={() => void loadPorts()}
            disabled={false}
            embedded
          />
        </DialogContent>
      </Dialog>

      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        projectId={projectId}
        editor={selected}
        parentKeys={parentKeys}
        initialContent={initialContent}
        initialModels={initialModels}
        onCreated={() => { void reload(); onMutated(); setFilesSignal((key) => key + 1) }}
      />
    </div>
  )
}

/** 节点信息浮动 Popover：内容对齐管理后台节点详情弹框。 */
function NodeInfoPopover({ node, selected, health }: { node: NodeInfo | null; selected: EditorInstance; health: EditorNodeHealth }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="节点信息">
          <IconInfoCircle className="size-3.5" /> 节点信息
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-3"
      >
        {health.abnormal && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            编辑器状态异常：{health.reason}
          </div>
        )}
        {node ? <NodeInfoBody node={node} /> : (
          <div className="text-sm text-muted-foreground">{selected.node_id ? "节点不存在" : "未指定节点，由调度自动挑选"}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function NodeInfoBody({ node }: { node: NodeInfo }) {
  const caps = node.capabilities || {}
  const status = STATUS_META[node.status] || STATUS_META.unknown
  const infoLine = machineInfoLine(caps) || "尚未上报"
  const specs = machineSpecs(caps).filter((s) => s.label !== "客户端版本")
  const network = nodeNetwork(caps)
  const editors = nodeEditorVersions(caps)
  const clientVersion = (caps.client_version || "").trim()
  const docker = caps.docker
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{node.node_name || node.node_id}</span>
        <Badge variant="outline">{ROLE_LABEL[node.node_role] || node.node_role}</Badge>
        {node.status === "approved" ? (
          <Badge variant="outline" className={node.connected ? "text-green-600 dark:text-green-400" : ""}>{node.connected ? "在线" : "离线"}</Badge>
        ) : (
          <Badge variant="outline" className={status.className}>{status.label}</Badge>
        )}
      </div>
      <div className="grid gap-2">
        <Row label="节点 ID" value={node.node_id} mono />
        <Row label="机器信息" value={infoLine} />
        {specs.map((spec) => <Row key={spec.label} label={spec.label} value={spec.value} />)}
        <Row label="系统" value={[OS_LABEL[caps.os || ""] || caps.os, ARCH_LABEL[caps.arch || ""] || caps.arch].filter(Boolean).join(" / ") || "尚未上报"} />
        <Row label="运行中会话" value={`${node.active_sessions ?? 0} 个`} />
        <Row label="编辑器占用" value={`${node.editor_occupancy ?? 0} 个`} />
        <Row label="最近心跳" value={node.last_heartbeat_at || "尚未上报"} />
        {network.map((row) => <Row key={row.label} label={row.label} value={row.value} mono />)}
        {docker ? <Row label="Docker" value={docker === "true" ? "支持" : "不支持"} /> : null}
        {clientVersion ? <Row label="客户端版本" value={`v${clientVersion.replace(/^v/i, "")}`} mono /> : null}
      </div>
      {editors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">编辑器</span>
          <div className="overflow-hidden rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">编辑器</th>
                  <th className="px-2 py-1 text-left font-medium">当前版本</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {editors.map((e) => (
                  <tr key={e.editor}>
                    <td className="px-2 py-1">{e.label}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {e.installed ? (e.version ? `v${e.version.replace(/^v/i, "")}` : "已安装 · 版本未知") : "未安装"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskInfoPopover({ session, editor }: { session: EditorSession; editor: EditorInstance }) {
  const [open, setOpen] = useState(false)
  const usageLimit = session.api_key_copy?.usage_limit || {}
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="任务信息">
          <IconInfoCircle className="size-3.5" /> 任务信息
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto p-3">
        <div className="flex flex-col gap-3 text-sm">
          <div className={cn("font-medium", taskTitleClassName(session.status))}>{session.task_name || "未命名任务"}</div>
          <div className="grid gap-2">
            <Row label="状态" value={statusLabel(session.status)} />
            <Row label="任务 ID" value={session.id} mono />
            <Row label="Provider Thread" value={mask(session.provider_thread_id)} mono />
            <Row label="当前模型" value={session.model || "默认模型"} />
            <Row label="当前模式" value={editorModeOptions(editor.provider).find((option) => option.value === (session.mode || ""))?.label || session.mode || "编辑器默认"} />
            <Row label="可用模型" value={session.models?.join("、") || "未返回"} />
            <Row label="累计消耗" value={`${formatLimit(session.total_tokens)} Tokens`} />
            <Row label="最近请求" value={formatTime(session.last_request_at)} />
            <Row label="创建时间" value={formatTime(session.created_at)} />
            <Row label="API Key" value={session.api_key_copy?.key_masked || "已绑定"} />
            <Row label="请求上限" value={formatLimit(usageLimit.max_requests)} />
            <Row label="Token 上限" value={formatLimit(usageLimit.max_total_tokens)} />
            <Row label="Key 过期" value={session.api_key_copy?.expires_at ? formatTime(new Date(session.api_key_copy.expires_at * 1000).toISOString()) : "未设置"} />
            <Row label="节点运行时" value={mask(session.node_session_id)} mono />
            <Row label="编辑器" value={editorDisplayName(editor)} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * 子 Agent 面板，紧挨「任务信息」自成一个入口。
 *
 * 数据来自当前任务事件流里带 agent_id 的条目（agent_id 为空即主 Agent）。节点侧目前
 * 还没有填充 agent_id，所以正常情况下这里是空的——面板照常显示，空状态里写明原因，
 * 免得看起来像坏了。
 */
function SubAgentsPopover({ subAgents }: { subAgents: EditorSessionSubAgent[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="当前任务的子 Agent">
          <IconRobot className="size-3.5" /> 子 Agent{subAgents.length > 0 ? ` (${subAgents.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">子 Agent{subAgents.length > 0 ? ` · ${subAgents.length}` : ""}</span>
          {subAgents.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              当前任务没有子 Agent。主 Agent 派发子任务后，子 Agent 的输出会归到这里。
            </p>
          ) : (
            <div className="space-y-2">
              {subAgents.map((agent) => <SubagentBlock key={agent.id} subagent={agent} />)}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right font-medium ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</span>
    </div>
  )
}
