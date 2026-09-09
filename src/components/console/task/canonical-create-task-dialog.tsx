import type { DomainProject } from "@/api/Api"
import { listUsableKeys, listChatModels, listAvailableMcp, type RuntimeKeyItem, type AvailableMcpItem } from "@/api/agentClient"
import { listMcpAuthorizationOptions } from "@/api/mcpClient"
import { editorModeOptions, nodeModeOptions, type GatewayModelOption } from "@/api/editorClient"
import { listEffectiveResources, listReferencesV2, listResourceReferences, createReferenceFromGithub, createResourceReference, type ResourceReference, type ResourceReferenceV2 } from "@/api/resourceReferences"
import { fetchMarketIndexAll, isMarketplaceEnabled, type MarketItem } from "@/api/marketplaceRaw"
import { recognizeGithubRepo } from "@/api/githubRecognition"
import type { GithubRecognizeResult } from "@/api/githubRecognition"
import { listEnvironments, getEnvironment, addEnvironmentResource, removeEnvironmentResource, syncEnvironment, type EnvResource, type EnvExtra, type TaskEnvironmentDetail } from "@/api/environmentClient"
import { getSystemEnv, installSystemEnvResource, removeSystemEnvResource, type SystemEnvDetail, type SystemEnvEntry } from "@/api/systemEnvClient"
import { createUserTask, type TaskProvider, type UserTaskDetail } from "@/api/userTaskClient"
import { useCommonData } from "@/components/console/data-provider"
import { EnvironmentPanel } from "@/components/console/environment/environment-panel"
import { EditorResourcePicker, type ConfigEntry, type ResourceItem } from "@/components/console/editor/resource-picker"
import { McpGrantPicker, type PickerGrant, type PickerParamKind, type PickerResource } from "@/components/console/mcp/McpGrantPicker"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"
import { resolveTaskIntent, type IssueTaskType, type TaskIntent } from "@/components/console/editor/task-intent"
import { type NodeInfo } from "@/api/nodes"
import { machineInfoLine, machineSpecs, nodeEditorVersions, OS_LABEL, ARCH_LABEL, formatBytes } from "@/pages/manager/platform/nodes/types"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { IconReload } from "@tabler/icons-react"
import { Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
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
  const items: ResourceItem[] = []
  for (const row of rows) {
    const manifest = row.manifest as {
      type?: string
      entries?: Array<{ name?: string; path?: string; entry?: string; editors?: string[] }>
    }
    // 新表引用（统一资源池）映射行：提交时 {reference_id, entries} 绑定。
    if (row.market_id?.startsWith("v2:")) {
      const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
      if (manifest?.type === "skills" && entries.length > 0) {
        for (const entry of entries) {
          const entryName = String(entry.name || "").trim()
          if (!entryName) continue
          items.push({
            id: `v2:${row.id}::${entryName}`,
            name: entryName,
            display_name: `${row.name}/${entryName}`,
            description: entry.path ? `${entry.path}/${entry.entry || "SKILL.md"}` : undefined,
            reference_id: row.id,
            resource_entry: entryName,
            __badge: `技能集 · ${row.name}`,
          })
        }
      } else {
        items.push({
          id: `v2:${row.id}`,
          name: row.name,
          display_name: row.display_name || row.name,
          description: (row as { description?: string }).description || undefined,
          reference_id: row.id,
        })
      }
      continue
    }
    if (manifest?.type === "skills" && Array.isArray(manifest.entries) && manifest.entries.length > 0) {
      // 集合只提供子技能复选框；提交时通过 resource_id/resource_entry 归并回集合绑定。
      for (const entry of manifest.entries) {
        const entryName = String(entry.name || "").trim()
        if (!entryName) continue
        items.push({
          id: `${row.id}::${entryName}`,
          name: entryName,
          display_name: `${row.name}/${entryName}`,
          description: entry.path ? `${entry.path}/${entry.entry || "SKILL.md"}` : undefined,
          resource_id: row.id,
          resource_entry: entryName,
          __badge: `技能集 · ${row.name}`,
        })
      }
      continue
    }
    items.push({
      id: row.id,
      name: row.name,
      display_name: row.display_name || row.name,
      description: row.version ? `v${row.version}` : undefined,
    })
  }
  return items
}

/**
 * 新表引用（统一资源池）→ 旧 ResourceReference 形状的映射行，并入 skillRows
 * 让现有选择器/展开逻辑零改动复用。market_id 打 ``v2:`` 前缀作标记，
 * toResourceItems 据此产出 {reference_id} 绑定字段。
 */
function v2ToLegacyRef(row: ResourceReferenceV2): ResourceReference {
  const res = row.resource
  const isCollection = res.resource_type === "skills"
  return {
    id: String(row.id),
    team_id: row.team_id,
    resource_type: "skill",
    market_module: "skills",
    market_id: `v2:${row.id}`,
    name: res.name,
    display_name: row.display_name || res.display_name || res.name,
    version: row.version || res.version,
    manifest: isCollection
      ? {
          type: "skills",
          entries: (res.resource_data?.entries || []) as Array<{ name?: string; path?: string; entry?: string; editors?: string[] }>,
        }
      : {},
    owned_entity_type: null,
    owned_entity_id: null,
    status: row.enabled ? "active" : "disabled",
    group_ids: [],
  }
}

/** 从选择器条目抽回普通 resource_id 列表（集合子项由 skillBindings 单独处理）。 */
function selectedIds(entries: ConfigEntry[]): string[] {
  return entries
    .map((entry) => String(entry.resource_id || entry.id || entry.name || entry.url || entry.entry || ""))
    .filter(Boolean)
}

/**
 * 将平台技能选择归并为服务端绑定：
 * - 新表引用子项 -> {reference_id, entries[]}，普通新引用 -> {reference_id}
 * - 旧表集合子项 -> {resource_id, entries[]}，旧普通项 -> {resource_id}
 */
