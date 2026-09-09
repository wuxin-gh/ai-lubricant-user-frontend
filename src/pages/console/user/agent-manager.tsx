/**
 * Agent 配置工作区（用户侧）。
 *
 * 页面与详情弹框共用同一套 Agent 列表、配置表单和 CRUD 行为，宿主只负责外层容器。
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgent,
  getAgentMcpDiagnostics,
  listUsableKeys,
  listChatModels,
  getAgentSops,
  fetchBuiltinToolsSchema,
  FALLBACK_BUILTIN_TOOLS,
  type AgentInstance,
  type ManagedAgentSop,
  type BuiltinToolSchema,
  type CreateAgentPayload,
  type RuntimeKeyItem,
  type AvailableModel,
} from "@/api/agentClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Bot, Plus, RefreshCw, Trash2, Check, ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"
import {
  listMcpAuthorizationOptions,
  listMcpPrincipalGrants,
  replaceMcpPrincipalGrants,
  updateMcpPrincipal,
  type McpPrincipal,
} from "@/api/mcpClient"
import { McpGrantPicker, type PickerGrant, type PickerParamKind, type PickerResource } from "@/components/console/mcp/McpGrantPicker"
import { type PermissionEditorHandle } from "@/components/console/mcp/McpUserPermissionEditor"

const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"]
const DEFAULT_DENIED_PATTERNS = ["/etc/", "/var/", ".env", ".git/", "node_modules/"]
const DEFAULT_ALLOWED_ROOTS = ["agent/workspace", "agent/temp"]

// 一级工具集来源单一：优先 GET /agent/tools/schema（agent/tools.py
// ToolRegistry.get_schema）。FALLBACK_BUILTIN_TOOLS 仅在后端不可用时回退，
// 与后端固定一级工具集 + tests/test_agent_tools.py 一致。capability_call 是
// 二级能力（MCP 方法 / scheduler）的入口，不在此处把二级方法伪装成一级工具。

interface EditorState {
  displayName: string
  description: string
  systemPrompt: string
  maxTurns: number
  enabled: boolean
  memoryEnabled: boolean
  skillAutoLearn: boolean
  schedulerEnabled: boolean
  // 网关秘钥绑定：主/子 Agent 各自选（网关 Key + 模型）；子空=跟随主。
  mainApiKeyId: number | null
  mainModel: string
  subagentApiKeyId: number | null
  subagentModel: string
  // 定时任务默认绑定：到点无人值守跑批用它，空=跟随主 Agent。
  scheduledApiKeyId: number | null
  scheduledModel: string
  thinkingEnabled: boolean
  reasoningEffort: string
  // agent 层 429 自动重试次数（仅瞬时限流类；0=关闭）
  llmRetry429: number
  deniedPatterns: string
  // 需确认工具（code_run / 节点命令）挂起等人裁决的上限，单位秒；0=不过期。
  approvalTimeoutSeconds: number
  // 浏览器（CDP 网页对话）能否执行 code_run。默认关；开启后网页对话弹审批卡。
  browserCodeRunEnabled: boolean
  guardianEnabled: boolean
  guardianInterval: number
  autonomousEnabled: boolean
  // 团队共享：true 时同 team 成员可见可用。
  isTeamShared: boolean
  // Agent 绑定的 MCP 用户（principal）。普通 user-owned principal，usage_type=agent；
  // token 全程隐藏。Agent 挂哪些 MCP 完全由该 principal 的授权/参数推导，Agent 自身
  // 不再保存服务清单。
  mcpUserId: number | null
}

const DEFAULT_EDITOR: EditorState = {
  displayName: "",
  description: "",
  systemPrompt: "",
  maxTurns: 80,
  enabled: true,
  memoryEnabled: true,
  skillAutoLearn: true,
  schedulerEnabled: false,
  mainApiKeyId: null,
  mainModel: "",
  subagentApiKeyId: null,
  subagentModel: "",
  scheduledApiKeyId: null,
  scheduledModel: "",
  thinkingEnabled: false,
  reasoningEffort: "medium",
  llmRetry429: 2,
  deniedPatterns: DEFAULT_DENIED_PATTERNS.join(", "),
  approvalTimeoutSeconds: 24 * 60 * 60,
  browserCodeRunEnabled: false,
  guardianEnabled: false,
  guardianInterval: 300,
  autonomousEnabled: false,
  isTeamShared: false,
  mcpUserId: null,
}

function agentToEditor(agent: AgentInstance): EditorState {
  return {
    displayName: agent.display_name || agent.name || "",
    description: agent.description || "",
    systemPrompt: agent.system_prompt || "",
    maxTurns: agent.max_turns || 80,
    enabled: agent.enabled,
    memoryEnabled: agent.memory_enabled,
    skillAutoLearn: agent.skill_auto_learn ?? true,
    schedulerEnabled: agent.scheduler_enabled ?? false,
    mainApiKeyId: agent.main_api_key_id ?? null,
    mainModel: agent.main_model || "",
    subagentApiKeyId: agent.subagent_api_key_id ?? null,
    subagentModel: agent.subagent_model || "",
    scheduledApiKeyId: agent.scheduled_api_key_id ?? null,
    scheduledModel: agent.scheduled_model || "",
    thinkingEnabled: !!agent.thinking_enabled,
    reasoningEffort: agent.reasoning_effort || "medium",
    llmRetry429: typeof agent.llm_retry_429 === "number" ? agent.llm_retry_429 : 2,
    deniedPatterns: (agent.denied_patterns || DEFAULT_DENIED_PATTERNS).join(", "),
    approvalTimeoutSeconds: typeof agent.approval_timeout_seconds === "number"
      ? agent.approval_timeout_seconds
      : 24 * 60 * 60,
    browserCodeRunEnabled: !!agent.browser_code_run_enabled,
    guardianEnabled: agent.guardian_enabled ?? false,
    guardianInterval: agent.guardian_interval || 300,
    autonomousEnabled: agent.autonomous_enabled ?? false,
    isTeamShared: agent.is_team_shared ?? false,
    mcpUserId: agent.mcp_user_id ?? null,
  }
}

// ── Agent MCP 权限管理区 ──────────────────────────────────────────────
// 建 Agent 时后端自动建一个 usage_type=agent 的 principal 并写 agents.mcp_user_id；
// 历史 Agent（含错绑 external principal 的）由服务启动对账补建/改绑，本区域只读展示
// 已绑定的 principal 并内联渲染权限编辑器，不再在打开页面时创建数据。
// token 全程隐藏（连 hint 都不展示）。principal 生命周期跟随 Agent。
function AgentPrincipalSection({
  agentId,
  boundId,
  editorRef,
}: {
  agentId: number | null
  boundId: number | null
  editorRef: React.RefObject<PermissionEditorHandle | null>
}) {
  const [principal, setPrincipal] = useState<McpPrincipal | null>(null)
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState(false)
  // 添加式选择器的授权草稿 + 候选数据。加载时从 grants 端点初始化草稿；
  // 外层「保存」按钮经 ref 触发 saveGrants（全量替换）。
  const [draft, setDraft] = useState<PickerGrant[]>([])
  const [pickerResources, setPickerResources] = useState<PickerResource[]>([])
  const [paramKinds, setParamKinds] = useState<PickerParamKind[]>([])
  const draftRef = useRef<PickerGrant[]>([])

  const load = useCallback(async () => {
    if (!agentId || !boundId) { setPrincipal(null); setDraft([]); return }
    setLoading(true)
    try {
      const [diag, opts, grantsResult] = await Promise.all([
        getAgentMcpDiagnostics(agentId),
        listMcpAuthorizationOptions(),
        listMcpPrincipalGrants(Number(boundId)).catch(() => ({ grants: [] as PickerGrant[] })),
      ])
      setPrincipal((diag.principal as unknown as McpPrincipal | null))
      const svcResources: PickerResource[] = (opts.resources || [])
        .filter((r) => r.resource_kind === "service")
        .map((r) => ({
          resource_kind: "service",
          resource_id: r.resource_id,
          resource_type: r.resource_type,
          name: r.name,
          description: r.description,
          tool_count: r.tool_count,
          kind: r.kind,
          stdio: r.stdio,
          required_param: r.required_param,
        }))
      const instanceResources: PickerResource[] = (opts.resources || [])
        .filter((r) => r.resource_kind === "builtin_resource")
        .map((r) => ({
          resource_kind: "builtin_resource",
          resource_id: r.resource_id,
          resource_type: r.resource_type,
          name: r.name,
          children: [],
        }))
      setPickerResources([...svcResources, ...instanceResources])
      setParamKinds(opts.param_kinds || [])
      const initial = (grantsResult.grants || []) as PickerGrant[]
      setDraft(initial)
      draftRef.current = initial
    } catch (e) {
      setPrincipal(null)
      toast.error(e instanceof Error ? e.message : "加载 Agent MCP 配置失败")
    } finally {
      setLoading(false)
    }
  }, [agentId, boundId])

  useEffect(() => { void load() }, [load])

  /** 外层「保存」按钮的统一入口：把草稿全量写回 principal grants。 */
  useImperativeHandle(
    editorRef,
    () => ({
      save: async () => {
        if (!principal) return false
        const saved = await replaceMcpPrincipalGrants(principal.id, draftRef.current)
        draftRef.current = (saved.grants || []) as PickerGrant[]
        setDraft(draftRef.current)
        return true
      },
    }),
    [principal],
  )

  const toggleEnabled = async () => {
    if (!principal) return
    setToggling(true)
    try {
      const updated = await updateMcpPrincipal(principal.id, { enabled: !principal.enabled })
      setPrincipal(updated)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> 加载 MCP 配置…
      </div>
    )
  }

  if (!agentId) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        请先选择或保存当前 Agent。
      </div>
    )
  }

  if (!boundId) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        该 Agent 尚未绑定 MCP 用户，重启服务完成启动对账后重试。
      </div>
    )
  }

  if (!principal) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        已绑定 MCP 用户（id={boundId}），但详情加载失败，请检查服务是否正常。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium">{principal.name}</div>
          <div className="text-xs text-muted-foreground">Principal {principal.id}</div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">启用</Label>
          <Switch checked={principal.enabled} onCheckedChange={() => void toggleEnabled()} disabled={toggling} />
        </div>
      </div>
      {/* 添加式选择器：草稿本地持有，「保存」按钮统一写回 grants（useImperativeHandle）。 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <McpGrantPicker
          grants={draft}
          onChange={(next) => { draftRef.current = next; setDraft(next) }}
          resources={pickerResources}
          paramKinds={paramKinds}
          title={`配置「${principal.name}」可使用的 MCP`}
        />
      </div>
    </div>
  )
}

// ── 可搜索单选下拉（Popover + Command）─────────────────────────────────
// 触发器占满整行，每项支持副标题（description）；用于网关 Key 与模型选择。
interface SearchableOption {
  value: string
  label: string
  description?: string
  keywords?: string[]
}

function SearchableSelect({
  value,
  options,
  placeholder,
  searchPlaceholder = "搜索...",
  emptyText = "无匹配项",
  disabled = false,
  onChange,
}: {
  value: string
  options: SearchableOption[]
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex min-w-0 flex-col items-start">
            {selected ? (
              <>
                <span className="truncate">{selected.label}</span>
                {selected.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {selected.description}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label, ...(o.keywords || [])]}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.description && (
                      <span className="truncate text-xs text-muted-foreground">{o.description}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// 模型 → 可搜索选项（模型 ID 作主标题，后端合成的 description 作副标题）。
function modelOptions(models: AvailableModel[]): SearchableOption[] {
  return models.map((m) => ({
    value: m.id,
    label: m.id,
    description: m.description || m.remark || undefined,
    keywords: [m.name || "", m.description || "", m.remark || ""].filter(Boolean),
  }))
}

const AGENTS_CHANGED_EVENT = "agent-manager:changed"

export interface AgentManagerWorkspaceProps {
  /** 设为 false 时只显示 initialAgentId 对应 Agent 的配置。 */
  showAgentList?: boolean
  /** 首次加载时直接定位某个 Agent。 */
  initialAgentId?: number | null
  /** 首次加载时直接进入新建 Agent 表单。 */
  initialCreate?: boolean
  /** Agent 列表发生变更后回调，供宿主刷新自己的 Agent 列表。 */
  onChanged?: () => void
  className?: string
}

