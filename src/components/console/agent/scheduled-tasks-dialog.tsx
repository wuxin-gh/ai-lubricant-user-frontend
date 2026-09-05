/**
 * Agent 定时任务管理弹框（主从双栏）。
 *
 * 从 agent 对话页标题栏「定时任务」打开，按当前选中 Agent 过滤：左栏任务列表，
 * 右栏详情/编辑。布局与 agent-manager 的「列表 + 配置」双栏同款——脚本正文和运行
 * 结果都需要足够纵向空间，故用大尺寸弹框而非窄弹框。
 *
 * 授权闭环：脚本任务必须人工授权（approve-script 写 approved_hash）才会执行——
 * approved_hash 为空即待授权，后端拒跑。创建/改动脚本后右栏顶部弹授权条引导当场授权，
 * 左栏未授权任务挂「待授权」标记。
 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle, Clock, FileText, Play, Plus, RefreshCw, ShieldCheck, Terminal, Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  approveScheduledTaskScript, createScheduledTask, deleteScheduledTask, getScheduledTask,
  listChatModels, listScheduledTasks, listUsableKeys, runScheduledTaskNow, toggleScheduledTask,
  updateScheduledTask,
  type AvailableModel, type RuntimeKeyItem,
  type ScheduledTaskDetail, type ScheduledTaskKind, type ScheduledTaskListItem,
  type ScheduledTaskOnError, type ScheduledTaskScriptType,
} from "@/api/agentClient"

/** approved_hash 为空 = 待授权（脚本任务拒跑）；prompt 任务无需授权。 */
function needsApproval(task: { task_kind?: string; approved_hash?: string | null; has_pending_fix?: boolean }): boolean {
  return task.task_kind === "script" && (!task.approved_hash || task.has_pending_fix === true)
}

interface FormState {
  id: number | null
  name: string
  cron_expression: string
  task_kind: ScheduledTaskKind
  task_prompt: string
  script_code: string
  script_type: ScheduledTaskScriptType
  script_timeout: number
  background: string
  on_error: ScheduledTaskOnError
  allow_ai_script_fix: boolean
  enabled: boolean
  /** 本任务的模型覆盖（prompt 模式）；空 = 用 Agent 的定时任务默认。 */
  api_key_id: number | null
  model: string
}

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    cron_expression: "",
    task_kind: "prompt",
    task_prompt: "",
    script_code: "",
    script_type: "python",
    script_timeout: 300,
    background: "",
    on_error: "diagnose",
    allow_ai_script_fix: false,
    enabled: true,
    api_key_id: null,
    model: "",
  }
}

function formFromDetail(detail: ScheduledTaskDetail): FormState {
  return {
    id: detail.id,
    name: detail.name || "",
    cron_expression: detail.cron_expression || "",
    task_kind: detail.task_kind || "prompt",
    task_prompt: detail.task_prompt || "",
    script_code: detail.script_code || "",
    script_type: detail.script_type || "python",
    script_timeout: detail.script_timeout || 300,
    background: detail.background || "",
    on_error: detail.on_error || "diagnose",
    allow_ai_script_fix: detail.allow_ai_script_fix ?? false,
    enabled: detail.enabled,
    api_key_id: detail.api_key_id ?? null,
    model: detail.model || "",
  }
}

export interface ScheduledTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前选中的 Agent；列表按它过滤，新建时绑定它。 */
  agentId: number | null
  agentName?: string
}

