import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Ban, FileText, Folder, KeyRound, RefreshCw, RotateCw, Square, Terminal, Trash2 } from "lucide-react"
import { IconDeviceDesktop, IconInfoCircle } from "@tabler/icons-react"
import { toast } from "sonner"

import type { DomainVMPort } from "@/api/Api"
import {
  addUserTaskModels,
  deleteUserTask,
  disableUserTaskKey,
  getUserTask,
  getUserTaskLog,
  getUserTaskStats,
  listUserTaskLogs,
  listUserTaskPorts,
  restartUserTask,
  rotateUserTaskKey,
  startUserTask,
  stopUserTask,
  switchUserTaskModel,
  updateUserTask,
  type UserTaskDetail,
  type UserTaskLog,
  type UserTaskStats,
} from "@/api/userTaskClient"
import { editorNodeHealth, type EditorNodeHealth, type NodeInfo } from "@/api/nodes"
import { listChatModels, type AvailableModel } from "@/api/agentClient"
import { editorModeOptions, nodeModeOptions } from "@/api/editorClient"
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
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { useCommonData } from "@/components/console/data-provider"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"
import MultiSelect from "@/components/console/editor/multi-select"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import TaskFileExplorer from "@/components/console/task/task-workspace-file-explorer"
import TaskWorkspaceChat from "@/components/console/task/task-workspace-chat"
import { TaskWorkspaceTerminalPanel } from "@/components/console/task/task-workspace-terminal-panel"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { getTaskDisplayName } from "@/utils/common"

const STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  processing: "运行中",
  finished: "已完成",
  stopped: "已停止",
  error: "错误",
}

function statusLabel(value: string): string {
  return STATUS_LABELS[value] || value || "未知"
}

/**
 * 任务状态的展示文案。
 *
 * 不能只做 status 的字典映射：`pending` 同时覆盖了三种完全不同的处境——还没派发到
 * 节点、节点正在准备环境、环境已就绪在等用户输入。三者都显示「等待中」，用户没法
 * 知道该等还是该动手。所以这里结合运行时句柄与节点上报的准备阶段把它拆开。
 */
function taskStateLabel(task: UserTaskDetail): string {
  if (task.workspace_state === "dispatch_failed") return "派发失败"
  const stage = task.runtime_stage
  if (stage?.ok === false) return `未启动 · ${stage.label || "准备失败"}`
  if (stage?.preparing) {
    const step = stage.index && stage.total ? `${stage.index}/${stage.total}` : ""
    return `准备环境${step ? ` · ${step}` : ""} · ${stage.label || ""}`.replace(/ · $/, "")
  }
  if (task.status === "pending") {
    // 有运行时句柄 = 环境已经起来了，只是还没有人说话。
    return task.node_session_id ? "就绪 · 等待输入" : "等待派发"
  }
  if (task.status === "stopped") return "已停止"
  if (task.status === "error") return "异常"
  return statusLabel(task.status)
}

