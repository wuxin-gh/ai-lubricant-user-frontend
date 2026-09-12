/**
 * 资源中心「市场」单页（榜单风格）。
 *
 * 取代原「市场」下 MCP / Skill / 插件 / 项目提示词 四个子 tab：一个页面、顶部分类
 * Tabs（全部 / MCP / Skill / 技能集 / 插件 / 项目提示词）、下方来源 / 技术栈 / 搜索筛选条，
 * 统一榜单风格卡片网格（对齐 LeaderboardItemsView）。
 *
 * 两个数据源混在同一网格：
 * - 市场（marketplace 仓库 index.json，MarketItem）——我们维护的 manifest，有版本/发布者
 * - 榜单（已发布的外部榜单条目，LeaderboardDiscoverItem）——GitHub 仓库，有 star/语言/技术栈
 *
 * 按钮按类型与侧别适配：
 * - 市场 MCP：下载（管理侧 createMcpService / 用户侧 createMyMcpService 仅远程），已下载置灰
 * - 市场 Skill/插件（管理侧）：引用 / 取消引用 + 镜像 / 刷新镜像；用户侧只查看
 * - 市场 提示词（管理侧）：引用 / 取消引用
 * - 榜单 Skill/技能集/插件：安装（URL 导入），已安装置灰；技能集卡片可展开子技能列表
 * - 榜单：引用 / 取消引用（条目即资源池 published 行，按 resource_id 直引，两侧可用）
 * - 榜单 MCP：用户侧保留原「个人远程 MCP 安装」入口；仓库入口统一在标题链接
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ExternalLink, GitFork, RefreshCw, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { StackBadges } from "@/components/ui/stack-badges"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  fetchMarketIndex,
  fetchMarketManifest,
  invalidateMarketCache,
  manifestToMcpService,
  manifestToPluginSpec,
  manifestToSkillSpec,
  useMarketplaceEnabled,
  type LeaderboardDiscoverItem,
  type MarketItem,
  type MarketManifest,
  type MarketModule,
} from "@/api/marketplaceRaw"
import { createMcpService, listMcpServices } from "@/@admin-port/api/mcp"
import { createMyMcpService, listMyMcpServices } from "@/api/mcpClient"
import {
  createMirror,
  deleteMirror,
  formatSize,
  getMirrorSpec,
  listMirrors,
  mirrorRequestFromManifest,
  mirrorStatusLabel,
  refreshMirror,
  type MirrorModule,
  type ResourceMirror,
} from "@/api/resourceMirrors"
import {
  createResourceReference,
  createReferenceFromResource,
  deleteResourceReference,
  deleteReferenceV2,
  listResourceReferences,
  listReferencesV2,
  type ResourceReference,
  type ResourceReferenceV2,
  type ResourceModule,
} from "@/api/resourceReferences"
import { fetchPluginListing, fetchSkillListing, importPluginUrl, importSkillUrl } from "@/lib/agent-resources-api"
import { useLeaderboardMarket, MarketPager, MARKET_PAGE_SIZE } from "@/components/marketplace/LeaderboardMarketCards"
import {
  LANG_DOT,
  MODULE_BADGE_CLASS,
  SOURCE_BADGE_CLASS,
  STACK_TAG_FILTERS,
} from "@/components/marketplace/LeaderboardItemsView"
import {
  MODULE_LABELS,
  SOURCE_LABELS,
  normalizeModules,
  normalizeSkillInstallSpec,
  type SkillEntry,
} from "@/components/marketplace/leaderboard-labels"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"

type Category = "all" | "mcp" | "skills" | "collections" | "plugins" | "prompts"

/** 市场列表排序键：默认（服务端热度序）/ 点赞数 / 更新时间。 */
type SortKey = "default" | "stars" | "updated"

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "default", label: "默认排序" },
  { value: "stars", label: "按点赞数" },
  { value: "updated", label: "按更新时间" },
]

const CATEGORY_TABS: { value: Category; label: string; modules: MarketModule[] }[] = [
  { value: "all", label: "全部", modules: ["mcp", "skills", "plugins", "prompts"] },
  { value: "mcp", label: "MCP", modules: ["mcp"] },
  { value: "skills", label: "Skill", modules: ["skills"] },
  { value: "collections", label: "技能集", modules: ["skills"] },
  { value: "plugins", label: "插件", modules: ["plugins"] },
  { value: "prompts", label: "项目提示词", modules: ["prompts"] },
]

/** 市场 module 名 -> 榜单 singular 分类名（徽章配色 / 榜单 hook 都按 singular 键）。 */
const MARKET_TO_TARGET: Record<string, "mcp" | "skill" | "plugin" | "prompt"> = {
  mcp: "mcp",
  skills: "skill",
  plugins: "plugin",
  prompts: "prompt",
}

/** 市场来源徽章（榜单条目用 SOURCE_BADGE_CLASS，市场条目用这个绿色相）。 */
const MARKET_BADGE_CLASS = "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"

/** 卡片渲染条目：把两种数据源投影到同一形态，避免两套分支。 */
type Row =
  | { kind: "market"; module: MarketModule; item: MarketItem }
  | { kind: "board"; module: MarketModule; item: LeaderboardDiscoverItem }