function skillBindings(entries: ConfigEntry[]): Array<{ resource_id?: string; reference_id?: string; entries?: string[] }> {
  const grouped = new Map<string, { resource_id?: string; reference_id?: string; entries?: string[] }>()
  for (const entry of entries) {
    const referenceId = String(entry.reference_id || "").trim()
    const entryName = String(entry.resource_entry || "").trim()
    const legacyId = String(entry.resource_id || entry.id || entry.name || "").trim()
    const key = referenceId ? `v2:${referenceId}` : legacyId
    if (!key) continue
    const current = grouped.get(key)
    if (current) {
      if (entryName) current.entries = [...(current.entries || []), entryName]
      continue
    }
    grouped.set(key, referenceId
      ? { reference_id: referenceId, ...(entryName ? { entries: [entryName] } : {}) }
      : { resource_id: legacyId, ...(entryName ? { entries: [entryName] } : {}) })
  }
  return [...grouped.values()]
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

/**
 * 添加式选择器的授权草稿 → mcp_config 负载：service 行 → {service_id}；
 * 工具类的 param 行按 grant_key 归属到对应服务条目 → {service_id, param_key,
 * param_values}（实例收窄，空=默认全量）。param 行找不到归属服务时跳过（孤儿行）。
 * required_param → service_id 的反查靠 picker 候选里的 required_param 字段。
 */
function grantDraftToPayload(
  draft: PickerGrant[],
  resources: PickerResource[],
): Array<Record<string, unknown>> {
  const serviceById = new Map<string, PickerResource>()
  for (const r of resources) {
    if (r.resource_kind === "service") serviceById.set(String(r.resource_id), r)
  }
  // param_key → 绑定该 param 的服务条目（一 param_key 只属一个内置服务）。
  const paramKeyToService = new Map<string, PickerResource>()
  for (const svc of serviceById.values()) {
    const key = (svc.required_param || "").trim()
    if (key) paramKeyToService.set(key, svc)
  }
  const out: Array<Record<string, unknown>> = []
  const entryByServiceId = new Map<string, Record<string, unknown>>()
  for (const g of draft) {
    if (g.grant_key === "service") {
      const entry: Record<string, unknown> = { service_id: Number(g.grant_value) }
      entryByServiceId.set(g.grant_value, entry)
      out.push(entry)
      continue
    }
    const svc = paramKeyToService.get(g.grant_key)
    if (!svc) continue
    const entry = entryByServiceId.get(String(svc.resource_id))
    if (!entry) continue
    const values = Array.isArray(entry.param_values) ? (entry.param_values as string[]) : []
    values.push(g.grant_value)
    entry.param_key = g.grant_key
    entry.param_values = values
  }
  return out
}

/** 第二步的 Tab：工具（MCP 服务/实例 + 引用型 MCP）/ 提示词 / API Key。 */
type ResourceTab = "tool" | "prompt" | "apikey"

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


/**
 * 第一步环境资源区：MCP/技能/插件 tabs + 卡片。卡片带勾选、来源徽标、删除按钮
 * （点击父层弹确认框）。右上「添加/安装」进三 tab 资源中心弹框。卡片描述做
 * 截断，hover 显示全部（title 属性）。
 */
function EnvironmentResourceTabs({
  entries, active, tab, onTabChange, onToggle, onAdd, onRemove, addButtonLabel = "添加",
}: {
  entries: Record<"skill" | "plugin" | "mcp", ResourceItem[]>
  active: Record<"skill" | "plugin" | "mcp", Set<string>>
  tab: "mcp" | "skill" | "plugin"
  onTabChange: (tab: "mcp" | "skill" | "plugin") => void
  onToggle: (kind: "skill" | "plugin" | "mcp", id: string) => void
  onAdd: (kind: "skill" | "plugin" | "mcp") => void
  onRemove: (kind: "skill" | "plugin" | "mcp", item: ResourceItem) => void
  /** 右上按钮文案：隔离档=添加，shared/system=安装。 */
  addButtonLabel?: string
}) {
  const labels = { mcp: "MCP", skill: "技能", plugin: "插件" }
  const items = entries[tab]
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as typeof tab)}>
          <TabsList><TabsTrigger value="mcp">MCP</TabsTrigger><TabsTrigger value="skill">技能</TabsTrigger><TabsTrigger value="plugin">插件</TabsTrigger></TabsList>
        </Tabs>
        <Button type="button" size="sm" className="ml-auto h-8" onClick={() => onAdd(tab)}><Plus className="size-3.5" /> {addButtonLabel}</Button>
      </div>
      {items.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">当前没有{labels[tab]}。点击「{addButtonLabel}」从资源中心选择。</div>
      ) : (
        <div className="grid gap-2.5 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const id = String(item.id)
            const locked = item.__locked === true
            const checked = locked || active[tab].has(id)
            const name = item.display_name || item.name
            return (
              <div key={id} className={`flex min-h-28 flex-col gap-2 rounded-lg border p-3 transition ${checked ? "border-primary/50 bg-accent/30" : "opacity-70"}`}>
                <div className="flex items-start gap-2">
                  {locked ? (
                    <span className="mt-0.5 inline-flex size-4 items-center justify-center rounded border bg-muted text-[9px] text-muted-foreground">✓</span>
                  ) : (
                    <input type="checkbox" checked={checked} onChange={() => onToggle(tab, id)} className="mt-0.5 size-4 accent-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={name}>{name}</div>
                    {item.description ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground" title={item.description}>{item.description}</div>
                    ) : null}
                  </div>
                </div>
                {locked ? (
                  <div className="mt-auto"><span className="text-[10px] text-muted-foreground">随环境自动生效（本机 MCP 平台不可任务级关闭）</span></div>
                ) : (
                  <div className="mt-auto flex justify-end">
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-destructive" onClick={() => onRemove(tab, item)} title="移除/卸载">移除</Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** 资源中心式添加弹框：资源中心 / 分组 / 市场 + GitHub 识别入口。 */
function EnvResourceSnapshot({ label, items }: { label: string; items: ResourceItem[] }) {
  return (
    <div className="rounded-md border p-2.5">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">当前环境没有配置</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={String(item.id)} variant="outline" className="max-w-full px-1.5 py-0.5 text-[11px]">
              <span className="truncate">{item.display_name || item.name}</span>
              {item.__badge ? <span className="ml-1 text-[10px] text-muted-foreground">· {item.__badge}</span> : null}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/** 节点摘要（第一步节点列 + 第二步固定展示共用）：单行显示——名称、在线徽标、
 *  机器信息、客户端版本，超长截断、hover 看全文，高度与执行客户端选择框一致。 */
function NodeSummaryCard({ node }: { node: NodeInfo }) {
  const specs = machineSpecs(node.capabilities)
  const info = machineInfoLine(node.capabilities)
  const version = specs.find((item) => item.label === "客户端版本")?.value
  const summary = [info, version ? `v${version}` : ""].filter(Boolean).join(" · ")
  const name = node.node_name || node.node_id
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={`${name} · ${summary}`}>
      <span className="shrink-0 truncate text-sm font-medium">{name}</span>
      {node.status === "approved" ? (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] text-green-600 dark:text-green-400">在线</Badge>
      ) : (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] text-muted-foreground">{node.status}</Badge>
      )}
      {summary ? <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span> : null}
    </span>
  )
}

/** 节点选择独立弹框：主创建页只显示当前节点摘要，树形收进这里。 */
function NodePickerDialog({
  open, nodes, value, provider, requireSystemEnv, loading, onChange, onClose, onReload,
}: {
  open: boolean
  nodes: NodeInfo[]
  value: string
  provider: TaskProvider
  requireSystemEnv?: boolean
  loading: boolean
  onChange: (id: string) => void
  onClose: () => void
  onReload: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="z-[90] max-h-[85vh] overflow-y-auto sm:max-w-2xl" overlayClassName="z-[90]">
        <DialogHeader><DialogTitle>选择执行节点</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">选择后环境列表会按该节点刷新。</p>
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={onReload}>
            {loading ? <Spinner className="size-3.5" /> : <IconReload className="size-3.5" />} 刷新
          </Button>
        </div>
        <NodeTree nodes={nodes} value={value} onChange={(id) => { onChange(id); onClose() }} provider={provider} allowAuto={false} requireSystemEnv={requireSystemEnv} />
      </DialogContent>
    </Dialog>
  )
}

/** 资源中心式添加弹框：资源中心 / 分组 / 市场 + GitHub 识别入口。
 * 选中资源后调用 onPick(reference_id)：装进环境的动作由父层按档位执行。 */
function ResourceCenterAddDialog({
  open, kind, pickedIds, onPick, onClose,
}: {
  open: boolean
  kind: "skill" | "plugin" | "mcp"
  /** 已在当前环境/勾选里的引用 id（显示「已添加」）。 */
  pickedIds: Set<string>
  onPick: (referenceId: string, label: string) => Promise<void>
  onClose: () => void
}) {
  const [tab, setTab] = useState<"center" | "group" | "market">("center")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<ResourceReference[]>([])
  const [marketRows, setMarketRows] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [github, setGithub] = useState("")
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubResult, setGithubResult] = useState<GithubRecognizeResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [marketEnabled, setMarketEnabled] = useState(true)

  const kindLabel = kind === "skill" ? "技能" : kind === "plugin" ? "插件" : "MCP"
  const marketModule = kind === "mcp" ? "mcp" : kind === "plugin" ? "plugins" : "skills"

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === "market") {
        // 市场可能未启用：先探测，未启用就显示提示而非空列表。
        const enabled = await isMarketplaceEnabled()
        if (!enabled) {
          setMarketRows([])
          setMarketEnabled(false)
          return
        }
        setMarketEnabled(true)
        setMarketRows(await fetchMarketIndexAll(marketModule))
        return
      }
      if (tab === "center") {
        // 资源中心 = 团队引用全集（含未授权给分组的，未授权的标灰禁加）。
        const [all, effective] = await Promise.all([
          listResourceReferences(kind),
          listEffectiveResources(kind).catch(() => [] as ResourceReference[]),
        ])
        const effectiveIds = new Set(effective.map((row) => row.id))
        setRows(all.map((row) => ({ ...row, __source: effectiveIds.has(row.id) ? undefined : "unauthorized" })))
        return
      }
      // 分组 = 当前用户所在分组已授权、可直接使用的资源（effective）。
      setRows(await listEffectiveResources(kind))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载资源失败")
    } finally { setLoading(false) }
  }, [kind, tab, marketModule])
  useEffect(() => { if (open) void load() }, [open, load])

  const q = query.trim().toLowerCase()
  const filteredRows = rows.filter((row) => [row.name, row.display_name, row.market_id, row.version].some((v) => String(v || "").toLowerCase().includes(q)))
  const filteredMarket = marketRows.filter((row) => [row.name, row.display_name, row.summary, row.publisher, row.id].some((v) => String(v || "").toLowerCase().includes(q)))

  const pickReference = async (referenceId: string, label: string) => {
    setBusyId(referenceId)
    try { await onPick(referenceId, label) } finally { setBusyId(null) }
  }

  /** GitHub 识别 → 引用 → 交给 onPick（新引用的资源即本次可用）。 */
  const recognizeGithub = async () => {
    const repo = github.trim()
    if (!repo) { toast.error("请输入 GitHub 仓库地址"); return }
    setGithubLoading(true)
    setGithubResult(null)
    try {
      const forceType = kind === "skill" ? "skills" : kind
      const result = await recognizeGithubRepo(repo, undefined, forceType)
      setGithubResult(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "GitHub 识别失败")
    } finally { setGithubLoading(false) }
  }

  const confirmGithub = async () => {
    if (!githubResult) return
    setGithubLoading(true)
    try {
      const refKind = githubResult.type === "skills" ? "skills" : githubResult.type === "plugin" ? "plugin" : "skill"
      const created = await createReferenceFromGithub(
        githubResult.repo_full_name,
        githubResult.ref,
        refKind,
        undefined,
        { name: githubResult.repo_full_name.split("/").pop() || githubResult.repo_full_name },
      )
      toast.success(`已引用「${created.display_name || created.name}」`)
      setGithubResult(null)
      setGithub("")
      await pickReference(created.id, created.display_name || created.name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "引用失败")
    } finally { setGithubLoading(false) }
  }

  /** 市场项：先建团队引用（module+market_id），再交给 onPick。 */
  const pickMarketItem = async (item: MarketItem) => {
    setBusyId(item.id)
    try {
      const created = await createResourceReference(marketModule, item.id)
      toast.success(`已引用「${created.display_name || created.name}」`)
      await pickReference(created.id, created.display_name || created.name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "引用市场资源失败")
    } finally { setBusyId(null) }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="z-[100] flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl" overlayClassName="z-[100]">
        <DialogHeader><DialogTitle>添加{kindLabel}资源</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={(value) => { setTab(value as typeof tab); setQuery(""); setGithubResult(null) }} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="center">资源中心</TabsTrigger>
            <TabsTrigger value="group">分组</TabsTrigger>
            <TabsTrigger value="market">市场</TabsTrigger>
          </TabsList>
          <div className="py-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${kindLabel}名称、描述或来源…`} /></div>
          <TabsContent value="center" className="min-h-0 flex-1 overflow-y-auto">
            <ResourceAddCards rows={filteredRows} pickedIds={pickedIds} loading={loading} busyId={busyId} onPick={pickReference} />
          </TabsContent>
          <TabsContent value="group" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">你所在分组已授权、可直接使用的{kindLabel}资源</div>
            <ResourceAddCards rows={filteredRows} pickedIds={pickedIds} loading={loading} busyId={busyId} onPick={pickReference} />
          </TabsContent>
          <TabsContent value="market" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 rounded-md border border-dashed p-3">
              <div className="mb-2 text-xs font-medium">从 GitHub 识别添加</div>
              <div className="flex gap-2">
                <Input value={github} onChange={(event) => setGithub(event.target.value)} placeholder="https://github.com/owner/repo" />
                <Button type="button" onClick={() => void recognizeGithub()} disabled={githubLoading}>{githubLoading ? <Spinner /> : "识别"}</Button>
              </div>
              {githubResult ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate">{githubResult.repo_full_name} · 类型 {githubResult.type || "未知"}</span>
                  <Button size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => void confirmGithub()} disabled={githubLoading}>引用并添加</Button>
                </div>
              ) : null}
            </div>
            {loading ? (
              <div className="flex h-32 items-center justify-center"><Spinner /></div>
            ) : !marketEnabled ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">市场暂未启用，请先在资源中心配置市场。</div>
            ) : filteredMarket.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的市场资源</p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {filteredMarket.map((row) => (
                  <div key={row.id} className="flex flex-col gap-1.5 rounded-lg border p-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.display_name || row.name || row.id}</span>
                      {row.latest_version ? <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">v{row.latest_version}</Badge> : null}
                    </div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{row.summary || "市场资源"}</div>
                    <div className="mt-auto flex justify-end">
                      <Button size="sm" className="h-7 px-2 text-xs" disabled={busyId !== null} onClick={() => void pickMarketItem(row)}>
                        {busyId === row.id ? <Spinner className="size-3" /> : null} 引用并添加
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <span className="mr-auto text-[11px] text-muted-foreground">添加后资源装入当前环境（隔离档为本次任务），并默认勾选。</span>
          <Button variant="outline" onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 资源引用卡片网格：点击卡片即添加（onPick），已在环境/勾选的显示「已添加」。 */
function ResourceAddCards({
  rows, pickedIds, loading, busyId, onPick,
}: {
  rows: ResourceReference[]
  pickedIds: Set<string>
  loading: boolean
  busyId: string | null
  onPick: (referenceId: string, label: string) => Promise<void>
}) {
  if (loading) return <div className="flex h-32 items-center justify-center"><Spinner /></div>
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">没有可添加的资源</p>
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {rows.map((row) => {
        const picked = pickedIds.has(row.id)
        const label = row.display_name || row.name
        const unauthorized = row.__source === "unauthorized"
        return (
          <div key={row.id} className={`flex flex-col gap-1.5 rounded-lg border p-3 ${unauthorized ? "opacity-60" : ""}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
              {row.version ? <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">v{row.version}</Badge> : null}
              {picked ? <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[10px]">已添加</Badge> : null}
              {unauthorized ? <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] text-destructive">未授权</Badge> : null}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">来源：{row.market_id || "资源中心"}</div>
            <div className="mt-auto flex justify-end">
              <Button
                size="sm" className="h-7 px-2 text-xs"
                disabled={picked || unauthorized || busyId !== null}
                title={unauthorized ? "该引用未授权给你的分组，先到资源中心授权" : undefined}
                onClick={() => void onPick(row.id, label)}
              >
                {busyId === row.id ? <Spinner className="size-3" /> : null} 添加
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
function EnvInstallStep({
  envMode, envId, envName, nodeId, onBack,
}: {
  envMode: "isolated" | "shared" | "system"
  envId: string
  envName: string
  nodeId: string
  onBack: () => void
}) {
  const isShared = envMode === "shared"
  const isSystem = envMode === "system"
  const KINDS = [
    { kind: "skill" as const, label: "技能" },
    { kind: "plugin" as const, label: "插件" },
    { kind: "mcp" as const, label: "MCP" },
  ]
  const [kind, setKind] = useState<"skill" | "plugin" | "mcp">("skill")
  const [search, setSearch] = useState("")
  const [authorized, setAuthorized] = useState<Partial<Record<"skill" | "plugin" | "mcp", ResourceReference[]>>>({})
  const [authLoading, setAuthLoading] = useState(false)
  // 已装集合：shared 按 resource_id 索引；system 按 kind:name 索引。
  const [sharedInstalled, setSharedInstalled] = useState<Map<string, EnvResource>>(new Map())
  const [sharedExtras, setSharedExtras] = useState<EnvExtra[]>([])
  const [sharedNeedsSync, setSharedNeedsSync] = useState(false)
  const [systemNative, setSystemNative] = useState<Map<string, SystemEnvEntry>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const reload = useCallback(async () => {
    const jobs: Promise<void>[] = [
      listEffectiveResources("skill").then((rows) => setAuthorized((cur) => ({ ...cur, skill: rows }))).catch(() => setAuthorized((cur) => ({ ...cur, skill: [] }))),
      listEffectiveResources("plugin").then((rows) => setAuthorized((cur) => ({ ...cur, plugin: rows }))).catch(() => setAuthorized((cur) => ({ ...cur, plugin: [] }))),
      listEffectiveResources("mcp").then((rows) => setAuthorized((cur) => ({ ...cur, mcp: rows }))).catch(() => setAuthorized((cur) => ({ ...cur, mcp: [] }))),
    ]
    if (isShared && envId) {
      jobs.push(getEnvironment(envId).then((detail) => {
        const map = new Map<string, EnvResource>()
        for (const r of detail.resources || []) map.set(r.resource_id, r)
        setSharedInstalled(map)
        setSharedExtras(detail.extras || [])
        setSharedNeedsSync(detail.needs_sync)
      }).catch(() => {}))
    }
    if (isSystem && nodeId) {
      jobs.push(getSystemEnv(nodeId).then((detail) => {
        const map = new Map<string, SystemEnvEntry>()
        for (const [k, rows] of Object.entries(detail.resources || {})) {
          for (const e of rows || []) map.set(`${k}:${e.name}`, e)
        }
        setSystemNative(map)
      }).catch(() => {}))
    }
    await Promise.all(jobs)
  }, [isShared, isSystem, envId, nodeId])

  useEffect(() => { setAuthLoading(true); void reload().finally(() => setAuthLoading(false)) }, [reload])

  const installedEntryOf = (_kindKey: "skill" | "plugin" | "mcp", resourceId: string): EnvResource | undefined =>
    isShared ? sharedInstalled.get(resourceId) : undefined
  const nativeEntryOf = (kindKey: "skill" | "plugin" | "mcp", name: string): SystemEnvEntry | undefined =>
    isSystem ? systemNative.get(`${kindKey}:${name}`) : undefined

  const addShared = async (resourceId: string, label: string) => {
    setBusy(resourceId)
    try {
      await addEnvironmentResource(envId, { kind, resource_id: resourceId })
      // 添加即同步：skill/plugin 真装到节点；MCP 是 config 引用，sync 无害。
      try { await syncEnvironment(envId) } catch { /* 同步失败不打断——卡片会显示待同步 */ }
      await reload()
      toast.success(`已添加「${label}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败")
    } finally { setBusy(null) }
  }

  const removeShared = async (entryId: string, label: string) => {
    setBusy(entryId)
    try {
      await removeEnvironmentResource(envId, entryId)
      try { await syncEnvironment(envId) } catch { /* 同上 */ }
      await reload()
      toast.success(`已移除「${label}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败")
    } finally { setBusy(null) }
  }

  const installSystem = async (resourceId: string, label: string) => {
    if (kind === "mcp") {
      // system 档不管理 MCP（整 tab 隐藏）；此处收窄 SystemEnvFileKind。
      toast.error("MCP 不支持安装到节点本机")
      return
    }
    setBusy(resourceId)
    try {
      await installSystemEnvResource(nodeId, { kind, resource_id: resourceId, overwrite: false })
      await reload()
      toast.success(`已安装「${label}」到节点本机`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装失败")
    } finally { setBusy(null) }
  }

  const uninstallSystem = async (name: string, label: string) => {
    setBusy(name)
    try {
      await removeSystemEnvResource(nodeId, kind, name)
      await reload()
      toast.success(`已卸载「${label}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "卸载失败")
    } finally { setBusy(null) }
  }

  const addSelected = async (resourceId: string, label: string) => {
    if (isShared) await addShared(resourceId, label)
    else if (isSystem && kind !== "mcp") await installSystem(resourceId, label)
  }

  const pickedIdsForDialog = new Set<string>(isShared
    ? [...sharedInstalled.keys()]
    : [...systemNative.values()].filter((entry) => entry.kind === kind).map((entry) => entry.name))

  // 授权资源按搜索过滤；MCP 在 system 档不可管理，整 tab 隐藏。
  const kinds = isSystem ? KINDS.filter((k) => k.kind !== "mcp") : KINDS
  const activeKind = kinds.some((k) => k.kind === kind) ? kind : kinds[0].kind
  const rows = (authorized[activeKind] || []).filter((row) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [row.name, row.display_name, row.market_id, row.version]
      .some((v) => String(v || "").toLowerCase().includes(q))
  })

  // 环境里有、授权清单里没有的（手装/本机自有）：只读展示。
  const unmanaged = isShared
    ? sharedExtras.filter((e) => e.kind === activeKind)
    : [...systemNative.values()]
        .filter((e) => e.kind === activeKind)
        .filter((e) => !(authorized[activeKind] || []).some((row) => row.name === e.name))

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onBack() }}>
      <DialogContent className="z-[80] flex max-h-[94vh] flex-col overflow-hidden sm:max-w-4xl" overlayClassName="z-[80]">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isShared ? `管理共用环境「${envName}」` : isSystem ? "管理节点本机环境" : "管理资源"}
            {isShared && sharedNeedsSync ? <Badge variant="destructive" className="ml-2 text-[10px]">待同步</Badge> : null}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 py-2">
          {/* Tab + 搜索 + 添加资源入口（三 tab 添加弹框：资源中心/分组/市场+GitHub 识别）一行 */}
          <div className="flex shrink-0 items-center gap-3">
            <Tabs value={activeKind} onValueChange={(v) => setKind(v as "skill" | "plugin" | "mcp")}>
              <TabsList>
                {kinds.map((k) => (
                  <TabsTrigger key={k.kind} value={k.kind}>{k.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`搜索${kinds.find((k) => k.kind === activeKind)?.label || ""}名称 / 市场…`}
              className="h-9 flex-1"
            />
            <Button type="button" size="sm" className="h-9 shrink-0" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" /> 添加
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {authLoading ? (
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : (
              <>
                {rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    没有匹配的平台资源。先在资源中心引用并授权给你的分组。
                  </p>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {rows.map((row) => {
                      const installed = installedEntryOf(activeKind, row.id)
                      const native = nativeEntryOf(activeKind, row.name)
                      const inPlace = isShared ? installed : native
                      const label = row.display_name || row.name
                      const cardBusy = busy === row.id
                      return (
                        <div key={row.id} className="flex flex-col gap-1.5 rounded-lg border p-3">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                            {row.version ? <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">v{row.version}</Badge> : null}
                            {inPlace ? (
                              <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[10px]">
                                {isShared ? (installed?.state === "pending" ? "待同步" : "已在环境") : (native?.platform_managed ? "平台已装" : "本机已有")}
                              </Badge>
                            ) : null}
                          </div>
                          {row.market_id ? (
                            <div className="truncate text-[11px] text-muted-foreground">来源：{row.market_id.startsWith("v2:") ? "资源中心" : row.market_id}</div>
                          ) : null}
                          <div className="min-h-[16px] flex-1" />
                          <div className="flex items-center justify-end gap-1.5">
                            {isShared ? (
                              installed ? (
                                <Button
                                  size="sm" variant="outline" className="h-7 px-2 text-xs"
                                  disabled={busy !== null}
                                  onClick={() => void removeShared(installed.id, label)}
                                >
                                  {cardBusy ? <Spinner className="size-3" /> : null} 移除
                                </Button>
                              ) : (
                                <Button
                                  size="sm" className="h-7 px-2 text-xs"
                                  disabled={busy !== null}
                                  onClick={() => void addShared(row.id, label)}
                                >
                                  {cardBusy ? <Spinner className="size-3" /> : null} 添加
                                </Button>
                              )
                            ) : isSystem ? (
                              native ? (
                                native.platform_managed ? (
                                  <Button
                                    size="sm" variant="outline" className="h-7 px-2 text-xs"
                                    disabled={busy !== null}
                                    onClick={() => void uninstallSystem(native.name, label)}
                                  >
                                    {cardBusy ? <Spinner className="size-3" /> : null} 卸载
                                  </Button>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">本机自有，平台不管理</span>
                                )
                              ) : (
                                <Button
                                  size="sm" className="h-7 px-2 text-xs"
                                  disabled={busy !== null}
                                  onClick={() => void installSystem(row.id, label)}
                                >
                                  {cardBusy ? <Spinner className="size-3" /> : null} 安装
                                </Button>
                              )
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 环境里有、授权清单里没有的：只读展示。 */}
                {unmanaged.length > 0 ? (
                  <div className="mt-4">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      {isShared ? "节点手动安装（不在环境配置里，任务也会带上）" : "本机自有（操作者安装，平台不管理）"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {unmanaged.map((entry) => (
                        <Badge key={`${entry.kind}:${entry.name}`} variant="outline" className="px-1.5 py-0.5 text-[11px]">
                          {entry.name}
                          {"version" in entry && entry.version ? <span className="ml-1 text-[10px] text-muted-foreground">v{entry.version}</span> : null}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {isShared ? "添加/移除会自动同步到节点；环境资源跨任务复用。" : "安装会写入节点操作者 HOME（增量）；卸载仅限平台装过的。"}
          </span>
          <Button variant="outline" onClick={onBack}>完成</Button>
        </DialogFooter>
      </DialogContent>
      {addOpen ? (
        <ResourceCenterAddDialog
          kind={activeKind}
          open={addOpen}
          pickedIds={pickedIdsForDialog}
          onPick={async (referenceId, label) => { await addSelected(referenceId, label) }}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </Dialog>
  )
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
  const [envDetail, setEnvDetail] = useState<TaskEnvironmentDetail | null>(null)
  const [systemEnvDetail, setSystemEnvDetail] = useState<SystemEnvDetail | null>(null)
  // 三步走：选环境（含查看配置/进入安装页）→ 给环境装资源（可选）→ 填任务。
  // shared/system 档资源在第三步装进环境后，任务页只读引用；环境建成后不可改。
  const [step, setStep] = useState<DialogStep>("env")
  // 节点选择弹框：第一步节点列点击打开（树形收敛进弹框，主页只留摘要）。
  const [nodePickerOpen, setNodePickerOpen] = useState(false)
  // 环境资源本次运行的勾选集合（按 kind 存资源标识）；环境已有默认全勾。
  const [activeResources, setActiveResources] = useState<Record<"skill" | "plugin" | "mcp", Set<string>>>({ skill: new Set(), plugin: new Set(), mcp: new Set() })
  // 第一步环境资源区的当前 tab + 添加弹框 + 删除确认目标。
  const [envResourceTab, setEnvResourceTab] = useState<"mcp" | "skill" | "plugin">("mcp")
  const [envAddKind, setEnvAddKind] = useState<"skill" | "plugin" | "mcp" | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ kind: "skill" | "plugin" | "mcp"; id: string; name: string } | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<ConfigEntry[]>([])
  const [selectedMcps, setSelectedMcps] = useState<ConfigEntry[]>([])
  const [mcpServiceRows, setMcpServiceRows] = useState<AvailableMcpItem[]>([])
  const [selectedPlugins, setSelectedPlugins] = useState<ConfigEntry[]>([])
  // MCP 添加式选择器（服务/工具 + 实例绑定）：授权草稿随表单提交，映射进
  // mcp_config 负载（service 行 + param 行）。候选与 param 目录来自
  // authorization/options（builtin/平台/个人三分组口径，含 required_param/stdio）。
  const [mcpGrantDraft, setMcpGrantDraft] = useState<PickerGrant[]>([])
  const [mcpPickerResources, setMcpPickerResources] = useState<PickerResource[]>([])
  const [mcpParamKinds, setMcpParamKinds] = useState<PickerParamKind[]>([])
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
  // 新表引用（统一资源池）：映射成旧形状并入 allSkillRows，选择器逻辑零改动复用。
  const [v2SkillRows, setV2SkillRows] = useState<ResourceReferenceV2[]>([])
  // 旧引用 + 新表引用（v2 映射行）合并：主技能 Tab 一个清单同时可见两种来源。
  const allSkillRows = useMemo(
    () => [...skillRows, ...v2SkillRows.map(v2ToLegacyRef)],
    [skillRows, v2SkillRows],
  )
  const [mcpRows, setMcpRows] = useState<ResourceReference[]>([])
  const [pluginRows, setPluginRows] = useState<ResourceReference[]>([])
  const [resourceTab, setResourceTab] = useState<ResourceTab>("tool")
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
    setEnvDetail(null)
    setSystemEnvDetail(null)
    setStep("env")
    setEditorMode(DEFAULT_EDITOR_MODE)
    setSelectedEditors([])
    setRateLimit(DEFAULT_RATE_LIMIT)
    setMaxRequests("")
    setMaxTotalTokens("")
    setExpiresAt("")
    setSelectionStrategy(DEFAULT_SELECTION_STRATEGY_VALUE)
    setResourceTab("tool")
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
      listReferencesV2("skill").catch(() => []),
    ]).then(([skills, mcps, plugins, v2Skills]) => {
      setSkillRows(skills)
      setMcpRows(mcps)
      setPluginRows(plugins)
      setV2SkillRows(v2Skills)
      // 只在资源列表非空时按它过滤已选项；空集视作"未加载/拉取失败"，
      // 保留已选项避免关弹框重开时被误清空（修复资源附件面板数据被覆盖）。
      // 集合子项的 id 是 ``refId::entryName``，按 resource_id 前缀匹配保留；
      // 新表引用（v2: 前缀映射行）按 reference_id / id 前缀匹配保留。
      const v2Mapped = v2Skills.map(v2ToLegacyRef)
      const keepRows: Array<{ id: string }> = [
        ...skills.map((r) => ({ id: r.id })),
        ...v2Mapped.map((r) => ({ id: r.id })),
      ]
      const keep = (entries: ConfigEntry[], rows: Array<{ id: string }>) =>
        rows.length === 0
          ? entries
          : entries.filter((entry) => {
            const id = String(entry.id || entry.name || "")
            const ownerId = String(entry.reference_id || entry.resource_id || id.replace(/^v2:/, "").split("::")[0] || "")
            return rows.some((row) => row.id === ownerId)
          })
      setSelectedSkills((cur) => keep(cur, keepRows))
      setSelectedPlugins((cur) => keep(cur, plugins))
    })
    // MCP 的第二个来源：可直接挂载的服务实例（内置 cdp-bridge / mail /
    // device-control、平台管理的、个人 SSE）。团队引用只覆盖市场安装的那部分，
    // 之前漏了这三类，弹框里根本看不到内置 MCP。
    void listAvailableMcp()
      .then((response) => setMcpServiceRows([...response.builtin, ...response.admin, ...response.upstream]))
      .catch(() => setMcpServiceRows([]))
    // 添加式选择器候选：authorization/options（builtin/平台/个人 services，带
    // required_param/stdio；builtin 实例与 param_kinds 目录）。失败时留空——picker
    // 显示空态，不阻断弹框其余功能。
    void listMcpAuthorizationOptions()
      .then((opts) => {
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
            source: r.source,
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
        setMcpPickerResources([...svcResources, ...instanceResources])
        setMcpParamKinds(opts.param_kinds || [])
      })
      .catch(() => {
        setMcpPickerResources([])
        setMcpParamKinds([])
      })
  }, [initialContent, issueId, open])

  // MCP 已选项的合法性随两个来源列表修剪：service: 前缀条目对服务实例表校验，
  // 其余（团队引用）对引用表校验；任一列表为空视作未加载，保留已选不清空。
  // 仅隔离档使用任务级 MCP 选择，但修剪逻辑对两档都无害（空列表即不修剪）。
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

  // 选中共用环境后拉它的配置清单（资源 + extras）：勾选页把环境自带资源带进
  // 勾选列表，第一步概览卡也用它。换环境/档位即失效重取。
  useEffect(() => {
    if (envMode !== "shared" || !envId) { setEnvDetail(null); return }
    let active = true
    getEnvironment(envId)
      .then((detail) => { if (active) setEnvDetail(detail) })
      .catch(() => { if (active) setEnvDetail(null) })
    return () => { active = false }
  }, [envMode, envId, provider])

  // 选中系统档节点后拉节点本机清单：同上，带进勾选页 + 第一步概览卡。
  // 切换执行客户端也重拉：不同编辑器发现的资源集不同（readers 按编辑器归组），
  // 旧清单会带着上一个客户端视角的资源卡片。
  useEffect(() => {
    if (envMode !== "system" || !nodeId || !systemEnvAllowed) { setSystemEnvDetail(null); return }
    let active = true
    getSystemEnv(nodeId)
      .then((detail) => { if (active) setSystemEnvDetail(detail) })
      .catch(() => { if (active) setSystemEnvDetail(null) })
    return () => { active = false }
  }, [envMode, nodeId, systemEnvAllowed, provider])

  // 第三步装完资源返回第一步时，强制重拉环境清单把新资源带进配置列表。
  const reloadEnvDetail = useCallback(async () => {
    if (envMode === "shared" && envId) {
      try { setEnvDetail(await getEnvironment(envId)) } catch { /* 保持旧快照 */ }
    } else if (envMode === "system" && nodeId && systemEnvAllowed) {
      try { setSystemEnvDetail(await getSystemEnv(nodeId)) } catch { /* 保持旧快照 */ }
    }
  }, [envMode, envId, nodeId, systemEnvAllowed])

  /** 添加资源（三 tab 弹框选中后）：按档位装进 shared 环境 / system 本机 / 隔离任务级。 */
  const addResourceToEnv = useCallback(async (referenceId: string, label: string) => {
    const kind = envAddKind
    if (!kind) return
    if (envMode === "shared" && envId) {
      try {
        await addEnvironmentResource(envId, { kind, resource_id: referenceId })
        try { await syncEnvironment(envId) } catch { /* 同步失败不打断，卡片显示待同步 */ }
        toast.success(`已添加「${label}」到环境`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加失败")
        return
      }
      await reloadEnvDetail()
    } else if (envMode === "system" && nodeId && kind !== "mcp") {
      try {
        await installSystemEnvResource(nodeId, { kind, resource_id: referenceId, overwrite: false })
        toast.success(`已安装「${label}」到节点本机`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "安装失败")
        return
      }
      await reloadEnvDetail()
    } else if (envMode === "system" && kind === "mcp") {
      toast.info("系统内置档不写操作者本机 MCP 配置；本机已有的 MCP 会自动生效。")
    } else if (envMode === "isolated") {
      // 隔离档没有可持久化的环境：加进任务级勾选（selected*），提交时装进 session。
      const rows = kind === "skill" ? allSkillRows : kind === "plugin" ? pluginRows : mcpRows
      const row = rows.find((r) => r.id === referenceId)
      if (!row) { toast.error("未找到该资源，请刷新后重试"); return }
      const item: ConfigEntry = { id: row.id, name: row.name, resource_id: row.id }
      if (kind === "skill") setSelectedSkills((cur) => cur.some((e) => e.id === row.id) ? cur : [...cur, item])
      if (kind === "plugin") setSelectedPlugins((cur) => cur.some((e) => e.id === row.id) ? cur : [...cur, item])
      if (kind === "mcp") setSelectedMcps((cur) => cur.some((e) => e.id === row.id) ? cur : [...cur, item])
      toast.success(`已添加「${label}」（本次任务）`)
    }
  }, [envMode, envId, nodeId, envAddKind, reloadEnvDetail, allSkillRows, pluginRows, mcpRows])

  /** 删除确认后执行：shared 移除环境引用并同步；system 卸载平台装的；isolated 仅取消勾选。 */
  const confirmRemove = useCallback(async () => {
    const target = removeTarget
    if (!target) return
    try {
      if (envMode === "shared" && envId) {
        // shared 的卡片 id 是 resource_id；行 id 需从环境详情反查。
        const entry = (envDetail?.resources || []).find((r) => r.kind === target.kind && r.resource_id === target.id)
        if (!entry) throw new Error("该资源不在环境配置里")
        await removeEnvironmentResource(envId, entry.id)
        try { await syncEnvironment(envId) } catch { /* 同上 */ }
        toast.success(`已从环境移除「${target.name}」`)
      } else if (envMode === "system" && nodeId) {
        const name = target.id.includes(":") ? target.id.slice(target.id.indexOf(":") + 1) : target.name
        await removeSystemEnvResource(nodeId, target.kind, name)
        toast.success(`已卸载「${target.name}」`)
      } else if (envMode === "isolated") {
        if (target.kind === "skill") setSelectedSkills((cur) => cur.filter((e) => String(e.id) !== target.id))
        if (target.kind === "plugin") setSelectedPlugins((cur) => cur.filter((e) => String(e.id) !== target.id))
        if (target.kind === "mcp") setSelectedMcps((cur) => cur.filter((e) => String(e.id) !== target.id))
        toast.success(`已移除「${target.name}」`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败")
    } finally {
      setRemoveTarget(null)
      if (envMode !== "isolated") await reloadEnvDetail()
    }
  }, [removeTarget, envMode, envId, nodeId, envDetail, reloadEnvDetail])

  // 当前环境资源卡片：shared=环境快照、system=本机清单、isolated=平台授权候选
  // （勾选即本次任务用，提交走任务级 selected*；无环境可装）。
  const environmentEntries = useMemo(() => {
    const out: Record<"skill" | "plugin" | "mcp", ResourceItem[]> = { skill: [], plugin: [], mcp: [] }
    if (envMode === "isolated") {
      out.skill = toResourceItems(allSkillRows)
      out.plugin = toResourceItems(pluginRows)
      out.mcp = toResourceItems(mcpRows)
      return out
    }
    if (envMode === "shared" && envDetail) {
      for (const entry of envDetail.resources || []) {
        const badge = entry.state === "installed" ? "环境自带" : entry.state === "pending" ? "环境待同步" : "环境配置"
        out[entry.kind as "skill" | "plugin" | "mcp"]?.push({
          id: entry.resource_id,
          name: entry.name,
          display_name: entry.name,
          description: entry.version ? `v${entry.version}` : undefined,
          __badge: badge,
        })
      }
      return out
    }
    if (envMode === "system" && systemEnvDetail) {
      for (const [kind, rows] of Object.entries(systemEnvDetail.resources || {})) {
        if (kind !== "skill" && kind !== "plugin" && kind !== "mcp") continue
        for (const entry of rows || []) {
          out[kind].push({
            id: `${kind}:${entry.name}`,
            name: entry.name,
            display_name: entry.name,
            description: entry.version ? `v${entry.version}` : entry.description || undefined,
            __badge: entry.platform_managed ? "平台已装" : "本机已有",
          })
        }
      }
    }
    return out
  }, [envMode, envDetail, systemEnvDetail, allSkillRows, pluginRows, mcpRows])

  // 环境资源默认全勾（取消 = 本次任务不使用）；换环境/新增资源时把新出现的
  // 资源补进勾选集合，用户手动取消的保持不动。isolated 档勾选走 selected*
  // （任务级候选默认不勾），此处跳过。
  useEffect(() => {
    if (envMode === "isolated") return
    setActiveResources((cur) => {
      const next = { skill: new Set(cur.skill), plugin: new Set(cur.plugin), mcp: new Set(cur.mcp) }
      let changed = false
      for (const kind of ["skill", "plugin", "mcp"] as const) {
        const known = new Set(environmentEntries[kind].map((item) => String(item.id)))
        for (const id of known) if (!next[kind].has(id)) { next[kind].add(id); changed = true }
        for (const id of cur[kind]) if (!known.has(id)) { next[kind].delete(id); changed = true }
      }
      return changed ? next : cur
    })
  }, [environmentEntries, envMode])

  // 三步式后：环境资源在第三步装进环境，任务页只读引用——不再把环境资源
  // 「预勾选」进任务级 selected*（那套 env: 前缀 + active 子集的合并语义已废）。
  // isolated 档没有可持久安装的环境，仍在第二步用 selected* 做任务级选择。

  // 卡片勾选状态：shared/system 用环境资源 activeResources；isolated 用任务级 selected*。
  const displayActive = envMode === "isolated"
    ? {
        skill: new Set(selectedSkills.map((entry) => String(entry.id || entry.resource_id || ""))),
        plugin: new Set(selectedPlugins.map((entry) => String(entry.id || entry.resource_id || ""))),
        mcp: new Set(selectedMcps.map((entry) => String(entry.id || entry.resource_id || ""))),
      }
    : activeResources

  /** 卡片「移除」入口：本机自有资源（操作者装的）平台不管理，直接提示不下确认框。 */
  const requestRemove = (kind: "skill" | "plugin" | "mcp", item: ResourceItem) => {
    if (item.__badge === "本机已有") {
      toast.info("该资源是节点操作者本机安装的，平台不管理其卸载")
      return
    }
    setRemoveTarget({ kind, id: String(item.id), name: String(item.display_name || item.name) })
  }

  const submit = async () => {
    const text = content.trim()
    // 内容可为空：为空则建一个等待用户输入的任务，第一条消息在详情页发。
    if (!nodeId) return toast.error("请选择执行节点")
    if (!keyId) return toast.error("请选择父 API Key")
    if (envMode === "system" && !systemEnvAllowed) return toast.error("该节点未开启系统环境，请换一个节点或改用其他环境")
    if (provider === "codex" && !installationId.trim()) return toast.error("Codex 任务需要 installation_id")
    if (provider === "codex" && !text) return toast.error("Codex 任务需要填写首条内容")
    const mapping = resolveTaskIntent(intent, issueType)
    const isIsolated = envMode === "isolated"
    // 隔离档：勾选的资源走任务级安装（装进本次 session）。
    const skillIds = isIsolated ? skillBindings(selectedSkills) : []
    const pluginIds = isIsolated ? selectedIds(selectedPlugins) : []
    // shared/system 档：环境资源已在环境里，任务只发「本次激活子集」（active_*）。
    // 全勾 = 不发（节点默认全激活）；部分勾 = 只发勾选的名字。名字取自环境卡片
    // 的 display_name/name（与节点侧 activeSkillNames 的枚举名一致）。
    const activeNames = (kind: "skill" | "plugin") => {
      if (isIsolated) return undefined
      const all = environmentEntries[kind]
      if (all.length === 0) return undefined
      const kept = all.filter((item) => activeResources[kind].has(String(item.id))).map((item) => String(item.name))
      return kept.length < all.length ? kept : undefined
    }
    const activeSkills = activeNames("skill")
    const activePlugins = activeNames("plugin")
    // 工具（第二步 McpGrantPicker：内置服务 + 实例绑定）在所有档位下发；
    // 隔离档还合并任务级 MCP 引用（selectedMcps）+ shared 档勾选的环境 MCP 引用。
    const toolEntries = grantDraftToPayload(mcpGrantDraft, mcpPickerResources)
    const isolatedMcpRefs = isIsolated ? mcpBindings(selectedMcps) : []
    // shared 档：环境里勾选的 MCP 引用（任务运行时按引用现签 token）。
    const sharedMcpRefs = envMode === "shared"
      ? environmentEntries.mcp.filter((item) => activeResources.mcp.has(String(item.id))).map((item) => ({ resource_id: String(item.id) }))
      : []
    const mcpEntries = [...toolEntries, ...isolatedMcpRefs, ...sharedMcpRefs]
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
        ...(activeSkills ? { active_skills: activeSkills } : {}),
        ...(activePlugins ? { active_plugins: activePlugins } : {}),
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
      // 「没有就安装」的结果：服务端逐条尝试把勾选的新资源装进环境/节点本机，
      // 失败不阻断创建——这里把失败清单 toast 出来让用户知情。
      const installWarnings = (task as { env_install_warnings?: string[] }).env_install_warnings
      if (Array.isArray(installWarnings) && installWarnings.length > 0) {
        for (const warning of installWarnings) toast.warning(warning)
      }
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

  // 第一步：先选节点，再选环境，在环境里管理资源。选节点 → 选档位（共用档
  // 再选具体环境）→ 下方展示「当前环境配置」列表（三栏：技能/插件/MCP），
  // 「管理资源」弹框里从平台授权清单勾选安装。下一步进任务页——资源只读引用。
  if (step === "env") {
    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader><DialogTitle>选择执行环境</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              {/* 第一行两列：节点 / 编辑器。两列结构完全一致——Label 一行 + 选择卡
                  一行；节点的「刷新」按钮放在选择卡内右侧，不再单独占一行（那会
                  让节点区比客户端多出一块空白）。 */}
              <div className="grid gap-3 sm:grid-cols-2">
              {/* ① 执行节点：主页面只显示摘要，树形收进独立选择弹框。 */}
              <section className="flex flex-col gap-2">
                <Label>执行节点</Label>
                <div className="relative">
                  <button
                    type="button"
                    className="flex h-11 w-full items-center gap-2 rounded-md border px-3 py-2 pr-9 text-left transition hover:bg-muted"
                    onClick={() => setNodePickerOpen(true)}
                  >
                    {selectedNode ? (
                      <NodeSummaryCard node={selectedNode} />
                    ) : <span className="text-sm text-muted-foreground">点击选择执行节点</span>}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                    title="刷新节点列表"
                    disabled={loadingNodes}
                    onClick={() => void reloadNodes().catch((error) => toast.error(error instanceof Error ? error.message : "刷新节点失败"))}
                  >
                    {loadingNodes ? <Spinner className="size-3.5" /> : <IconReload className="size-3.5" />}
                  </Button>
                </div>
              </section>

              {/* ② 执行客户端：与节点同结构（Label + 选择卡），高度一致。 */}
              <section className="flex flex-col gap-2">
                <Label>执行客户端</Label>
                <Select value={provider} onValueChange={(value) => setProvider(value as TaskProvider)}>
                  <SelectTrigger className="!h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </section>
              </div>

              {/* 第二行：执行环境（三档卡片 + 解释文案）。 */}
              <section className="space-y-2">
                <Label>执行环境</Label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {ENV_TIERS.map((tier) => {
                    const disabled = tier.value === "system" && !anySystemEnvNode
                    const selected = envMode === tier.value
                    return (
                      <button
                        key={tier.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => { setEnvMode(tier.value); if (tier.value !== "shared") { setEnvId(""); setEnvName("") } }}
                        className={`flex flex-col gap-1 rounded-md border p-3 text-left transition ${selected ? "border-primary bg-accent" : "hover:bg-muted"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <span className="text-sm font-medium">{tier.label}</span>
                        <span className="text-xs text-muted-foreground">{tier.detail}</span>
                        {disabled ? <span className="text-[10px] text-destructive">无已开启系统环境的节点</span> : null}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* shared 档在三列下方展示该节点的共用环境选择器（宽度足够时不挤三列）。 */}
              {envMode === "shared" ? (
                <section className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <Label>共用环境</Label>
                    <span className="text-xs text-muted-foreground">选一个环境，或在旁边新建</span>
                  </div>
                  {!nodeId ? <p className="text-sm text-muted-foreground">先选择执行节点，才能看到它上面的共用环境。</p> : (
                    <EnvironmentPanel nodeId={nodeId} compact selectedEnvId={envId} onSelect={(id, name) => { setEnvId(id); setEnvName(name) }} />
                  )}
                </section>
              ) : null}

              {/* ④ 环境资源：MCP/技能/插件 tabs + 卡片（勾选本次使用 / 添加 / 删除确认）。
                  shared=环境快照（装进环境）；system=本机清单（平台装的）；isolated=平台授权候选（任务级）。 */}
              {envMode === "isolated" ? (
                <EnvironmentResourceTabs
                  entries={environmentEntries}
                  active={displayActive}
                  tab={envResourceTab}
                  onTabChange={setEnvResourceTab}
                  onToggle={(kind, id) => {
                    // isolated 勾选直接驱动 selected*（提交时装进 session）。
                    const item = environmentEntries[kind].find((e) => String(e.id) === id)
                    const entry: ConfigEntry = { id, name: item?.name || id, resource_id: id }
                    if (kind === "skill") setSelectedSkills((cur) => cur.some((e) => String(e.id) === id) ? cur.filter((e) => String(e.id) !== id) : [...cur, entry])
                    if (kind === "plugin") setSelectedPlugins((cur) => cur.some((e) => String(e.id) === id) ? cur.filter((e) => String(e.id) !== id) : [...cur, entry])
                    if (kind === "mcp") setSelectedMcps((cur) => cur.some((e) => String(e.id) === id) ? cur.filter((e) => String(e.id) !== id) : [...cur, entry])
                  }}
                  onAdd={(kind) => setEnvAddKind(kind)}
                  onRemove={requestRemove}
                />
              ) : null}
              {envMode === "shared" ? (
                envId ? (
                  <EnvironmentResourceTabs
                    entries={environmentEntries}
                    active={activeResources}
                    tab={envResourceTab}
                    onTabChange={setEnvResourceTab}
                    onToggle={(kind, id) => setActiveResources((cur) => {
                      const next = new Set(cur[kind])
                      if (next.has(id)) next.delete(id); else next.add(id)
                      return { ...cur, [kind]: next }
                    })}
                    onAdd={(kind) => setEnvAddKind(kind)}
                    onRemove={requestRemove}
                    addButtonLabel="安装"
                  />
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">选择一个共用环境后展示其资源配置。</p>
                )
              ) : null}
              {envMode === "system" ? (
                nodeId && systemEnvAllowed ? (
                  <EnvironmentResourceTabs
                    entries={environmentEntries}
                    active={activeResources}
                    tab={envResourceTab}
                    onTabChange={setEnvResourceTab}
                    onToggle={(kind, id) => setActiveResources((cur) => {
                      const next = new Set(cur[kind])
                      if (next.has(id)) next.delete(id); else next.add(id)
                      return { ...cur, [kind]: next }
                    })}
                    onAdd={(kind) => setEnvAddKind(kind)}
                    onRemove={requestRemove}
                    addButtonLabel="安装"
                  />
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    系统内置档直接使用节点操作者的本机 HOME（已装的工具与登录态）。请选择一个已开启该模式的节点。
                  </p>
                )
              ) : null}

              <DialogFooter>
                <Button onClick={() => setStep("task")} disabled={!nodeId || (envMode === "shared" && !envId)}>
                  下一步
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
        {/* 节点选择弹框（树形收敛于此）。 */}
        {nodePickerOpen ? (
          <NodePickerDialog
            open={nodePickerOpen}
            nodes={nodes}
            value={nodeId}
            provider={provider}
            requireSystemEnv={envMode === "system"}
            loading={loadingNodes}
            onChange={setNodeId}
            onClose={() => setNodePickerOpen(false)}
            onReload={() => void reloadNodes().catch((error) => toast.error(error instanceof Error ? error.message : "刷新节点失败"))}
          />
        ) : null}
        {/* 添加资源弹框（资源中心/分组/市场 + GitHub 识别）。 */}
        {envAddKind ? (
          <ResourceCenterAddDialog
            open={envAddKind !== null}
            kind={envAddKind}
            pickedIds={new Set(environmentEntries[envAddKind].map((item) => String(item.id)))}
            onPick={addResourceToEnv}
            onClose={() => setEnvAddKind(null)}
          />
        ) : null}
        {/* 删除/卸载确认。 */}
        <AlertDialog open={removeTarget !== null} onOpenChange={(next) => { if (!next) setRemoveTarget(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认移除「{removeTarget?.name}」？</AlertDialogTitle>
              <AlertDialogDescription>
                {envMode === "shared"
                  ? "会从共用环境配置移除并同步到节点（卸载文件）；其他任务不再可用。"
                  : envMode === "system"
                    ? "会从节点操作者本机卸载该资源（仅平台安装的可卸）。"
                    : "仅从本次任务选择中移除（不安装）。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void confirmRemove()}>移除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>创建开发任务</DialogTitle></DialogHeader>
        {/* 环境卡片：环境 + 固定的执行节点/客户端一起展示，第二步不可修改。 */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">环境</span>
            <Badge variant="secondary">{envTierLabel}</Badge>
            {envMode === "shared" && envId ? <span className="font-medium">{envName}</span> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex h-10 items-center rounded-md border bg-background/70 px-3">
              {selectedNode ? <NodeSummaryCard node={selectedNode} /> : <span className="text-sm text-muted-foreground">未选择节点</span>}
            </div>
            <div className="flex h-10 items-center rounded-md border bg-background/70 px-3">
              <span className="text-sm font-medium">{PROVIDERS.find((item) => item.value === provider)?.label || provider}</span>
            </div>
          </div>
        </div>
        <div className="space-y-5 py-2">
          {/* 执行配置：节点/客户端已固定在上方环境卡片，只保留意图/权限方式 + 父Key/模型 */}
          <section className="space-y-4 rounded-md border p-3">
            {/* 任务意图 + 权限方式 两列均分 */}
            <div className="grid gap-4 sm:grid-cols-2">
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

          {/* 第二步只保留：工具（本次任务挂载的 MCP 服务/工具实例）/ 提示词 / API Key。
              技能/插件/MCP 引用在第一步环境里管理与勾选，这里不再重复。 */}
          <div className="rounded-md border p-3">
            <Tabs
              value={resourceTab}
              onValueChange={(v) => setResourceTab(v as ResourceTab)}
              className="block w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="tool">工具 ({mcpGrantDraft.filter((g) => g.grant_key === "service").length + selectedMcps.length})</TabsTrigger>
                <TabsTrigger value="prompt">提示词 {promptId ? "·" : ""}</TabsTrigger>
                <TabsTrigger value="apikey">API Key</TabsTrigger>
              </TabsList>
              <TabsContent value="tool" className="mt-3">
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-muted-foreground">
                    本次任务挂载的工具：内置服务型 MCP（cdp-bridge / 邮件 / 设备控制等）与实例绑定，
                    以及团队授权的引用型 MCP。工具与第一步环境里勾选的 MCP 一起下发给本次任务。
                  </div>
                  <McpGrantPicker
                    grants={mcpGrantDraft}
                    onChange={setMcpGrantDraft}
                    resources={mcpPickerResources}
                    paramKinds={mcpParamKinds}
                  />
                  {(mcpRows.length > 0 || selectedMcps.length > 0) ? (
                    <div className="rounded-md border p-2.5">
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">团队授权 MCP（引用型）</div>
                      <EditorResourcePicker label="团队 MCP" items={toResourceItems(mcpRows)} selected={selectedMcps} onChange={setSelectedMcps} />
                    </div>
                  ) : null}
                </div>
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
          <Button variant="outline" onClick={() => setStep("env")}>返回重选</Button>
          <Button onClick={() => void submit()} disabled={submitting}>{submitting && <Spinner />} 创建并运行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
