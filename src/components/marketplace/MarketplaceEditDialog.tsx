/**
 * 资源统一编辑弹窗：市场 tab（mcp/插件/skill/项目提示词）与外部榜单草稿**共用同一套
 * 字段**——资源标识、名称、显示名、摘要（大输入框）、发布者、版本、子分类、标签、
 * 分类（多选）、按分类展开的安装配置、状态。footer 统一「取消/保存」，发布=状态选
 * 「已发布」保存。
 *
 * 上游数据口径（external_data 是唯一上游真相）：
 * - 同步进来的条目已在 external_data 存了上游原文；资源字段是它首次入池时的派生值。
 * - 弹框里每个派生字段旁有「同步」小按钮：把该项表单值替换为 external_data 的上游值，
 *   **逐项、主动触发**（分类用 external_data 里的 board/category 重新推导），仍需保存
 *   才落库。安装配置（launch_spec/install_spec）不提供——上游没有对应值。
 *
 * 概念口径：分类=安装形态（多选）；子分类=用途场景（多选，源=上游 use_cases）；
 * 标签=搜索自由词（源=上游 topics）。
 */
import { useEffect, useRef, useState } from "react"
import { ExternalLink, HelpCircle, RefreshCw, Save, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { MarketplaceManifest, LeaderboardItem } from "@/api/marketplaceAdmin"
import {
  ALL_MODULES,
  BOARD_LABELS,
  LAUNCH_TRANSPORTS,
  MODULE_LABELS,
  deriveModulesFromExternal,
  normalizeExternalData,
  normalizeModules,
  normalizeSkillInstallSpec,
  type SkillEntry,
} from "./leaderboard-labels"
import { LeaderboardTagInput, toStringArray } from "./LeaderboardTagInput"
import { toast } from "sonner"

export type EditMode = "mcp-remote" | "mcp-stdio" | "plugin" | "skill" | "prompt"

/** 项名后面的问号：说明文字挪进 tooltip，表单里不堆一行行小字。 */
function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="说明" className="text-muted-foreground/60 hover:text-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <Hint text={hint} /> : null}
        {action}
      </Label>
      {children}
    </div>
  )
}

/** 逐项「同步」按钮：把该项表单值替换为 external_data 的上游值（保存才落库）。 */
function SyncButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="同步上游数据"
      aria-label="同步上游数据"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
    >
      <RefreshCw className="h-3 w-3" />同步
    </button>
  )
}

/** 榜单草稿保存时回传的收口 patch（由 LeaderboardItemsView 转成 updateLeaderboardItem）。 */
export type LeaderboardCurationPatch = {
  target_modules: string[]
  installable: boolean
  install_spec?: Record<string, unknown>
  launch_spec?: Record<string, unknown>
  status?: "draft" | "published" | "hidden"
  sort_order?: number | null
  name?: string
  display_name?: string
  publisher?: string
  description?: string
  version?: string
  categories?: string[]
  tags?: string[]
}

