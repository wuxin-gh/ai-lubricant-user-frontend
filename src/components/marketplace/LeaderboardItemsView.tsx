/**
 * 榜单条目视图：草稿与已发布在一个列表里，用「状态」筛选切换，不拆两个 tab。
 *
 * 筛选轴：
 * - 榜单（board）= 上游哪个榜抓来的（同步时按它预填默认分类）
 * - 状态（status）= 草稿 / 已发布 / 全部
 * - 仅浏览（installable=false）= 资源中心不给下载入口，但发布后照样给用户看
 *
 * 编辑与发布是两段：编辑弹框只落表（不碰状态）；「发布」= 入推送队列
 * （module=leaderboard，复用市场发布 outbox），worker 校验门禁后翻 published，
 * 本视图轮询队列给条目叠加「推送中/推送失败」徽标，失败可一键重新推送。
 *
 * 删除（卡片单条 / 工具栏批量）共用一个确认框：服务端硬删行 + 连带清掉这些条目
 * pending/pushing 的孤儿推送 job。
 *
 * 编辑走与市场资源同一个弹框（``MarketplaceEditDialog`` 榜单变体）：分类单选、
 * 身份与安装参数由上游预填。卡片顶部一行放状态（已发布/草稿/仅浏览）+ 来源 + 分类；
 * 按资源类型展示安装要点（skill/prompt/plugin=支持客户端，mcp=启动方式）。
 * 启动方式的确定性探测在同步时由探针完成（attach_probe），agent 识别路径
 * （单条/批量）已随专用 agent 配置一并移除；MCP 验证仍走确定性 HEAD/握手（verify_item）。
 */
import { useCallback, useEffect, useState } from "react"
import { ArrowUpDown, CloudOff, CloudUpload, Download, ExternalLink, Info, Pencil, Plus, ScanSearch, ShieldCheck, Star, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createLeaderboardItem,
  deleteLeaderboardItems,
  downloadLeaderboardItem,
  fetchLeaderboardItems,
  getMarketplacePublishJobs,
  publishLeaderboardItems,
  reprobeLeaderboardItem,
  unpublishLeaderboardItems,
  updateLeaderboardItem,
  verifyLeaderboardItem,
  type LeaderboardItem,
  type MarketplacePublishJobs,
} from "@/api/marketplaceAdmin"
import {
  ALL_BOARDS, ALL_MODULES, BOARD_LABELS, EDITOR_LABELS, MODULE_LABELS,
  SOURCE_LABELS, normalizeModules, normalizeSkillInstallSpec,
} from "./leaderboard-labels"
import { MarketplaceEditDialog, type LeaderboardCurationPatch } from "./MarketplaceEditDialog"
import { LeaderboardItemInfo } from "./LeaderboardItemInfo"
import { toast } from "sonner"

/** 条目的分类：兼容旧数据/旧后端（JSON 字符串、单值列）由 normalizeModules 收口。 */
function modulesOf(item: LeaderboardItem): string[] {
  return normalizeModules(item.target_modules, item.target_module)
}

/* ── 卡片徽章配色：软色底 + 深色字（浅色/深色主题都可读），hover 提亮 ──────────
 * 资源类型：MCP=紫、Skill=青、技能集=青绿、提示词=琥珀、插件=玫红；来源：每个源一个固定色相，
 * 一眼区分来源；语言：通用灰蓝底。都是软色，不抢状态徽章（已发布=主色实底）的视觉。
 * 市场单页（ResourceMarketBoard）复用同一套，保证两处卡片视觉一致。 */
export const MODULE_BADGE_CLASS: Record<string, string> = {
  mcp: "bg-violet-500/12 text-violet-600 dark:text-violet-400 border-violet-500/25",
  skill: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300 border-cyan-500/25",
  skills: "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25",
  prompt: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25",
  plugin: "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25",
}

export const SOURCE_BADGE_CLASS: Record<string, string> = {
  "agent-leaderboard": "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  "agency-agents": "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25",
  "agency-agents-zh": "bg-lime-500/12 text-lime-700 dark:text-lime-300 border-lime-500/25",
  agentscope: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/25",
  manual: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25",
}

