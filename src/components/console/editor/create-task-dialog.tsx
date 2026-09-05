import { useEffect, useMemo, useState } from "react"
import { Play, Plus } from "lucide-react"
import CreateEditorDialog from "@/components/console/editor/create-editor-dialog"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import MultiSelect from "@/components/console/editor/multi-select"
import { useCommonData } from "@/components/console/data-provider"
import { editorSelectable } from "@/api/nodes"
import { MAX_TASK_CONTENT_LENGTH } from "@/components/console/task/task-content-limit"
import { resolveTaskIntent, type TaskIntent } from "@/components/console/editor/task-intent"
import { listRuntimeModelOptions } from "@/api/agentClient"
import {
  createProjectEditorSession,
  editorDisplayName,
  editorModeOptions,
  listParentKeys,
  listProjectEditors,
  type GatewayModelOption,
} from "@/api/editorClient"
import type { EditorInstance, EditorSession, ParentKeyItem } from "@/api/editorClient"
import type { DomainProjectIssue } from "@/api/Api"

/**
 * 创建任务（原「预注册编辑器会话」）。一个任务 = 一个独立 provider 对话状态 + 一把
 * 派生 API Key，共享编辑器的项目/分支/节点/工具配置。
 *
 * 全站唯一的任务创建弹框：编辑器详情页、编辑器列表、项目页「启动 AI」、需求/bug
 * 「分配任务」都用它。「分配任务」与「创建任务」是同一个东西，界面完全一致——
 * 传 issue 只额外做两件事：预填任务内容、提交 issue_id 让服务端挂上需求/bug 操作 MCP。
 *
 * 关键点：
 * - 可用模型按父 API Key 取运行时目录（listRuntimeModelOptions → /agent/chat/models），
 *   随所选父 Key 的白/黑名单过滤，不再用无 Key 范围的全局 /v1/models。
 * - 模型用下拉多选，选中的即该任务可切换的模型集合；当前激活模型取第一个。
 * - 限额（请求数 / 总 token）收进「高级参数」折叠区，文案明确这是 API Key 的可用次数。
 * - editor 传入则锁定该编辑器；不传则在项目下拉选择（项目页/issue 入口还没选编辑器）。
 */

/** 把需求/bug 的标题与已有文档拼成任务内容，作为预注册的首条消息。 */
function buildIssueContent(issue: DomainProjectIssue): string {
  const parts: string[] = []
  if (issue.title?.trim()) parts.push(issue.title.trim())
  if (issue.requirement_document?.trim()) parts.push(issue.requirement_document.trim())
  if (issue.design_document?.trim()) parts.push(`技术方案：\n${issue.design_document.trim()}`)
  if (issue.bug_reason?.trim()) parts.push(`已知原因：\n${issue.bug_reason.trim()}`)
  return parts.join("\n\n")
}