export function ResourceMarketBoard({ userMode = false }: { userMode?: boolean }) {
  const [category, setCategory] = useState<Category>("all")
  const [sourceFilter, setSourceFilter] = useState<"all" | "market" | "board">("all")
  const [stackTag, setStackTag] = useState("all")
  const [query, setQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortKey>("default")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [marketByModule, setMarketByModule] = useState<Partial<Record<MarketModule, MarketItem[]>>>({})
  const [detail, setDetail] = useState<{ module: MarketModule; manifest: MarketManifest | null } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 状态源：已下载 MCP 名 / 已引用 / 镜像 / 本地 skill·插件键
  const [mcpNames, setMcpNames] = useState<Set<string>>(new Set())
  const [references, setReferences] = useState<ResourceReference[]>([])
  const [v2References, setV2References] = useState<ResourceReferenceV2[]>([])
  const [mirrors, setMirrors] = useState<ResourceMirror[]>([])
  const [localKeys, setLocalKeys] = useState<Set<string>>(new Set())
  // 榜单技能集卡片子技能展开态（按条目 id）。
  const [expandedSkills, setExpandedSkills] = useState<Set<number>>(new Set())
  // 技能集安装选择弹框：安装前勾选子技能（整包 zip 按 entry 逐个导入）。
  const [installPick, setInstallPick] = useState<{ item: LeaderboardDiscoverItem; url: string; entries: SkillEntry[] } | null>(null)
  const [pickedEntries, setPickedEntries] = useState<Set<number>>(new Set())

  const marketEnabled = useMarketplaceEnabled()

  const mcpBoard = useLeaderboardMarket("mcp")
  const skillBoard = useLeaderboardMarket("skill")
  const pluginBoard = useLeaderboardMarket("plugin")
  const promptBoard = useLeaderboardMarket("prompt")

  const boardByModule: Partial<Record<MarketModule, LeaderboardDiscoverItem[]>> = {
    mcp: mcpBoard.items,
    skills: skillBoard.items,
    plugins: pluginBoard.items,
    prompts: promptBoard.items,
  }
  const boardLoading =
    mcpBoard.loading || skillBoard.loading || pluginBoard.loading || promptBoard.loading

  const load = useCallback(
    async (flush = false) => {
      setLoading(true)
      try {
        const modules = CATEGORY_TABS.find((c) => c.value === category)?.modules ?? []
        const marketResults = await Promise.all(
          modules.map(async (m) => [m, await fetchMarketIndex(m, flush).catch(() => [] as MarketItem[])] as const),
        )
        setMarketByModule((prev) => {
          const next = { ...prev }
          for (const [m, items] of marketResults) next[m] = items
          return next
        })
        const [names, refs, v2Refs, skills, plugins] = await Promise.all([
          userMode
            ? listMyMcpServices().then((list) => list.map((s) => s.name)).catch(() => [] as string[])
            : listMcpServices().then((list) => list.map((s) => s.name || "")).catch(() => [] as string[]),
          userMode
            ? Promise.resolve([] as ResourceReference[])
            : listResourceReferences().catch(() => [] as ResourceReference[]),
          // 新表引用是团队级口径（非 admin-only），用户侧也加载——榜单引用按钮两侧可用，
          // 刷新后「已引用」状态不丢。
          listReferencesV2().catch(() => [] as ResourceReferenceV2[]),
          fetchSkillListing().catch(() => []),
          fetchPluginListing().catch(() => []),
        ])
        setMcpNames(new Set(names.filter(Boolean)))
        setReferences(refs)
        setV2References(v2Refs)
        setLocalKeys(
          new Set([
            ...skills.flatMap((s) => [s.id, s.name].filter(Boolean) as string[]),
            ...plugins.flatMap((p) => [p.id, p.name].filter(Boolean) as string[]),
          ]),
        )
        if (!userMode) {
          const [skillMirrors, pluginMirrors] = await Promise.all([
            listMirrors("skills").catch(() => [] as ResourceMirror[]),
            listMirrors("plugins").catch(() => [] as ResourceMirror[]),
          ])
          setMirrors([...skillMirrors, ...pluginMirrors])
        }
      } finally {
        setLoading(false)
      }
    },
    [category, userMode],
  )

  useEffect(() => {
    void load()
  }, [load])

  // 镜像后台任务轮询：有 pending/downloading 时每 2s 拉一次，直到 ready/error。
  useEffect(() => {
    if (userMode) return
    const pending = mirrors.filter((m) => m.status === "pending" || m.status === "downloading")
    if (pending.length === 0) return
    const timer = setInterval(() => {
      Promise.all([listMirrors("skills").catch(() => []), listMirrors("plugins").catch(() => [])]).then(
        ([a, b]) => setMirrors([...a, ...b]),
      )
    }, 2000)
    return () => clearInterval(timer)
  }, [mirrors, userMode])

  const mirrorByMarket = useMemo(() => {
    const m = new Map<string, ResourceMirror>()
    for (const it of mirrors) m.set(`${it.module}:${it.market_id}`, it)
    return m
  }, [mirrors])

  const referenceByMarket = useMemo(() => {
    const m = new Map<string, ResourceReference>()
    for (const r of references) m.set(`${r.resource_type}:${r.market_id}`, r)
    return m
  }, [references])

  const referenceByResourceId = useMemo(() => {
    const m = new Map<number, ResourceReferenceV2>()
    for (const reference of v2References) m.set(Number(reference.resource_id), reference)
    return m
  }, [v2References])

  // ── 动作 ────────────────────────────────────────────────────────────────────

  const openDetail = useCallback(async (module: MarketModule, item: MarketItem) => {
    setDetailLoading(true)
    setDetail({ module, manifest: null })
    try {
      const manifest = await fetchMarketManifest(module, item.id)
      setDetail({ module, manifest })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const downloadMcp = async (item: MarketItem) => {
    setBusyKey(`market:mcp:${item.id}`)
    try {
      const manifest = await fetchMarketManifest("mcp", item.id)
      if (!manifest) {
        toast.error("拉取市场 manifest 失败")
        return
      }
      if (userMode) {
        const r = manifest.resource || {}
        const url = r.url || ""
        if (r.type !== "remote_mcp" || !url) {
          toast.error("个人 MCP 仅支持带远程 URL 的 SSE/HTTP 服务；stdio MCP 请在平台 MCP 页面下载")
          return
        }
        await createMyMcpService({
          name: manifest.name || item.name || item.id,
          display_name: manifest.display_name || manifest.name || item.name || item.id,
          description: manifest.summary || manifest.description || "",
          url,
          token: r.token || "",
          headers: {},
          enabled: true,
        })
      } else {
        const mapped = manifestToMcpService(manifest)
        await createMcpService({
          ...mapped,
          template: false,
          market_id: item.id,
          market_version: item.latest_version || "",
        })
      }
      toast.success("已下载。请到「MCP」Tab 完成连接与权限管理。")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败")
    } finally {
      setBusyKey(null)
    }
  }

  const installBoardMcpUser = async (item: LeaderboardDiscoverItem) => {
    const spec = (item.launch_spec || {}) as { kind?: string; url?: string; transport?: string }
    const url = typeof spec.url === "string" ? spec.url.trim() : ""
    if (!url) {
      toast.error(
        spec.kind === "stdio"
          ? "该 MCP 是 stdio 形态（本机命令启动），个人 MCP 只支持远程 SSE/HTTP 服务"
          : "该条目还没补启动地址，请让管理员在榜单里补全启动方式",
      )
      return
    }
    const name = item.repo_full_name.split("/").pop() || item.repo_full_name
    setBusyKey(`board:${item.id}`)
    try {
      await createMyMcpService({
        name,
        display_name: name,
        description: item.description || "",
        url,
        token: "",
        headers: {},
        enabled: true,
      })
      toast.success("已下载。请到「MCP」Tab 完成连接与权限管理。")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败")
    } finally {
      setBusyKey(null)
    }
  }

  /** 技能集可安装条目（Claude SKILL.md 形态，导入器只认这种）。 */
  const installableEntries = (item: LeaderboardDiscoverItem): SkillEntry[] =>
    normalizeSkillInstallSpec(item.install_spec).entries.filter((e) => {
      const entry = (e.entry || "SKILL.md").trim()
      return entry.toLowerCase() === "skill.md" && e.editors.includes("claude")
    })

  /** 技能集整包 zip 下载地址（分支/ref 来自 install_spec）。 */
  const collectionZipUrl = (item: LeaderboardDiscoverItem): string => {
    const spec = normalizeSkillInstallSpec(item.install_spec)
    const ref = spec.ref || "main"
    return `https://github.com/${item.repo_full_name}/archive/refs/heads/${ref}.zip`
  }

  /** 逐个安装技能条目：每个传 skill_md_path 锁定 zip 内那个 SKILL.md。 */
  const installSkillEntries = async (item: LeaderboardDiscoverItem, url: string, entries: SkillEntry[]) => {
    const short = item.display_name || item.repo_full_name.split("/").pop() || item.repo_full_name
    setBusyKey(`board:${item.id}`)
    try {
      for (const entry of entries) {
        const path = (entry.path || "").replace(/^\/+|\/+$/g, "")
        const skillMdPath = path ? `${path}/${entry.entry || "SKILL.md"}` : entry.entry || "SKILL.md"
        await importSkillUrl(url, {
          name: entry.name || item.name || short,
          description: item.description || "",
          enabled: true,
          skill_md_path: skillMdPath,
        })
      }
      toast.success(`已安装 Skill「${short}」${entries.length > 1 ? `（${entries.length} 个 skill）` : ""}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装失败")
    } finally {
      setBusyKey(null)
    }
  }

  /**
   * 安装榜单条目。技能集（target_modules 含复数 "skills"）弹框勾选子技能再装；
   * 单技能/直连下载源整包直装；插件按下载地址导入。
   */
  const installBoardItem = async (item: LeaderboardDiscoverItem) => {
    const mods = normalizeModules(item.target_modules, item.target_module)
    // 技能集合的 target_modules 是复数 "skills"，单技能是 "skill"，两者都走 skills 安装分支。
    const kind: MirrorModule | null =
      mods.includes("skill") || mods.includes("skills") ? "skills" : mods.includes("plugin") ? "plugins" : null
    if (!kind) {
      toast.error("该条目暂无可识别的安装形态")
      return
    }
    const repo = item.repo_full_name
    const install = (item.install_spec || {}) as {
      skill?: { download_url?: string }
      plugin?: { download_url?: string }
    }
    const short = item.display_name || repo.split("/").pop() || repo
    if (kind === "skills") {
      // agentscope 这类直连下载源：一个 zip 一个 skill，download_url 直接喂导入器
      //（不是 GitHub 仓库，拼 github archive 会 404）。
      if (install.skill?.download_url) {
        setBusyKey(`board:${item.id}`)
        try {
          await importSkillUrl(install.skill.download_url, {
            name: item.name || short, description: item.description || "", enabled: true,
          })
          toast.success(`已安装 Skill「${short}」`)
          await load()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "安装失败")
        } finally {
          setBusyKey(null)
        }
        return
      }
      // 有可安装子技能：技能集弹框勾选（避免整包无脑装）；单技能直接按 entry 装。
      const entries = installableEntries(item)
      if (entries.length > 0) {
        if (mods.includes("skills")) {
          setInstallPick({ item, url: collectionZipUrl(item), entries })
          setPickedEntries(new Set(entries.map((_, i) => i)))
          return
        }
        await installSkillEntries(item, collectionZipUrl(item), entries)
        return
      }
    }
    setBusyKey(`board:${item.id}`)
    try {
      if (kind === "skills") {
        // 没探到可安装条目：兜底整仓 zip，走默认 finder 取最短 SKILL.md。
        await importSkillUrl(collectionZipUrl(item), { name: item.name || short, description: item.description || "", enabled: true })
        toast.success(`已安装 Skill「${short}」`)
      } else {
        const raw = install.plugin?.download_url || `https://github.com/${repo}/archive/refs/heads/main.zip`
        const url = raw.replace(/\.tar\.gz$/, ".zip")
        await importPluginUrl(url, { name: item.name || short, description: item.description || "", enabled: true })
        toast.success(`已安装插件「${short}」`)
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装失败")
    } finally {
      setBusyKey(null)
    }
  }

  const confirmInstallPick = async () => {
    if (!installPick) return
    const picked = installPick.entries.filter((_, i) => pickedEntries.has(i))
    if (picked.length === 0) {
      toast.error("请至少勾选一个子技能")
      return
    }
    const { item, url } = installPick
    setInstallPick(null)
    await installSkillEntries(item, url, picked)
  }

  const toggleReference = async (module: MarketModule, item: MarketItem) => {
    const resourceType = module === "skills" ? "skill" : module === "plugins" ? "plugin" : "project_prompt"
    const key = `${resourceType}:${item.id}`
    const existing = referenceByMarket.get(key)
    setBusyKey(`ref:${key}`)
    try {
      if (existing) {
        await deleteResourceReference(existing.id)
        setReferences((cur) => cur.filter((r) => r.id !== existing.id))
        toast.success("已取消引用")
      } else {
        const created = await createResourceReference(module as ResourceModule, item.id)
        setReferences((cur) => [...cur.filter((r) => `${r.resource_type}:${r.market_id}` !== key), created])
        toast.success("已引用，现在可以分配给团队")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    } finally {
      setBusyKey(null)
    }
  }

  /**
   * 引用/取消引用榜单条目：榜单条目本身就是统一资源池的 published 行（id 即
   * resources.id），直接按 resource_id 建新表引用，不再走 GitHub 识别重复落池。
   */
  const toggleBoardReference = async (item: LeaderboardDiscoverItem) => {
    const existing = referenceByResourceId.get(item.id)
    setBusyKey(`boardref:${item.id}`)
    try {
      if (existing) {
        await deleteReferenceV2(existing.id)
        setV2References((cur) => cur.filter((r) => r.id !== existing.id))
        toast.success("已取消引用")
      } else {
        const created = await createReferenceFromResource({ resource_id: item.id })
        setV2References((cur) => [...cur.filter((r) => Number(r.resource_id) !== item.id), created])
        toast.success("已引用，现在可以分配给团队")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    } finally {
      setBusyKey(null)
    }
  }

  const handleMirror = async (module: MirrorModule, item: MarketItem) => {
    setBusyKey(`mirror:${module}:${item.id}`)
    try {
      const manifest = await fetchMarketManifest(module, item.id)
      if (!manifest) {
        toast.error("拉取市场 manifest 失败")
        return
      }
      const req = mirrorRequestFromManifest(manifest)
      if (!req.source_url) {
        toast.error("该资源没有可镜像的来源地址（manifest 未提供 source_url）")
        return
      }
      await createMirror(module, req)
      toast.success("已开始镜像，稍候查看状态")
      const [a, b] = await Promise.all([
        listMirrors("skills").catch(() => [] as ResourceMirror[]),
        listMirrors("plugins").catch(() => [] as ResourceMirror[]),
      ])
      setMirrors([...a, ...b])
    } catch (err) {
      toast.error(`镜像失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleRefreshMirror = async (module: MirrorModule, mirrorId: number) => {
    setBusyKey(`mirror:${module}:${mirrorId}`)
    try {
      await refreshMirror(module, mirrorId)
      toast.success("已重新拉取")
      const [a, b] = await Promise.all([
        listMirrors("skills").catch(() => [] as ResourceMirror[]),
        listMirrors("plugins").catch(() => [] as ResourceMirror[]),
      ])
      setMirrors([...a, ...b])
    } catch (err) {
      toast.error(`刷新失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleDeleteMirror = async (module: MirrorModule, mirrorId: number) => {
    setBusyKey(`mirror:${module}:${mirrorId}`)
    try {
      await deleteMirror(module, mirrorId)
      toast.success("已删除镜像")
      const [a, b] = await Promise.all([
        listMirrors("skills").catch(() => [] as ResourceMirror[]),
        listMirrors("plugins").catch(() => [] as ResourceMirror[]),
      ])
      setMirrors([...a, ...b])
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const copySpec = async (module: MarketModule, manifest: MarketManifest) => {
    if (module !== "skills" && module !== "plugins") return
    const spec = module === "skills" ? manifestToSkillSpec(manifest) : manifestToPluginSpec(manifest)
    let out: Record<string, unknown> = spec as Record<string, unknown>
    const m = manifest.id ? mirrorByMarket.get(`${module}:${manifest.id}`) : undefined
    let mirrored = false
    if (m && m.status === "ready") {
      try {
        const res = await getMirrorSpec(module, manifest.id, m.version || "")
        out = res.spec as Record<string, unknown>
        mirrored = true
      } catch (e) {
        toast.error(`取镜像引用失败，已复制原始 spec: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const copied = await copyToClipboard(JSON.stringify(out, null, 2))
    if (!copied) {
      toast.error("复制失败，请手动选择")
      return
    }
    toast.success(
      mirrored
        ? "已复制 spec（指向服务端镜像）；在编辑器资源中勾选即可使用"
        : "已复制 spec；在编辑器资源中勾选可直接保存并下载",
    )
  }

  // ── 筛选 + 排序 ────────────────────────────────────────────────────────────

  const rows = useMemo<Row[]>(() => {
    const modules = CATEGORY_TABS.find((c) => c.value === category)?.modules ?? []
    const q = query.trim().toLowerCase()
    const matchQ = (fields: (string | undefined | null)[]) =>
      !q || fields.filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
    const out: Row[] = []
    // 榜单条目跨多模块时会同时出现在多个 target 列表里，按 id 去重，归到首个命中模块。
    const seenBoard = new Set<number>()
    for (const module of modules) {
      // 技能集 tab 只看榜单集合：市场索引（index.json）没有集合形态，整类不参与。
      if (sourceFilter !== "board" && category !== "collections") {
        for (const it of marketByModule[module] ?? []) {
          if (!matchQ([it.display_name, it.name, it.id, it.summary, it.publisher])) continue
          out.push({ kind: "market", module, item: it })
        }
      }
      if (sourceFilter !== "market") {
        for (const it of boardByModule[module] ?? []) {
          if (seenBoard.has(it.id)) continue
          // Skill / 技能集两个 tab 按 target_modules 分流：复数 "skills" 是集合、单数是单技能。
          const isCollection = normalizeModules(it.target_modules, it.target_module).includes("skills")
          if (category === "collections" && !isCollection) continue
          if (category === "skills" && isCollection) continue
          // 技能集：子技能名/说明也参与匹配——搜 "docx" 能命中 anthropics/skills 集合。
          const entryFields = normalizeSkillInstallSpec(it.install_spec).entries.flatMap((e) => [e.name, e.description || ""])
          if (!matchQ([it.repo_full_name, it.name, it.display_name, it.description, it.language, ...(it.topics || []), ...(it.use_cases || []), ...entryFields])) {
            continue
          }
          if (stackTag !== "all" && !(it.stack_tags || []).includes(stackTag)) {
            // 技术栈筛选只对榜单条目有意义：市场项无 stack_tags，整体不参与
            continue
          }
          seenBoard.add(it.id)
          out.push({ kind: "board", module, item: it })
        }
      }
    }
    // 排序只在榜单条目上有意义（市场项无 stars/updated）；市场项按原序排最后。
    if (sortBy === "stars") {
      out.sort((a, b) => {
        const av = a.kind === "board" ? a.item.stars : 0
        const bv = b.kind === "board" ? b.item.stars : 0
        return bv - av
      })
    } else if (sortBy === "updated") {
      const ts = (r: Row) => {
        if (r.kind !== "board") return 0
        const it = r.item
        const raw = it.upstream_updated_at || it.published_at
        return raw ? Date.parse(raw) : 0
      }
      out.sort((a, b) => ts(b) - ts(a))
    }
    return out
  }, [category, sourceFilter, stackTag, query, sortBy, marketByModule, boardByModule])

  // 筛选/分类/排序变化时回第 1 页，避免翻到不存在的页码。
  useEffect(() => { setPage(1) }, [category, sourceFilter, stackTag, query, sortBy])

  const totalPages = Math.max(1, Math.ceil(rows.length / MARKET_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * MARKET_PAGE_SIZE, currentPage * MARKET_PAGE_SIZE),
    [rows, currentPage],
  )

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  const renderMarketCard = (module: MarketModule, item: MarketItem) => {
    const singular = MARKET_TO_TARGET[module]
    const downloaded = module === "mcp" && mcpNames.has(item.name || item.id)
    const refKey = `${singular === "skill" ? "skill" : singular === "plugin" ? "plugin" : "project_prompt"}:${item.id}`
    const referenced = referenceByMarket.get(refKey)
    const mirrorKey = `${module}:${item.id}`
    const mirror = mirrorByMarket.get(mirrorKey)
    const mirrored = !!mirror && mirror.status === "ready"
    const busy = busyKey === `market:${module}:${item.id}` || busyKey === `ref:${refKey}` || busyKey === `mirror:${mirrorKey}`
    return (
      <Card key={`market:${module}:${item.id}`} size="sm" className="shadow-none" style={busy ? { opacity: 0.6 } : undefined}>
        <CardContent className="flex h-full flex-col gap-2.5 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{item.display_name || item.name || item.id}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className={`text-[10px] ${MARKET_BADGE_CLASS}`}>市场</Badge>
            <Badge variant="outline" className={`text-[10px] ${MODULE_BADGE_CLASS[singular] || ""}`}>
              {MODULE_LABELS[singular]}
            </Badge>
            {item.latest_version ? (
              <Badge variant="outline" className="text-[10px]">v{item.latest_version}</Badge>
            ) : null}
            {downloaded ? (
              <Badge className="text-[10px]">已下载</Badge>
            ) : null}
            {referenced ? (
              <Badge variant="secondary" className="text-[10px]">已引用</Badge>
            ) : null}
            {mirror ? (
              <Badge
                variant={mirrored ? "secondary" : mirror.status === "error" ? "destructive" : "outline"}
                className="text-[10px]"
                title={mirror.status === "error" ? mirror.error : undefined}
              >
                {mirror.status === "ready" ? `已镜像 ${formatSize(mirror.size_bytes)}` : mirrorStatusLabel(mirror.status)}
              </Badge>
            ) : null}
          </div>
          <p className="line-clamp-3 min-h-[44px] text-xs leading-5 text-muted-foreground">
            {item.summary || "暂无描述"}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
            {item.publisher ? <span>{item.publisher}</span> : <span className="text-muted-foreground/60">-</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <Button size="sm" variant="outline" onClick={() => void openDetail(module, item)}>查看详情</Button>
            {module === "mcp" ? (
              <Button size="sm" disabled={downloaded || busy} onClick={() => !downloaded && void downloadMcp(item)}>
                {downloaded ? "已下载" : "下载"}
              </Button>
            ) : null}
            {!userMode && (module === "skills" || module === "plugins" || module === "prompts") ? (
              <Button
                size="sm"
                variant={referenced ? "outline" : "default"}
                disabled={busy}
                onClick={() => void toggleReference(module, item)}
              >
                {busyKey === `ref:${refKey}` ? "处理中..." : referenced ? "取消引用" : "引用"}
              </Button>
            ) : null}
            {!userMode && (module === "skills" || module === "plugins") ? (
              mirrored ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRefreshMirror(module, mirror!.id)}>
                  刷新镜像
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleMirror(module, item)}>
                  {busyKey === `mirror:${mirrorKey}` ? "镜像中..." : mirror ? (mirror.status === "error" ? "重新镜像" : "镜像中...") : "镜像"}
                </Button>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderBoardCard = (module: MarketModule, item: LeaderboardDiscoverItem) => {
    const modules = normalizeModules(item.target_modules, item.target_module)
    const canInstall = module === "skills" || module === "plugins"
    const installed = canInstall && localKeys.has(item.name || item.display_name || item.repo_full_name.split("/").pop() || item.repo_full_name)
    const busy = busyKey === `board:${item.id}`
    const refBusy = busyKey === `boardref:${item.id}`
    const boardRef = referenceByResourceId.get(item.id)
    const isUserMcpInstall = userMode && module === "mcp"
    // 技能集：一行卡片 + 可展开子技能列表（整包安装/引用，任务期再勾子技能）。
    const isCollection = modules.includes("skills")
    const skillEntries = isCollection ? normalizeSkillInstallSpec(item.install_spec).entries : []
    const expanded = expandedSkills.has(item.id)
    return (
      <Card key={`board:${item.id}`} size="sm" className="shadow-none" style={busy || refBusy ? { opacity: 0.6 } : undefined}>
        <CardContent className="flex h-full flex-col gap-2.5 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <a
                href={item.repo_url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 text-sm font-medium hover:underline"
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
          <div className="flex flex-wrap items-center gap-1">
            {item.board ? (
              <Badge variant="outline" className={`text-[10px] ${SOURCE_BADGE_CLASS[item.board] || "text-muted-foreground"}`}>
                {SOURCE_LABELS[item.board] || item.board}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">榜单</Badge>
            )}
            {modules.map((m) => (
              <Badge key={m} variant="outline" className={`text-[10px] ${MODULE_BADGE_CLASS[m] || ""}`}>
                {MODULE_LABELS[m]}
              </Badge>
            ))}
            {!item.installable ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">仅浏览</Badge>
            ) : null}
            {boardRef ? (
              <Badge variant="secondary" className="text-[10px]">已引用</Badge>
            ) : null}
          </div>
          {item.stack && (item.stack.primary_language || (item.stack.frameworks || []).length > 0) ? (
            <StackBadges stack={item.stack} max={3} className="-mt-1" />
          ) : null}
          <p className="line-clamp-3 min-h-[44px] text-xs leading-5 text-muted-foreground">
            {item.description || "暂无描述"}
          </p>
          {isCollection && skillEntries.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setExpandedSkills((prev) => {
                  const next = new Set(prev)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                包含 {skillEntries.length} 个子技能（整包安装，任务期再勾选）
              </button>
              {expanded ? (
                <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2">
                  {skillEntries.map((entry, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-medium text-foreground">{entry.name || `#${i + 1}`}</span>
                      {entry.description ? (
                        <span className="ml-1.5 text-muted-foreground line-clamp-2">{entry.description}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground">
            {item.display_rank != null ? <span className="font-medium text-foreground">#{item.display_rank}</span> : null}
            <span className="inline-flex items-center gap-0.5"><Star className="size-3" />{item.stars.toLocaleString()}</span>
            <span className="inline-flex items-center gap-0.5"><GitFork className="size-3" />{item.forks.toLocaleString()}</span>
            {item.language ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: LANG_DOT[item.language] || "#94a3b8" }} />
                {item.language}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            {canInstall ? (
              <Button size="sm" disabled={installed || busy} onClick={() => !installed && void installBoardItem(item)}>
                {installed ? "已下载" : "安装"}
              </Button>
            ) : null}
            {isUserMcpInstall ? (
              <Button size="sm" disabled={busy} onClick={() => void installBoardMcpUser(item)}>
                {busy ? "安装中..." : "安装"}
              </Button>
            ) : null}
            {item.installable ? (
              <Button
                size="sm"
                variant={boardRef ? "outline" : "default"}
                disabled={refBusy}
                onClick={() => void toggleBoardReference(item)}
              >
                {refBusy ? "处理中..." : boardRef ? "取消引用" : "引用"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    )
  }

  const showEmpty = !loading && !boardLoading && marketEnabled !== undefined && rows.length === 0
  const marketDisabled = marketEnabled === false && rows.filter((r) => r.kind === "board").length === 0
  return (
    <div className="space-y-4">
      {/* 分类切换不能用 Tabs：资源中心外壳是 vertical group/tabs，其 group-data-vertical
          变体会把嵌套 TabsList 污染成竖排（命名组匹配任意祖先）。ToggleGroup 用独立的
          group/toggle-group，不受影响。 */}
      <ToggleGroup
        type="single"
        value={category}
        onValueChange={(v) => { if (v) setCategory(v as Category) }}
      >
        {CATEGORY_TABS.map((c) => (
          <ToggleGroupItem key={c.value} value={c.value}>{c.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | "market" | "board")} className="h-9 w-32 text-sm">
          <NativeSelectOption value="all">全部来源</NativeSelectOption>
          <NativeSelectOption value="market">市场</NativeSelectOption>
          <NativeSelectOption value="board">榜单</NativeSelectOption>
        </NativeSelect>
        <NativeSelect value={stackTag} onChange={(e) => setStackTag(e.target.value)} className="h-9 w-32 text-sm" title="技术栈 tag（仅榜单条目）">
          <NativeSelectOption value="all">全部技术栈</NativeSelectOption>
          {STACK_TAG_FILTERS.map((tag) => (
            <NativeSelectOption key={tag} value={tag}>{tag}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-9 w-32 text-sm"
          title="排序方式（点赞/更新时间仅榜单条目有数据）"
        >
          {SORT_OPTIONS.map((opt) => (
            <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          placeholder="搜索名称 / 仓库 / 描述..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-52"
        />
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => {
              invalidateMarketCache()
              void load(true)
            }}
          >
            <RefreshCw className="mr-1 size-3.5" />刷新
          </Button>
        </div>
      </div>

      {loading || boardLoading || marketEnabled === undefined ? (
        <Empty><Spinner /> 加载中...</Empty>
      ) : marketDisabled ? (
        <Empty>
          <div>市场未启用</div>
          <div className="text-xs text-muted-foreground">在服务端 env.ini 的 [marketplace] 配置 GitHub 仓库后即可使用</div>
        </Empty>
      ) : showEmpty ? (
        <Empty>没有符合筛选的资源</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageRows.map((row) =>
              row.kind === "market"
                ? renderMarketCard(row.module, row.item)
                : renderBoardCard(row.module, row.item),
            )}
          </div>
          <MarketPager page={currentPage} pageSize={MARKET_PAGE_SIZE} total={rows.length} onPageChange={setPage} />
        </>
      )}

      {/* 技能集安装弹框：安装前勾选子技能（整包 zip 按 skill_md_path 逐个导入）。
          勾选页替代旧「整包无脑装」——技能集动辄几十个子技能，全部装进去只会污染列表。 */}
      <Dialog open={!!installPick} onOpenChange={(open) => { if (!open) setInstallPick(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>安装技能集</DialogTitle>
          </DialogHeader>
          {installPick ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {installPick.item.repo_full_name} 共 {installPick.entries.length} 个子技能，
                勾选要安装的（按 SKILL.md 路径逐个导入）：
              </p>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                {installPick.entries.map((entry, i) => (
                  <label key={i} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/60">
                    <Checkbox
                      checked={pickedEntries.has(i)}
                      onCheckedChange={(checked) => setPickedEntries((prev) => {
                        const next = new Set(prev)
                        if (checked) next.add(i)
                        else next.delete(i)
                        return next
                      })}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{entry.name || `#${i + 1}`}</div>
                      {entry.description ? (
                        <div className="text-xs text-muted-foreground line-clamp-2">{entry.description}</div>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPickedEntries(
                    installPick.entries.length === pickedEntries.size
                      ? new Set()
                      : new Set(installPick.entries.map((_entry, i) => i)),
                  )}
                >
                  {installPick.entries.length === pickedEntries.size ? "取消全选" : "全选"}
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setInstallPick(null)}>取消</Button>
                  <Button size="sm" disabled={pickedEntries.size === 0} onClick={() => void confirmInstallPick()}>
                    安装（{pickedEntries.size}）
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 详情弹框：manifest 摘要 +（提示词）内容 + JSON + 复制 spec / 镜像 / 引用 / 下载 */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) { setDetail(null); setDetailLoading(false) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.manifest?.display_name || detail?.manifest?.name || "详情"}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground"><Spinner /> 加载中...</div>
          ) : detail?.manifest ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{detail.manifest.summary || detail.manifest.description || "暂无描述"}</p>
              {detail.module === "prompts" ? (
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">
                  {String((detail.manifest.resource as Record<string, unknown> | undefined)?.content || "")}
                </pre>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div>version: {detail.manifest.version || "-"}</div>
                <div>publisher: {detail.manifest.publisher || "-"}</div>
                <div className="col-span-2 break-all">source: {detail.manifest.source_url || detail.manifest.download_url || "-"}</div>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(detail.manifest, null, 2)}</pre>
              <div className="flex flex-wrap justify-end gap-2">
                {detail.module === "mcp" ? (
                  <Button onClick={() => { const it = marketByModule.mcp?.find((x) => x.id === detail.manifest!.id); if (it) void downloadMcp(it) }} disabled={!detail.manifest.id || mcpNames.has(detail.manifest.name || detail.manifest.id)}>
                    {mcpNames.has(detail.manifest.name || detail.manifest.id) ? "已下载" : "下载"}
                  </Button>
                ) : null}
                {detail.module === "skills" || detail.module === "plugins" ? (
                  <Button variant="outline" onClick={() => void copySpec(detail.module, detail.manifest!)}>复制 spec</Button>
                ) : null}
                {!userMode && (detail.module === "skills" || detail.module === "plugins") ? (
                  (() => {
                    const mm = detail.module as MirrorModule
                    const m = detail.manifest!.id ? mirrorByMarket.get(`${mm}:${detail.manifest!.id}`) : undefined
                    const ready = !!m && m.status === "ready"
                    const it = marketByModule[detail.module]?.find((x) => x.id === detail.manifest!.id)
                    if (ready) {
                      return (
                        <>
                          <Badge variant="secondary" className="text-[10px] self-center">
                            已镜像 · {formatSize(m!.size_bytes)} · sha256 {m!.digest.slice(0, 8)}
                          </Badge>
                          <Button variant="outline" onClick={() => void handleRefreshMirror(mm, m!.id)} disabled={busyKey === `mirror:${mm}:${m!.id}`}>刷新镜像</Button>
                          <Button variant="outline" onClick={() => void handleDeleteMirror(mm, m!.id)} disabled={busyKey === `mirror:${mm}:${m!.id}`}>删除镜像</Button>
                        </>
                      )
                    }
                    if (!it) return null
                    return (
                      <Button onClick={() => void handleMirror(mm, it)} disabled={busyKey === `mirror:${mm}:${it.id}`}>
                        {m?.status === "downloading" || busyKey === `mirror:${mm}:${it.id}` ? "镜像中..." : "镜像到服务端"}
                      </Button>
                    )
                  })()
                ) : null}
                {!userMode && (detail.module === "skills" || detail.module === "plugins" || detail.module === "prompts") ? (
                  (() => {
                    const singular = MARKET_TO_TARGET[detail.module]
                    const rt = singular === "skill" ? "skill" : singular === "plugin" ? "plugin" : "project_prompt"
                    const ref = referenceByMarket.get(`${rt}:${detail.manifest!.id}`)
                    return (
                      <Button
                        variant={ref ? "outline" : "default"}
                        disabled={!detail.manifest.id || busyKey === `ref:${rt}:${detail.manifest!.id}`}
                        onClick={() => { const it = marketByModule[detail.module]?.find((x) => x.id === detail.manifest!.id); if (it) void toggleReference(detail.module, it) }}
                      >
                        {busyKey === `ref:${rt}:${detail.manifest!.id}` ? "处理中..." : ref ? "取消引用" : "引用"}
                      </Button>
                    )
                  })()
                ) : null}
                {(() => {
                  const url = detail.manifest!.download_url || detail.manifest!.source_url
                  if (!url) return null
                  return <Button onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>下载 / 打开来源</Button>
                })()}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">加载失败</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