/** 客户端徽章：五编辑器各一个色相，与来源/类型不撞。 */
const CLIENT_BADGE_CLASS: Record<string, string> = {
  claude: "bg-orange-500/12 text-orange-600 dark:text-orange-400 border-orange-500/25",
  codex: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 border-indigo-500/25",
  opencode: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  cursor: "bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/25",
  gemini: "bg-purple-500/12 text-purple-600 dark:text-purple-400 border-purple-500/25",
}

/** 语言色点（GitHub Linguist 同款色）：认识的给色点，不认识的给灰点。 */
export const LANG_DOT: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Dart: "#00B4AB",
  Lua: "#000080",
  Zig: "#ec915c",
  Scala: "#c22d40",
  Perl: "#0298c3",
  "Jupyter Notebook": "#DA5B0B",
  MDX: "#fcb32c",
  Dockerfile: "#384d54",
}

/** install_spec 当成 dict 读（JSONB 在旧进程上可能返回字符串）。 */
function specDict(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return {} }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** MCP launch_spec 摘要：stdio→命令+包名，remote→协议+主机。 */
function launchSpecSummary(spec: unknown): string {
  const s = specDict(spec)
  const kind = String(s.kind || "")
  if (kind === "stdio") {
    const cmd = String(s.command || "").trim()
    const args = Array.isArray(s.args) ? (s.args as unknown[]).map(String) : []
    const pkg = args.find((a) => a && !a.startsWith("-")) || ""
    return pkg ? `stdio · ${cmd} ${pkg}`.trim() : (cmd ? `stdio · ${cmd}` : "stdio")
  }
  if (kind === "remote") {
    const transport = String(s.transport || "sse")
    const url = String(s.url || "")
    let host = ""
    try { host = url ? new URL(url).host : "" } catch { /* 非法 url 只显示协议 */ }
    return host ? `remote · ${transport} · ${host}` : `remote · ${transport}`
  }
  return ""
}

/** skill 支持的客户端：所有 entries.editors 并集保序去重。 */
function skillEditors(item: LeaderboardItem): string[] {
  const spec = normalizeSkillInstallSpec(item.install_spec)
  const out: string[] = []
  for (const e of spec.entries) {
    for (const ed of e.editors) {
      if (ed && !out.includes(ed)) out.push(ed)
    }
  }
  return out
}

/** prompt 支持的客户端：install_spec.prompt.providers。 */
function promptProviders(item: LeaderboardItem): string[] {
  const prompt = specDict(item.install_spec).prompt
  const providers = (prompt && typeof prompt === "object" ? (prompt as Record<string, unknown>).providers : null)
  return Array.isArray(providers) ? providers.map(String).filter(Boolean) : []
}

/** plugin 支持的客户端：install_spec.plugin.provider（claude 等）。 */
function pluginProvider(item: LeaderboardItem): string {
  const plugin = specDict(item.install_spec).plugin
  return plugin && typeof plugin === "object" ? String((plugin as Record<string, unknown>).provider || "") : ""
}

type StatusFilter = "draft" | "published" | "all"
/** 仅浏览筛选：全部 / 只看仅浏览 / 只看可安装。 */
type BrowseFilter = "all" | "browse" | "installable"

/** 技术栈 tag 快捷筛选项（stack_tags 投影里的常用值；探针识别会覆盖更多）。 */
export const STACK_TAG_FILTERS = [
  "python", "typescript", "javascript", "go", "rust", "java",
  "web_frontend", "web_backend", "cli", "containerized", "mobile_app",
] as const