export function ScheduledTasksDialog({ open, onOpenChange, agentId, agentName }: ScheduledTasksDialogProps) {
  const [tasks, setTasks] = useState<ScheduledTaskListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  // 右栏状态：null = 空态（提示选左侧）；isNew = 新建草稿；否则编辑 detail。
  const [detail, setDetail] = useState<ScheduledTaskDetail | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTaskListItem | null>(null)
  // 任务级模型覆盖用的候选：Key 列表进弹框时拉一次，模型跟着所选 Key 变。
  const [usableKeys, setUsableKeys] = useState<RuntimeKeyItem[]>([])
  const [taskModels, setTaskModels] = useState<AvailableModel[]>([])

  const selectedId = isNew ? null : detail?.id ?? null
  const hasSelection = isNew || detail !== null
  // 授权引导：右栏当前任务是脚本且未授权时常显，不依赖"刚保存"这个瞬时状态——
  // 这样从左栏点开一个 AI 建的待授权任务也能直接授权。
  const showApprovalBar = !isNew && detail !== null && needsApproval(detail)

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // 换任务级 Key 时清掉旧模型：模型白名单跟着 Key 走，留着旧值会提交一个该 Key
  // 下并不存在的模型。
  const handlePickKey = useCallback((apiKeyId: number | null) => {
    setForm((prev) => ({ ...prev, api_key_id: apiKeyId, model: "" }))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const all = await listScheduledTasks()
      // 按当前 Agent 过滤（用户任务量小，客户端过滤即可）。agent_id 为空的一并列出：
      // 早期链路建的任务没落 agent_id，若严格过滤这些任务在任何 Agent 下都看不到，
      // 用户既管不了也删不掉。列出时标注「未绑定」。
      setTasks(agentId == null ? all : all.filter((t) => t.agent_id === agentId || t.agent_id == null))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载定时任务失败")
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    if (!open) return
    setDetail(null)
    setIsNew(false)
    setForm(emptyForm())
    void refresh()
    listUsableKeys().then(setUsableKeys).catch(() => setUsableKeys([]))
  }, [open, refresh])

  // 任务级 Key 变化 → 拉该 Key 白名单下的模型。未选 Key 时无候选（走 Agent 默认）。
  useEffect(() => {
    if (!form.api_key_id) {
      setTaskModels([])
      return
    }
    listChatModels(form.api_key_id)
      .then(setTaskModels)
      .catch(() => setTaskModels([]))
  }, [form.api_key_id])

  /** 重新拉一条明细（保存/授权后同步右栏的 approved_hash、last_result 等）。 */
  const reloadDetail = useCallback(async (jobId: number) => {
    try {
      const fresh = await getScheduledTask(jobId)
      setDetail(fresh)
      setForm(formFromDetail(fresh))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载任务详情失败")
    }
  }, [])

  const startCreate = useCallback(() => {
    setIsNew(true)
    setDetail(null)
    setForm(emptyForm())
  }, [])

  const selectTask = useCallback(async (task: ScheduledTaskListItem) => {
    setIsNew(false)
    await reloadDetail(task.id)
  }, [reloadDetail])

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.cron_expression.trim()) {
      toast.error("请填写名称和调度表达式")
      return
    }
    if (form.task_kind === "prompt" && !form.task_prompt.trim()) {
      toast.error("提示词任务需要填写提示词")
      return
    }
    if (form.task_kind === "script" && !form.script_code.trim()) {
      toast.error("脚本任务需要填写脚本内容")
      return
    }
    setSaving(true)
    try {
      if (form.id == null) {
        const result = await createScheduledTask({
          name: form.name.trim(),
          cron_expression: form.cron_expression.trim(),
          agent_id: agentId,
          enabled: form.enabled,
          task_kind: form.task_kind,
          task_prompt: form.task_kind === "prompt" ? form.task_prompt : undefined,
          script_code: form.task_kind === "script" ? form.script_code : undefined,
          script_type: form.script_type,
          script_timeout: form.script_timeout,
          background: form.background.trim() || undefined,
          on_error: form.on_error,
          allow_ai_script_fix: form.allow_ai_script_fix,
          // 模型覆盖只对 prompt 任务有意义（脚本任务不过 LLM）。
          api_key_id: form.task_kind === "prompt" ? form.api_key_id : undefined,
          model: form.task_kind === "prompt" ? form.model || undefined : undefined,
        })
        setIsNew(false)
        await Promise.all([refresh(), reloadDetail(result.id)])
        if (result.needs_approval) {
          toast.info("脚本任务已创建，需授权后才会执行")
        } else {
          toast.success("定时任务已创建")
        }
      } else {
        await updateScheduledTask(form.id, {
          name: form.name.trim(),
          cron_expression: form.cron_expression.trim(),
          enabled: form.enabled,
          task_prompt: form.task_kind === "prompt" ? form.task_prompt : undefined,
          script_code: form.task_kind === "script" ? form.script_code : undefined,
          script_type: form.task_kind === "script" ? form.script_type : undefined,
          script_timeout: form.task_kind === "script" ? form.script_timeout : undefined,
          background: form.background.trim() || undefined,
          on_error: form.on_error,
          allow_ai_script_fix: form.allow_ai_script_fix,
          api_key_id: form.task_kind === "prompt" ? form.api_key_id : undefined,
          model: form.task_kind === "prompt" ? form.model || undefined : undefined,
        })
        const changedScript = form.task_kind === "script" && detail?.script_code !== form.script_code
        await Promise.all([refresh(), reloadDetail(form.id)])
        if (changedScript) {
          // 改脚本会撤销授权（后端 approved_hash 置空 + disable），授权条会自动显示。
          toast.info("脚本已修改，需重新授权后才会执行")
        } else {
          toast.success("定时任务已更新")
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }, [form, agentId, detail, refresh, reloadDetail])

  const handleApprove = useCallback(async (jobId: number) => {
    try {
      await approveScheduledTaskScript(jobId)
      toast.success("脚本已授权，任务将按计划执行")
      await Promise.all([refresh(), reloadDetail(jobId)])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "授权失败")
    }
  }, [refresh, reloadDetail])

  const handleToggle = useCallback(async (task: ScheduledTaskListItem) => {
    // 未授权脚本任务不允许直接启用：先授权。
    if (!task.enabled && needsApproval(task)) {
      toast.error("脚本任务需先授权才能启用")
      return
    }
    try {
      await toggleScheduledTask(task.id)
      await refresh()
      if (selectedId === task.id) await reloadDetail(task.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "切换状态失败")
    }
  }, [refresh, reloadDetail, selectedId])

  const handleRunNow = useCallback(async (jobId: number) => {
    setRunning(true)
    try {
      await runScheduledTaskNow(jobId)
      toast.success("已触发执行，稍后刷新查看结果")
      // 结果异步写回：延迟拉一次让 last_run_at / exit_code / last_result 更新。
      setTimeout(() => { void refresh(); void reloadDetail(jobId) }, 2000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "触发失败")
    } finally {
      setRunning(false)
    }
  }, [refresh, reloadDetail])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteScheduledTask(deleteTarget.id)
      toast.success("已删除")
      if (selectedId === deleteTarget.id) { setDetail(null); setForm(emptyForm()) }
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }, [deleteTarget, refresh, selectedId])

  const title = agentName ? `${agentName} · 定时任务` : "定时任务"

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85vh] max-h-[90vh] w-[96vw] max-w-[min(96vw,1200px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1200px)]">
          {/* pr-14 给右上角关闭按钮（DialogContent 的 absolute top-4 right-4）留位，
              否则刷新按钮会和它叠在一起。 */}
          <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-5 py-4 pr-14">
            <div className="flex min-w-0 items-center gap-2">
              <Clock className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">{title}</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  到点自动执行。提示词任务交给 Agent 跑；脚本任务直接运行代码，报错时触发 AI 诊断。脚本需授权后才会执行。
                </DialogDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> 刷新
            </Button>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* 左栏：任务列表 */}
            <div className="flex w-[280px] shrink-0 flex-col border-r">
              <div className="p-2">
                <Button className="w-full justify-start" variant="outline" onClick={startCreate}>
                  <Plus className="size-4" /> 新建定时任务
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
                {loading && tasks.length === 0 ? (
                  <div className="flex h-24 items-center justify-center"><Spinner /></div>
                ) : tasks.length === 0 && !isNew ? (
                  <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-sm text-muted-foreground">
                    <Clock className="size-8 opacity-40" />
                    <p>还没有定时任务。</p>
                    <p className="text-xs">点上方「新建」创建一个。</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {isNew && (
                      <div className="rounded-md border border-dashed bg-accent/50 px-3 py-2 text-sm">
                        <div className="font-medium">{form.name || "新任务"}</div>
                        <div className="text-xs text-muted-foreground">未保存</div>
                      </div>
                    )}
                    {tasks.map((task) => {
                      const pending = needsApproval(task)
                      return (
                        <button
                          key={task.id}
                          onClick={() => void selectTask(task)}
                          className={cn(
                            "flex flex-col gap-1 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                            !isNew && selectedId === task.id && "bg-accent",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {task.task_kind === "script" ? <Terminal className="mr-1 inline size-3.5 text-muted-foreground" /> : <FileText className="mr-1 inline size-3.5 text-muted-foreground" />}
                              {task.name}
                            </span>
                            {!task.enabled && <Badge variant="outline" className="shrink-0 text-[10px]">停用</Badge>}
                            {pending && <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">待授权</Badge>}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate font-mono">{task.cron_expression}</span>
                            {task.agent_id == null && <span className="shrink-0" title="未绑定 Agent（早期链路创建）">未绑定</span>}
                            {task.consecutive_failures ? <span className="shrink-0 text-destructive">连败 {task.consecutive_failures}</span> : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* 右栏：详情/编辑 */}
            <div className="flex min-w-0 flex-1 flex-col">
              {!hasSelection ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Clock className="size-10 opacity-40" />
                  <p>选择左侧任务查看详情，或新建一个。</p>
                </div>
              ) : (
                <TaskDetailPane
                  form={form}
                  detail={isNew ? null : detail}
                  isNew={isNew}
                  saving={saving}
                  running={running}
                  showApprovalBar={showApprovalBar}
                  usableKeys={usableKeys}
                  taskModels={taskModels}
                  setField={setField}
                  onPickKey={handlePickKey}
                  onSave={() => void handleSave()}
                  onApprove={() => detail && void handleApprove(detail.id)}
                  onRunNow={() => detail && void handleRunNow(detail.id)}
                  onToggle={() => detail && void handleToggle(detail)}
                  onDelete={() => detail && setDeleteTarget(detail)}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除定时任务</AlertDialogTitle>
            <AlertDialogDescription>确定删除「{deleteTarget?.name}」？此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ==================== 右栏：详情/编辑 ====================

interface TaskDetailPaneProps {
  form: FormState
  detail: ScheduledTaskDetail | null
  isNew: boolean
  saving: boolean
  running: boolean
  showApprovalBar: boolean
  /** 任务级模型覆盖的候选：可用网关 Key 与所选 Key 下的模型。 */
  usableKeys: RuntimeKeyItem[]
  taskModels: AvailableModel[]
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  /** 换 Key 要同时清掉旧模型，单字段 setField 表达不了，故单开一个回调。 */
  onPickKey: (apiKeyId: number | null) => void
  onSave: () => void
  onApprove: () => void
  onRunNow: () => void
  onToggle: () => void
  onDelete: () => void
}

function TaskDetailPane({
  form, detail, isNew, saving, running, showApprovalBar, usableKeys, taskModels,
  setField, onPickKey, onSave, onApprove, onRunNow, onToggle, onDelete,
}: TaskDetailPaneProps) {
  const isScript = form.task_kind === "script"
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-6 py-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{isNew ? "新建定时任务" : detail?.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {isNew ? "填写后保存创建任务" : (isScript ? `脚本 · ${form.script_type}` : "提示词任务")}
            {!isNew && detail && ` · ${detail.enabled ? "已启用" : "已停用"}`}
          </div>
        </div>
        {!isNew && detail && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onRunNow} disabled={running || !detail.enabled}>
              <Play className="size-4" /> {running ? "执行中..." : "立即运行"}
            </Button>
            <Button variant="outline" size="sm" onClick={onToggle}>
              {detail.enabled ? "停用" : "启用"}
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-destructive" title="删除" onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-6 py-4">
          {showApprovalBar && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <div className="text-sm font-medium text-amber-700 dark:text-amber-300">脚本需授权才会执行</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  出于安全，脚本任务必须经你确认后才会运行。核对脚本无误后点「立即授权」。
                </p>
              </div>
              <Button size="sm" onClick={onApprove}>
                <ShieldCheck className="size-4" /> 立即授权
              </Button>
            </div>
          )}

          {/* 基本字段 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>名称</Label>
              <Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="每日巡检" />
            </div>
            <div className="grid gap-1.5">
              <Label>调度表达式</Label>
              <Input
                value={form.cron_expression}
                onChange={(e) => setField("cron_expression", e.target.value)}
                placeholder="0 9 * * 1-5"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">支持 5 位 cron、daily/weekday/weekly/monthly/hourly、every_30m/every_2h。</p>
            </div>
          </div>

          {/* 类型切换 */}
          <div className="grid gap-1.5">
            <Label>任务类型</Label>
            <div className="flex gap-2">
              <Button type="button" variant={!isScript ? "default" : "outline"} size="sm" onClick={() => setField("task_kind", "prompt")}>
                <FileText className="size-4" /> 提示词
              </Button>
              <Button type="button" variant={isScript ? "default" : "outline"} size="sm" onClick={() => setField("task_kind", "script")}>
                <Terminal className="size-4" /> 脚本
              </Button>
            </div>
          </div>

          {/* 内容区 */}
          {!isScript ? (
            <>
              <div className="grid gap-1.5">
                <Label>提示词</Label>
                <Textarea
                  value={form.task_prompt}
                  onChange={(e) => setField("task_prompt", e.target.value)}
                  placeholder="到点时交给 Agent 执行的指令，需自包含（输入、期望产出、约束）。"
                  rows={10}
                  className="text-xs"
                />
              </div>
              {/* 任务级模型覆盖：不选则用 Agent 配置的定时任务模型（再空则主 Agent）。 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label>API Key</Label>
                  <NativeSelect
                    className="w-full"
                    value={form.api_key_id == null ? "" : String(form.api_key_id)}
                    onChange={(e) => {
                      const v = e.target.value
                      onPickKey(v ? Number(v) : null)
                    }}
                  >
                    <NativeSelectOption value="">用 Agent 默认</NativeSelectOption>
                    {usableKeys.map((k) => (
                      <NativeSelectOption key={k.id} value={String(k.id)}>
                        {k.name || k.key_masked || `Key #${k.id}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label>模型</Label>
                  <NativeSelect
                    className="w-full"
                    value={form.model}
                    disabled={!form.api_key_id}
                    onChange={(e) => setField("model", e.target.value)}
                  >
                    <NativeSelectOption value="">
                      {form.api_key_id ? "选择模型" : "用 Agent 默认"}
                    </NativeSelectOption>
                    {taskModels.map((m) => (
                      <NativeSelectOption key={m.id} value={m.id}>{m.id}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                留空则用 Agent「模型」页配置的定时任务默认；两处都未配则回退主 Agent 模型。
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label>脚本内容</Label>
                <Textarea
                  value={form.script_code}
                  onChange={(e) => setField("script_code", e.target.value)}
                  placeholder="print('hello')"
                  rows={14}
                  className="font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-1.5">
                  <Label>语言</Label>
                  <NativeSelect className="w-full" value={form.script_type} onChange={(e) => setField("script_type", e.target.value as ScheduledTaskScriptType)}>
                    <NativeSelectOption value="python">Python</NativeSelectOption>
                    <NativeSelectOption value="powershell">PowerShell</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label>超时（秒）</Label>
                  <Input type="number" min={1} value={form.script_timeout} onChange={(e) => setField("script_timeout", Math.max(1, Number(e.target.value) || 300))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>报错处理</Label>
                  <NativeSelect className="w-full" value={form.on_error} onChange={(e) => setField("on_error", e.target.value as ScheduledTaskOnError)}>
                    <NativeSelectOption value="none">仅记录</NativeSelectOption>
                    <NativeSelectOption value="diagnose">AI 诊断根因</NativeSelectOption>
                    <NativeSelectOption value="diagnose_fix_retry">诊断 + 修复 + 重跑</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">允许 AI 自主修复脚本</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">开启后 AI 修复的脚本免二次授权直接生效并自动重跑一次；关闭则修复需你重新授权。</p>
                </div>
                <Switch checked={form.allow_ai_script_fix} onCheckedChange={(v) => setField("allow_ai_script_fix", v)} />
              </div>
            </>
          )}

          {/* 背景 */}
          <div className="grid gap-1.5">
            <Label>背景（可选）</Label>
            <Textarea
              value={form.background}
              onChange={(e) => setField("background", e.target.value)}
              placeholder="这个任务为什么存在、判断口径、注意事项。脚本报错时会连同上下文一起交给 AI 诊断。"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="text-sm font-medium">启用</div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setField("enabled", v)} />
          </div>

          {/* 运行结果与自愈历史（仅已保存的脚本任务显示） */}
          {!isNew && detail && detail.task_kind === "script" && (
            <RunResultSection detail={detail} />
          )}

          {/* 操作 */}
          <div className="flex items-center justify-end gap-2 pt-1 pb-2">
            <Button onClick={onSave} disabled={saving}>
              {saving && <Spinner className="size-3" />}
              {isNew ? "创建" : "保存修改"}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </>
  )
}

// ==================== 运行结果与自愈历史 ====================

function RunResultSection({ detail }: { detail: ScheduledTaskDetail }) {
  const heal = detail.heal_history ?? []
  const lastResult = detail.last_result || ""
  if (!detail.last_run_at && !lastResult && heal.length === 0) return null
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Terminal className="size-4 text-muted-foreground" /> 运行结果
      </div>
      {detail.last_run_at && (
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">上次运行</div>
            <div>{new Date(detail.last_run_at).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">退出码</div>
            <div className={detail.last_exit_code == null ? "" : detail.last_exit_code === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              {detail.last_exit_code ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">连续失败</div>
            <div className={detail.consecutive_failures ? "text-destructive" : ""}>{detail.consecutive_failures ?? 0}</div>
          </div>
        </div>
      )}
      {lastResult && (
        <div className="grid gap-1">
          <div className="text-xs text-muted-foreground">last_result</div>
          <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-xs whitespace-pre-wrap">{lastResult}</pre>
        </div>
      )}
      {heal.length > 0 && (
        <div className="grid gap-1">
          <div className="text-xs text-muted-foreground">自愈历史（最近 {heal.length} 条）</div>
          <div className="flex flex-col gap-1">
            {heal.slice(-5).reverse().map((h, i) => (
              <div key={i} className="rounded border bg-background p-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">exit {h.exit_code ?? "—"}</Badge>
                  {h.applied && <Badge variant="outline" className="border-emerald-500/50 text-[10px] text-emerald-600 dark:text-emerald-400">已应用修复</Badge>}
                  {h.at && <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>}
                </div>
                {h.diagnosis && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{h.diagnosis}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
