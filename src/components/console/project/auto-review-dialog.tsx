import type { DomainProject } from "@/api/Api"
import { listAvailableMcp, listRuntimeModelOptions, type AvailableMcpItem } from "@/api/agentClient"
import { listParentKeys, type ParentKeyItem } from "@/api/editorClient"
import {
  getProjectWebhook,
  getProjectWebhookStatus,
  listProjectReviewNodes,
  listReviewFrameworks,
  resyncProjectWebhookCallback,
  saveProjectWebhook,
  type ProjectWebhookConfig,
  type ReviewEventSummary,
  type ReviewFrameworkInfo,
  type ReviewNodeInfo,
} from "@/api/reviewClient"
import {
  EditorResourcePicker,
  type ItemState,
  type ResourceItem,
} from "@/components/console/editor/resource-picker"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"
import { useMarketSpecMappers } from "@/components/console/editor/use-market-specs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Hint, SearchSelect } from "@/components/console/task/task-form-fields"
import {
  buildRateLimitPayload,
  DEFAULT_RATE_LIMIT,
  TaskApiKeyPanel,
  type RateLimitState,
} from "@/components/console/task/api-key-fields"
import {
  fetchPluginListingWithMarket,
  fetchSkillListingWithMarket,
  type PluginListingItem,
  type SkillListingItem,
} from "@/lib/agent-resources-api"
import { IconLoader, IconRefresh, IconViewfinder } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

const DEFAULT_FRAMEWORK = "open_code_review_delegate"
type ConfigEntry = Record<string, unknown>

/** 资源与 API Key 的 5 个 Tab，与创建任务弹框同一组。 */
type ReviewResourceTab = "skill" | "mcp" | "plugin" | "prompt" | "apikey"

// 执行客户端全集。是否可选由框架的 supported_editors 决定：不支持的仍然显示，
// 但禁用并给出原因（Codex 缺少可预注册的 installation_id）。
const ALL_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "codex", label: "Codex" },
]