export default function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  editor,
  parentKeys,
  onCreated,
  initialContent = "",
  initialModels = [],
  issue,
  navigateToSession = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** 传入则锁定该编辑器；不传则拉取项目编辑器列表让用户选。 */
  editor?: EditorInstance
  /** 不传则自行拉取可用父 Key。 */
  parentKeys?: ParentKeyItem[]
  onCreated?: (session: EditorSession) => void
  initialContent?: string
  initialModels?: string[]
  /** 传入则进入「分配任务」：预填需求/bug 内容并提交 issue_id，其余与创建任务完全一致。 */
  issue?: DomainProjectIssue
  /** 创建后跳到该会话（项目页/issue 入口用；编辑器详情页原地刷新，不跳）。 */
  navigateToSession?: boolean
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { nodes } = useCommonData()
  const [parentKeyId, setParentKeyId] = useState("")
  const [fetchedParentKeys, setFetchedParentKeys] = useState<ParentKeyItem[]>([])
  const [editors, setEditors] = useState<EditorInstance[]>([])
  const [createEditorOpen, setCreateEditorOpen] = useState(false)
  const [selectedEditorId, setSelectedEditorId] = useState("")
  const [models, setModels] = useState<GatewayModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [mode, setMode] = useState("")
  const [taskContent, setTaskContent] = useState("")
  const [taskIntent, setTaskIntent] = useState<TaskIntent>("analysis")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [maxRequests, setMaxRequests] = useState("")
  const [maxTotalTokens, setMaxTotalTokens] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [expectedClientId, setExpectedClientId] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const availableParentKeys = parentKeys ?? fetchedParentKeys
  // editor 固定时用它；否则用下拉选中的。
  const activeEditor = editor ?? editors.find((item) => item.id === selectedEditorId)
  const compatibleParentKeys = useMemo(() => {
    if (!activeEditor) return availableParentKeys
    return availableParentKeys.filter((key) => {
      const whitelist = key.editor_provider_whitelist || []
      const blacklist = key.editor_provider_blacklist || []
      return (!whitelist.length || whitelist.includes(activeEditor.provider)) && !blacklist.includes(activeEditor.provider)
    })
  }, [activeEditor, availableParentKeys])
  const contentTooLong = taskContent.length > MAX_TASK_CONTENT_LENGTH
  const prefillContent = useMemo(
    () => (issue ? buildIssueContent(issue) : initialContent),
    [issue, initialContent],
  )

  // 模型目录绑定当前父 API Key；父 Key 变化时清空旧值并重新拉取，避免把
  // 上一个 Key 的模型带进当前任务。
  useEffect(() => {
    if (!open || !parentKeyId) {
      setModels([])
      setSelectedModels([])
      return
    }
    const controller = new AbortController()
    setModels([])
    setSelectedModels([])
    setModelsLoading(true)
    void listRuntimeModelOptions(Number(parentKeyId), controller.signal)
      .then((options) => {
        if (controller.signal.aborted) return
        setModels(options)
        const allowedInitial = initialModels.filter((id) => options.some((item) => item.value === id))
        setSelectedModels(allowedInitial.length > 0 ? allowedInitial : options.slice(0, 1).map((item) => item.value))
      })
      .catch(() => { if (!controller.signal.aborted) setModels([]) })
      .finally(() => { if (!controller.signal.aborted) setModelsLoading(false) })
    return () => { controller.abort() }
  }, [open, parentKeyId, initialModels])

  // 打开时初始化任务表单；模型目录由上面的 parentKeyId effect 负责加载。
  // prefillContent 必须在依赖里：issue 与 open=true 同帧到达时否则会漏预填。
  useEffect(() => {
    if (!open) return
    setParentKeyId(compatibleParentKeys[0] ? String(compatibleParentKeys[0].id) : "")
    setTaskContent(prefillContent)
    setTaskIntent("analysis")
    setMode("")
    setShowAdvanced(false)
    setMaxRequests("")
    setMaxTotalTokens("")
    setExpiresAt("")
    setExpectedClientId("")
  }, [open, parentKeys, prefillContent, compatibleParentKeys])

  // 未传 parentKeys 的调用方（项目页/issue）自行拉取，免得层层透传。
  useEffect(() => {
    if (!open || parentKeys) return
    let active = true
    void listParentKeys()
      .then((rows) => {
        if (!active) return
        const usable = rows.filter((key) => !key.disabled)
        setFetchedParentKeys(usable)
        setParentKeyId((current) =>
          current && usable.some((key) => String(key.id) === current)
            ? current
            : (usable[0] ? String(usable[0].id) : ""),
        )
      })
      .catch(() => { if (active) setFetchedParentKeys([]) })
    return () => { active = false }
  }, [open, parentKeys])

  useEffect(() => {
    if (!open || !activeEditor) return
    setParentKeyId((current) =>
      current && compatibleParentKeys.some((key) => String(key.id) === current)
        ? current
        : (compatibleParentKeys[0] ? String(compatibleParentKeys[0].id) : ""),
    )
  }, [open, activeEditor, compatibleParentKeys])

  async function refreshEditors(preferredId?: string) {
    const rows = await listProjectEditors(projectId)
    setEditors(rows)
    // 默认选第一个可用编辑器（节点在线且未满载）；全部不可用时退回第一个并提示原因。
    const firstUsable = rows.find((e) => editorSelectable(e, nodes).selectable)
    const fallback = (firstUsable || rows[0])?.id || ""
    setSelectedEditorId(
      preferredId && rows.some((item) => item.id === preferredId) ? preferredId : fallback
    )
  }

  // 未固定编辑器时拉项目编辑器列表供选择。
  useEffect(() => {
    if (!open || editor || !projectId) {
      if (!open) {
        setEditors([])
        setCreateEditorOpen(false)
      }
      return
    }
    let active = true
    void refreshEditors(selectedEditorId || undefined).catch(() => { if (active) setEditors([]) })
    return () => { active = false }
  }, [open, editor, projectId])

  // provider 变化时，若当前模式不在该 provider 的选项内则回落默认。
  useEffect(() => {
    const allowed = editorModeOptions(activeEditor?.provider).map((option) => option.value)
    setMode((current) => (allowed.includes(current) ? current : ""))
  }, [activeEditor?.provider])

  async function submit() {
    if (!activeEditor) {
      toast.error("请选择一个编辑器；任务会在该编辑器下创建")
      return
    }
    if (!parentKeyId) {
      toast.error("请选择父 API Key")
      return
    }
    if (contentTooLong) {
      toast.error(`任务内容超出 ${MAX_TASK_CONTENT_LENGTH} 字上限`)
      return
    }
    if (activeEditor.provider === "codex" && (!expectedClientId.trim() || !taskContent.trim())) {
      toast.error("Codex 任务需要预注册 installation_id 和任务内容")
      return
    }
    // issue 模式必须带意图映射：服务端要靠 task_role 判断权限与目标状态。
    const mapping = resolveTaskIntent(taskIntent, issue?.type === "bug" ? "bug" : issue ? "requirement" : undefined)
    setSubmitting(true)
    try {
      const session = await createProjectEditorSession(projectId, activeEditor.id, {
        parent_api_key_id: Number(parentKeyId),
        ...(selectedModels.length ? { models: selectedModels, model: selectedModels[0] } : {}),
        ...(mode ? { mode } : {}),
        ...((maxRequests || maxTotalTokens) ? {
          usage_limit: {
            ...(maxRequests ? { max_requests: Number(maxRequests) } : {}),
            ...(maxTotalTokens ? { max_total_tokens: Number(maxTotalTokens) } : {}),
          },
        } : {}),
        ...(expiresAt ? { expires_at: new Date(expiresAt).getTime() / 1000 } : {}),
        ...(expectedClientId.trim() ? { expected_client_id: expectedClientId.trim() } : {}),
        ...(taskContent.trim() ? { first_content: taskContent } : {}),
        task_type: mapping.taskType,
        task_role: mapping.taskRole,
        sub_type: mapping.subType,
        ...(issue?.id ? { issue_id: issue.id } : {}),
      })
      onOpenChange(false)
      onCreated?.(session)
      toast.success(issue ? "任务已分配" : "任务已创建")
      if (navigateToSession) {
        navigate(`/console/editor/${activeEditor.id}/session/${session.id}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            {/* 锁定编辑器时下拉不渲染，这句是唯一能看出选了哪个编辑器的地方——显示名字而非 provider。 */}
            任务继承编辑器
            <span className="font-medium text-foreground">「{editorDisplayName(activeEditor)}」</span>
            {activeEditor?.provider ? ` · ${activeEditor.provider}` : ""}
            {" "}的项目、分支、节点和工具配置，但拥有独立的 provider 对话状态与独立的 API Key。
          </div>

          {!editor && (
            <div className="grid gap-2">
              <Label>编辑器</Label>
              <div className="flex items-center gap-2">
                <select
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                  value={selectedEditorId}
                  onChange={(event) => setSelectedEditorId(event.target.value)}
                >
                  {editors.length === 0 && <option value="">该项目还没有编辑器</option>}
                  {editors.map((item) => {
                    const state = editorSelectable(item, nodes)
                    return (
                      <option key={item.id} value={item.id} disabled={!state.selectable}>
                        {editorDisplayName(item)} · {item.provider}
                        {!state.selectable ? `（${state.reason}）` : ""}
                      </option>
                    )
                  })}
                </select>
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setCreateEditorOpen(true)} title="新建编辑器">
                  <Plus className="size-4" />
                </Button>
              </div>
              {editors.length === 0 && <p className="text-xs text-muted-foreground">请先使用右侧加号创建编辑器，创建后会自动选中。</p>}
            </div>
          )}

          <div className="grid gap-2">
            <Label>父 API Key</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={parentKeyId}
              onChange={(event) => setParentKeyId(event.target.value)}
            >
              <option value="">选择可用的父 Key</option>
              {compatibleParentKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name} · {key.source} · {key.key_masked}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label>{t("consoleProject.startTask.taskType.label")}</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={taskIntent}
              onChange={(event) => setTaskIntent(event.target.value as TaskIntent)}
            >
              <option value="analysis">{t("consoleProject.startTask.taskType.analysis")}</option>
              <option value="fix">{t("consoleProject.startTask.taskType.fix")}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {taskIntent === "analysis"
                ? t("consoleProject.startTask.taskType.analysisHint")
                : t("consoleProject.startTask.taskType.fixHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>可用模型</Label>
            <MultiSelect
              options={models}
              value={selectedModels}
              onChange={setSelectedModels}
              placeholder={modelsLoading ? "加载模型中…" : "选择该任务可切换的模型（可多选）"}
              emptyHint={modelsLoading ? "加载模型中…" : "暂无可用模型"}
            />
            <p className="text-xs text-muted-foreground">来自网关模型目录；运行时可在这些模型间切换，当前激活模型取第一个。</p>
          </div>

          <div className="grid gap-2">
            <Label>运行模式</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {editorModeOptions(activeEditor?.provider).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">决定任务的权限/审批模式，随编辑器类型不同；留空使用编辑器默认。</p>
          </div>

          <div className="grid gap-2">
            <Textarea
              className="min-h-28"
              value={taskContent}
              onChange={(event) => setTaskContent(event.target.value)}
              placeholder="本次任务要处理的内容（作为预注册的第一条消息）"
              aria-invalid={contentTooLong}
            />
            {contentTooLong && (
              <p className="text-xs text-destructive">
                任务内容超出 {MAX_TASK_CONTENT_LENGTH} 字上限（当前 {taskContent.length} 字）
              </p>
            )}
          </div>

          {activeEditor?.provider === "codex" && (
            <div className="grid gap-2">
              <Label>Codex installation_id</Label>
              <Input
                value={expectedClientId}
                onChange={(event) => setExpectedClientId(event.target.value)}
                placeholder="来自 Codex 请求 metadata"
              />
            </div>
          )}

          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
            >
              <span>高级参数 · API Key 限额</span>
              <span className="text-xs text-muted-foreground">{showAdvanced ? "收起" : "展开"}</span>
            </button>
            {showAdvanced && (
              <div className="grid gap-3 border-t px-3 py-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">API Key 最大请求次数</Label>
                  <Input type="number" min="1" value={maxRequests} onChange={(event) => setMaxRequests(event.target.value)} placeholder="不限制" />
                  <p className="text-[11px] text-muted-foreground">该任务派生 Key 的最大请求次数</p>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">API Key 最大总 Token</Label>
                  <Input type="number" min="1" value={maxTotalTokens} onChange={(event) => setMaxTotalTokens(event.target.value)} placeholder="不限制" />
                  <p className="text-[11px] text-muted-foreground">该任务派生 Key 的最大累计 token</p>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label className="text-xs">API Key 过期时间</Label>
                  <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={submitting || contentTooLong || !activeEditor}>
            {submitting ? <Spinner /> : <Play className="size-4" />} 创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CreateEditorDialog
      open={createEditorOpen}
      onOpenChange={setCreateEditorOpen}
      projectId={projectId}
      onCreated={(created) => {
        setEditors((current) => [...current.filter((item) => item.id !== created.id), created])
        setSelectedEditorId(created.id)
      }}
    />
    </>
  )
}
