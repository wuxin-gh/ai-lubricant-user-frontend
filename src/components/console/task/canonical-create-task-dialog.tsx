import type { DomainProject } from "@/api/Api"
import { listUsableKeys, listChatModels, listAvailableMcp, type RuntimeKeyItem, type AvailableMcpItem } from "@/api/agentClient"
import { editorModeOptions, nodeModeOptions, type GatewayModelOption } from "@/api/editorClient"
import { listEffectiveResources, type ResourceReference } from "@/api/resourceReferences"
import { listEnvironments } from "@/api/environmentClient"
import { createUserTask, type TaskProvider, type UserTaskDetail } from "@/api/userTaskClient"
import { useCommonData } from "@/components/console/data-provider"
import { EnvironmentPanel } from "@/components/console/environment/environment-panel"
import { EditorResourcePicker, type ConfigEntry, type ResourceItem } from "@/components/console/editor/resource-picker"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"
import { resolveTaskIntent, type IssueTaskType, type TaskIntent } from "@/components/console/editor/task-intent"
import { type NodeInfo } from "@/api/nodes"
import NodeTree, { nodeSystemEnvAllowed } from "@/components/console/editor/node-tree"
import {
  Hint,
  SearchSelect,
  TaskBranchPicker,
  type TaskBranchMode,
} from "@/components/console/task/task-form-fields"
import {
  DEFAULT_EDITOR_MODE,
  DEFAULT_RATE_LIMIT,
  DEFAULT_SELECTION_STRATEGY_VALUE,
  TaskApiKeyPanel,
  buildRateLimitPayload,
  type EditorScopeMode,
  type RateLimitState,
} from "@/components/console/task/api-key-fields"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { IconReload } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

/**
 * 全站唯一的创建任务弹框：项目页「创建任务」、侧栏加号、任务列表页、需求/bug
 * 「分配」都用它。传 issueId 只额外做两件事——预填任务内容、提交 issue_id 让
 * 服务端挂上需求/bug 工作流，界面完全一致。
 *
 * 关键点（参照 auto-review-dialog 的展示风格）：
 * - 执行节点渲染成树形：管理节点（含 passive 容器）作为不可选的分组父行，其
 *   execution 子节点作为可选卡片。异常（离线/待审批/已吊销/会话已满）的节点
 *   也显示出来并禁用，卡片上标原因；状态徽标显示在线状态，仅当审批未完成
 *   （pending）才显示审批状态。
 * - 权限方式来自节点注册握手时上报的 ``capabilities.editors``（Go 客户端探测），
 *   经 monkeycode_compat ``flatten_capabilities`` 透传；节点没上报时回落硬编码
 *   ``editorModeOptions`` 并提示「节点未上报」。
 * - 可用模型按父 API Key 取运行时目录（/agent/chat/models），随该 Key 的白/黑名单
 *   过滤；多选即该任务可切换的模型集合，激活模型取第一个。所选模型同时收窄派生
 *   子 Key 的 model_whitelist，使这把 Key 真正只允许这些模型。
 * - 技能/MCP/插件只列当前用户分组已授权的资源（/resources/effective），收进
 *   「资源附加」折叠框的 4 个 Tab；项目提示词由服务端解析后拼到任务正文前。
 * - API Key 折叠面板承载所有「其实是 API Key 参数」的字段（可用模型/可用编辑器/
 *   速率限制/累计配额/过期/选择策略），创建时透传 createUserTask，服务端收窄子 Key。
 */

const PROVIDERS: Array<{ value: TaskProvider; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "codex", label: "Codex" },
]

/** 把已授权资源引用行映射成 EditorResourcePicker 的 item。 */
function toResourceItems(rows: ResourceReference[]): ResourceItem[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    display_name: row.display_name || row.name,
    description: row.version ? `v${row.version}` : undefined,
  }))
}