export function LeaderboardItemsView({
  onCountsChange,
}: {
  onCountsChange?: (counts: { draft: number; published: number }) => void
}) {
  const [items, setItems] = useState<LeaderboardItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [detail, setDetail] = useState<LeaderboardItem | null>(null)
  // 仓库信息（只读）单独一个弹窗，和编辑分开——看信息是决定要不要发，编辑是改好再发。
  const [infoItem, setInfoItem] = useState<LeaderboardItem | null>(null)
  // 手动添加 GitHub 项目
  const [addOpen, setAddOpen] = useState(false)
  const [addRepo, setAddRepo] = useState("")
  const [adding, setAdding] = useState(false)
  const [batchRecognizing, setBatchRecognizing] = useState(false)
  const [batchRecognizeProgress, setBatchRecognizeProgress] = useState({ done: 0, total: 0 })
  // 排序（资源中心索引）单独管理，不混进资源编辑弹框
  const [sortItem, setSortItem] = useState<LeaderboardItem | null>(null)
  const [sortValue, setSortValue] = useState("")
  const [sortSaving, setSortSaving] = useState(false)

  const [board, setBoard] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("draft")
  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>("all")
  const [moduleFilter, setModuleFilter] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [stackTag, setStackTag] = useState("all")
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchLeaderboardItems({
        status: statusFilter === "all" ? undefined : statusFilter,
        board: board === "all" ? undefined : board,
        source: sourceFilter === "all" ? undefined : sourceFilter,
        installable: browseFilter === "all" ? undefined : browseFilter === "installable",
        target_module: moduleFilter === "all" ? undefined : (moduleFilter as never),
        stack_tag: stackTag === "all" ? undefined : stackTag,
        q: query.trim() || undefined,
        limit: 200,
      })
      setItems(list.items || [])
      setTotal(list.total || 0)
      onCountsChange?.({ draft: list.draft_count || 0, published: list.published_count || 0 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "榜单加载失败")
    } finally {
      setLoading(false)
    }
  }, [board, statusFilter, browseFilter, moduleFilter, sourceFilter, stackTag, query, onCountsChange])

  useEffect(() => { void load() }, [load])

  // 筛选变了旧勾选已不在列表里，留着会导致「发布 3 项」发布了看不见的条目。
  useEffect(() => { setSelected(new Set()) }, [board, statusFilter, browseFilter, moduleFilter, sourceFilter, stackTag, query])

  const handleAddRepo = async () => {
    const repo = addRepo.trim()
    if (!repo) return
    setAdding(true)
    try {
      const created = await createLeaderboardItem(repo)
      toast.success("已添加为草稿，补好分类后再发布")
      setAddOpen(false)
      setAddRepo("")
      await load()
      setDetail(created) // 直接打开编辑弹框补分类
    } catch (err) {
      // 409：仓库已存在——后端把既有 id 放在 detail.existing_id
      const msg = err instanceof Error ? err.message : "添加失败"
      toast.error(msg)
    } finally {
      setAdding(false)
    }
  }

  const withBusy = useCallback(async (id: number, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await fn()
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = items.length > 0 && selected.size === items.length

  const handlePublish = async (ids: number[]) => {
    if (ids.length === 0) return
    try {
      // 发布=入队推送（202 立即返回）：worker 校验门禁后翻 published，失败进发布队列。
      const result = await publishLeaderboardItems(ids)
      const parts = [`已提交推送 ${result.queued.length} 项`]
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} 项已是发布态`)
      toast.success(parts.join("；"), {
        description: result.detail || "推送队列处理中，校验不过的条目会在条目卡片标红并说明原因",
      })
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交推送失败")
    }
  }

  /**
   * 批量识别：对选中条目逐个重跑 GitHub 探针并重派生分类/安装/启动配置。
   *
   * 复用单条「重新识别」端点（POST /items/{id}/reprobe），串行执行：
   *  - 逐条推进，按钮文本实时显示 X/N，跑完汇总成功/失败；
   *  - 单条失败（识别证据不足、仓库不可达、限流）catch 住继续下一条，不中断整批；
   *  - 识别语义与编辑弹框「重新识别」一致：重派生 install_spec/launch_spec/
   *    target_modules，管理员手改的 name/description/排序不动；不改状态，识别完
   *    仍是草稿，勾选保留方便接着批量发布。
   */
  const handleBatchRecognize = async (ids: number[]) => {
    if (ids.length === 0 || batchRecognizing) return
    const failures: string[] = []
    setBatchRecognizing(true)
    setBatchRecognizeProgress({ done: 0, total: ids.length })
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        try {
          await reprobeLeaderboardItem(id)
        } catch (err) {
          const name = items.find((it) => it.id === id)?.repo_full_name || `#${id}`
          failures.push(`${name}：${err instanceof Error ? err.message : "识别失败"}`)
        }
        setBatchRecognizeProgress({ done: i + 1, total: ids.length })
      }
      if (failures.length === 0) {
        toast.success(`批量识别完成：${ids.length} 项全部成功`)
      } else {
        toast.warning(`批量识别完成：成功 ${ids.length - failures.length} 项、失败 ${failures.length} 项`, {
          description: failures.join("；"),
        })
      }
      await load()
    } finally {
      setBatchRecognizing(false)
      setBatchRecognizeProgress({ done: 0, total: 0 })
    }
  }

  const handleUnpublish = async (ids: number[]) => {
    if (ids.length === 0) return
    try {
      const result = await unpublishLeaderboardItems(ids)
      toast.success(`已撤回 ${result.count} 项，用户侧立即不可见`)
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "撤回失败")
    }
  }

  // 删除（单条/批量共用一个确认框）：破坏性操作，先弹确认框，确认后才真删。
  // deleteItem 为空 = 批量（删当前勾选）；否则删单条（勾选不用先清，卡片上直接发起）。
  const [deleteItem, setDeleteItem] = useState<LeaderboardItem | null>(null)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const deleteTargets = deleteItem ? [deleteItem.id] : [...selected]
  const handleBatchDelete = async () => {
    if (deleteTargets.length === 0) return
    setBatchDeleting(true)
    try {
      const result = await deleteLeaderboardItems(deleteTargets)
      toast.success(`已删除 ${result.count} 项（含已发布条目，用户侧立即不可见）`)
      setBatchDeleteOpen(false)
      setDeleteItem(null)
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleVerify = (item: LeaderboardItem) =>
    void withBusy(item.id, async () => {
      try {
        const result = await verifyLeaderboardItem(item.id)
        if (result.launch?.status === "verified") {
          toast.success("验证通过：启动方式可连")
        } else if (result.launch?.status === "failed") {
          toast.warning("验证失败", { description: result.launch.error || "详见条目徽标" })
        } else {
          toast.info("无启动方式可验证（kind=none）")
        }
        await load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "验证失败")
      }
    })

  // 下载安装数据（实测下载地址是否有效）：后端代理拉上游 zip/prompt 正文回传。
  const handleDownload = (item: LeaderboardItem) =>
    void withBusy(item.id, async () => {
      try {
        const { blob, filename } = await downloadLeaderboardItem(item.id)
        const url = URL.createObjectURL(blob)
        try {
          const a = document.createElement("a")
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "下载失败")
      }
    })

  // ── 推送队列观测：发布已改为入队异步执行，这里轮询 module=leaderboard 的 jobs，
  //    按条目叠加「推送中 / 推送失败」徽标；计数归零时刷新列表把新状态拉回来。 ──
  const [pushJobs, setPushJobs] = useState<MarketplacePublishJobs | null>(null)
  const pendingPush = pushJobs ? pushJobs.counts.pending + pushJobs.counts.pushing : 0
  const failedPush = pushJobs ? pushJobs.counts.failed : 0

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const jobs = await getMarketplacePublishJobs("leaderboard")
        if (cancelled) return
        const before = pushJobs ? pushJobs.counts.pending + pushJobs.counts.pushing : 0
        setPushJobs(jobs)
        // 有 job 落定（pending→done）就刷新一次列表，让已发布状态及时显出来。
        if (before > 0 && jobs.counts.pending + jobs.counts.pushing === 0) await load()
      } catch { /* 面板性数据，失败静默等下一轮 */ }
    }
    void tick()
    if (pendingPush > 0) {
      const timer = setInterval(() => { void tick() }, 4000)
      return () => { cancelled = true; clearInterval(timer) }
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPush, failedPush])

  /** 条目 id → 推送中/失败信息（发布队列 module=leaderboard 的 pending/pushing/failed 汇总）。 */
  const pushStateByItem = (() => {
    const map = new Map<number, { state: "pending" | "failed"; error: string; attempts: number }>()
    if (!pushJobs) return map
    for (const job of [...pushJobs.pending, ...pushJobs.pushing]) {
      const id = Number(job.item_id)
      if (Number.isFinite(id)) map.set(id, { state: "pending", error: "", attempts: job.attempts })
    }
    for (const job of pushJobs.failed) {
      const id = Number(job.item_id)
      if (Number.isFinite(id)) map.set(id, { state: "failed", error: job.last_error, attempts: job.attempts })
    }
    return map
  })()

  const handleRetryPush = async (item: LeaderboardItem) =>
    void withBusy(item.id, async () => {
      try {
        await publishLeaderboardItems([item.id])
        toast.success("已重新提交推送")
        await load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "重新提交失败")
      }
    })

  const handleSaveDetail = async (patch: LeaderboardCurationPatch) => {
    if (!detail) return
    await updateLeaderboardItem(detail.id, patch)
    await load()
  }

  const handleEditSort = (item: LeaderboardItem) => {
    setSortItem(item)
    const value = item.sort_order ?? item.display_rank
    setSortValue(value != null ? String(value) : "")
  }

  const handleSaveSort = async () => {
    if (!sortItem) return
    let value: number | null = null
    if (sortValue.trim()) {
      const parsed = Number(sortValue.trim())
      if (!Number.isInteger(parsed) || parsed < 0) {
        toast.error("排序需为非负整数；留空则排最后按热度")
        return
      }
      value = parsed
    }
    setSortSaving(true)
    try {
      await updateLeaderboardItem(sortItem.id, { sort_order: value })
      toast.success("排序已保存")
      setSortItem(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "排序保存失败")
    } finally {
      setSortSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 榜单 tabs：一个榜就是一类，直接绑定，不再有「全部类型」那一层 */}
      <Tabs value={board} onValueChange={setBoard}>
        <TabsList>
          <TabsTrigger value="all">全部榜单</TabsTrigger>
          {ALL_BOARDS.map((b) => (
            <TabsTrigger key={b} value={b}>{BOARD_LABELS[b] || b}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 筛选 + 批量操作同一行 */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-9 w-32 text-sm"
        >
          <NativeSelectOption value="draft">草稿</NativeSelectOption>
          <NativeSelectOption value="published">已发布</NativeSelectOption>
          <NativeSelectOption value="all">全部状态</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={browseFilter}
          onChange={(e) => setBrowseFilter(e.target.value as BrowseFilter)}
          className="h-9 w-36 text-sm"
        >
          <NativeSelectOption value="all">全部条目</NativeSelectOption>
          <NativeSelectOption value="browse">仅浏览</NativeSelectOption>
          <NativeSelectOption value="installable">可安装</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="h-9 w-32 text-sm"
        >
          <NativeSelectOption value="all">全部分类</NativeSelectOption>
          {ALL_MODULES.map((m) => (
            <NativeSelectOption key={m} value={m}>{MODULE_LABELS[m]}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-9 w-36 text-sm"
        >
          <NativeSelectOption value="all">全部来源</NativeSelectOption>
          <NativeSelectOption value="agent-leaderboard">Agent-Leaderboard</NativeSelectOption>
          <NativeSelectOption value="agency-agents">agency-agents</NativeSelectOption>
          <NativeSelectOption value="agency-agents-zh">agency-agents-zh</NativeSelectOption>
          <NativeSelectOption value="agentscope">agentscope</NativeSelectOption>
          <NativeSelectOption value="skillhub">SkillHub</NativeSelectOption>
          <NativeSelectOption value="manual">手动添加</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={stackTag}
          onChange={(e) => setStackTag(e.target.value)}
          className="h-9 w-32 text-sm"
          title="技术栈 tag（探针识别 stack_tags 命中即算）"
        >
          <NativeSelectOption value="all">全部技术栈</NativeSelectOption>
          {STACK_TAG_FILTERS.map((tag) => (
            <NativeSelectOption key={tag} value={tag}>{tag}</NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          placeholder="搜索仓库/描述..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-44"
        />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={selected.size === 0 || batchRecognizing} onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />手动添加
          </Button>
          <Button size="sm" disabled={selected.size === 0 || batchRecognizing} onClick={() => void handlePublish([...selected])}>
            批量发布（{selected.size}）
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selected.size === 0 || batchRecognizing}
            title="对选中条目逐个重跑 GitHub 识别探针，按探测结果重置分类与安装/启动配置（名称、描述等管理员编辑过的字段不动；串行执行，单条失败不中断整批）"
            onClick={() => void handleBatchRecognize([...selected])}
          >
            {batchRecognizing
              ? `识别中 ${batchRecognizeProgress.done}/${batchRecognizeProgress.total}`
              : <><ScanSearch className="mr-1 h-3.5 w-3.5" />批量识别（{selected.size}）</>}
          </Button>
          <Button size="sm" variant="outline" disabled={selected.size === 0 || batchRecognizing} onClick={() => void handleUnpublish([...selected])}>
            批量撤回（{selected.size}）
          </Button>
          <Button size="sm" variant="destructive" disabled={selected.size === 0 || batchRecognizing} onClick={() => { setDeleteItem(null); setBatchDeleteOpen(true) }}>
            批量删除（{selected.size}）
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
          />
          <span className="text-sm text-muted-foreground">
            {selected.size > 0 ? `已选 ${selected.size} 项` : `本页 ${items.length} 项（共 ${total}）`}
          </span>
        </div>
      )}

      {loading && <Spinner />}
      {!loading && items.length === 0 && (
        <Empty>
          <div className="text-base font-medium">没有符合筛选的条目</div>
          <div className="text-sm text-muted-foreground">到「配置」tab 点「立即同步」从外部榜单拉一批，或放宽筛选条件</div>
        </Empty>
      )}

      {!loading && items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const busy = busyIds.has(item.id)
            const browseOnly = !item.installable
            const published = item.status === "published"
            const modules = modulesOf(item)
            // 第二排「支持的客户端」：skill/prompt/plugin 从 install_spec 收支持的编辑器并集
            const clientTypes = (() => {
              const out: string[] = []
              if (modules.includes("skill")) for (const e of skillEditors(item)) if (!out.includes(e)) out.push(e)
              if (modules.includes("prompt")) for (const p of promptProviders(item)) if (!out.includes(p)) out.push(p)
              if (modules.includes("plugin")) {
                const pp = pluginProvider(item)
                if (pp && !out.includes(pp)) out.push(pp)
              }
              return out
            })()
            // MCP 的对应信息是启动方式（server 没有「客户端」概念，#5 口径）
            const launchSummary = modules.includes("mcp") ? launchSpecSummary(item.launch_spec) : ""
            return (
              <Card key={item.id} className={`pt-3 pb-1.5 ${busy ? "opacity-60" : ""}`}>
                <CardContent className="flex h-full flex-col gap-2.5 px-4">
                  {/* 第一排：标题（=仓库名，点击跳 GitHub）+ 右侧点赞数（star 数，没有就不显示） */}
                  <div className="flex items-start gap-2">
                    <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.repo_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 font-semibold hover:underline"
                        aria-label={`在 GitHub 打开 ${item.repo_full_name}`}
                      >
                        <span className="truncate">{item.repo_full_name}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    </div>
                    {item.stars > 0 ? (
                      <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${item.stars.toLocaleString()} stars`}>
                        <Star className="h-3.5 w-3.5" />{item.stars.toLocaleString()}
                      </span>
                    ) : null}
                  </div>

                  {/* 第二排：标签行——状态、来源、资源类型、启动方式、支持的客户端（各自配色） */}
                  <div className="flex flex-wrap items-center gap-1">
                    {browseOnly ? (
                      <Badge variant="outline" className="border-zinc-500/25 bg-zinc-500/12 text-[10px] text-zinc-600 dark:text-zinc-400">仅浏览</Badge>
                    ) : published ? (
                      <Badge className="text-[10px]">已发布</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/25 bg-amber-500/12 text-[10px] text-amber-700 dark:text-amber-300">草稿</Badge>
                    )}
                    {item.source ? (
                      <Badge variant="outline" className={`text-[10px] ${SOURCE_BADGE_CLASS[item.source] || "text-muted-foreground"}`}>
                        {SOURCE_LABELS[item.source] || item.source}
                      </Badge>
                    ) : null}
                    {modules.map((m) => (
                      <Badge key={m} variant="outline" className={`text-[10px] ${MODULE_BADGE_CLASS[m] || ""}`}>{MODULE_LABELS[m]}</Badge>
                    ))}
                    {launchSummary ? (
                      <Badge variant="outline" className="max-w-52 truncate border-slate-500/25 bg-slate-500/12 text-[10px] text-slate-600 dark:text-slate-300" title={`启动方式：${launchSummary}`}>
                        {launchSummary}
                      </Badge>
                    ) : null}
                    {item.launch_spec_status === "verified" ? (
                      <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/12 text-[10px] text-emerald-700 dark:text-emerald-300">已验证</Badge>
                    ) : null}
                    {item.launch_spec_status === "failed" ? (
                      <Badge variant="outline" className="border-red-500/25 bg-red-500/12 text-[10px] text-red-600 dark:text-red-400">验证失败</Badge>
                    ) : null}
                    {/* 推送状态：发布已入队未落定 → 推送中；worker 门禁没过 → 推送失败（tooltip 带原因） */}
                    {pushStateByItem.get(item.id)?.state === "pending" ? (
                      <Badge variant="outline" className="border-sky-500/25 bg-sky-500/12 text-[10px] text-sky-700 dark:text-sky-300">
                        <CloudUpload className="mr-0.5 h-3 w-3" />推送中
                      </Badge>
                    ) : null}
                    {pushStateByItem.get(item.id)?.state === "failed" ? (
                      <Badge
                        variant="outline"
                        className="border-red-500/25 bg-red-500/12 text-[10px] text-red-600 dark:text-red-400"
                        title={`推送失败（已重试 ${pushStateByItem.get(item.id)?.attempts ?? 0} 次）：${pushStateByItem.get(item.id)?.error || "详见发布队列"}`}
                      >
                        <CloudOff className="mr-0.5 h-3 w-3" />推送失败
                      </Badge>
                    ) : null}
                    {clientTypes.map((c) => (
                      <Badge key={c} variant="outline" className={`text-[10px] ${CLIENT_BADGE_CLASS[c] || "text-muted-foreground"}`} title={`支持的客户端：${EDITOR_LABELS[c] || c}`}>
                        {EDITOR_LABELS[c] || c}
                      </Badge>
                    ))}
                  </div>

                  {/* 第三排：描述区——高度固定（4 行 = 80px），文字铺满这个区域：
                      不足 4 行留白、超过 4 行截断，悬停 title 看全文 */}
                  <div
                    className="h-[80px] overflow-hidden text-sm leading-5 text-muted-foreground"
                    title={item.description || undefined}
                  >
                    {item.description ? (
                      <div className="line-clamp-4">{item.description}</div>
                    ) : null}
                  </div>

                  {/* 第四排：语言（GitHub 同款色点），没有就显示占位横杠，钉在卡片底部 */}
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                    {item.language ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: LANG_DOT[item.language] || "#94a3b8" }}
                        />
                        {item.language}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">-</span>
                    )}
                  </div>

                  {/* 第五排：按钮区域（与第四排之间用横杠隔开，紧贴卡片下边框） */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2 pb-0.5">
                    <button
                      type="button"
                      title={item.sort_order != null ? `排序 #${item.sort_order}（点击修改，资源中心索引）` : "设置排序（资源中心索引）"}
                      onClick={() => void handleEditSort(item)}
                      className="inline-flex items-center rounded px-1.5 py-1.5 text-muted-foreground hover:bg-muted"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setInfoItem(item)}>
                      <Info className="mr-1 h-3 w-3" />信息
                    </Button>

                    {/* 下载安装数据：实测该条目的下载地址（后端代理上游 zip / prompt 正文） */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      title="下载该条目的安装数据，实测下载地址是否有效（zip / 提示词正文；仅浏览类无下载数据会提示）"
                      onClick={() => handleDownload(item)}
                    >
                      <Download className="h-3 w-3" />下载
                    </Button>

                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setDetail(item)}>
                      <Pencil className="mr-1 h-3 w-3" />编辑
                    </Button>

                    {modules.includes("mcp") && ["filled", "failed", "verified"].includes(item.launch_spec_status) ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleVerify(item)}>
                        <ShieldCheck className="mr-1 h-3 w-3" />验证
                      </Button>
                    ) : null}

                    {pushStateByItem.get(item.id)?.state === "failed" ? (
                      /* 推送失败重提：worker 退避重试达上限后条目停在草稿，这里一键重新入队 */
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRetryPush(item)}>
                        <CloudUpload className="mr-1 h-3 w-3" />重新推送
                      </Button>
                    ) : null}

                    {published ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleUnpublish([item.id])}>撤回</Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => void handlePublish([item.id])}>发布</Button>
                    )}

                    {/* 删除（单条）：破坏性操作走同一个确认框（deleteItem 区分单条/批量） */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      title="从候选池删除（不可恢复，含已发布行；上游再同步会拉回草稿）"
                      onClick={() => { setDeleteItem(item); setBatchDeleteOpen(true) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <LeaderboardItemInfo
        item={infoItem}
        onClose={() => setInfoItem(null)}
        onEdit={(it) => setDetail(it)}
      />

      {/* 编辑走与市场资源同一个弹框（榜单变体：分类单选 + 上游预填 + 逐项同步 + 重新识别） */}
      <MarketplaceEditDialog
        open={!!detail}
        onOpenChange={(v) => { if (!v) setDetail(null) }}
        mode="skill"
        item={null}
        onSave={async () => { /* 榜单变体不走这里 */ }}
        leaderboardItem={detail}
        onLeaderboardSave={handleSaveDetail}
        onReprobe={async (type) => {
          if (!detail) return null
          const updated = await reprobeLeaderboardItem(detail.id, type)
          await load()
          setDetail(updated)
          return updated
        }}
      />

      {/* 排序（资源中心索引）小弹框 */}
      <Dialog open={!!sortItem} onOpenChange={(v) => { if (!v && !sortSaving) setSortItem(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置排序</DialogTitle>
            <p className="text-xs text-muted-foreground">
              数字越小越靠前，作为资源中心索引；留空=排最后按热度。
            </p>
          </DialogHeader>
          <Input
            type="number"
            min={0}
            value={sortValue}
            onChange={(e) => setSortValue(e.target.value)}
            placeholder={sortItem?.sort_order != null ? `当前 #${sortItem.sort_order}` : "未设置（按热度）"}
            disabled={sortSaving}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSortItem(null)} disabled={sortSaving}>取消</Button>
            <Button onClick={() => void handleSaveSort()} disabled={sortSaving}>
              {sortSaving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动添加 GitHub 项目为草稿 */}
      <Dialog open={addOpen} onOpenChange={(v) => { if (!adding) setAddOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>手动添加 GitHub 项目</DialogTitle>
            <p className="text-xs text-muted-foreground">
              填 owner/repo 或完整仓库地址。系统会读取仓库元数据、预填默认分类和安装参数，生成一条草稿。
            </p>
          </DialogHeader>
          <Input
            value={addRepo}
            onChange={(e) => setAddRepo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddRepo() }}
            placeholder="owner/repo 或 https://github.com/owner/repo"
            disabled={adding}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>取消</Button>
            <Button onClick={() => void handleAddRepo()} disabled={adding || !addRepo.trim()}>
              {adding ? "读取仓库中..." : "添加为草稿"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认——破坏性操作，硬删候选池行（含已发布），不可恢复。deleteItem 非空=单条，否则=批量 */}
      <Dialog open={batchDeleteOpen} onOpenChange={(v) => { if (!batchDeleting) { setBatchDeleteOpen(v); if (!v) setDeleteItem(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteItem ? `删除「${deleteItem.repo_full_name}」？` : `批量删除 ${selected.size} 项？`}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {deleteItem
                ? deleteItem.status === "published"
                  ? "该条目已发布——删除后用户侧市场立即不可见。"
                  : "该条目是草稿，仅管理端可见。"
                : `从候选池硬删除选中条目（含已发布行，用户侧市场立即不可见）。`}
              {" "}此操作不可恢复——上游榜单再次同步时同名仓库会重新作为草稿拉回。
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setBatchDeleteOpen(false); setDeleteItem(null) }} disabled={batchDeleting}>取消</Button>
            <Button variant="destructive" onClick={() => void handleBatchDelete()} disabled={batchDeleting}>
              {batchDeleting ? "删除中..." : `确认删除（${deleteTargets.length}）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