export default function AgentManagerWorkspace({
  showAgentList = true,
  initialAgentId = null,
  initialCreate = false,
  onChanged,
  className,
}: AgentManagerWorkspaceProps) {
  const [agents, setAgents] = useState<AgentInstance[]>([])
  // 可用网关 Key（自有 + 分组授权系统 key）；模型按所选 Key 拉取（复用聊天页口径）。
  const [runtimeKeys, setRuntimeKeys] = useState<RuntimeKeyItem[]>([])
  const [mainModels, setMainModels] = useState<AvailableModel[]>([])
  const [subagentModels, setSubagentModels] = useState<AvailableModel[]>([])
  const [scheduledModels, setScheduledModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  // 当前选中的 Agent：id 为编辑现有；null 为新建草稿。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<EditorState>(DEFAULT_EDITOR)
  const [saving, setSaving] = useState(false)
  const [availableSops, setAvailableSops] = useState<ManagedAgentSop[]>([])
  const [sopsLoading, setSopsLoading] = useState(false)
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolSchema[]>(FALLBACK_BUILTIN_TOOLS)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toDelete, setToDelete] = useState<AgentInstance | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** Agent 配置保存时顺带保存 MCP 授权（编辑器挂载后才有值）。 */
  const mcpEditorRef = useRef<PermissionEditorHandle | null>(null)

  const editing = useMemo(
    () => (isNew ? null : agents.find((a) => a.id === selectedId) || null),
    [agents, selectedId, isNew],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ags, keys] = await Promise.all([listAgents(), listUsableKeys().catch(() => [])])
      setAgents(ags)
      setRuntimeKeys(keys.filter((k) => !k.disabled))
      return ags
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败")
      return [] as AgentInstance[]
    } finally {
      setLoading(false)
    }
  }, [])

  // 宿主挂载时加载；页面与弹框都复用相同的初始化逻辑。
  useEffect(() => {
    reload().then((ags) => {
      if (initialCreate) {
        setIsNew(true)
        setSelectedId(null)
        setForm({ ...DEFAULT_EDITOR })
        return
      }
      setSelectedId((prev) => {
        if (isNew) return prev
        const requested = initialAgentId ? ags.find((a) => a.id === initialAgentId) : null
        const current = prev ? ags.find((a) => a.id === prev) : null
        const target = requested || current || (showAgentList ? ags[0] : undefined)
        if (target) {
          setForm(agentToEditor(target))
          return target.id
        }
        return null
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, initialAgentId, initialCreate, showAgentList])

  useEffect(() => {
    if (!editing?.id) {
      setAvailableSops([])
      return
    }
    let cancelled = false
    setSopsLoading(true)
    getAgentSops(editing.id)
      .then((data) => {
        if (cancelled) return
        setAvailableSops(data.available || [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "加载 SOP 失败")
      })
      .finally(() => { if (!cancelled) setSopsLoading(false) })
    return () => { cancelled = true }
  }, [editing?.id])

  // 一级工具集动态加载：来源单一，GET /agent/tools/schema 不可用时回退到固定集。
  useEffect(() => {
    setToolsLoading(true)
    let cancelled = false
    fetchBuiltinToolsSchema()
      .then((tools) => { if (!cancelled) setBuiltinTools(tools) })
      .catch(() => { if (!cancelled) setBuiltinTools(FALLBACK_BUILTIN_TOOLS) })
      .finally(() => { if (!cancelled) setToolsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 主 Agent Key 变化 → 拉该 Key 白名单下可用模型（供主模型选择器）。
  useEffect(() => {
    if (!form.mainApiKeyId) {
      setMainModels([])
      return
    }
    listChatModels(form.mainApiKeyId)
      .then(setMainModels)
      .catch(() => setMainModels([]))
  }, [form.mainApiKeyId])

  // 子 Agent Key 变化 → 拉该 Key 下可用模型（子 Key 为空则不拉，子模型跟随主）。
  useEffect(() => {
    if (!form.subagentApiKeyId) {
      setSubagentModels([])
      return
    }
    listChatModels(form.subagentApiKeyId)
      .then(setSubagentModels)
      .catch(() => setSubagentModels([]))
  }, [form.subagentApiKeyId])

  // 定时任务 Key 变化 → 拉该 Key 下可用模型（为空则不拉，定时回退主 Agent）。
  useEffect(() => {
    if (!form.scheduledApiKeyId) {
      setScheduledModels([])
      return
    }
    listChatModels(form.scheduledApiKeyId)
      .then(setScheduledModels)
      .catch(() => setScheduledModels([]))
  }, [form.scheduledApiKeyId])

  const selectAgent = (agent: AgentInstance) => {
    setIsNew(false)
    setSelectedId(agent.id)
    setForm(agentToEditor(agent))
  }

  const startCreate = () => {
    setIsNew(true)
    setSelectedId(null)
    setForm({ ...DEFAULT_EDITOR })
  }

  const notifyChanged = () => {
    onChanged?.()
    window.dispatchEvent(new Event(AGENTS_CHANGED_EVENT))
  }

  const handleSave = async () => {
    if (!form.displayName.trim()) {
      toast.error("请填写显示名称")
      return
    }
    if (!form.mainApiKeyId) {
      toast.error("请选择主 Agent 的网关 API Key")
      return
    }
    if (!form.mainModel) {
      toast.error("请选择主 Agent 的模型")
      return
    }
    setSaving(true)
    try {
      const denied = form.deniedPatterns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const payload: CreateAgentPayload = {
        // name 只是内部标识，用显示名 + 时间戳生成，避免用户填写；服务端 id 才是唯一标识
        name: editing ? editing.name : `agent-${Date.now()}`,
        display_name: form.displayName.trim(),
        description: form.description,
        system_prompt: form.systemPrompt,
        max_turns: form.maxTurns,
        enabled: form.enabled,
        memory_enabled: form.memoryEnabled,
        skill_auto_learn: form.skillAutoLearn,
        scheduler_enabled: form.schedulerEnabled,
        main_api_key_id: form.mainApiKeyId,
        main_model: form.mainModel,
        subagent_api_key_id: form.subagentApiKeyId,
        subagent_model: form.subagentModel,
        scheduled_api_key_id: form.scheduledApiKeyId,
        scheduled_model: form.scheduledModel,
        thinking_enabled: form.thinkingEnabled,
        reasoning_effort: form.reasoningEffort,
        llm_retry_429: form.llmRetry429,
        denied_patterns: denied,
        approval_timeout_seconds: form.approvalTimeoutSeconds,
        browser_code_run_enabled: form.browserCodeRunEnabled,
        guardian_enabled: form.guardianEnabled,
        guardian_interval: form.guardianInterval,
        autonomous_enabled: form.autonomousEnabled,
        is_team_shared: form.isTeamShared,
        // mcp_user_id 由建 Agent 时后端自动绑定，update 不改绑，故不回传。
      }
      if (editing) {
        const { name, ...rest } = payload
        void name
        await updateAgent(editing.id, rest)
        // 先保存 MCP 授权草稿（此时 principal 已存在，编辑器仍挂载在旧 agent 上，
        // draft 未被 reload 覆盖），再 reload/selectAgent 切换。
        try {
          await mcpEditorRef.current?.save()
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "MCP 授权保存失败")
        }
        toast.success("已保存")
        const ags = await reload()
        const updated = ags.find((a) => a.id === editing.id)
        if (updated) selectAgent(updated)
      } else {
        // 新建补默认 workspace/allowed_roots（后端也有默认，这里显式带上更清晰）
        const created = await createAgent({
          ...payload,
          workspace_root: "agent/workspace",
          allowed_roots: DEFAULT_ALLOWED_ROOTS,
        })
        toast.success("已创建")
        const ags = await reload()
        const fresh = ags.find((a) => a.id === created.id) || created
        selectAgent(fresh)
      }
      notifyChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (agent: AgentInstance) => {
    try {
      await toggleAgent(agent.id)
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, enabled: !a.enabled } : a)),
      )
      if (selectedId === agent.id && !isNew) {
        setForm((f) => ({ ...f, enabled: !f.enabled }))
      }
      notifyChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteAgent(toDelete.id)
      toast.success("已删除")
      const deletedId = toDelete.id
      setToDelete(null)
      const ags = await reload()
      // 被删的正在编辑 → 选下一个可用 Agent，否则清空。
      if (selectedId === deletedId) {
        const next = ags[0]
        if (next) selectAgent(next)
        else {
          setSelectedId(null)
          setIsNew(false)
          setForm({ ...DEFAULT_EDITOR })
        }
      }
      notifyChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }

  // 网关 Key 可搜索选项（自有 + 分组系统 key）。
  const keyOptions = useMemo<SearchableOption[]>(
    () =>
      runtimeKeys.map((k) => ({
        value: String(k.id),
        label: k.name || `Key #${k.id}`,
        description: k.key_masked,
        keywords: [k.key_masked],
      })),
    [runtimeKeys],
  )

  const setField = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const hasSelection = isNew || editing != null

  return (
    <>
      <div className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm", className)}>
        <div className="flex items-center justify-between gap-2 border-b px-6 py-4">
          <div className="text-lg font-semibold">我的 Agent</div>
          <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {showAgentList && (
              <div className="flex w-64 shrink-0 flex-col border-r">
                <div className="p-2">
                  <Button className="w-full justify-start" variant="outline" onClick={startCreate}>
                    <Plus className="size-4" />
                    新建 Agent
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
                  {loading && agents.length === 0 ? (
                    <div className="flex h-24 items-center justify-center"><Spinner /></div>
                  ) : agents.length === 0 && !isNew ? (
                    <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-sm text-muted-foreground">
                      <Bot className="size-8 opacity-40" />
                      <p>还没有 Agent，点上方新建。</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {isNew && (
                        <div className="rounded-md border border-dashed bg-accent/50 px-3 py-2 text-sm">
                          <div className="font-medium">{form.displayName || "新 Agent"}</div>
                          <div className="text-xs text-muted-foreground">未保存</div>
                        </div>
                      )}
                      {agents.map((agent) => (
                        <button
                          key={agent.id}
                          onClick={() => selectAgent(agent)}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                            !isNew && selectedId === agent.id && "bg-accent",
                          )}
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="size-4" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{agent.display_name || agent.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{agent.main_model || agent.model || "未设置模型"}</div>
                          </div>
                          {!agent.enabled && <Badge variant="outline" className="shrink-0 text-[10px]">停用</Badge>}
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {!hasSelection ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Bot className="size-10 opacity-40" />
                  <p>选择左侧 Agent 查看配置，或新建一个。</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 border-b px-6 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {isNew ? "新建 Agent" : editing?.display_name || editing?.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {form.mainModel || "未设置模型"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editing && (
                        <>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">启用</Label>
                            <Switch
                              checked={editing.enabled}
                              onCheckedChange={() => handleToggle(editing)}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setToDelete(editing)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <Tabs defaultValue="basic" className="flex min-h-0 flex-1 flex-col gap-0">
                    <div className="px-6 pt-3">
                      <TabsList className="w-full flex-wrap">
                        <TabsTrigger value="basic">基础</TabsTrigger>
                        <TabsTrigger value="model">模型</TabsTrigger>
                        <TabsTrigger value="tools">工具</TabsTrigger>
                        <TabsTrigger value="mcp-user">MCP</TabsTrigger>
                        <TabsTrigger value="sops">SOP</TabsTrigger>
                        <TabsTrigger value="memory">记忆</TabsTrigger>
                        <TabsTrigger value="security">安全</TabsTrigger>
                        <TabsTrigger value="guardian">守护</TabsTrigger>
                      </TabsList>
                    </div>
                    {/* tab 正文可能比容器高（模型/工具/守护几个 tab 尤其长），这里必须
                        能滚动，否则在弹框里下半截字段连同保存按钮一起被裁掉。 */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
                      {/* 基础 */}
                      <TabsContent value="basic" className="space-y-4">
                        <div className="space-y-2">
                          <Label>显示名称</Label>
                          <Input
                            value={form.displayName}
                            onChange={(e) => setField("displayName", e.target.value)}
                            placeholder="例如：我的助手"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>描述</Label>
                          <Input
                            value={form.description}
                            onChange={(e) => setField("description", e.target.value)}
                            placeholder="可选"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>系统提示词</Label>
                          <Textarea
                            rows={5}
                            value={form.systemPrompt}
                            onChange={(e) => setField("systemPrompt", e.target.value)}
                            placeholder="定义 Agent 的角色与行为"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>最大轮次</Label>
                          <Input
                            type="number"
                            min={1}
                            value={form.maxTurns}
                            onChange={(e) => setField("maxTurns", Number(e.target.value) || 80)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label>启用 Agent</Label>
                          <Switch
                            checked={form.enabled}
                            onCheckedChange={(v) => setField("enabled", v)}
                          />
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <Label>团队共享</Label>
                            <p className="text-xs text-muted-foreground">
                              开启后同团队成员可见并可用此 Agent（仍只有你能改配置、删除）。
                              关闭则仅自己可见。
                            </p>
                          </div>
                          <Switch
                            checked={form.isTeamShared}
                            onCheckedChange={(v) => setField("isTeamShared", v)}
                          />
                        </div>
                      </TabsContent>

                      {/* 模型 */}
                      <TabsContent value="model" className="space-y-4">
                        <p className="text-xs text-muted-foreground">
                          Agent 的 LLM 调用走本系统网关：选择网关 API Key 与模型，token / TPM
                          与请求归属都记在该 Key 下。没有可用 Key 时请联系管理员分配。
                        </p>
                        {/* 主 Agent：网关 Key + 模型 */}
                        <div className="space-y-2">
                          <Label>主 Agent API Key</Label>
                          <SearchableSelect
                            value={form.mainApiKeyId ? String(form.mainApiKeyId) : ""}
                            placeholder={keyOptions.length ? "选择 API Key" : "无可用 Key"}
                            searchPlaceholder="搜索 Key..."
                            emptyText="无匹配的 Key"
                            options={keyOptions}
                            onChange={(v) =>
                              setForm((f) => ({ ...f, mainApiKeyId: Number(v), mainModel: "" }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>主 Agent 模型</Label>
                          <SearchableSelect
                            value={form.mainModel}
                            placeholder={form.mainApiKeyId ? "选择模型" : "请先选择 API Key"}
                            searchPlaceholder="搜索模型..."
                            emptyText="无可用模型"
                            disabled={!form.mainApiKeyId}
                            options={modelOptions(mainModels)}
                            onChange={(v) => setField("mainModel", v)}
                          />
                        </div>
                        {/* 子 Agent：网关 Key + 模型（可留空 = 跟随主） */}
                        <div className="space-y-2 border-t pt-4">
                          <Label>子 Agent API Key</Label>
                          <SearchableSelect
                            value={form.subagentApiKeyId ? String(form.subagentApiKeyId) : ""}
                            placeholder="跟随主 Agent"
                            searchPlaceholder="搜索 Key..."
                            emptyText="无匹配的 Key"
                            options={[
                              { value: "0", label: "跟随主 Agent" },
                              ...keyOptions,
                            ]}
                            onChange={(v) =>
                              setForm((f) => ({
                                ...f,
                                subagentApiKeyId: v === "0" ? null : Number(v),
                                subagentModel: "",
                              }))
                            }
                          />
                        </div>
                        {form.subagentApiKeyId ? (
                          <div className="space-y-2">
                            <Label>子 Agent 模型</Label>
                            <SearchableSelect
                              value={form.subagentModel}
                              placeholder="选择模型"
                              searchPlaceholder="搜索模型..."
                              emptyText="无可用模型"
                              options={modelOptions(subagentModels)}
                              onChange={(v) => setField("subagentModel", v)}
                            />
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          子 Agent 用于并行子任务；留空则与主 Agent 用同一 Key 和模型。
                        </p>
                        {/* 定时任务：网关 Key + 模型（可留空 = 跟随主） */}
                        <div className="space-y-2 border-t pt-4">
                          <Label>定时任务 API Key</Label>
                          <SearchableSelect
                            value={form.scheduledApiKeyId ? String(form.scheduledApiKeyId) : ""}
                            placeholder="跟随主 Agent"
                            searchPlaceholder="搜索 Key..."
                            emptyText="无匹配的 Key"
                            options={[
                              { value: "0", label: "跟随主 Agent" },
                              ...keyOptions,
                            ]}
                            onChange={(v) =>
                              setForm((f) => ({
                                ...f,
                                scheduledApiKeyId: v === "0" ? null : Number(v),
                                scheduledModel: "",
                              }))
                            }
                          />
                        </div>
                        {form.scheduledApiKeyId ? (
                          <div className="space-y-2">
                            <Label>定时任务模型</Label>
                            <SearchableSelect
                              value={form.scheduledModel}
                              placeholder="选择模型"
                              searchPlaceholder="搜索模型..."
                              emptyText="无可用模型"
                              options={modelOptions(scheduledModels)}
                              onChange={(v) => setField("scheduledModel", v)}
                            />
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          定时任务到点无人值守执行，通常适合选一个更便宜、更稳的模型；留空则与主
                          Agent 用同一 Key 和模型。单个定时任务还可以在任务里单独指定模型，优先于这里。
                        </p>
                        <div className="flex items-center justify-between">
                          <Label>思考模式</Label>
                          <Switch
                            checked={form.thinkingEnabled}
                            onCheckedChange={(v) => setField("thinkingEnabled", v)}
                          />
                        </div>
                        {form.thinkingEnabled && (
                          <div className="space-y-2">
                            <Label>思考强度</Label>
                            <Select
                              value={form.reasoningEffort}
                              onValueChange={(v) => setField("reasoningEffort", v)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REASONING_EFFORTS.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>限流自动重试次数</Label>
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            value={form.llmRetry429}
                            onChange={(e) => setField("llmRetry429", Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                          />
                          <p className="text-xs text-muted-foreground">
                            上游临时限流（429）时 Agent 自动带退避重试的次数；0 = 关闭。
                            白名单/渠道禁用等配置类失败不会自动重试，需在页面手动重试。
                          </p>
                        </div>
                      </TabsContent>

                      {/* 工具 */}
                      <TabsContent value="tools" className="space-y-4">
                        <div className="space-y-2">
                          <Label>一级工具（随 Agent 固定挂载）</Label>
                          <p className="text-xs text-muted-foreground">
                            来源：GET /agent/tools/schema。{toolsLoading ? "加载中…" : "已加载"}。
                            MCP 方法与 scheduler 走 <code>capability_call</code>，不作为独立一级工具展示。
                          </p>
                          <div className="grid gap-2 md:grid-cols-2">
                            {builtinTools.map((t) => {
                              const isCapabilityCall = t.name === "capability_call"
                              return (
                                <div
                                  key={t.name}
                                  className="rounded-lg border p-3"
                                  title={t.description}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-[12px] font-medium">{t.name}</span>
                                    {isCapabilityCall && (
                                      <Badge variant="outline" className="text-[10px]" title="二级能力入口">
                                        二级能力入口
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                    {t.description}
                                  </p>
                                  {isCapabilityCall && (
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                      通过 <code>capability_call(name="service.method")</code> 调用 MCP 方法 / scheduler；
                                      具体可用方法见会话系统提示词的 [Available Capabilities]。
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t pt-4">
                          <div>
                            <Label>定时任务</Label>
                            <p className="text-xs text-muted-foreground">允许 Agent 创建定时任务。</p>
                          </div>
                          <Switch
                            checked={form.schedulerEnabled}
                            onCheckedChange={(v) => setField("schedulerEnabled", v)}
                          />
                        </div>
                      </TabsContent>

                      {/* MCP：管理该 Agent 可使用的 MCP 及子项（增删改 + 临时启停） */}
                      <TabsContent value="mcp-user" className="h-full min-h-0 !space-y-0">
                        <AgentPrincipalSection
                          agentId={isNew ? null : selectedId}
                          boundId={form.mcpUserId}
                          editorRef={mcpEditorRef}
                        />
                      </TabsContent>

                      {/* SOP：只读展示当前 Agent 生效的 SOP；安装/绑定在资源管理页统一规划。 */}
                      <TabsContent value="sops" className="space-y-3">
                        {isNew ? (
                          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            请先创建 Agent。
                          </div>
                        ) : sopsLoading ? (
                          <div className="flex justify-center py-8"><Spinner className="size-5" /></div>
                        ) : availableSops.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            当前 Agent 暂无生效的 SOP。
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div>
                              <Label>当前 Agent 生效的 SOP</Label>
                              <p className="text-xs text-muted-foreground">
                                只读视图：内置 SOP 自动生效，自定义 SOP 经 per-Agent 绑定后生效，
                                私有蒸馏 SOP 为 Agent 自身沉淀。安装/绑定交互在「资源管理 → SOP」统一规划。
                              </p>
                            </div>
                            {/* 外层 tab 容器已可滚动，这里不再自带滚动条，避免嵌套两条。 */}
                            <div className="space-y-2">
                              {availableSops.map((sop) => (
                                <div key={sop.id} className="flex items-start gap-3 rounded-lg border p-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium">{sop.name}</span>
                                      {sop.is_builtin && <Badge variant="secondary" title="系统内置，自动生效">内置</Badge>}
                                      {sop.filename?.startsWith("private/") && <Badge variant="outline">私有蒸馏</Badge>}
                                      {!sop.is_builtin && !sop.filename?.startsWith("private/") && (
                                        <Badge variant="outline" title="自定义 SOP，经绑定生效">自定义</Badge>
                                      )}
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">{sop.description || sop.filename}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </TabsContent>

                      {/* 记忆 */}
                      <TabsContent value="memory" className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>记忆系统</Label>
                            <p className="text-xs text-muted-foreground">跨对话保留洞察与事实。</p>
                          </div>
                          <Switch
                            checked={form.memoryEnabled}
                            onCheckedChange={(v) => setField("memoryEnabled", v)}
                          />
                        </div>
                        <div className="flex items-center justify-between border-t pt-4">
                          <div>
                            <Label>自动学习技能</Label>
                            <p className="text-xs text-muted-foreground">从对话中沉淀可复用技能。</p>
                          </div>
                          <Switch
                            checked={form.skillAutoLearn}
                            onCheckedChange={(v) => setField("skillAutoLearn", v)}
                          />
                        </div>
                        {editing?.stats && (
                          <div className="grid grid-cols-3 gap-2 border-t pt-4 text-center">
                            <div>
                              <div className="text-lg font-semibold">{editing.stats.insights}</div>
                              <div className="text-xs text-muted-foreground">L1 洞察</div>
                            </div>
                            <div>
                              <div className="text-lg font-semibold">{editing.stats.facts}</div>
                              <div className="text-xs text-muted-foreground">L2 事实</div>
                            </div>
                            <div>
                              <div className="text-lg font-semibold">{editing.stats.skills}</div>
                              <div className="text-xs text-muted-foreground">L3 技能</div>
                            </div>
                          </div>
                        )}
                      </TabsContent>

                      {/* 安全 */}
                      <TabsContent value="security" className="space-y-4">
                        <div className="space-y-2">
                          <Label>禁止访问模式</Label>
                          <Textarea
                            rows={3}
                            value={form.deniedPatterns}
                            onChange={(e) => setField("deniedPatterns", e.target.value)}
                            placeholder="/etc/, /var/, .env, .git/, node_modules/"
                          />
                          <p className="text-xs text-muted-foreground">
                            逗号分隔。Agent 的文件工具不会触碰匹配这些模式的路径。
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>审批等待上限（秒）</Label>
                          <Input
                            type="number"
                            min={0}
                            max={604800}
                            value={form.approvalTimeoutSeconds}
                            onChange={(e) => setField("approvalTimeoutSeconds", Math.max(0, Number(e.target.value) || 0))}
                          />
                          <p className="text-xs text-muted-foreground">
                            code_run / 节点命令这类需确认的工具，等你裁决的最长时间。0 = 不过期，一直等到有人处理；
                            其余取值范围 60 秒到 7 天（默认 86400，即 1 天）。超时会中止本轮，而不是当作拒绝后继续调用模型。
                          </p>
                        </div>
                        <div className="flex items-center justify-between border-t pt-4">
                          <div>
                            <Label>允许浏览器执行 code_run</Label>
                            <p className="text-xs text-muted-foreground">
                              浏览器插件对话面板里能否运行 code_run。默认关闭：Agent 会拒绝执行并提示开启。
                              开启后仍需逐次审批——面板会展示完整代码，由用户点「允许」后执行一次。
                            </p>
                          </div>
                          <Switch
                            checked={form.browserCodeRunEnabled}
                            onCheckedChange={(v) => setField("browserCodeRunEnabled", v)}
                          />
                        </div>
                        <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
                          <div>
                            工作目录：<code className="font-mono">{editing?.workspace_root || "agent/workspace"}</code>
                          </div>
                          <div>
                            可访问根：
                            <code className="font-mono">
                              {(editing?.allowed_roots || DEFAULT_ALLOWED_ROOTS).join(", ")}
                            </code>
                          </div>
                        </div>
                      </TabsContent>

                      {/* 守护 */}
                      <TabsContent value="guardian" className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>守护模式</Label>
                            <p className="text-xs text-muted-foreground">定期自检并推进未完成目标。</p>
                          </div>
                          <Switch
                            checked={form.guardianEnabled}
                            onCheckedChange={(v) => setField("guardianEnabled", v)}
                          />
                        </div>
                        {form.guardianEnabled && (
                          <div className="space-y-2">
                            <Label>检查间隔（秒）</Label>
                            <Input
                              type="number"
                              min={30}
                              value={form.guardianInterval}
                              onChange={(e) =>
                                setField("guardianInterval", Number(e.target.value) || 300)
                              }
                            />
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t pt-4">
                          <div>
                            <Label>自主运行</Label>
                            <p className="text-xs text-muted-foreground">
                              允许 Agent 无人工介入持续运行。请谨慎开启。
                            </p>
                          </div>
                          <Switch
                            checked={form.autonomousEnabled}
                            onCheckedChange={(v) => setField("autonomousEnabled", v)}
                          />
                        </div>
                      </TabsContent>
                    </div>
                  </Tabs>

                  <div className="flex justify-end gap-2 border-t px-6 py-4">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving && <Spinner className="mr-2 size-4" />}
                      {editing ? "保存" : "创建"}
                    </Button>
                  </div>
                </>
              )}
            </div>
        </div>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Agent</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{toDelete?.display_name || toDelete?.name}」？该操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