/** 从 EditorResourcePicker 的 selected ConfigEntry[] 抽回 id 列表。 */
function selectedIds(entries: ConfigEntry[]): string[] {
  return entries
    .map((entry) => String(entry.id || entry.name || entry.url || entry.entry || ""))
    .filter(Boolean)
}

/** MCP 选项的来源：团队引用（resource_id）/ 服务实例（service_id）。 */
const MCP_SOURCE_BADGE: Record<string, string> = {
  builtin: "内置",
  admin: "平台",
  upstream: "个人",
}

/**
 * 把可挂载的 MCP 服务（内置 cdp-bridge / mail / device-control、平台管理的、
 * 个人 SSE）映射成 picker item。id 前缀 `service:` 让它与团队引用的 UUID 不会
 * 撞键，提交时按前缀映射成 `{service_id}` 绑定——服务端 resolver 会据此读
 * mcp_services 行、校验授权并构造节点可用的 wire spec。之前这里直接提交浏览器
 * 侧的条目摘要（只有 id/display_name/tool_count），服务端原样落库，节点拿到的
 * spec 没有 transport 也没有命令，等于白配。
 */
function toMcpServiceItems(rows: AvailableMcpItem[]): ResourceItem[] {
  return rows.map((row) => ({
    id: `service:${row.id}`,
    name: row.name,
    display_name: row.display_name || row.name,
    description: [row.description, row.tool_count ? `${row.tool_count} 个工具` : ""].filter(Boolean).join(" · ") || undefined,
    __badge: MCP_SOURCE_BADGE[row.source] || row.source,
    disabled: row.enabled === false,
  }))
}

/** 把已选 MCP 条目映射成服务端接受的绑定：团队引用 vs 服务实例。 */
function mcpBindings(entries: ConfigEntry[]): Array<{ resource_id: string } | { service_id: number }> {
  const out: Array<{ resource_id: string } | { service_id: number }> = []
  for (const id of selectedIds(entries)) {
    if (id.startsWith("service:")) {
      const serviceId = Number(id.slice("service:".length))
      if (Number.isFinite(serviceId) && serviceId > 0) out.push({ service_id: serviceId })
      continue
    }
    out.push({ resource_id: id })
  }
  return out
}

/** 资源与 API Key 的 5 个 Tab。 */
type ResourceTab = "skill" | "mcp" | "plugin" | "prompt" | "apikey"

/**
 * 弹框两步：先选环境类型（共用档还要选具体环境），再填任务内容。
 * 环境决定编辑器跑在哪个 HOME，所以它是任务的前置选择，不是表单里的一个字段。
 */
type DialogStep = "env" | "task"

/** 三个环境档位的说明文案，第一步的卡片和第二步的属性条共用。 */
const ENV_TIERS: Array<{
  value: "system" | "isolated" | "shared"
  label: string
  detail: string
}> = [
  {
    value: "isolated",
    label: "隔离环境",
    detail: "每次任务一个全新的初始环境，任务之间互不干扰。默认选项。",
  },
  {
    value: "shared",
    label: "共用环境",
    detail: "跑在你建好的命名环境里，装好的依赖与 CLI 登录态跨任务复用。",
  },
  {
    value: "system",
    label: "系统内置",
    detail: "直接用节点操作者本机已装的工具与配置目录。需节点开启该模式；任务勾选的技能/MCP 不会写入本机配置。",
  },
]

interface CanonicalCreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  initialContent?: string
  issueId?: string
  /** 需求/bug 入口传入：驱动任务意图到 task_role / sub_type 的映射。 */
  issueType?: IssueTaskType
  onCreated?: (task: UserTaskDetail) => void
}