export function MarketplaceEditDialog({
  open,
  onOpenChange,
  mode,
  item,
  onSave,
  leaderboardItem,
  onLeaderboardSave,
  onFillLaunch,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 市场变体：tab 决定的单形态。榜单变体下忽略（分类由多选区决定）。 */
  mode: EditMode
  item: MarketplaceManifest | null
  onSave: (manifest: MarketplaceManifest) => Promise<void>
  /** 榜单变体：传入榜单条目即启用（与 item 二选一）。 */
  leaderboardItem?: LeaderboardItem | null
  onLeaderboardSave?: (patch: LeaderboardCurationPatch) => Promise<void>
  onFillLaunch?: (item: LeaderboardItem) => void
}) {
  const isLeaderboard = !!leaderboardItem

  // 市场变体：manifest 形态
  const [form, setForm] = useState<Record<string, any>>({})

  // 统一资源字段（两个变体同一套状态）
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [summary, setSummary] = useState("")
  const [publisher, setPublisher] = useState("")
  const [version, setVersion] = useState("")
  // 排序（资源中心索引）：仅榜单变体；空串=未设置（排最后按热度）
  const [sortOrder, setSortOrder] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  // 分类（多选）——榜单变体；市场变体由 tab 决定（单形态徽标）
  const [modules, setModules] = useState<string[]>([])
  // 状态（两个变体同一字段；榜单发布=选已发布保存）
  const [status, setStatus] = useState("published")
  // MCP 启动方式（launch_spec）
  const [mcpKind, setMcpKind] = useState("none")
  const [mcpCommand, setMcpCommand] = useState("")
  const [mcpArgs, setMcpArgs] = useState("")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpTransport, setMcpTransport] = useState("sse")
  // skill 安装参数（install_spec.skill）：entries 列表形态，支持技能包与多编辑器
  const [skillInstallMethod, setSkillInstallMethod] = useState("github_clone")
  const [skillRef, setSkillRef] = useState("main")
  const [skillEntries, setSkillEntries] = useState<SkillEntry[]>([])
  // plugin 安装参数（install_spec.plugin）
  const [pluginDownloadUrl, setPluginDownloadUrl] = useState("")
  const [pluginProvider, setPluginProvider] = useState("claude")
  // prompt 安装参数（install_spec.prompt）
  const [promptContent, setPromptContent] = useState("")
  const [promptProviders, setPromptProviders] = useState<string[]>(["claude", "codex", "opencode", "cursor"])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (isLeaderboard && leaderboardItem) {
      const it = leaderboardItem
      const install = (it.install_spec || {}) as Record<string, any>
      const spec = (it.launch_spec || {}) as Record<string, any>
      const upstreamName = it.repo_full_name.split("/").pop() || it.repo_full_name
      setName(it.name || upstreamName)
      setDisplayName(it.display_name || it.name || upstreamName)
      setSummary(it.description || "")
      setPublisher(it.publisher || it.repo_full_name.split("/")[0] || "")
      setVersion(it.version || "latest")
      setSortOrder(it.sort_order != null ? String(it.sort_order) : "")
      setCategories(toStringArray(it.categories))
      setTags(toStringArray(it.tags))
      const initialModules = normalizeModules(it.target_modules, it.target_module)
      // 存量/旧后端可能没有 target_modules，按 external_data 的榜单类型自动推导默认勾选；
      // 注意：只填表单默认值，仍要保存才落库。
      setModules(initialModules.length > 0
        ? initialModules
        : deriveModulesFromExternal(it.external_data, it.board, it.upstream_category))
      setStatus(it.status || "draft")
      setMcpKind(String(spec.kind || "none"))
      setMcpCommand(String(spec.command || ""))
      setMcpArgs(Array.isArray(spec.args) ? (spec.args as string[]).join("\n") : "")
      setMcpUrl(String(spec.url || ""))
      setMcpTransport(String(spec.transport || "sse"))
      const skill = normalizeSkillInstallSpec(install)
      setSkillInstallMethod(skill.install_method || "github_clone")
      setSkillRef(skill.ref || "main")
      setSkillEntries(skill.entries.length > 0 ? skill.entries : [{ name: "", path: "", entry: "SKILL.md", editors: ["claude"] }])
      const plugin = install.plugin || {}
      setPluginDownloadUrl(String(plugin.download_url || `https://github.com/${it.repo_full_name}/archive/refs/heads/main.zip`))
      setPluginProvider(String(plugin.provider || "claude"))
      const prompt = install.prompt || {}
      setPromptContent(String(prompt.content || ""))
      setPromptProviders(Array.isArray(prompt.providers) && prompt.providers.length ? prompt.providers : ["claude", "codex", "opencode", "cursor"])
    } else if (item) {
      setForm(item)
      setName(item.name || "")
      setDisplayName(item.display_name || "")
      setSummary(item.summary || "")
      setPublisher(item.publisher || "")
      setVersion(item.version || "")
      setCategories(Array.isArray((item as any).categories) ? toStringArray((item as any).categories) : (item.category ? [item.category] : []))
      setTags(toStringArray(item.tags))
      setStatus(item.status || "published")
    } else {
      const base: Record<string, any> = {
        id: "",
        name: "",
        display_name: "",
        summary: "",
        publisher: "",
        category: "custom",
        tags: [],
        version: "latest",
        status: "published",
        resource: {},
      }
      if (mode === "mcp-remote") {
        base.kind = "mcp"
        base.resource = { type: "remote_mcp", transport: "sse", url: "" }
      } else if (mode === "mcp-stdio") {
        base.kind = "mcp"
        base.resource = { type: "stdio_mcp", command: "npx", args: [] }
      } else if (mode === "plugin") {
        base.kind = "editor_plugin"
        base.download_url = ""
        base.resource = { type: "editor_plugin", provider: "claude", package_format: "tar", entry: ".claude-plugin/marketplace.json" }
      } else if (mode === "prompt") {
        base.kind = "project_prompt"
        base.resource = {
          type: "project_prompt",
          content: "",
          providers: ["claude", "codex", "opencode", "cursor"],
          target_files: ["CLAUDE.md", "AGENTS.md"],
        }
      } else {
        base.kind = "skill"
        base.source_url = ""
        base.install_method = "github_clone"
        base.resource = { type: "skill_package", source: "github", url: "", entry: "SKILL.md", ref: "main" }
      }
      setForm(base)
      setName("")
      setDisplayName("")
      setSummary("")
      setPublisher("")
      setVersion("latest")
      setCategories([])
      setTags([])
      setStatus("published")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, leaderboardItem, mode])

  const external = isLeaderboard
    ? normalizeExternalData(leaderboardItem?.external_data)
    : null

  /** 逐项同步：把表单值替换为 external_data 的上游值（保存才落库）。 */
  const syncField = (field: string) => {
    if (!external) return
    const short = String(external.repo_full_name || leaderboardItem!.repo_full_name).split("/").pop() || ""
    const owner = String(external.repo_full_name || "").split("/")[0] || ""
    switch (field) {
      case "name": setName(String(external.repo_full_name || "").split("/").pop() || name); break
      case "displayName": setName(short); setDisplayName(short); break
      case "summary": setSummary(String(external.description || "")); break
      case "publisher": setPublisher(owner); break
      case "version": setVersion(String(external.version || "latest")); break
      case "categories": setCategories(toStringArray(external.categories ?? external.use_cases)); break
      case "tags": setTags(toStringArray(external.tags ?? external.topics)); break
      case "modules": setModules(deriveModulesFromExternal(
        external,
        leaderboardItem?.board || "",
        leaderboardItem?.upstream_category || "",
      )); break
      default: break
    }
  }

  const syncAction = (field: string) => (external ? <SyncButton onClick={() => syncField(field)} /> : undefined)

  const toggleModule = (module: string) => {
    setModules((prev) => (prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]))
  }

  const togglePromptProvider = (provider: string) => {
    setPromptProviders((prev) => (prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]))
  }

  const buildLaunchSpec = (): Record<string, unknown> | undefined => {
    if (!modules.includes("mcp")) return undefined
    if (mcpKind === "stdio") {
      return { kind: "stdio", command: mcpCommand.trim(), args: mcpArgs.split("\n").map((a) => a.trim()).filter(Boolean) }
    }
    if (mcpKind === "remote") {
      return { kind: "remote", url: mcpUrl.trim(), transport: mcpTransport }
    }
    return { kind: "none" }
  }

  const handleLeaderboardSave = async (): Promise<boolean> => {
    if (!leaderboardItem || !onLeaderboardSave) return false
    const spec = buildLaunchSpec()
    const install: Record<string, unknown> = {}
    if (modules.includes("skill")) {
      const cleanEntries = skillEntries
        .filter((e) => e.entry.trim())
        .map((e) => ({ name: e.name.trim(), path: e.path.trim(), entry: e.entry.trim(), editors: e.editors }))
      install.skill = { install_method: skillInstallMethod, ref: skillRef.trim() || "main", entries: cleanEntries }
    }
    if (modules.includes("plugin")) {
      install.plugin = { download_url: pluginDownloadUrl.trim(), provider: pluginProvider.trim() }
    }
    if (modules.includes("prompt")) {
      install.prompt = { content: promptContent, providers: promptProviders }
    }
    const statusValue = status as "draft" | "published" | "hidden"
    if (statusValue === "published" && modules.length === 0) {
      toast.error("可安装条目发布前需要勾选分类；仅浏览条目请保持不勾任何分类")
      return false
    }
    let sortValue: number | null = null
    if (sortOrder.trim()) {
      const parsed = Number(sortOrder.trim())
      if (!Number.isInteger(parsed) || parsed < 0) {
        toast.error("排序需为非负整数；留空则排最后按热度")
        return false
      }
      sortValue = parsed
    }
    setSaving(true)
    try {
      await onLeaderboardSave({
        target_modules: modules,
        installable: modules.length > 0,
        status: statusValue,
        sort_order: sortValue,
        name: name.trim(),
        display_name: displayName.trim(),
        description: summary.trim(),
        publisher: publisher.trim(),
        version: version.trim(),
        categories,
        tags,
        ...(spec ? { launch_spec: spec } : {}),
        ...(Object.keys(install).length > 0 ? { install_spec: install } : {}),
      })
      toast.success(statusValue === "published" ? "已保存并发布，用户侧立即可见" : "已保存")
      onOpenChange(false)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleMarketSave = async (): Promise<boolean> => {
    const manifest = {
      ...form,
      name,
      display_name: displayName,
      summary,
      publisher,
      version,
      // 子分类多选：manifest.category 保持第一个（兼容索引/消费侧），完整数组存 categories
      category: categories[0] || "",
      categories,
      tags,
      status,
    }
    setSaving(true)
    try {
      await onSave(manifest as MarketplaceManifest)
      onOpenChange(false)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    const done = isLeaderboard ? await handleLeaderboardSave() : await handleMarketSave()
    return done
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  const title = isLeaderboard
    ? `编辑资源：${leaderboardItem!.repo_full_name}`
    : item ? "编辑资源" : "新建资源"
  // GitHub 跳转：榜单条目=仓库地址；市场资源=source_url（有才显示）。
  const githubUrl = isLeaderboard
    ? leaderboardItem!.repo_url
    : String(form.source_url || form.download_url || "")
  const githubIsRepoLink = isLeaderboard || /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(githubUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{title}</span>
            {githubIsRepoLink ? (
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer noopener"
                title="在 GitHub 打开"
                aria-label="在 GitHub 打开"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            {modules.map((m) => (
              <Badge key={m} variant="outline" className="shrink-0 text-[10px]">{MODULE_LABELS[m]}</Badge>
            ))}
            {modules.length === 0 ? (
              <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">仅浏览</Badge>
            ) : null}
            <Badge variant={status === "published" ? "default" : status === "hidden" ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
              {status === "published" ? "已发布" : status === "hidden" ? "隐藏" : "草稿"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 上游数据只读条：external_data 是唯一上游真相，这里只是展示 */}
          {isLeaderboard && external ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">外部数据</span>
              <span>来源：{external.source === "manual" ? "手动添加" : (BOARD_LABELS[String(external.board)] || String(external.board || "榜单"))}</span>
              {external.upstream_category ? <span>上游分类：{String(external.upstream_category)}</span> : null}
              <span>★ {Number(external.stars || 0).toLocaleString()}</span>
              <span>fork {Number(external.forks || 0).toLocaleString()}</span>
              {external.language ? <span>{String(external.language)}</span> : null}
            </div>
          ) : null}

          {/* 资源标识：榜单=仓库身份只读；市场可输入 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="资源标识" hint={isLeaderboard ? "条目身份=上游仓库，不可改" : "资源唯一标识，例如 owner.name"}>
              <Input
                value={isLeaderboard ? leaderboardItem!.repo_full_name : form.id || ""}
                disabled={isLeaderboard}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="owner.name"
                className="font-mono text-xs" />
            </Field>
            <Field label="名称" action={syncAction("name")} hint="资源名；榜单默认取仓库短名">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="显示名" action={syncAction("displayName")} hint="用户侧卡片标题">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          {/* 摘要是给人改的：大输入框 */}
          <Field label="摘要" action={syncAction("summary")} hint="一段介绍；榜单默认取上游仓库描述">
            <Textarea rows={10} className="resize-y" value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={isLeaderboard ? String(external?.description || "上游描述，可改写") : ""} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="发布者" action={syncAction("publisher")} hint="榜单默认取仓库 owner">
              <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </Field>
            <Field label="版本" action={syncAction("version")} hint="榜单默认取上游更新日期（YYYY.MM.DD）">
              <Input value={version} onChange={(e) => setVersion(e.target.value)} />
            </Field>
          </div>
          {isLeaderboard ? (
            <Field label="排序" hint="资源中心索引位置，数字越小越靠前；留空=排最后按热度">
              <Input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder={leaderboardItem!.sort_order != null ? `当前 #${leaderboardItem!.sort_order}` : "未设置（按热度）"} />
            </Field>
          ) : null}
          <Field label="子分类" action={syncAction("categories")} hint="用途/场景，可多个；榜单默认取上游 use_cases">
            <LeaderboardTagInput value={categories} onChange={setCategories} placeholder="输入子分类，按 Enter 添加" />
          </Field>
          <Field label="标签" action={syncAction("tags")} hint="搜索自由词（llm / agent / rag）；榜单默认取 GitHub topics">
            <LeaderboardTagInput value={tags} onChange={setTags} placeholder="输入标签，按 Enter 添加" />
          </Field>
          <Field label="状态" hint="已发布=用户侧可见；草稿=仅管理端；隐藏=下架保留">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="hidden">隐藏</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Separator />

          {/* 分类（多选）：榜单可勾；市场由所在 tab 决定，展示为只读徽标 */}
          <div className="space-y-2">
            <Field
              label="分类"
              action={syncAction("modules")}
              hint="决定出现在用户侧哪个模块、给不给安装入口；可多选（比如同时是 MCP 和 Skill）；全不勾=仅浏览"
            >
              {isLeaderboard ? (
                <div className="flex flex-wrap gap-4">
                  {ALL_MODULES.map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={modules.includes(m)} onCheckedChange={() => toggleModule(m)} />
                      {MODULE_LABELS[m]}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{MODULE_LABELS[mode === "mcp-remote" || mode === "mcp-stdio" ? "mcp" : mode === "plugin" ? "plugin" : mode === "prompt" ? "prompt" : "skill"]}</Badge>
                  <span className="text-xs text-muted-foreground">由所在模块 tab 决定</span>
                </div>
              )}
            </Field>
            {isLeaderboard ? (
              <p className="text-xs text-muted-foreground">
                {modules.length > 0
                  ? `可安装：将出现在 ${modules.map((m) => MODULE_LABELS[m]).join("、")} 模块。`
                  : "仅浏览：无安装入口，用户侧渲染成跳 GitHub 的卡片（开发框架 / 研究程序 / awesome 目录选这个）。"}
              </p>
            ) : null}
          </div>

          {/* ── MCP 安装配置（两变体同一套字段） ── */}
          {(isLeaderboard ? modules.includes("mcp") : mode === "mcp-remote" || mode === "mcp-stdio") && (
            <>
              <Separator />
              <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    MCP 启动方式
                    <Hint text="MCP 需要可连接的启动命令或地址，上游榜单不提供，得手填或让 agent 识别" />
                  </div>
                  {isLeaderboard && onFillLaunch ? (
                    <Button size="sm" variant="outline" onClick={() => onFillLaunch(leaderboardItem!)}>
                      <Sparkles className="mr-1 h-3 w-3" />让 agent 识别
                    </Button>
                  ) : null}
                </div>
                {isLeaderboard && leaderboardItem!.launch_spec_status ? (
                  <div className="text-xs text-muted-foreground">识别状态：{leaderboardItem!.launch_spec_status}</div>
                ) : null}
                {isLeaderboard && leaderboardItem!.launch_spec_error ? (
                  <div className="text-xs text-destructive">识别错误：{leaderboardItem!.launch_spec_error}</div>
                ) : null}
                {isLeaderboard ? (
                  <Field label="形态" hint="stdio=本地进程；remote=远程 HTTPS 服务">
                    <Select value={mcpKind} onValueChange={setMcpKind}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未确定</SelectItem>
                        <SelectItem value="stdio">stdio（本地进程）</SelectItem>
                        <SelectItem value="remote">remote（远程服务）</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {isLeaderboard ? mcpKind === "stdio" : mode === "mcp-stdio" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="命令">
                      <Input
                        value={isLeaderboard ? mcpCommand : form.resource?.command || ""}
                        onChange={(e) => (isLeaderboard ? setMcpCommand(e.target.value) : setForm({ ...form, resource: { ...form.resource, command: e.target.value } }))}
                        placeholder="npx" />
                    </Field>
                    <Field label="参数" hint="每行一个参数，按顺序传给命令">
                      <Textarea rows={3} className="font-mono text-xs"
                        value={isLeaderboard ? mcpArgs : JSON.stringify(form.resource?.args || [])}
                        onChange={(e) => (isLeaderboard
                          ? setMcpArgs(e.target.value)
                          : (() => { try { setForm({ ...form, resource: { ...form.resource, args: JSON.parse(e.target.value) } }) } catch { /* 输入未完成时不动 */ } })())}
                        placeholder={"-y\n@scope/server"} />
                    </Field>
                  </div>
                ) : null}
                {isLeaderboard ? mcpKind === "remote" : mode === "mcp-remote" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="服务地址（HTTPS）" hint="必须是 HTTPS，非 HTTPS 会被后端丢弃">
                      <Input
                        value={isLeaderboard ? mcpUrl : form.resource?.url || ""}
                        onChange={(e) => (isLeaderboard ? setMcpUrl(e.target.value) : setForm({ ...form, resource: { ...form.resource, url: e.target.value } }))}
                        placeholder="https://mcp.example.com/mcp" />
                    </Field>
                    <Field label="传输协议">
                      <Select
                        value={isLeaderboard ? mcpTransport : form.resource?.transport || "sse"}
                        onValueChange={(v) => (isLeaderboard ? setMcpTransport(v) : setForm({ ...form, resource: { ...form.resource, transport: v } }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LAUNCH_TRANSPORTS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                ) : null}
                {isLeaderboard ? <p className="text-xs text-muted-foreground">手改后保存会把状态标记为已核对（filled）。</p> : null}
              </div>
            </>
          )}

          {/* ── Skill 安装配置 ── */}
          {(isLeaderboard ? modules.includes("skill") : mode === "skill") && (
            <>
              <Separator />
              <div className="space-y-4">
                <Field label="下载方式" hint="GitHub 直连=节点 git clone；服务端镜像=预下载后离线可用">
                  <Select
                    value={isLeaderboard ? skillInstallMethod : form.install_method || "github_clone"}
                    onValueChange={(v) => (isLeaderboard ? setSkillInstallMethod(v) : setForm({ ...form, install_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="github_clone">GitHub 直连（节点 git clone）</SelectItem>
                      <SelectItem value="server_mirror">服务端镜像（预下载 + 离线可用）</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {/* 榜单 skill 从条目仓库直装，源地址即仓库（外部数据，不重复摆输入框） */}
                {!isLeaderboard ? (
                  <Field label="源地址（HTTPS）">
                    <Input
                      value={form.source_url || form.resource?.url || ""}
                      onChange={(e) => setForm({ ...form, source_url: e.target.value, resource: { ...form.resource, url: e.target.value } })}
                      placeholder="https://github.com/user/repo" />
                  </Field>
                ) : null}
                <Field label="分支/标签" hint="整仓一个 ref，所有条目共用">
                  <Input
                    value={isLeaderboard ? skillRef : form.resource?.ref || "main"}
                    onChange={(e) => (isLeaderboard ? setSkillRef(e.target.value) : setForm({ ...form, resource: { ...form.resource, ref: e.target.value } }))} />
                </Field>
                {isLeaderboard ? (
                  <Field label="可安装条目" hint="一个仓库可产出多个 skill（技能包）；按编辑器形态认：SKILL.md=claude、.cursor/rules/*.mdc=cursor、AGENTS.md=codex+opencode">
                    <div className="space-y-2">
                      {skillEntries.map((entry, idx) => (
                        <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-12">
                          <Input className="sm:col-span-3" value={entry.name}
                            onChange={(e) => setSkillEntries((prev) => prev.map((p, i) => i === idx ? { ...p, name: e.target.value } : p))}
                            placeholder="名称" />
                          <Input className="sm:col-span-4" value={entry.path}
                            onChange={(e) => setSkillEntries((prev) => prev.map((p, i) => i === idx ? { ...p, path: e.target.value } : p))}
                            placeholder="子路径（留空=根）" />
                          <Input className="sm:col-span-3" value={entry.entry}
                            onChange={(e) => setSkillEntries((prev) => prev.map((p, i) => i === idx ? { ...p, entry: e.target.value } : p))}
                            placeholder="SKILL.md" />
                          <Button size="sm" variant="ghost" className="sm:col-span-2"
                            onClick={() => setSkillEntries((prev) => prev.filter((_, i) => i !== idx))}>
                            删除
                          </Button>
                          <div className="sm:col-span-12 flex flex-wrap gap-3">
                            {["claude", "codex", "opencode", "cursor", "gemini"].map((editor) => (
                              <label key={editor} className="flex items-center gap-1.5 text-xs">
                                <input type="checkbox" checked={entry.editors.includes(editor)}
                                  onChange={(e) => setSkillEntries((prev) => prev.map((p, i) => {
                                    if (i !== idx) return p
                                    const editors = e.target.checked
                                      ? [...p.editors, editor]
                                      : p.editors.filter((x) => x !== editor)
                                    return { ...p, editors }
                                  }))} />
                                {editor}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      <Button size="sm" variant="outline"
                        onClick={() => setSkillEntries((prev) => [...prev, { name: "", path: "", entry: "SKILL.md", editors: ["claude"] }])}>
                        添加条目
                      </Button>
                    </div>
                  </Field>
                ) : (
                  <Field label="子路径（可选）" hint="仓库内子目录，留空=仓库根">
                    <Input
                      value={form.resource?.path || ""}
                      onChange={(e) => setForm({ ...form, resource: { ...form.resource, path: e.target.value } })}
                      placeholder="skills" />
                  </Field>
                )}
              </div>
            </>
          )}

          {/* ── 插件安装配置 ── */}
          {(isLeaderboard ? modules.includes("plugin") : mode === "plugin") && (
            <>
              <Separator />
              <div className="space-y-4">
                <Field label="下载地址（HTTPS）" hint={isLeaderboard ? "默认取仓库 main 分支的 zip 归档" : undefined}>
                  <Input
                    value={isLeaderboard ? pluginDownloadUrl : form.download_url || ""}
                    onChange={(e) => (isLeaderboard ? setPluginDownloadUrl(e.target.value) : setForm({ ...form, download_url: e.target.value }))}
                    placeholder="https://github.com/user/repo/archive/refs/heads/main.zip" />
                </Field>
                <Field label="目标编辑器" hint="claude / codex 等">
                  <Input
                    value={isLeaderboard ? pluginProvider : form.resource?.provider || ""}
                    onChange={(e) => (isLeaderboard ? setPluginProvider(e.target.value) : setForm({ ...form, resource: { ...form.resource, provider: e.target.value } }))}
                    placeholder="claude" />
                </Field>
              </div>
            </>
          )}

          {/* ── 提示词安装配置 ── */}
          {(isLeaderboard ? modules.includes("prompt") : mode === "prompt") && (
            <>
              <Separator />
              <div className="space-y-4">
                <Field label="提示词内容（Markdown）" hint={isLeaderboard ? "上游只有仓库元数据，正文需从仓库 README 取或手写" : undefined}>
                  <Textarea rows={10} className="font-mono text-xs"
                    value={isLeaderboard ? promptContent : form.resource?.content || ""}
                    onChange={(e) => (isLeaderboard ? setPromptContent(e.target.value) : setForm({ ...form, resource: { ...form.resource, content: e.target.value } }))} />
                </Field>
                <Field label="适用编辑器">
                  <div className="flex flex-wrap gap-4">
                    {["claude", "codex", "opencode", "cursor"].map((provider) => {
                      const active = isLeaderboard ? promptProviders.includes(provider)
                        : (Array.isArray(form.resource?.providers) ? form.resource.providers : []).includes(provider)
                      return (
                        <label key={provider} className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="checkbox" checked={active}
                            onChange={(e) => (isLeaderboard
                              ? togglePromptProvider(provider)
                              : setForm({
                                ...form,
                                resource: {
                                  ...form.resource,
                                  providers: e.target.checked
                                    ? [...(form.resource?.providers || []), provider]
                                    : (form.resource?.providers || []).filter((v: string) => v !== provider),
                                },
                              }))} />
                          {provider}
                        </label>
                      )
                    })}
                  </div>
                </Field>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "保存中..." : <><Save className="mr-1 h-4 w-4" />保存</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