function formatTime(value?: string | number | null): string {
  if (!value) return "尚未使用"
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
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
 * 任务详情工作区。排版与交互对齐编辑器会话详情页：顶部一排身份徽章 + 工具按钮
 * （终端 / 预览 / 目录 / 日志 / 任务信息 / 节点信息 / Key / 运行时操作 / 刷新），
 * 主区是可拖拽的对话 + 底部终端分栏，目录与信息走 Popover、预览与日志走 Dialog。
 *
 * 数据全部走任务侧端点（/api/v1/users/tasks/{id}/...）：浏览器只发 task_id，
 * 工作目录与运行时句柄由服务端解析。
 */
export default function TaskDetailPage() {
  const { taskId = "" } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { nodes, reloadNodes } = useCommonData()
  const setTaskName = useBreadcrumbTask()?.setTaskName

  const [task, setTask] = useState<UserTaskDetail | null>(null)
  const [stats, setStats] = useState<UserTaskStats | null>(null)
  const [keyModels, setKeyModels] = useState<AvailableModel[]>([])
  // The chat view now owns the merged (replay + live) sub-agent list and drives
  // the side rail + dialog itself; the page only needs the id it wants opened.
  // We still receive the list via onSubAgents but don't render it here.
  const [, setSubAgents] = useState<EditorSessionSubAgent[]>([])
  const [activeSubAgentId, setActiveSubAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [ports, setPorts] = useState<DomainVMPort[] | undefined>(undefined)
  const [portsSupported, setPortsSupported] = useState(true)
  const [filesSignal, setFilesSignal] = useState(0)
  const [keyPending, setKeyPending] = useState(false)
  const [runtimePending, setRuntimePending] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 「添加模型」弹框：从父 Key 允许的目录里多选追加进任务的已添加集合。
  const [addModelsOpen, setAddModelsOpen] = useState(false)
  const [modelsToAdd, setModelsToAdd] = useState<string[]>([])
  const [addingModels, setAddingModels] = useState(false)
  // 上下文窗口用量由 chat 的事件流上抛，驱动输入框旁的进度圈。
  const [contextUsage, setContextUsage] = useState<{ size: number | null; used: number | null }>({ size: null, used: null })

  const loadDetail = useCallback(async () => {
    const next = await getUserTask(taskId)
    setTask(next)
    return next
  }, [taskId])

  const loadStats = useCallback(async () => {
    try {
      setStats(await getUserTaskStats(taskId))
    } catch {
      // 统计缺失不该拦住详情页。
    }
  }, [taskId])

  const loadPorts = useCallback(async () => {
    try {
      const result = await listUserTaskPorts(taskId)
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
  }, [taskId])

  const reload = useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    try {
      await Promise.all([loadDetail(), loadStats(), loadPorts()])
      setNotFound(false)
    } catch (error) {
      setNotFound(true)
      toast.error(error instanceof Error ? error.message : "加载任务详情失败")
    } finally {
      setLoading(false)
    }
  }, [loadDetail, loadPorts, loadStats, taskId])

  useEffect(() => { void reload() }, [reload])

  // 环境准备期轮询详情，让步骤能自己往前走。
  //
  // 这段时间拿不到事件流：SSE 只在任务可交互（有运行时且状态可收消息）时才开，
  // 而准备期恰好两个条件都不满足。没有轮询的话，页面会停在第一条上报的步骤上
  // 一动不动，直到用户手动刷新——那正是「什么都看不到」的老毛病。
  // 准备结束（就绪或某步失败）即停，不留常驻定时器。
  useEffect(() => {
    if (!task?.runtime_stage?.preparing) return
    const timer = setInterval(() => { void loadDetail().catch(() => undefined) }, 2000)
    return () => clearInterval(timer)
  }, [loadDetail, task?.runtime_stage?.preparing])

  // 任务详情模型列表按其父 API Key 的白/黑名单拉取；任务快照只作断网回退。
  useEffect(() => {
    const apiKeyId = Number(task?.parent_api_key_id)
    if (!apiKeyId) { setKeyModels([]); return }
    let active = true
    listChatModels(apiKeyId)
      .then((rows) => { if (active) setKeyModels(rows) })
      .catch(() => { if (active) setKeyModels([]) })
    return () => { active = false }
  }, [task?.parent_api_key_id])

  useEffect(() => {
    if (!task || !setTaskName) return
    setTaskName(getTaskDisplayName(task))
    return () => setTaskName(null)
  }, [setTaskName, task])

  async function refreshAll() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([loadDetail(), loadStats(), loadPorts(), reloadNodes()])
      setFilesSignal((value) => value + 1)
      toast.success("刷新成功")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  async function runtimeAction(action: () => Promise<unknown>, success: string) {
    if (runtimePending) return
    setRuntimePending(true)
    try {
      await action()
      await loadDetail()
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败")
    } finally {
      setRuntimePending(false)
    }
  }

  async function startRuntime() {
    if (runtimePending) return
    setRuntimePending(true)
    try {
      await startUserTask(taskId)
      await loadDetail()
      toast.success("任务运行时已启动")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动任务运行时失败")
      throw error
    } finally {
      setRuntimePending(false)
    }
  }

  async function keyAction(action: () => Promise<unknown>, success: string) {
    setKeyPending(true)
    try {
      await action()
      await loadDetail()
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败")
    } finally {
      setKeyPending(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      await deleteUserTask(taskId)
      toast.success("任务已删除，请求日志按审计要求保留")
      navigate("/console/tasks")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除任务失败")
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  async function switchModel(nextModel: string) {
    // 活跃模型 = models_snapshot 头部；model_id 是 ProjectTask 绑定 UUID，不是
    // 模型名。快照非空 = 只能在已添加集合内切换；快照为空（不限制）时首次切换
    // 即建立集合。集合外目标由服务端 4xx 明确拒绝，UI 直接透出错误。
    if (!task || !nextModel || nextModel === (task.models?.[0] || "")) return
    try {
      const result = await switchUserTaskModel(taskId, nextModel)
      setTask((current) => (current ? { ...current, models: result.models } : current))
      await loadDetail()
      toast.success("模型已切换，下一轮消息生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换模型失败")
    }
  }

  async function addModels() {
    if (!task || modelsToAdd.length === 0 || addingModels) return
    setAddingModels(true)
    try {
      const result = await addUserTaskModels(taskId, modelsToAdd)
      setTask((current) => (current ? { ...current, models: result.models } : current))
      setModelsToAdd([])
      setAddModelsOpen(false)
      await loadDetail()
      toast.success("模型已添加")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加模型失败")
    } finally {
      setAddingModels(false)
    }
  }

  async function switchMode(nextMode: string) {
    if (!task || nextMode === (task.mode || "")) return
    try {
      await updateUserTask(taskId, { mode: nextMode })
      await loadDetail()
      toast.success("模式已切换，下一轮消息生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换模式失败")
    }
  }

  async function switchReasoningEffort(reasoningEffort: "" | "low" | "medium" | "high" | "xhigh") {
    if (!task || reasoningEffort === (task.reasoning_effort || "")) return
    try {
      await updateUserTask(taskId, { reasoning_effort: reasoningEffort })
      await loadDetail()
      toast.success("思考等级已切换，下一轮消息生效")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换思考等级失败")
    }
  }

  const nodeHealth = useMemo(() => editorNodeHealth(task?.node_id, nodes), [nodes, task?.node_id])

  if (loading && !task) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  if (notFound || !task) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">任务不存在或已删除</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/console/tasks")}><ArrowLeft className="size-4" />返回任务列表</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const node = nodes.find((item) => item.node_id === task.node_id) || null
  const previewPortCount = (ports ?? []).length
  const modeLabel = task.mode_label || task.mode || "默认模式"
  // 终端 / 预览 / 目录 / Key 轮换都需要活跃运行时（node_session_id）。
  // 任务状态不是充分条件：存储态任务（没选节点或节点服务没起导致没派发）
  // 即便 status==pending 也没有 node_session_id，这些操作会 409。
  // 模型切换不在此列——switch_task_model 只改快照，不需要运行时。
  const hasRuntime = Boolean(task.node_session_id)
  const dispatchFailed = task.workspace_state === "dispatch_failed"
  // 这段文案会出现在一堆禁用按钮的 tooltip 里，用户看到的应该是「为什么不能点」
  // 而不是内部术语（运行时/派发）。原因优先用服务端翻译好的 dispatch_error。
  // 没有「开始/重新运行」按钮了——恢复统一走发消息，所以这里只解释「为什么不能点」。
  const runtimeReason = !hasRuntime
    ? (!task.node_id
        ? "任务还没有执行节点，请联系管理员分配"
        : task.dispatch_error
          ? `任务没能运行起来：${task.dispatch_error}`
          : "任务还没开始运行，发送消息即可开始")
    : ""
  const keyDisabled = Boolean(task.api_key?.disabled)
  const keyLocked = keyDisabled || !hasRuntime
  // 徽标配色：运行中=主色，异常/派发失败=红，已停止=次要（灰底强调，区别于
  // 「等待中」的描边），其余描边。
  const statusVariant = task.status === "processing"
    ? "default"
    : task.status === "error"
      ? "destructive"
      : task.status === "stopped"
        ? "secondary"
        : "outline"
  const totalTokens = Number(stats?.total_tokens || 0)
  // 活跃模型 = models_snapshot 头部（模型名）。model_id 是 ProjectTask 绑定的
  // UUID，不是模型名，不能用于判断或展示。
  const currentModel = task.models?.[0] || ""
  // 快照非空时只显示任务已添加的集合；快照为空 = 不限制，但下拉仍展示
  // 父 Key 当前允许的完整模型目录，避免「不限制」状态下模型菜单为空。
  // 从空快照首次选择模型会由服务端建立任务模型集合。
  const modelOptions = task.models?.length ? task.models : keyModels.map((model) => model.id)
  const addedModelSet = new Set(task.models || [])
  const addableModelOptions = keyModels
    .filter((model) => !addedModelSet.has(model.id))
    .map((model) => ({
      value: model.id,
      label: model.name || model.remark || model.id,
      hint: model.remark || model.id,
    }))
  const currentModelMaxTokens = Number(keyModels.find((item) => item.id === currentModel)?.max_context_tokens) || undefined
  const modeOptions = nodeModeOptions(node, task.provider) || editorModeOptions(task.provider)

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden p-2 md:p-3">
      <div className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/console/tasks")}><ArrowLeft className="size-4" />返回列表</Button>
            <h2 className="truncate font-medium" title={task.id}>{getTaskDisplayName(task)}</h2>
            <Badge variant="secondary">{task.provider}</Badge>
            <Badge variant={dispatchFailed || task.runtime_stage?.ok === false ? "destructive" : statusVariant}>任务：{taskStateLabel(task)}</Badge>
            {/* 绑定节点的实时健康：节点被删/吊销/掉线时任务跑不起来，这里直接标异常。 */}
            <Badge
              variant={nodeHealth.abnormal ? "destructive" : "outline"}
              className={nodeHealth.state === "ok" ? "text-green-600 dark:text-green-400" : undefined}
              title={nodeHealth.abnormal ? `绑定节点 ${task.node_id}：${nodeHealth.reason}` : undefined}
            >
              节点：{nodeHealth.label}
            </Badge>
            {/* 执行环境档位（config_snapshot 透出）：隔离是默认档不显示，系统内置/共用才标。 */}
            {task.env_mode === "system" ? <Badge variant="outline">环境：系统内置</Badge> : null}
            {task.env_mode === "shared" ? (
              <Badge variant="outline" title={task.env_id ? `共用环境 ${task.env_id}` : undefined}>
                环境：共用{task.env_name ? ` · ${task.env_name}` : ""}
              </Badge>
            ) : null}
            {/* 模型 / 模式切换在输入框区域（见 TaskWorkspaceChat），这里不重复。 */}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={terminalOpen ? "bg-accent text-primary" : ""}
              disabled={!hasRuntime}
              onClick={() => setTerminalOpen((prev) => !prev)}
              title={hasRuntime ? "在任务工作目录打开终端" : runtimeReason}
            >
              <Terminal className="size-3.5" /> 终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={previewOpen ? "bg-accent text-primary" : ""}
              disabled={!hasRuntime}
              onClick={() => setPreviewOpen((prev) => !prev)}
              title={hasRuntime ? "端口预览" : runtimeReason}
            >
              <IconDeviceDesktop className="size-3.5" /> 预览{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={directoryOpen ? "bg-accent text-primary" : ""}
              disabled={!hasRuntime}
              onClick={() => setDirectoryOpen((prev) => !prev)}
              title={hasRuntime ? "任务工作目录" : runtimeReason}
            >
              <Folder className="size-3.5" /> 目录
            </Button>
            <Button variant="ghost" size="sm" className={logsOpen ? "bg-accent text-primary" : ""} onClick={() => setLogsOpen(true)} title="网关请求日志">
              <FileText className="size-3.5" /> 请求日志
            </Button>
            {/* 任务：信息 + 可改动作（轮换 Key / 停用 Key / 重启运行环境）都收在这里，
                顶栏只留高频的开关与销毁类操作。 */}
            <TaskInfoPopover
              task={task}
              stats={stats}
              nodeHealth={nodeHealth}
              actionsDisabled={keyPending || runtimePending}
              keyLocked={keyLocked}
              keyDisabled={keyDisabled}
              hasRuntime={hasRuntime}
              runtimeReason={runtimeReason}
              onRotateKey={() => void keyAction(() => rotateUserTaskKey(taskId), "任务 API Key 已轮换并下发运行时")}
              onDisableKey={() => void keyAction(() => disableUserTaskKey(taskId), "任务 API Key 已停用")}
              onRestartRuntime={() => void runtimeAction(() => restartUserTask(taskId), "运行环境已重启")}
            />
            <NodeInfoPopover node={node} task={task} health={nodeHealth} />
            {/* 停止 = 释放运行环境（status→stopped，工作区与对话保留，发消息即恢复）。
                与输入框里的停止按钮不是一回事——那个是中断当前轮次（cancel），任务继续跑。 */}
            <Button variant="ghost" size="sm" disabled={runtimePending || !hasRuntime} onClick={() => void runtimeAction(() => stopUserTask(taskId), "任务已停止，详情与历史仍可查看")} title={hasRuntime ? "停止任务：释放运行环境，工作区与对话保留，发消息即可恢复" : runtimeReason}>
              <Square className="size-3.5" /> 停止
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} title="删除任务"><Trash2 className="size-3.5 text-destructive" /> 删除</Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refreshAll()} title="刷新">
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 刷新
            </Button>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
          <ResizablePanel defaultSize={terminalOpen ? 77 : 100} minSize={30} className="relative min-h-0">
            {/* 会话 + 目录左右分栏。目录以前是顶栏的 Popover 浮层，遮住半个对话；
                现在作为对话右侧的一栏，可拖拽调宽，会话区自然收窄。 */}
            <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
              <ResizablePanel defaultSize={directoryOpen && hasRuntime ? 72 : 100} minSize={40} className="min-h-0">
                <div className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border">
                  <TaskWorkspaceChat
                    taskId={taskId}
                    status={task.status}
                    nodeSessionId={task.node_session_id}
                    nodeId={task.node_id}
                    dispatchError={task.dispatch_error || null}
                    runtimeStage={task.runtime_stage || null}
                    active
                    onStartRuntime={startRuntime}
                    onSubAgents={setSubAgents}
                    activeSubAgentId={activeSubAgentId}
                    onSelectSubAgent={setActiveSubAgentId}
                    modelLabel={{ model: currentModel || "不限制（可从下方列表选择）", mode: modeOptions.find((option) => option.value === (task.mode || ""))?.label || modeLabel }}
                    models={modelOptions}
                    onSwitchModel={switchModel}
                    onAddModel={() => { setModelsToAdd([]); setAddModelsOpen(true) }}
                    modeOptions={modeOptions}
                    onSwitchMode={switchMode}
                    reasoningEffort={task.reasoning_effort || ""}
                    onSwitchReasoningEffort={switchReasoningEffort}
                    contextUsage={contextUsage}
                    onContextUsage={setContextUsage}
                    totalTokens={totalTokens}
                    modelMaxTokens={currentModelMaxTokens}
                    onRestartRuntime={() => runtimeAction(() => restartUserTask(taskId), "任务运行时已重启")}
                    onSessionTerminal={() => { void loadDetail() }}
                  />
                </div>
              </ResizablePanel>
              {directoryOpen && hasRuntime && (
                <>
                  <ResizableHandle withHandle className="mx-1 shrink-0 bg-transparent after:hidden" />
                  <ResizablePanel defaultSize={28} minSize={18} className="min-h-0">
                    <div className="h-full min-h-0 overflow-hidden rounded-lg border">
                      <TaskFileExplorer taskId={taskId} disabled={false} refreshSignal={filesSignal} onClosePanel={() => setDirectoryOpen(false)} />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
          {terminalOpen && (
            <>
              <ResizableHandle withHandle className="my-1 shrink-0 bg-transparent after:hidden" />
              {/* 终端默认高度取原来 35% 的三分之二（缩小三分之一）。 */}
              <ResizablePanel defaultSize={23} minSize={12} className="min-h-0">
                <TaskWorkspaceTerminalPanel taskId={taskId} onClosePanel={() => setTerminalOpen(false)} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader className="flex-row items-center justify-start gap-2 pr-8">
            <DialogTitle>端口预览</DialogTitle>
            {!portsSupported && <span className="text-xs text-muted-foreground">当前节点未提供端口能力</span>}
          </DialogHeader>
          <TaskPreviewPanel ports={ports} onRefresh={() => void loadPorts()} disabled={false} embedded />
        </DialogContent>
      </Dialog>

      <RequestLogsDialog taskId={taskId} open={logsOpen} onOpenChange={setLogsOpen} />

      <Dialog open={addModelsOpen} onOpenChange={(open) => { if (!addingModels) setAddModelsOpen(open) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>添加模型</DialogTitle>
            <DialogDescription>
              仅显示创建任务所选 API Key 当前允许的模型；添加后可在输入框模型菜单中切换。
            </DialogDescription>
          </DialogHeader>
          <MultiSelect
            options={addableModelOptions}
            value={modelsToAdd}
            onChange={setModelsToAdd}
            placeholder="请选择要添加的模型"
            emptyHint="该 API Key 下没有更多可添加的模型"
          />
          <DialogFooter>
            <Button variant="outline" disabled={addingModels} onClick={() => setAddModelsOpen(false)}>取消</Button>
            <Button disabled={modelsToAdd.length === 0 || addingModels} onClick={() => void addModels()}>
              {addingModels && <Spinner className="mr-2 size-4" />}添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => { if (!open && !deleting) setDeleteOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务「{getTaskDisplayName(task)}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将终止任务运行时并永久删除任务数据，请求日志按审计口径保留。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={(event) => { event.preventDefault(); void confirmDelete() }}>
              {deleting && <Spinner className="mr-2 size-4" />}删除任务
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 网关请求日志：左列表右详情，替代原来的 logs tab。 */
function RequestLogsDialog({ taskId, open, onOpenChange }: { taskId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [logs, setLogs] = useState<UserTaskLog[]>([])
  const [selected, setSelected] = useState<UserTaskLog | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void listUserTaskLogs(taskId)
      .then((page) => { if (active) setLogs(page.rows || page.logs || []) })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "加载请求日志失败"))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, taskId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>网关请求日志</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <ScrollArea className="h-[55vh] rounded-md border p-1">
            {loading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : logs.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无请求日志</div>
            ) : logs.map((log) => (
              <button
                key={String(log.id)}
                type="button"
                className={cn("block w-full rounded border-b p-2 text-left hover:bg-muted", selected?.id === log.id && "bg-muted")}
                onClick={() => void getUserTaskLog(taskId, log.id).then(setSelected).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "加载日志详情失败"))}
              >
                <div className="truncate text-sm">{String(log.request_path || log.model || `#${log.id}`)}</div>
                <div className="text-xs text-muted-foreground">{String(log.status_code ?? log.status ?? "")} · {log.total_tokens || 0} tokens · {formatTime((log.time as number | string | null) ?? log.created_at)}</div>
              </button>
            ))}
          </ScrollArea>
          <pre className="h-[55vh] overflow-auto rounded-md border p-3 text-xs">
            {selected ? JSON.stringify(selected, null, 2) : "选择一条日志查看详情"}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 「任务」浮动 Popover：任务信息 + 可改动作。
 *
 * 只读信息（状态 / 运行时句柄 / Key 限额 / Token 用量）与三个可改动作
 * （轮换 Key、停用 Key、重启运行环境）收在一处：它们都是低频的任务级设置，
 * 摊在顶栏会把高频的停止/删除挤到看不见。
 */
function TaskInfoPopover({
  task,
  stats,
  nodeHealth,
  actionsDisabled,
  keyLocked,
  keyDisabled,
  hasRuntime,
  runtimeReason,
  onRotateKey,
  onDisableKey,
  onRestartRuntime,
}: {
  task: UserTaskDetail
  stats: UserTaskStats | null
  nodeHealth: EditorNodeHealth
  actionsDisabled?: boolean
  keyLocked?: boolean
  keyDisabled?: boolean
  hasRuntime?: boolean
  runtimeReason?: string
  onRotateKey?: () => void
  onDisableKey?: () => void
  onRestartRuntime?: () => void
}) {
  const [open, setOpen] = useState(false)
  const usageLimit = task.api_key?.usage_limit || {}
  const hasActions = Boolean(onRotateKey || onDisableKey || onRestartRuntime)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="任务信息与设置">
          <IconInfoCircle className="size-3.5" /> 任务
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto p-3">
        <div className="flex flex-col gap-3 text-sm">
          <div className="font-medium">{getTaskDisplayName(task)}</div>
          {hasActions && (
            <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">可改动作</div>
              <div className="flex flex-wrap gap-1.5">
                {onRotateKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={actionsDisabled || keyLocked}
                    onClick={onRotateKey}
                    title={keyDisabled ? "API Key 已停用" : !hasRuntime ? runtimeReason : "换发新的任务 API Key 并下发运行时"}
                  >
                    <KeyRound className="size-3.5" /> 轮换 Key
                  </Button>
                )}
                {onDisableKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={actionsDisabled || keyDisabled}
                    onClick={onDisableKey}
                    title={keyDisabled ? "API Key 已停用" : "停用任务 API Key，之后请求都会被拒"}
                  >
                    <Ban className="size-3.5 text-destructive" /> 停用 Key
                  </Button>
                )}
                {onRestartRuntime && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={actionsDisabled || !hasRuntime}
                    onClick={onRestartRuntime}
                    title={hasRuntime ? "重启运行环境（清空进程内上下文，工作区与对话保留）" : runtimeReason}
                  >
                    <RotateCw className="size-3.5" /> 重启运行环境
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="grid gap-2">
            {/* 与顶部徽标同源，避免两处对同一个 pending 给出不同说法。 */}
            <Row label="状态" value={taskStateLabel(task)} />
            <Row label="任务 ID" value={task.id} mono />
            <Row label="类型" value={[task.kind, task.sub_type].filter(Boolean).join(" / ") || "未标注"} />
            <Row label="当前模型" value={task.model_id || task.models?.[0] || "默认模型"} />
            <Row label="当前模式" value={task.mode_label || task.mode || "默认模式"} />
            <Row label="可用模型" value={task.models?.join("、") || "未返回"} />
            <Row label="Token 用量" value={stats ? `${formatLimit(stats.total_tokens)} 总 · ${formatLimit(stats.input_tokens)} 入 · ${formatLimit(stats.output_tokens)} 出` : "暂无统计"} />
            <Row label="API Key" value={task.api_key?.key_masked || "未签发"} mono />
            <Row label="请求上限" value={formatLimit(usageLimit.max_requests)} />
            <Row label="Token 上限" value={formatLimit(usageLimit.max_total_tokens)} />
            <Row label="Key 过期" value={task.api_key?.expires_at ? formatTime(task.api_key.expires_at) : "未设置"} />
            <Row label="节点运行时" value={mask(task.node_session_id)} mono />
            <Row label="绑定节点" value={nodeHealth.node?.node_name || task.node_id || "自动节点"} />
            <Row label="仓库 / 分支" value={[task.repo_url, task.branch].filter(Boolean).join(" @ ") || "未关联仓库"} />
            <Row label="创建时间" value={formatTime(task.created_at)} />
            <Row label="最近活跃" value={formatTime(task.last_active_at)} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NodeInfoPopover({ node, task, health }: { node: NodeInfo | null; task: UserTaskDetail; health: EditorNodeHealth }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="节点信息">
          <IconInfoCircle className="size-3.5" /> 节点信息
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-3">
        {health.abnormal && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">任务节点状态异常：{health.reason}</div>}
        {node ? <NodeInfoBody node={node} /> : (
          <div className="text-sm text-muted-foreground">{task.node_id ? "节点不存在" : "未指定节点，由调度自动挑选"}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 节点信息正文：对齐编辑器详情页/管理后台节点详情弹框。机器信息 / 系统 / 网络 /
 *  Docker / 客户端版本 / 编辑器版本表。任务侧不展示「编辑器占用」。 */
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right font-medium ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</span>
    </div>
  )
}