/** epoch 秒 → yyyy-MM-ddTHH:mm（本地）供 datetime-local 使用；空返回 ""。 */
function epochToDateInput(epoch?: number | null): string {
  if (!epoch) return ""
  const d = new Date(epoch * 1000)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local（本地时间）→ epoch 秒；空返回 null（永不过期/继承父）。 */
function dateInputToEpoch(value: string): number | null {
  if (!value) return null
  const epoch = Math.floor(new Date(value).getTime() / 1000)
  return Number.isFinite(epoch) ? epoch : null
}

interface AutoReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function AutoReviewDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: AutoReviewDialogProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ProjectWebhookConfig | null>(null)
  const [reviewNodes, setReviewNodes] = useState<ReviewNodeInfo[]>([])
  const [parentKeys, setParentKeys] = useState<ParentKeyItem[]>([])
  const [models, setModels] = useState<Array<{ value: string; label: string }>>([])
  const [frameworks, setFrameworks] = useState<ReviewFrameworkInfo[]>([])
  const [events, setEvents] = useState<ReviewEventSummary[]>([])
  const [inflight, setInflight] = useState(0)
  // 默认值：启用自动 Review=开、仅保留最新事件=关（产品最终口径）。
  const [enabled, setEnabled] = useState(true)
  const [framework, setFramework] = useState(DEFAULT_FRAMEWORK)
  const [provider, setProvider] = useState("claude")
  const [reviewAuto, setReviewAuto] = useState(false)
  const [nodeIds, setNodeIds] = useState<string[]>([])
  const [skills, setSkills] = useState<ConfigEntry[]>([])
  const [mcp, setMcp] = useState<ConfigEntry[]>([])
  const [plugins, setPlugins] = useState<ConfigEntry[]>([])
  const [availableMcp, setAvailableMcp] = useState<AvailableMcpItem[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillListingItem[]>([])
  const [availablePlugins, setAvailablePlugins] = useState<PluginListingItem[]>([])
  const [modelId, setModelId] = useState("")
  const [promptId, setPromptId] = useState("")
  const [apiKeyId, setApiKeyId] = useState<number | null>(null)
  const [maxRequests, setMaxRequests] = useState("")
  const [maxTokens, setMaxTokens] = useState("")
  // Per-review rate limits. Empty = unlimited for that metric. Shape is shared
  // with the task dialog so TaskApiKeyPanel can render it as-is.
  const [rateLimit, setRateLimit] = useState<RateLimitState>(DEFAULT_RATE_LIMIT)
  // Per-review child-key expiry. Empty = inherit parent's.
  const [expiresAt, setExpiresAt] = useState("")
  const [latestOnly, setLatestOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const { mapSkillItem, mapPluginItem, skillItemState, pluginItemState } = useMarketSpecMappers(
    availableSkills,
    availablePlugins,
  )

  // The webhook must exist before review can be configured — POST creates it,
  // PATCH updates it. `exists` drives the button label and gate.
  const exists = Boolean(config?.id)

  const load = useCallback(async () => {
    if (!project?.id) return
    setLoading(true)
    try {
      const [saved, frameworkList, keys, status, mcpList, skillList, pluginList] = await Promise.all([
        getProjectWebhook(project.id),
        listReviewFrameworks(project.id).catch(() => ({ frameworks: [] as ReviewFrameworkInfo[] })),
        listParentKeys().catch(() => []),
        getProjectWebhookStatus(project.id).catch(() => null),
        listAvailableMcp().catch(() => ({ builtin: [], admin: [], upstream: [] })),
        fetchSkillListingWithMarket().catch(() => [] as SkillListingItem[]),
        fetchPluginListingWithMarket().catch(() => [] as PluginListingItem[]),
      ])
      setConfig(saved)
      setFrameworks(frameworkList.frameworks)
      setParentKeys(keys)
      setModels([])
      setAvailableMcp([...mcpList.builtin, ...mcpList.admin, ...mcpList.upstream])
      setAvailableSkills(skillList)
      setAvailablePlugins(pluginList)
      setEvents(status?.events || [])
      setInflight(status?.inflight || 0)
      setFramework(saved?.review_framework || DEFAULT_FRAMEWORK)
      // 默认：启用自动 Review = 开；仅保留最新事件 = 关。已有保存值时沿用行内状态。
      setEnabled(saved ? Boolean(saved.review_enabled) : true)
      setProvider(saved?.review_provider || "claude")
      setReviewAuto(Boolean(saved?.review_auto))
      setNodeIds(list(saved?.review_node_ids))
      setSkills(saved?.review_skill_config || [])
      setMcp(saved?.review_mcp_config || [])
      setPlugins(saved?.review_plugin_config || [])
      setModelId(saved?.review_model_id || "")
      setPromptId(saved?.review_prompt_id || "")
      setApiKeyId(saved?.review_api_key_id ?? null)
      const limits = saved?.review_model_limits || {}
      setMaxRequests(limits.max_requests ? String(limits.max_requests) : "")
      setMaxTokens(limits.max_total_tokens ? String(limits.max_total_tokens) : "")
      const rl = saved?.review_rate_limit || {}
      const rlStr = (key: string) => (rl[key] ? String(rl[key]) : "")
      setRateLimit({
        requests_per_minute: rlStr("requests_per_minute"),
        requests_per_5h: rlStr("requests_per_5h"),
        requests_per_day: rlStr("requests_per_day"),
        requests_per_week: rlStr("requests_per_week"),
        tokens_per_minute: rlStr("tokens_per_minute"),
        tokens_per_day: rlStr("tokens_per_day"),
        tokens_per_week: rlStr("tokens_per_week"),
        concurrent_requests: rlStr("concurrent_requests"),
        max_ips: rlStr("max_ips"),
        ip_window_seconds: rl.ip_window_seconds ? String(rl.ip_window_seconds) : "3600",
      })
      setExpiresAt(epochToDateInput(saved?.review_expires_at ?? null))
      setLatestOnly(saved ? Boolean(saved.review_latest_only) : false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectOverview.review.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [project?.id, t])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []

  const supportedProviders = useMemo(() => {
    const selected = frameworks.find((item) => item.name === framework)
    // Codex Task authentication requires a pre-registered installation id and
    // bootstrap content. Webhook reviews cannot currently source that identity,
    // so hide Codex until the node reports a stable installation id.
    return (selected?.supported_editors || ["claude", "opencode"])
      .filter((item) => item !== "codex")
  }, [framework, frameworks])

  useEffect(() => {
    if (supportedProviders.length === 0) return
    if (!supportedProviders.includes(provider)) setProvider(supportedProviders[0])
  }, [provider, supportedProviders])

  useEffect(() => {
    if (!open || apiKeyId == null) {
      setModels([])
      if (apiKeyId == null) setModelId("")
      return
    }
    const controller = new AbortController()
    setModels([])
    void listRuntimeModelOptions(apiKeyId, controller.signal)
      .then((options) => {
        if (controller.signal.aborted) return
        setModels(options)
        setModelId((current) => current && options.some((item) => item.value === current) ? current : "")
      })
      .catch(() => { if (!controller.signal.aborted) { setModels([]); setModelId("") } })
    return () => { controller.abort() }
  }, [open, apiKeyId])

  useEffect(() => {
    if (!open || !project?.id || !provider) return
    void listProjectReviewNodes(project.id, framework, provider)
      .then((result) => setReviewNodes(result.nodes || []))
      .catch(() => setReviewNodes([]))
  }, [open, project?.id, framework, provider])

  const toggleAuto = (checked: boolean) => {
    setReviewAuto(checked)
    if (checked) setNodeIds([]) // mutual exclusion: auto clears manual picks
  }

  const toggleNode = (nodeId: string, checked: boolean) => {
    setReviewAuto(false) // selecting a manual node exits auto mode
    setNodeIds((current) => checked
      ? Array.from(new Set([...current, nodeId]))
      : current.filter((value) => value !== nodeId))
  }

  const save = async () => {
    if (!project?.id) return
    if (enabled && !provider) {
      toast.error(t("projectOverview.review.providerRequired"))
      return
    }
    if (enabled && !reviewAuto && nodeIds.length === 0) {
      toast.error(t("projectOverview.review.nodeRequired"))
      return
    }
    if (enabled && apiKeyId == null) {
      toast.error(t("projectOverview.review.parentApiKeyRequired"))
      return
    }
    const limits: Record<string, number> = {}
    if (maxRequests.trim()) limits.max_requests = Math.max(0, Number(maxRequests) || 0)
    if (maxTokens.trim()) limits.max_total_tokens = Math.max(0, Number(maxTokens) || 0)
    // 速率限制：留空/非正数 = 该项不限制，直接不下发该键（与任务侧同一个收敛函数，
    // ip_window_seconds 也只在 max_ips>0 时才带上）。
    const rateLimitPayload = buildRateLimitPayload(rateLimit)
    try {
      setSaving(true)
      const saved = await saveProjectWebhook(project.id, {
        events: ["push", "pull_request"],
        active: true,
        review_framework: framework,
        review_provider: provider,
        review_node_ids: reviewAuto ? [] : nodeIds,
        review_skill_config: skills,
        review_mcp_config: mcp,
        review_plugin_config: plugins,
        review_auto: reviewAuto,
        review_enabled: enabled,
        review_model_id: modelId || null,
        review_prompt_id: promptId || "",
        review_api_key_id: apiKeyId,
        review_model_limits: limits,
        review_rate_limit: rateLimitPayload,
        review_expires_at: dateInputToEpoch(expiresAt),
        review_latest_only: latestOnly,
      }, exists)
      setConfig(saved)
      toast.success(t("projectOverview.review.saved"))
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectOverview.review.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const resyncCallback = async () => {
    if (!project?.id) return
    setResyncing(true)
    try {
      const saved = await resyncProjectWebhookCallback(project.id)
      setConfig(saved)
      toast.success(t("projectOverview.review.callbackUpdated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectOverview.review.callbackUpdateFailed"))
    } finally {
      setResyncing(false)
    }
  }

  // Guided first step: create the platform webhook (callback URL) only, with
  // review left disabled. Only after it exists do we reveal the review config.
  const createWebhook = async () => {
    if (!project?.id) return
    setCreatingWebhook(true)
    try {
      const saved = await saveProjectWebhook(project.id, {
        events: ["push", "pull_request"],
        active: true,
        review_enabled: false,
      }, false)
      setConfig(saved)
      toast.success(t("projectOverview.review.webhookCreated"))
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectOverview.review.saveFailed"))
    } finally {
      setCreatingWebhook(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 固定高度 + 内部滚动：内容多寡都撑满可视高度，避免弹框随 Tab 切换忽高忽低。 */}
      <DialogContent className="flex h-[92vh] w-[95vw] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <IconViewfinder className="size-5" />
            {t("projectOverview.review.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-40 items-center justify-center"><IconLoader className="animate-spin" /></div>
        ) : !exists ? (
          // Guided empty state: no webhook yet. The user must create the
          // callback first; only then is the review configuration revealed.
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="rounded-full bg-muted p-4">
              <IconViewfinder className="size-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t("projectOverview.review.setupTitle")}</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                {t("projectOverview.review.setupHint")}
              </p>
            </div>
            <Button disabled={creatingWebhook} onClick={() => void createWebhook()}>
              {creatingWebhook ? <IconLoader className="animate-spin" /> : <IconRefresh className="size-4" />}
              {t("projectOverview.review.createCallback")}
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="config">
            <TabsList>
              <TabsTrigger value="config">{t("projectOverview.review.tabConfig")}</TabsTrigger>
              <TabsTrigger value="manage">{t("projectOverview.review.tabManage")}</TabsTrigger>
              <TabsTrigger value="deliveries">{t("projectOverview.review.tabDeliveries")}</TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-5">
              <ConfigPanel
                t={t}
                frameworks={frameworks}
                framework={framework}
                setFramework={setFramework}
                supportedProviders={supportedProviders}
                provider={provider}
                setProvider={setProvider}
                reviewNodes={reviewNodes}
                nodeIds={nodeIds}
                toggleNode={toggleNode}
                reviewAuto={reviewAuto}
                toggleAuto={toggleAuto}
                skills={skills}
                setSkills={setSkills}
                mcp={mcp}
                setMcp={setMcp}
                plugins={plugins}
                setPlugins={setPlugins}
                availableMcp={availableMcp}
                availableSkills={availableSkills}
                availablePlugins={availablePlugins}
                mapSkillItem={mapSkillItem}
                mapPluginItem={mapPluginItem}
                skillItemState={skillItemState}
                pluginItemState={pluginItemState}
                models={models}
                modelId={modelId}
                setModelId={setModelId}
                promptId={promptId}
                setPromptId={setPromptId}
                parentKeys={parentKeys}
                apiKeyId={apiKeyId}
                setApiKeyId={setApiKeyId}
                maxRequests={maxRequests}
                setMaxRequests={setMaxRequests}
                maxTokens={maxTokens}
                setMaxTokens={setMaxTokens}
                rateLimit={rateLimit}
                setRateLimit={setRateLimit}
                expiresAt={expiresAt}
                setExpiresAt={setExpiresAt}
                latestOnly={latestOnly}
                setLatestOnly={setLatestOnly}
                enabled={enabled}
                setEnabled={setEnabled}
              />
            </TabsContent>

            <TabsContent value="manage">
              <ManagePanel t={t} config={config} inflight={inflight} onResync={resyncCallback} resyncing={resyncing} />
            </TabsContent>

            <TabsContent value="deliveries">
              <DeliveriesPanel t={t} events={events} />
            </TabsContent>
          </Tabs>
        )}

        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("projectOverview.review.cancel")}</Button>
          {exists && (
            <Button disabled={loading || saving} onClick={() => void save()}>
              {saving && <IconLoader className="animate-spin" />}
              {t("projectOverview.review.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ConfigPanelProps {
  t: (key: string, opts?: Record<string, unknown>) => string
  frameworks: ReviewFrameworkInfo[]
  framework: string
  setFramework: (value: string) => void
  supportedProviders: string[]
  provider: string
  setProvider: (value: string) => void
  reviewNodes: ReviewNodeInfo[]
  nodeIds: string[]
  toggleNode: (nodeId: string, checked: boolean) => void
  reviewAuto: boolean
  toggleAuto: (checked: boolean) => void
  skills: ConfigEntry[]
  setSkills: (value: ConfigEntry[]) => void
  mcp: ConfigEntry[]
  setMcp: (value: ConfigEntry[]) => void
  plugins: ConfigEntry[]
  setPlugins: (value: ConfigEntry[]) => void
  availableMcp: AvailableMcpItem[]
  availableSkills: SkillListingItem[]
  availablePlugins: PluginListingItem[]
  mapSkillItem: (item: ResourceItem) => ConfigEntry
  mapPluginItem: (item: ResourceItem) => ConfigEntry
  skillItemState: (item: ResourceItem) => ItemState
  pluginItemState: (item: ResourceItem) => ItemState
  models: Array<{ value: string; label: string }>
  modelId: string
  setModelId: (value: string) => void
  promptId: string
  setPromptId: (value: string) => void
  parentKeys: ParentKeyItem[]
  apiKeyId: number | null
  setApiKeyId: (value: number | null) => void
  maxRequests: string
  setMaxRequests: (value: string) => void
  maxTokens: string
  setMaxTokens: (value: string) => void
  /** 速率限制整体用任务侧的 RateLimitState，交给 TaskApiKeyPanel 渲染。 */
  rateLimit: RateLimitState
  setRateLimit: (value: RateLimitState) => void
  expiresAt: string
  setExpiresAt: (value: string) => void
  latestOnly: boolean
  setLatestOnly: (value: boolean) => void
  enabled: boolean
  setEnabled: (value: boolean) => void
}

function ConfigPanel(props: ConfigPanelProps) {
  const { t } = props
  const [resourceTab, setResourceTab] = useState<ReviewResourceTab>("prompt")
  return (
    <div className="space-y-5 py-2">
      {/* 执行配置：与创建任务弹框同构——框架/客户端/节点/父 Key/模型收在一个带边框的
          section 里，下面再跟资源与 API Key 的平铺 Tab（不再用两层折叠面板）。 */}
      <section className="space-y-4 rounded-md border p-3">
      {/* Review 框架：仅选择审查方式，不再要求预装环境（review 作为 skill 隔离交付）。 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label>{t("projectOverview.review.framework")}</Label>
          <Hint label={t("projectOverview.review.frameworkHint")} />
        </div>
        <RadioGroup value={props.framework} onValueChange={props.setFramework} className="gap-2">
          {props.frameworks.map((fw) => (
            <label key={fw.name} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value={fw.name} className="mt-1" />
              <div>
                <div className="font-medium">{fw.label}</div>
                <p className="mt-1 text-xs text-muted-foreground">{fw.description}</p>
              </div>
            </label>
          ))}
          {props.frameworks.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("projectOverview.review.frameworkNone")}</p>
          )}
        </RadioGroup>
      </div>

      {/* Provider: the Review Task drives this CLI directly. Rendered as a
          select; Codex stays visible-but-disabled with its reason. */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label>{t("projectOverview.review.provider")}</Label>
          <Hint label={t("projectOverview.review.providerHint")} />
        </div>
        <Select value={props.provider} onValueChange={props.setProvider}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder={t("projectOverview.review.providerRequired")} />
          </SelectTrigger>
          <SelectContent>
            {ALL_PROVIDERS.map((item) => {
              const supported = props.supportedProviders.includes(item.value)
              return (
                <SelectItem key={item.value} value={item.value} disabled={!supported}>
                  <span className="flex items-center gap-2">
                    <span>{item.label}</span>
                    {!supported && (
                      <span className="text-xs text-muted-foreground">
                        {item.value === "codex"
                          ? t("projectOverview.review.providerCodexDisabled")
                          : t("projectOverview.review.providerUnsupported")}
                      </span>
                    )}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Node pool: manual ids or automatic selection from authorized execution nodes. */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label>{t("projectOverview.review.nodes")}</Label>
          <Hint label={t("projectOverview.review.nodesHint")} />
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${props.reviewAuto ? "border-primary" : ""}`}
          >
            <Checkbox
              checked={props.reviewAuto}
              onCheckedChange={(checked) => props.toggleAuto(Boolean(checked))}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t("projectOverview.review.autoNode")}</span>
                <Badge variant="outline">{t("projectOverview.review.autoNode")}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("projectOverview.review.autoNodeHint")}</p>
            </div>
          </label>

          {props.reviewNodes.map((node) => {
            const selectable = Boolean(node.review_ready)
            const selected = props.nodeIds.includes(node.node_id)
            return (
              <label
                key={node.node_id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected ? "border-primary" : ""} ${selectable ? "" : "opacity-60"}`}
              >
                <Checkbox
                  checked={selected}
                  disabled={!selectable || props.reviewAuto}
                  onCheckedChange={(checked) => props.toggleNode(node.node_id, Boolean(checked))}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{node.node_name || node.node_id}</span>
                    <span className="text-xs text-muted-foreground">· {node.node_id}</span>
                    <Badge variant={selectable ? "outline" : "secondary"}>
                      {node.review_in_use}/{node.review_capacity}
                    </Badge>
                  </div>
                  {!selectable && (
                    <p className="mt-1 text-xs text-destructive">
                      {node.review_reason || node.review_missing.join(", ")}
                    </p>
                  )}
                </div>
              </label>
            )
          })}

          {props.reviewNodes.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">{t("projectOverview.review.noNode")}</div>
          )}
        </div>
      </div>

      {/* 父 API Key + Review 模型：可搜索、宽满父容器。 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label>{t("projectOverview.review.parentApiKey")}</Label>
            <Hint label={t("projectOverview.review.parentApiKeyHint")} />
          </div>
          <SearchSelect
            value={props.apiKeyId == null ? "" : String(props.apiKeyId)}
            onChange={(v) => props.setApiKeyId(v ? Number(v) : null)}
            options={props.parentKeys.map((key) => ({
              value: String(key.id),
              label: key.name || key.key_masked || `#${key.id}`,
              hint: key.key_masked,
              disabled: key.disabled,
            }))}
            placeholder={t("projectOverview.review.parentApiKeyRequired")}
            emptyHint={t("projectOverview.review.parentApiKeyEmpty")}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label>{t("projectOverview.review.model")}</Label>
            <Hint label={t("projectOverview.review.modelHint")} />
          </div>
          <SearchSelect
            value={props.modelId || "__inherit__"}
            onChange={(v) => props.setModelId(v === "__inherit__" ? "" : v)}
            options={props.models.map((model) => ({ value: model.value, label: model.label, hint: model.value }))}
            placeholder={t("projectOverview.review.modelInherit")}
            emptyHint={t("projectOverview.review.modelEmpty")}
            inheritLabel={t("projectOverview.review.modelInherit")}
          />
        </div>
      </div>
      </section>

      {/* 资源与 API Key：与创建任务弹框一致的 5 Tab 平铺（技能/MCP/插件/提示词/API Key），
          不再折叠——折叠内容与后面的面板会互相压盖。API Key Tab 直接复用任务侧的
          TaskApiKeyPanel，只是模型/编辑器/选择策略那几段 Review 侧不适用，不传即不渲染。 */}
      <div className="rounded-md border p-3">
        <Tabs
          value={resourceTab}
          onValueChange={(v) => setResourceTab(v as ReviewResourceTab)}
          className="block w-full"
        >
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="skill">Skill ({props.skills.length})</TabsTrigger>
            <TabsTrigger value="mcp">MCP ({props.mcp.length})</TabsTrigger>
            <TabsTrigger value="plugin">Plugin ({props.plugins.length})</TabsTrigger>
            <TabsTrigger value="prompt">{t("projectOverview.review.tabPrompt")} {props.promptId ? "·" : ""}</TabsTrigger>
            <TabsTrigger value="apikey">API Key</TabsTrigger>
          </TabsList>
          <TabsContent value="skill" className="mt-3">
            <EditorResourcePicker
              label="Skills"
              items={props.availableSkills}
              selected={props.skills}
              onChange={props.setSkills}
              mapItem={props.mapSkillItem}
              itemState={props.skillItemState}
            />
          </TabsContent>
          <TabsContent value="mcp" className="mt-3">
            <EditorResourcePicker
              label="MCP 服务"
              items={props.availableMcp}
              selected={props.mcp}
              onChange={props.setMcp}
            />
          </TabsContent>
          <TabsContent value="plugin" className="mt-3">
            <EditorResourcePicker
              label="Plugins"
              items={props.availablePlugins}
              selected={props.plugins}
              onChange={props.setPlugins}
              mapItem={props.mapPluginItem}
              itemState={props.pluginItemState}
            />
          </TabsContent>
          <TabsContent value="prompt" className="mt-3 space-y-2">
            <ProjectPromptSelector
              value={props.promptId}
              onChange={props.setPromptId}
              provider={props.provider}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("projectOverview.review.promptHint")}
            </p>
          </TabsContent>
          <TabsContent value="apikey" className="mt-3">
            <TaskApiKeyPanel
              intro={t("projectOverview.review.advancedLimitsHint")}
              rateLimit={props.rateLimit}
              onRateLimitChange={props.setRateLimit}
              maxRequests={props.maxRequests}
              onMaxRequestsChange={props.setMaxRequests}
              maxTotalTokens={props.maxTokens}
              onMaxTotalTokensChange={props.setMaxTokens}
              expiresAt={props.expiresAt}
              onExpiresAtChange={props.setExpiresAt}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* 行为开关：两个 Switch 同一张卡里，与其它 section 的边框语言一致。 */}
      <section className="divide-y rounded-md border">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-1">
            <Label>{t("projectOverview.review.latestOnly")}</Label>
            <Hint label={t("projectOverview.review.latestOnlyHint")} />
          </div>
          <Switch checked={props.latestOnly} onCheckedChange={props.setLatestOnly} />
        </div>
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-1">
            <Label>{t("projectOverview.review.autoReview")}</Label>
            <Hint label={t("projectOverview.review.autoReviewHint")} />
          </div>
          <Switch checked={props.enabled} onCheckedChange={props.setEnabled} />
        </div>
      </section>
    </div>
  )
}

interface ManagePanelProps {
  t: (key: string, opts?: Record<string, unknown>) => string
  config: ProjectWebhookConfig | null
  inflight: number
  onResync: () => void
  resyncing: boolean
}

function ManagePanel({ t, config, inflight, onResync, resyncing }: ManagePanelProps) {
  if (!config) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{t("projectOverview.review.notConfigured")}</div>
  }
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("projectOverview.review.callbackUrl")}</span>
          <Button variant="outline" size="sm" onClick={onResync} disabled={resyncing} className="shrink-0">
            {resyncing ? <IconLoader className="animate-spin" /> : <IconRefresh className="size-4" />}
            <span className="truncate">{t("projectOverview.review.updateCallback")}</span>
          </Button>
        </div>
        <p className="break-all font-mono text-xs">{config.callback_url}</p>
        <div className="flex justify-between"><span className="text-muted-foreground">{t("projectOverview.review.secret")}</span>
          <span className="font-mono text-xs">{config.secret_masked || "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{t("projectOverview.review.platform")}</span>
          <span>{config.platform}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{t("projectOverview.review.inflight")}</span>
          <span>{inflight}</span></div>
        {config.last_error && (
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t("projectOverview.review.lastError")}</span>
            <span className="max-w-[60%] truncate text-destructive">{config.last_error}</span></div>
        )}
      </section>
    </div>
  )
}

interface DeliveriesPanelProps {
  t: (key: string, opts?: Record<string, unknown>) => string
  events: ReviewEventSummary[]
}

function DeliveriesPanel({ t, events }: DeliveriesPanelProps) {
  return (
    <section className="space-y-2">
      <Label>{t("projectOverview.review.recentDeliveries")}</Label>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-md border p-2">
        {events.map((event) => (
          <div key={event.id} className="rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {event.event_type === "pull_request"
                  ? `PR #${event.pr_number || "?"}`
                  : `${t("projectOverview.review.push")} ${(event.commit_sha || "").slice(0, 8)}`}
              </span>
              <Badge variant="outline">{event.status}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{t("projectOverview.review.findings", { count: event.finding_count })}</span>
              {event.attempts > 0 && <span>{t("projectOverview.review.attempts", { count: event.attempts })}</span>}
              {event.last_error && <span className="text-destructive">{event.last_error}</span>}
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">{t("projectOverview.review.noDeliveries")}</div>
        )}
      </div>
    </section>
  )
}