export default function CanonicalCreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  initialContent = "",
  issueId,
  issueType,
  onCreated,
}: CanonicalCreateTaskDialogProps) {
  const navigate = useNavigate()
  const { projects, nodes, loadingNodes, reloadProjects, reloadNodes, reloadUnlinkedTasks } = useCommonData()
  const [content, setContent] = useState(initialContent)
  const [provider, setProvider] = useState<TaskProvider>("claude")
  const [nodeId, setNodeId] = useState("")
  const [keyId, setKeyId] = useState("")
  const [intent, setIntent] = useState<TaskIntent>("fix")
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [mode, setMode] = useState("")
  const [branchMode, setBranchMode] = useState<TaskBranchMode>("default")
  const [branch, setBranch] = useState("")
  // 执行环境档位：isolated 默认；shared 选节点上的命名环境；system 用节点操作者真实
  // home（需节点已开启 system 模式，否则派发被节点拒绝）。仅 shared 需要 env_id。
  const [envMode, setEnvMode] = useState<"isolated" | "shared" | "system">("isolated")
  const [envId, setEnvId] = useState("")
  const [envName, setEnvName] = useState("")
  const [nodeEnvs, setNodeEnvs] = useState<{ env_id: string; name: string }[]>([])
  // 两步走：先定环境，再填任务。进第二步后顶部只展示环境属性（类型 + 共用 env id），
  // 要改就点「返回」回第一步——任务建成后环境不可改，这里是最后的修改机会。
  const [step, setStep] = useState<DialogStep>("env")
  const [selectedSkills, setSelectedSkills] = useState<ConfigEntry[]>([])
  const [selectedMcps, setSelectedMcps] = useState<ConfigEntry[]>([])
  const [mcpServiceRows, setMcpServiceRows] = useState<AvailableMcpItem[]>([])
  const [selectedPlugins, setSelectedPlugins] = useState<ConfigEntry[]>([])
  const [promptId, setPromptId] = useState("")
  const [installationId, setInstallationId] = useState("")
  // API Key Tab 的字段（其实是子 Key 创建参数）
  const [editorMode, setEditorMode] = useState<EditorScopeMode>(DEFAULT_EDITOR_MODE)
  const [selectedEditors, setSelectedEditors] = useState<TaskProvider[]>([])
  const [rateLimit, setRateLimit] = useState<RateLimitState>(DEFAULT_RATE_LIMIT)
  const [maxRequests, setMaxRequests] = useState("")
  const [maxTotalTokens, setMaxTotalTokens] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [selectionStrategy, setSelectionStrategy] = useState(DEFAULT_SELECTION_STRATEGY_VALUE)
  const [keys, setKeys] = useState<RuntimeKeyItem[]>([])
  const [models, setModels] = useState<GatewayModelOption[]>([])
  const [skillRows, setSkillRows] = useState<ResourceReference[]>([])
  const [mcpRows, setMcpRows] = useState<ResourceReference[]>([])
  const [pluginRows, setPluginRows] = useState<ResourceReference[]>([])
  const [resourceTab, setResourceTab] = useState<ResourceTab>("skill")
  const [submitting, setSubmitting] = useState(false)

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) as DomainProject | undefined,
    [projectId, projects],
  )

  const selectedNode = useMemo(
    () => nodes.find((node) => node.node_id === nodeId) as NodeInfo | undefined,
    [nodeId, nodes],
  )

  useEffect(() => {
    if (!open) return
    setContent(initialContent)
    setIntent(issueId ? "analysis" : "fix")
    setMode("")
    setBranchMode("default")
    setBranch("")
    setEnvMode("isolated")
    setEnvId("")
    setEnvName("")
    setNodeEnvs([])
    setStep("env")
    setEditorMode(DEFAULT_EDITOR_MODE)
    setSelectedEditors([])
    setRateLimit(DEFAULT_RATE_LIMIT)
    setMaxRequests("")
    setMaxTotalTokens("")
    setExpiresAt("")
    setSelectionStrategy(DEFAULT_SELECTION_STRATEGY_VALUE)
    setResourceTab("skill")
    setInstallationId("")
    setPromptId("")
    void listUsableKeys()
      .then((rows) => {
        const available = rows.filter((item) => !item.disabled)
        setKeys(available)
        setKeyId((current) => current && available.some((item) => String(item.id) === current) ? current : String(available[0]?.id || ""))
      })
      .catch(() => setKeys([]))
    void Promise.all([
      listEffectiveResources("skill").catch(() => []),
      listEffectiveResources("mcp").catch(() => []),
      listEffectiveResources("plugin").catch(() => []),
    ]).then(([skills, mcps, plugins]) => {
      setSkillRows(skills)
      setMcpRows(mcps)
      setPluginRows(plugins)
      // 只在资源列表非空时按它过滤已选项；空集视作"未加载/拉取失败"，
      // 保留已选项避免关弹框重开时被误清空（修复资源附件面板数据被覆盖）。
      const keep = (entries: ConfigEntry[], rows: ResourceReference[]) =>
        rows.length === 0
          ? entries
          : entries.filter((entry) => rows.some((row) => row.id === String(entry.id || entry.name || "")))
      setSelectedSkills((cur) => keep(cur, skills))
      setSelectedPlugins((cur) => keep(cur, plugins))
    })
    // MCP 的第二个来源：可直接挂载的服务实例（内置 cdp-bridge / mail /
    // device-control、平台管理的、个人 SSE）。团队引用只覆盖市场安装的那部分，
    // 之前漏了这三类，弹框里根本看不到内置 MCP。
    void listAvailableMcp()
      .then((response) => setMcpServiceRows([...response.builtin, ...response.admin, ...response.upstream]))
      .catch(() => setMcpServiceRows([]))
  }, [initialContent, issueId, open])

  // MCP 已选项的合法性随两个来源列表修剪：service: 前缀条目对服务实例表校验，
  // 其余（团队引用）对引用表校验；任一列表为空视作未加载，保留已选不清空。
  useEffect(() => {
    setSelectedMcps((cur) => {
      if (!cur.length) return cur
      const next = cur.filter((entry) => {
        const id = String(entry.id || entry.name || "")
        if (id.startsWith("service:")) {
          return mcpServiceRows.length === 0 || mcpServiceRows.some((row) => `service:${row.id}` === id)
        }
        return mcpRows.length === 0 || mcpRows.some((row) => row.id === id)
      })
      return next.length === cur.length ? cur : next
    })
  }, [mcpRows, mcpServiceRows])

  // 父 Key 变化时按该 Key 的白/黑名单拉可用模型；不再用全局 /v1/models。
  useEffect(() => {
    const apiKeyId = Number(keyId)
    if (!apiKeyId) {
      setModels([])
      setSelectedModels([])
      return
    }
    const controller = new AbortController()
    listChatModels(apiKeyId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const options = rows.map((item) => ({ value: item.id, label: item.name || item.remark || item.id }))
        setModels(options)
        // 默认不选：空 = 不限制（任务继承该 Key 允许的全部模型），显式勾选才收窄。
        setSelectedModels((current) => current.filter((id) => options.some((item) => item.value === id)))
      })
      .catch(() => { if (!controller.signal.aborted) { setModels([]); setSelectedModels([]) } })
    return () => { controller.abort() }
  }, [keyId])

  // 节点 / 执行客户端变化时重算权限方式：优先节点上报的，否则回落硬编码；
  // 当前值不在新选项集里就清空。
  const modeReported = useMemo(() => nodeModeOptions(selectedNode, provider), [selectedNode, provider])
  const modeOptions = modeReported ?? editorModeOptions(provider)
  useEffect(() => {
    const allowed = modeOptions.map((option) => option.value)
    setMode((current) => (allowed.includes(current) ? current : ""))
  }, [modeOptions])

  // 该节点是否允许 system 档（节点上报的能力位）。
  const systemEnvAllowed = nodeSystemEnvAllowed(selectedNode)
  // 第一步还没选节点，卡片不能绑在 selectedNode 上（否则永远「未开启」）：只要
  // 用户可见的执行节点里有一个开启系统环境，档位就可选，具体节点的过滤交给
  // 第二步节点树的 requireSystemEnv（禁用并标注原因）。
  const anySystemEnvNode = useMemo(
    () => nodes.some((n) => n.node_role === "execution" && !n.display_only && nodeSystemEnvAllowed(n)),
    [nodes],
  )

  // 换节点就重取它的共用环境列表：环境归属节点，跨节点不通用。同时把不再合法的
  // 档位/选择收回 isolated，避免带着旧节点的 env_id 派发过去被拒。
  useEffect(() => {
    if (!nodeId) {
      setNodeEnvs([])
      if (envMode === "shared") { setEnvMode("isolated") }
      setEnvId("")
      setEnvName("")
      return
    }
    let active = true
    void listEnvironments(nodeId)
      .then((rows) => {
        if (!active) return
        setNodeEnvs(rows.map((r) => ({ env_id: r.id, name: r.name })))
        setEnvId((current) => {
          const match = rows.find((r) => r.id === current)
          setEnvName(match ? match.name : "")
          return match ? current : ""
        })
      })
      .catch(() => { if (active) setNodeEnvs([]) })
    return () => { active = false }
  }, [nodeId])

  useEffect(() => {
    // 只在「已选节点且该节点不支持」时把档位收回隔离——第一步没选节点时 system
    // 档是合法的（支持与否到第二步选节点时才见分晓），不能在进第二步的瞬间被偷偷改掉。
    if (envMode === "system" && nodeId && !systemEnvAllowed) setEnvMode("isolated")
    if (envMode !== "shared" && envId) setEnvId("")
  }, [envMode, nodeId, systemEnvAllowed, envId])

  const submit = async () => {
    const text = content.trim()
    // 内容可为空：为空则建一个等待用户输入的任务，第一条消息在详情页发。
    if (!nodeId) return toast.error("请选择执行节点")
    if (!keyId) return toast.error("请选择父 API Key")
    if (envMode === "system" && !systemEnvAllowed) return toast.error("该节点未开启系统环境，请换一个节点或改用其他环境")
    if (provider === "codex" && !installationId.trim()) return toast.error("Codex 任务需要 installation_id")
    if (provider === "codex" && !text) return toast.error("Codex 任务需要填写首条内容")
    const mapping = resolveTaskIntent(intent, issueType)
    const skillIds = selectedIds(selectedSkills)
    const pluginIds = selectedIds(selectedPlugins)
    const mcpEntries = mcpBindings(selectedMcps)
    // 可用编辑器单选 → editor_provider_whitelist：current=只允许当前执行客户端；
    // specified=多选；all=不发（继承父级）。
    const editorWhitelist: string[] | undefined =
      editorMode === "current" ? [provider]
      : editorMode === "specified" ? selectedEditors
      : undefined
    const rateLimitPayload = buildRateLimitPayload(rateLimit)
    const extra = {
      ...(project ? { project_id: project.id } : {}),
      ...(issueId ? { issue_id: issueId } : {}),
      ...(skillIds.length ? { skill_ids: skillIds } : {}),
      ...(pluginIds.length ? { plugin_ids: pluginIds } : {}),
    }
    setSubmitting(true)
    try {
      const task = await createUserTask({
        content: text,
        node_id: nodeId,
        provider,
        cli_name: provider,
        parent_api_key_id: Number(keyId),
        // 执行环境档位：isolated 不下发（节点默认）；shared 带 env_id；system 仅
        // 在节点开启时下发。节点对 system 未开启会拒绝派发，任务报错。
        ...(envMode === "shared" && envId ? { env_mode: "shared", env_id: envId, env_name: envName } : {}),
        ...(envMode === "system" && systemEnvAllowed ? { env_mode: "system" } : {}),
        // 可用模型同源写 models_snapshot 与 model_whitelist，让子 Key 只允许这些模型。
        ...(selectedModels.length ? { models: selectedModels, model_whitelist: selectedModels } : {}),
        ...(mode ? { mode } : {}),
        ...((maxRequests || maxTotalTokens) ? {
          usage_limit: {
            ...(maxRequests ? { max_requests: Number(maxRequests) } : {}),
            ...(maxTotalTokens ? { max_total_tokens: Number(maxTotalTokens) } : {}),
          },
        } : {}),
        ...(Object.keys(rateLimitPayload).length ? { rate_limit: rateLimitPayload } : {}),
        ...(editorWhitelist ? { editor_provider_whitelist: editorWhitelist } : {}),
        ...(selectionStrategy && selectionStrategy !== DEFAULT_SELECTION_STRATEGY_VALUE ? { selection_strategy: selectionStrategy } : {}),
        ...(expiresAt ? { expires_at: new Date(expiresAt).getTime() / 1000 } : {}),
        ...(promptId ? { prompt_id: promptId } : {}),
        ...(project?.git_identity_id ? { git_identity_id: project.git_identity_id } : {}),
        ...(project ? {
          repo: {
            repo_url: project.repo_url || undefined,
            branch_mode: branchMode,
            ...(branchMode === "existing" && branch.trim() ? { branch: branch.trim() } : {}),
          },
        } : {}),
        ...(Object.keys(extra).length ? { extra } : {}),
        ...(mcpEntries.length ? { mcp_config: mcpEntries } : {}),
        task_type: mapping.taskType,
        sub_type: mapping.subType,
        task_role: mapping.taskRole,
        ...(provider === "codex" ? {
          expected_client_id: installationId.trim(),
          bootstrap_content: text,
        } : {}),
      })
      onOpenChange(false)
      onCreated?.(task)
      void reloadProjects()
      void reloadUnlinkedTasks()
      navigate(`/console/task/${task.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  // 单个 execution 节点卡片改由共享的 NodeTree 渲染（树形：管理节点作可折叠父行、
  // 不可选；子节点带在线状态/容量/机器信息/不可用原因），与编辑器创建流程一致。
  const envTierLabel = ENV_TIERS.find((t) => t.value === envMode)?.label ?? "隔离"

  // 第一步：选环境类型。选了共用还要选一个具体环境（共用环境的增删改查内嵌精简版）。
  // 进第二步后顶部只展示环境属性（类型 + 共用 env 名/id）+ 返回按钮，任务建成后环境不可改。
  if (step === "env") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>选择执行环境</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              先决定任务跑在哪种环境里，再填任务内容。共用环境可以复用装好的依赖和登录态。
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {ENV_TIERS.map((tier) => {
                const disabled = tier.value === "system" && !anySystemEnvNode
                const selected = envMode === tier.value
                return (
                  <button
                    key={tier.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setEnvMode(tier.value)
                      if (tier.value !== "shared") { setEnvId(""); setEnvName("") }
                    }}
                    className={`flex flex-col gap-1 rounded-md border p-3 text-left transition ${selected ? "border-primary bg-accent" : "hover:bg-muted"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <span className="text-sm font-medium">{tier.label}</span>
                    <span className="text-xs text-muted-foreground">{tier.detail}</span>
                    {disabled ? <span className="text-[10px] text-destructive">无已开启系统环境的节点</span> : null}
                  </button>
                )
              })}
            </div>

            {envMode === "shared" ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label>共用环境</Label>
                  <span className="text-xs text-muted-foreground">选一个环境，或在旁边新建</span>
                </div>
                {!nodeId ? (
                  <p className="text-sm text-muted-foreground">先在下方选一个执行节点，才能看到它上面的共用环境。</p>
                ) : (
                  <EnvironmentPanel
                    nodeId={nodeId}
                    compact
                    selectedEnvId={envId}
                    onSelect={(id, name) => { setEnvId(id); setEnvName(name) }}
                  />
                )}
                <div className="space-y-2">
                  <Label>执行节点</Label>
                  <NodeTree nodes={nodes} value={nodeId} onChange={setNodeId} provider={provider} allowAuto={false} />
                </div>
                {envId ? (
                  <div className="rounded-md border bg-accent/50 px-3 py-2 text-sm">
                    已选环境：<span className="font-medium">{envName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{envId}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                onClick={() => setStep("task")}
                disabled={envMode === "shared" && !envId}
              >
                下一步
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>创建开发任务</DialogTitle></DialogHeader>
        {/* 环境属性条：类型 + 共用 env 名/id（只读）+ 返回重选。建成后不可改，这里是最后的修改机会。 */}
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">环境</span>
            <Badge variant="secondary">{envTierLabel}</Badge>
            {envMode === "shared" && envId ? (
              <span className="text-sm">{envName} <span className="font-mono text-xs text-muted-foreground">{envId}</span></span>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep("env")}>返回重选</Button>
        </div>
        <div className="space-y-5 py-2">
          {/* 执行配置：节点树 + 客户端/意图/权限方式 + 父Key/模型 */}
          <section className="space-y-4 rounded-md border p-3">
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label>执行节点</Label>
                <Hint label="按所属分组以树形展示（与管理端节点列表一致）。管理节点仅作分组父行、可展开收起、不可选；异常（离线/待审批/已吊销/会话已满/未安装该客户端）的 execution 节点也显示，并禁用标原因。" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 ml-auto"
                  title="刷新节点列表"
                  disabled={loadingNodes}
                  onClick={() => void reloadNodes().catch((error) => toast.error(error instanceof Error ? error.message : "刷新节点失败"))}
                >
                  {loadingNodes ? <Spinner className="size-3.5" /> : <IconReload className="size-4" />}
                </Button>
              </div>
              <NodeTree nodes={nodes} value={nodeId} onChange={setNodeId} provider={provider} allowAuto={false} requireSystemEnv={envMode === "system"} />
            </div>

            {/* 执行客户端 + 任务意图 + 权限方式 三列均分，各占三分之一 */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>执行客户端</Label>
                <Select value={provider} onValueChange={(value) => setProvider(value as TaskProvider)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label>任务意图</Label>
                  <Hint label="分析：针对需求生成技术方案、针对 bug 定位根因，不改代码。实现/修复：修改代码并完成实现。" />
                </div>
                <Select value={intent} onValueChange={(value) => setIntent(value as TaskIntent)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analysis">分析</SelectItem>
                    <SelectItem value="fix">实现 / 修复</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label>权限方式</Label>
                  <Hint
                    label={
                      modeReported
                        ? "来自该节点注册握手时上报的权限方式（客户端探测）。留空使用客户端默认。"
                        : "节点未上报该客户端的权限方式，以下为客户端默认选项；留空使用客户端默认。"
                    }
                  />
                </div>
                <Select value={mode || "__default__"} onValueChange={(value) => setMode(value === "__default__" ? "" : value)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modeOptions.map((option) => (
                      <SelectItem key={option.value || "__default__"} value={option.value || "__default__"}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 分支策略：项目已绑定 Git 身份时才出现（内部仓库不显示）。 */}
            {/* 父 API Key 与分支同一排：分支依赖项目 Git 身份，无 Git 身份时该格留空，
                父 Key 仍在左格可选。可用模型已移入下方 API Key 折叠面板。 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label>父 API Key</Label>
                  <Hint label="该任务会从父 Key 派生一把独立子 Key，额度与过期单独计数；下方 API Key 面板的可用模型/可用编辑器等参数会收窄这把子 Key。" />
                </div>
                <SearchSelect
                  value={keyId}
                  onChange={setKeyId}
                  options={keys.map((key) => ({
                    value: String(key.id),
                    label: key.name || key.key_masked || `#${key.id}`,
                    hint: key.key_masked,
                    disabled: key.disabled,
                  }))}
                  placeholder="选择父 API Key"
                  emptyHint="没有可用的父 Key"
                />
              </div>
              <TaskBranchPicker
                mode={branchMode}
                onModeChange={setBranchMode}
                branch={branch}
                onBranchChange={setBranch}
                gitIdentityId={project?.git_identity_id}
                repoFullName={project?.full_name}
                platform={project?.platform}
                disabled={submitting}
              />
            </div>

            {provider === "codex" && (
              <div className="grid gap-2">
                <div className="flex items-center gap-1">
                  <Label>Codex installation_id</Label>
                  <Hint label="来自 Codex 客户端 metadata，用于首条请求匹配本任务后绑定。" />
                </div>
                <Input className="h-11" value={installationId} onChange={(event) => setInstallationId(event.target.value)} placeholder="来自 Codex 客户端 metadata" />
              </div>
            )}
          </section>

          {/* 任务内容（资源附加上方） */}
          <div className="grid gap-2">
            <Label>任务内容</Label>
            <Textarea
              className="min-h-32"
              value={content}
              placeholder="可为空，为空则会等待用户输入"
              onChange={(event) => setContent(event.target.value)}
            />
          </div>

          {/* 资源与 API Key：技能 / MCP / 插件 / 项目提示词 / API Key，5 个 Tab 平铺
              （不再折叠，避免折叠内容与后续面板互相压盖）。 */}
          <div className="rounded-md border p-3">
            <Tabs
              value={resourceTab}
              onValueChange={(v) => setResourceTab(v as ResourceTab)}
              className="block w-full"
            >
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="skill">技能 ({selectedSkills.length})</TabsTrigger>
                <TabsTrigger value="mcp">MCP ({selectedMcps.length})</TabsTrigger>
                <TabsTrigger value="plugin">插件 ({selectedPlugins.length})</TabsTrigger>
                <TabsTrigger value="prompt">提示词 {promptId ? "·" : ""}</TabsTrigger>
                <TabsTrigger value="apikey">API Key</TabsTrigger>
              </TabsList>
              <TabsContent value="skill" className="mt-3">
                <EditorResourcePicker label="技能" items={toResourceItems(skillRows)} selected={selectedSkills} onChange={setSelectedSkills} />
              </TabsContent>
              <TabsContent value="mcp" className="mt-3">
                <EditorResourcePicker
                  label="MCP"
                  items={[...toResourceItems(mcpRows), ...toMcpServiceItems(mcpServiceRows)]}
                  selected={selectedMcps}
                  onChange={setSelectedMcps}
                  groups={[
                    { title: "团队授权（市场安装）", items: toResourceItems(mcpRows) },
                    { title: "内置 / 平台 / 个人服务", items: toMcpServiceItems(mcpServiceRows) },
                  ]}
                />
              </TabsContent>
              <TabsContent value="plugin" className="mt-3">
                <EditorResourcePicker label="插件" items={toResourceItems(pluginRows)} selected={selectedPlugins} onChange={setSelectedPlugins} />
              </TabsContent>
              <TabsContent value="prompt" className="mt-3">
                <ProjectPromptSelector value={promptId} onChange={setPromptId} provider={provider} />
              </TabsContent>
              <TabsContent value="apikey" className="mt-3">
                <TaskApiKeyPanel
                  models={models}
                  selectedModels={selectedModels}
                  onSelectedModelsChange={setSelectedModels}
                  provider={provider}
                  editorMode={editorMode}
                  onEditorModeChange={setEditorMode}
                  selectedEditors={selectedEditors}
                  onSelectedEditorsChange={setSelectedEditors}
                  rateLimit={rateLimit}
                  onRateLimitChange={setRateLimit}
                  maxRequests={maxRequests}
                  onMaxRequestsChange={setMaxRequests}
                  maxTotalTokens={maxTotalTokens}
                  onMaxTotalTokensChange={setMaxTotalTokens}
                  expiresAt={expiresAt}
                  onExpiresAtChange={setExpiresAt}
                  selectionStrategy={selectionStrategy}
                  onSelectionStrategyChange={setSelectionStrategy}
                  disabled={submitting}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={submitting}>{submitting && <Spinner />} 创建并运行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
