import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  fetchMarketIndex,
  fetchMarketManifest,
  invalidateMarketCache,
  useMarketplaceEnabled,
  type MarketItem,
  type MarketManifest,
} from "@/api/marketplaceRaw"
import {
  createMirror,
  deleteMirror,
  formatSize,
  getMirrorSpec,
  listMirrors,
  mirrorRequestFromManifest,
  mirrorStatusLabel,
  refreshMirror,
  type ResourceMirror,
} from "@/api/resourceMirrors"
import {
  createResourceReference,
  deleteResourceReference,
  listResourceReferences,
  type ResourceReference,
  type ResourceType,
} from "@/api/resourceReferences"
import {
  LeaderboardMarketCard,
  filterLeaderboardItems,
  useLeaderboardMarket,
} from "@/components/marketplace/LeaderboardMarketCards"
import type { LeaderboardDiscoverItem } from "@/api/marketplaceRaw"
import { toast } from "sonner"
import type { ParsedResource } from "@/lib/agent-resources-api"

type View = "local" | "market"

/**
 * Skill / 插件 市场 + 本地资源的共用面板。两者数据与服务端引用链路完全同构，
 * 仅在名词 / 图标 / spec 映射上有差异，按 props 参数化避免两份克隆代码。
 *
 * 「引用」语义（与现有 SkillsMarket/Plugins 一致）：
 *  - 复制 SkillSpec / NodePluginSpec 到剪贴板（在编辑器资源选择器勾选后由节点物化）
 *  - 下载 / 打开来源 URL
 * 「已引用」判定：本地清单的 id/name 与市场项命中 => 本地已有 => 视为已引用。
 */
export interface ResourceMarketPanelProps<LocalItem extends { id?: string; name?: string; description?: string }> {
  /** 资源名词，用于空态/提示文案（如 "Skill" / "插件"）。 */
  noun: string
  /** 固定视图：用于资源中心把“本地资源”与“市场”拆成独立顶层 Tab。 */
  forcedView?: View
  /** 卡片图标。 */
  icon: LucideIcon
  /** 从本地后端拉取可用资源（GET /api/v1/{skills|plugins}）。 */
  fetchLocal: () => Promise<LocalItem[]>
  /** 市场模块，喂给 fetchMarketIndex / fetchMarketManifest。 */
  module: "skills" | "plugins"
  /** 持久化引用使用的统一资源类型。 */
  resourceType: Extract<ResourceType, "skill" | "plugin">
  /** manifest -> 编辑器资源选择器消费的 spec。 */
  manifestToSpec: (manifest: MarketManifest) => Record<string, unknown>
  /** 复制按钮 / toast 里的 spec 名称（如 "SkillSpec" / "NodePluginSpec"）。 */
  specLabel: string
  /**
   * 用户侧只读模式：个人消费者只浏览本地可用资源 + GitHub 市场，复制 spec 到编辑器。
   * 关闭镜像（admin-only /api/v1/resources/{module}/mirrors）与团队引用（治理动作）——
   * 这些属于管理端，用户侧调用会 403 且语义不符。
   */
  /** 用户侧资源管理可传导入 + 元数据编辑；未传时本地列表保持只读。 */
  localCrud?: {
    importUpload: (file: File, payload: { name?: string; description?: string; enabled?: boolean; skill_md_path?: string }) => Promise<LocalItem>
    importUrl: (url: string, payload: { name?: string; description?: string; enabled?: boolean; skill_md_path?: string }) => Promise<LocalItem>
    update: (id: string, payload: { name: string; description: string; enabled: boolean }) => Promise<LocalItem>
    remove: (id: string) => Promise<unknown>
    /** 导入两步式弹框第一步：dry-run 解析，返回识别出的元数据，不落库。 */
    parseUpload?: (file: File) => Promise<ParsedResource>
    parseUrl?: (url: string) => Promise<ParsedResource>
  }
  userMode?: boolean
}

export function ResourceMarketPanel<LocalItem extends { id?: string; name?: string; description?: string }>({
  noun,
  forcedView,
  icon: Icon,
  fetchLocal,
  module,
  resourceType,
  manifestToSpec,
  specLabel,
  localCrud,
  userMode = false,
}: ResourceMarketPanelProps<LocalItem>) {
  const [internalView, setInternalView] = useState<View>("local")
  const view = forcedView ?? internalView
  const setView: (value: View) => void = forcedView ? () => {} : setInternalView
  const [localItems, setLocalItems] = useState<LocalItem[]>([])
  const [marketItems, setMarketItems] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [detail, setDetail] = useState<MarketManifest | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [onlyReferenced, setOnlyReferenced] = useState(false)
  const [references, setReferences] = useState<ResourceReference[]>([])
  const [referencing, setReferencing] = useState<string | null>(null)
  // 榜单条目安装中（按榜单 id），防重复点击。
  const [boardInstalling, setBoardInstalling] = useState<number | null>(null)
  // 镜像筛选：全部 / 已镜像 / 未镜像。镜像让节点的会话启动跳过外网 git clone、走服务端存档。
  const [mirrorFilter, setMirrorFilter] = useState<"all" | "mirrored" | "unmirrored">("all")
  const [mirrors, setMirrors] = useState<ResourceMirror[]>([])
  const [mirroring, setMirroring] = useState<string | null>(null) // 正在镜像的 market_id
  const [localEditing, setLocalEditing] = useState<LocalItem | null | undefined>(undefined)
  const [importSource, setImportSource] = useState<"upload" | "url">("upload")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importUrl, setImportUrl] = useState("")
  const [localName, setLocalName] = useState("")
  const [localDescription, setLocalDescription] = useState("")
  const [localEnabled, setLocalEnabled] = useState(true)
  const [localSaving, setLocalSaving] = useState(false)
  // 导入两步式：input → 识别 → confirm → 确认导入。parsing=识别中，parsedMeta=识别结果。
  const [parseStep, setParseStep] = useState<"input" | "confirm">("input")
  const [parsing, setParsing] = useState(false)
  const [parsedMeta, setParsedMeta] = useState<ParsedResource | null>(null)
  // undefined=探测中，false=服务端未配 [marketplace]，true=可用
  const marketEnabled = useMarketplaceEnabled()
  // 外部榜单条目：与 index.json 市场项混在同一网格，只有这些有 star/fork 热度。
  const { items: boardItems, loading: boardLoading } = useLeaderboardMarket(
    module === "skills" ? "skill" : "plugin",
    { enabled: view === "market" },
  )

  const loadMirrors = useCallback(async () => {
    if (userMode) return
    const items = await listMirrors(module).catch(() => [] as ResourceMirror[])
    setMirrors(items)
  }, [module, userMode])

  const load = useCallback(
    async (flush = false) => {
      setLoading(true)
      try {
        const [local, market, referenced] = await Promise.all([
          fetchLocal().catch(() => [] as LocalItem[]),
          fetchMarketIndex(module, flush).catch(() => [] as MarketItem[]),
          userMode
            ? Promise.resolve([] as ResourceReference[])
            : listResourceReferences(resourceType).catch(() => [] as ResourceReference[]),
        ])
        await loadMirrors()
        setLocalItems(local)
        setMarketItems(market)
        setReferences(referenced)
      } finally {
        setLoading(false)
      }
    },
    [fetchLocal, module, resourceType, loadMirrors, userMode],
  )

  useEffect(() => {
    void load()
  }, [load])

  // 镜像拉取是后台任务：有 pending/downloading 项时轮询，直到 ready/error。
  useEffect(() => {
    const pending = mirrors.filter((m) => m.status === "pending" || m.status === "downloading")
    if (pending.length === 0) return
    const timer = setInterval(() => { void loadMirrors() }, 2000)
    return () => clearInterval(timer)
  }, [mirrors, loadMirrors])

  // market_id -> 镜像记录（卡片徽章 + 筛选用）
  const mirrorByMarket = useMemo(() => {
    const m = new Map<string, ResourceMirror>()
    for (const it of mirrors) m.set(it.market_id, it)
    return m
  }, [mirrors])

  const handleMirror = async (marketId: string) => {
    // 卡片只有摘要，镜像需要 source_url/ref/path，先拉 manifest。
    setMirroring(marketId)
    try {
      const manifest = await fetchMarketManifest(module, marketId)
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
      await loadMirrors()
    } catch (e: any) {
      toast.error(`镜像失败: ${e?.message}`)
    } finally {
      setMirroring(null)
    }
  }

  const handleRefreshMirror = async (marketId: string) => {
    const m = mirrorByMarket.get(marketId)
    if (!m) return
    try {
      await refreshMirror(module, m.id)
      toast.success("已重新拉取")
      await loadMirrors()
    } catch (e: any) {
      toast.error(`刷新失败: ${e?.message}`)
    }
  }

  const handleDeleteMirror = async (marketId: string) => {
    const m = mirrorByMarket.get(marketId)
    if (!m) return
    try {
      await deleteMirror(module, m.id)
      toast.success("已删除镜像")
      await loadMirrors()
    } catch (e: any) {
      toast.error(`删除失败: ${e?.message}`)
    }
  }

  const localKeys = useMemo(
    () => new Set(localItems.flatMap((item) => [item.id, item.name].filter(Boolean)) as string[]),
    [localItems],
  )

  const referenceByMarket = useMemo(
    () => new Map(references.map((reference) => [reference.market_id, reference])),
    [references],
  )

  const current: Array<MarketItem | LocalItem> = view === "local" ? localItems : marketItems
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let base: Array<MarketItem | LocalItem> = q
      ? current.filter((item) => JSON.stringify(item).toLowerCase().includes(q))
      : current
    // 「仅看已引用」以服务端持久化 reference 为准。
    if (onlyReferenced && view === "market") {
      base = base.filter((item) => referenceByMarket.has((item as MarketItem).id))
    }
    // 镜像筛选：已镜像 = mirrorByMarket 命中且 ready；未镜像 = 未命中或非 ready。
    if (mirrorFilter !== "all" && view === "market") {
      base = base.filter((item) => {
        const market = item as MarketItem
        const m = mirrorByMarket.get(market.id)
        const mirrored = !!m && m.status === "ready"
        return mirrorFilter === "mirrored" ? mirrored : !mirrored
      })
    }
    return base
  }, [current, query, onlyReferenced, mirrorFilter, view, referenceByMarket, localKeys, mirrorByMarket])

  /**
   * 榜单条目（只在市场视图出现）。镜像/引用是 index.json 条目的治理动作，榜单条目
   * 没有 manifest 也就没有这两种状态——所以这两个筛选一开，榜单条目整体不参与，
   * 而不是硬塞进「未镜像」桶里让人以为可以去镜像。
   */
  const boardFiltered = useMemo(() => {
    if (view !== "market") return []
    if (onlyReferenced || mirrorFilter !== "all") return []
    return filterLeaderboardItems(boardItems, query)
  }, [view, onlyReferenced, mirrorFilter, boardItems, query])

  /**
   * 安装榜单条目：把它当作一次「URL 导入」走本地导入链路（下载归档 → 解析 → 落库）。
   * 归档地址由 install_spec 拼：skill 用分支 zip；plugin 用下载地址（tar.gz 换 .zip，
   * 导入器只认 zip）。install_spec 没填的老条目按 main 分支兜底。
   *
   * skill 技能包：一个仓库可能产出多个 SKILL.md（entries）。按 claude entry 逐个安装，
   * 每个传 ``skill_md_path=<entry.path>/<entry.entry>`` 让服务端装用户选中的那个，不再
   * 取"任意最短路径"。cursor/.mdc 与 AGENTS.md 不是 skill 导入器形态，不在此安装。
   */
  const installBoardItem = async (item: LeaderboardDiscoverItem) => {
    if (!localCrud) return
    const repo = item.repo_full_name
    const install = (item.install_spec || {}) as {
      skill?: { ref?: string; entries?: Array<{ name?: string; path?: string; entry?: string; editors?: string[] }> },
      plugin?: { download_url?: string },
    }
    const short = item.display_name || repo.split("/").pop() || repo
    setBoardInstalling(item.id)
    try {
      if (module === "skills") {
        const ref = install.skill?.ref || "main"
        const url = `https://github.com/${repo}/archive/refs/heads/${ref}.zip`
        const entries = (install.skill?.entries || []).filter((e) => {
          const entry = (e.entry || "SKILL.md").trim()
          return entry.toLowerCase() === "skill.md" && (e.editors || []).includes("claude")
        })
        if (entries.length === 0) {
          // 没探到/没勾 claude 的 skill entry：兜底整仓 zip，走默认 finder
          await localCrud.importUrl(url, {
            name: item.name || short, description: item.description || "", enabled: true,
          })
        } else {
          // 技能包：逐个 entry 装到本地，每个传 skill_md_path 锁定那个 SKILL.md
          for (const entry of entries) {
            const path = (entry.path || "").replace(/^\/+|\/+$/g, "")
            const skillMdPath = path ? `${path}/${entry.entry || "SKILL.md"}` : (entry.entry || "SKILL.md")
            await localCrud.importUrl(url, {
              name: entry.name || item.name || short,
              description: item.description || "",
              enabled: true,
              skill_md_path: skillMdPath,
            })
          }
        }
        toast.success(`已安装${noun}「${short}」${entries.length > 1 ? `（${entries.length} 个 skill）` : ""}`)
      } else {
        const raw = install.plugin?.download_url || `https://github.com/${repo}/archive/refs/heads/main.zip`
        const url = raw.replace(/\.tar\.gz$/, ".zip")
        await localCrud.importUrl(url, {
          name: item.name || short, description: item.description || "", enabled: true,
        })
        toast.success(`已安装${noun}「${short}」`)
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `安装${noun}失败`)
    } finally {
      setBoardInstalling(null)
    }
  }

  const openDetail = async (item: MarketItem) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await fetchMarketManifest(module, item.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败")
    } finally {
      setDetailLoading(false)
    }
  }

  const download = (manifest: MarketManifest) => {
    const url = manifest.download_url || manifest.source_url
    if (!url) {
      toast.error(`该${noun}没有可下载地址`)
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  /**
   * 复制引用 spec。已镜像的优先取服务端 archive spec（url 指向我们、带 fetch_token），
   * 这样节点走 HTTP 拉存档 + 节点级缓存，不再直连 GitHub。未镜像的退回原始来源 spec。
   */
  const copySpec = async (manifest: MarketManifest) => {
    let spec: Record<string, unknown> = manifestToSpec(manifest)
    let mirrored = false
    const m = manifest.id ? mirrorByMarket.get(manifest.id) : undefined
    if (m && m.status === "ready") {
      try {
        const res = await getMirrorSpec(module, manifest.id, m.version || "")
        spec = res.spec
        mirrored = true
      } catch (e: any) {
        // 取镜像 spec 失败时不静默降级成"看起来一样"的原始 spec，明确告知
        toast.error(`取镜像引用失败，已复制原始来源 spec: ${e?.message}`)
      }
    }
    void navigator.clipboard?.writeText(JSON.stringify(spec, null, 2))
    toast.success(
      mirrored
        ? `已复制 ${specLabel}（指向服务端镜像）；在编辑器资源中勾选即可使用`
        : `已复制 ${specLabel}；在编辑器资源中勾选可直接保存并下载`,
    )
  }

  const toggleReference = async (marketId: string) => {
    const existing = referenceByMarket.get(marketId)
    setReferencing(marketId)
    try {
      if (existing) {
        await deleteResourceReference(existing.id)
        setReferences((current) => current.filter((item) => item.id !== existing.id))
        toast.success(`已取消引用${noun}`)
      } else {
        const created = await createResourceReference(module, marketId)
        setReferences((current) => [...current.filter((item) => item.market_id !== marketId), created])
        toast.success(`已引用${noun}，现在可以分配给团队`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败")
    } finally {
      setReferencing(null)
    }
  }

  const copyShortcut = `复制 ${specLabel}`

  const openLocalCreate = () => {
    setLocalEditing(null)
    setImportSource("upload")
    setImportFile(null)
    setImportUrl("")
    setLocalName("")
    setLocalDescription("")
    setLocalEnabled(true)
    setParsedMeta(null)
    setParseStep("input")
  }

  const parseAndPreview = async () => {
    if (!localCrud) return
    setParsing(true)
    try {
      const meta =
        importSource === "upload"
          ? (importFile
            ? await localCrud.parseUpload!(importFile)
            : null)
          : importUrl.trim()
            ? await localCrud.parseUrl!(importUrl.trim())
            : null
      if (!meta) {
        toast.error(importSource === "upload" ? "请选择要导入的文件" : "请填写下载链接")
        return
      }
      setParsedMeta(meta)
      // 用识别结果预填名称/描述，用户可在确认步覆盖。
      setLocalName(meta.name || "")
      setLocalDescription(meta.description || "")
      setParseStep("confirm")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "识别失败")
    } finally {
      setParsing(false)
    }
  }

  const openLocalEdit = (item: LocalItem) => {
    setLocalEditing(item)
    setLocalName(item.name || "")
    setLocalDescription(item.description || "")
    setLocalEnabled((item as { enabled?: boolean }).enabled !== false)
    setParsedMeta(null)
    setParseStep("input")
  }

  const saveLocal = async () => {
    if (!localCrud) return
    setLocalSaving(true)
    try {
      const payload = {
        name: localName.trim() || undefined,
        description: localDescription || undefined,
        enabled: localEnabled,
      }
      if (localEditing) {
        if (!payload.name) {
          toast.error(`请填写${noun}名称`)
          return
        }
        await localCrud.update(String(localEditing.id), {
          name: payload.name,
          description: localDescription,
          enabled: localEnabled,
        })
        toast.success(`已更新${noun}`)
      } else if (importSource === "upload") {
        if (!importFile) {
          toast.error("请选择要导入的文件")
          return
        }
        await localCrud.importUpload(importFile, payload)
        toast.success(`已导入${noun}`)
      } else {
        if (!importUrl.trim()) {
          toast.error("请填写下载链接")
          return
        }
        await localCrud.importUrl(importUrl.trim(), payload)
        toast.success(`已导入${noun}`)
      }
      setLocalEditing(undefined)
      setParsedMeta(null)
      setParseStep("input")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setLocalSaving(false)
    }
  }

  const removeLocal = async (item: LocalItem) => {
    if (!localCrud || !item.id || !confirm(`删除${noun}「${item.name || item.id}」？`)) return
    try {
      await localCrud.remove(String(item.id))
      toast.success(`已删除${noun}`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {!forcedView && <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList>
            <TabsTrigger value="local">本地可用（{localItems.length}）</TabsTrigger>
            <TabsTrigger value="market">市场（{marketItems.length}）</TabsTrigger>
          </TabsList>
        </Tabs>}
        <Input
          placeholder="搜索名称、描述或标签"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <div className="ml-auto flex items-center gap-3">
          {view === "local" && localCrud && (
            <Button size="sm" onClick={openLocalCreate}>导入{noun}</Button>
          )}
          {view === "market" && !userMode ? (
            <>
              <ToggleGroup
                type="single"
                value={mirrorFilter}
                onValueChange={(v) => v && setMirrorFilter(v as "all" | "mirrored" | "unmirrored")}
                size="sm"
              >
                <ToggleGroupItem value="all" aria-label="全部">全部</ToggleGroupItem>
                <ToggleGroupItem value="mirrored" aria-label="已镜像">已镜像</ToggleGroupItem>
                <ToggleGroupItem value="unmirrored" aria-label="未镜像">未镜像</ToggleGroupItem>
              </ToggleGroup>
              <Label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={onlyReferenced} onCheckedChange={setOnlyReferenced} size="sm" />
                仅看已引用
              </Label>
            </>
          ) : null}
          <ManagerRefreshButton
            loading={loading}
            onClick={() => {
              invalidateMarketCache()
              void load(true)
            }}
          />
        </div>
      </div>

      {loading || boardLoading || (view === "market" && marketEnabled === undefined) ? (
        <Empty>
          <Spinner /> 加载中...
        </Empty>
      ) : view === "market" && marketEnabled === false && boardFiltered.length === 0 ? (
        <Empty>
          <div>市场未启用</div>
          <div className="text-xs text-muted-foreground">在服务端 env.ini 的 [marketplace] 配置 GitHub 仓库后即可使用</div>
        </Empty>
      ) : filtered.length === 0 && boardFiltered.length === 0 ? (
        <Empty>
          {view === "local"
            ? `暂无本地${noun}`
            : onlyReferenced
              ? `暂无已引用的${noun}`
              : `市场暂无${noun}`}
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const market = item as MarketItem
            const isMarket = view === "market"
            const reference = isMarket ? referenceByMarket.get(market.id) : undefined
            const exists = !!reference
            const mirror = isMarket ? mirrorByMarket.get(market.id) : undefined
            const mirrored = !!mirror && mirror.status === "ready"
            return (
              <Card key={item.id} size="sm" className="shadow-none">
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{market.display_name || item.name || item.id}</span>
                        {isMarket ? (
                          <Badge variant="outline" className="text-[10px]">
                            GitHub
                          </Badge>
                        ) : null}
                        {exists ? (
                          <Badge variant="secondary" className="text-[10px]">
                            已引用
                          </Badge>
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
                      {isMarket ? (
                        <span className="text-[11px] text-muted-foreground">
                          {market.latest_version ? `v${market.latest_version}` : ""}
                          {market.publisher ? ` · ${market.publisher}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                    {market.summary || (item as LocalItem).description || "暂无描述"}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    {isMarket ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void openDetail(market)}>
                          查看与下载
                        </Button>
                        {!userMode && (
                          <Button
                            size="sm"
                            variant={exists ? "outline" : "default"}
                            disabled={referencing === market.id}
                            onClick={() => void toggleReference(market.id)}
                          >
                            {referencing === market.id ? "处理中..." : exists ? "取消引用" : "引用"}
                          </Button>
                        )}
                        {!userMode && (mirrored ? (
                          <Button size="sm" variant="outline" onClick={() => void handleRefreshMirror(market.id)} title="重新拉取存档">
                            刷新镜像
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={mirroring === market.id || mirror?.status === "downloading"}
                            onClick={() => void handleMirror(market.id)}
                            title="镜像到服务端，节点会话启动时从我们拉取"
                          >
                            {mirror?.status === "downloading" || mirroring === market.id ? "镜像中..." : "镜像"}
                          </Button>
                        ))}
                      </>
                    ) : localCrud ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openLocalEdit(item as LocalItem)}>编辑</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void removeLocal(item as LocalItem)}>删除</Button>
                      </>
                    ) : (
                      <Badge variant="outline">本地资源</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {boardFiltered.map((item) => (
            <LeaderboardMarketCard
              key={`board-${item.id}`}
              item={item}
              icon={Icon}
              installed={localKeys.has(item.name || item.display_name || item.repo_full_name.split("/").pop() || item.repo_full_name)}
              busy={boardInstalling === item.id}
              onInstall={localCrud ? () => void installBoardItem(item) : undefined}
              installLabel={boardInstalling === item.id ? "安装中..." : "安装"}
            />
          ))}
        </div>
      )}

      <Dialog open={localEditing !== undefined} onOpenChange={(open) => { if (!open) { setLocalEditing(undefined); setParsedMeta(null); setParseStep("input") } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{localEditing ? `编辑${noun}` : `导入${noun}`}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!localEditing && parseStep === "input" && (
              <>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={importSource}
                  onValueChange={(value) => { if (value) setImportSource(value as "upload" | "url") }}
                >
                  <ToggleGroupItem value="upload">上传文件</ToggleGroupItem>
                  <ToggleGroupItem value="url">下载链接</ToggleGroupItem>
                </ToggleGroup>
                {importSource === "upload" ? (
                  <div className="space-y-1.5">
                    <Label>资源文件</Label>
                    <Input
                      type="file"
                      accept={module === "skills" ? ".zip,.md,text/markdown" : ".zip,application/zip"}
                      onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {module === "skills"
                        ? "支持 ZIP、SKILL.md 或 Markdown；先识别再确认导入。"
                        : "仅支持含 package.json 和有效 entry 的 ZIP 插件包。先识别再确认导入。"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>下载链接</Label>
                    <Input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://example.com/resource.zip" />
                    <p className="text-xs text-muted-foreground">服务端会限制协议、重定向、大小，下载后解析识别。</p>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    disabled={parsing || (importSource === "upload" && !importFile) || (importSource === "url" && !importUrl.trim())}
                    onClick={() => void parseAndPreview()}
                  >
                    {parsing ? "识别中..." : "识别"}
                  </Button>
                </div>
              </>
            )}
            {!localEditing && parseStep === "confirm" && parsedMeta ? (
              <>
                <div className="rounded-md border bg-muted/30 p-3 text-xs">
                  <div className="mb-1 font-medium">识别结果</div>
                  <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                    <div>来源文件：<span className="break-all text-foreground">{parsedMeta.filename}</span></div>
                    <div>识别名称：<span className="text-foreground">{parsedMeta.name || "（未识别到名称）"}</span></div>
                    {parsedMeta.entry && <div>入口：<span className="text-foreground">{parsedMeta.entry}</span></div>}
                    {parsedMeta.root && <div>根目录：<span className="text-foreground">{parsedMeta.root}</span></div>}
                    {parsedMeta.tags && parsedMeta.tags.length > 0 && (
                      <div className="col-span-2">标签：<span className="text-foreground">{parsedMeta.tags.join("、")}</span></div>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5"><Label>名称（可选，覆盖识别结果）</Label><Input value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder={parsedMeta.name || ""} /></div>
                <div className="space-y-1.5"><Label>描述（可选，覆盖识别结果）</Label><Textarea value={localDescription} onChange={(e) => setLocalDescription(e.target.value)} rows={2} placeholder={parsedMeta.description || ""} /></div>
                <label className="flex items-center justify-between rounded-md border p-3 text-sm"><span>启用</span><Switch checked={localEnabled} onCheckedChange={setLocalEnabled} /></label>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setParseStep("input"); setParsedMeta(null) }}>返回修改</Button>
                  <Button disabled={localSaving} onClick={() => void saveLocal()}>{localSaving ? "导入中..." : "确认导入"}</Button>
                </div>
              </>
            ) : localEditing ? (
              <>
                <div className="space-y-1.5"><Label>名称</Label><Input value={localName} onChange={(e) => setLocalName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>描述</Label><Textarea value={localDescription} onChange={(e) => setLocalDescription(e.target.value)} rows={2} /></div>
                <label className="flex items-center justify-between rounded-md border p-3 text-sm"><span>启用</span><Switch checked={localEnabled} onCheckedChange={setLocalEnabled} /></label>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setLocalEditing(undefined)}>取消</Button><Button disabled={localSaving || !localName.trim()} onClick={() => void saveLocal()}>{localSaving ? "保存中..." : "保存"}</Button></div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detail || detailLoading}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null)
            setDetailLoading(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.display_name || detail?.name || `${noun}详情`}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Spinner /> 加载中...
            </div>
          ) : detail ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{detail.summary || detail.description || "暂无描述"}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>version: {detail.version || "-"}</div>
                <div>publisher: {detail.publisher || "-"}</div>
                <div className="col-span-2 break-all">source: {detail.source_url || detail.download_url || "-"}</div>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 text-xs">
                {JSON.stringify(detail, null, 2)}
              </pre>
              <div className="flex flex-wrap justify-end gap-2">
                {!userMode && (() => {
                  const m = detail.id ? mirrorByMarket.get(detail.id) : undefined
                  const ready = !!m && m.status === "ready"
                  return (
                    <>
                      {ready ? (
                        <>
                          <Badge variant="secondary" className="text-[10px] self-center">
                            已镜像 · {formatSize(m!.size_bytes)} · sha256 {m!.digest.slice(0, 8)}
                          </Badge>
                          <Button variant="outline" onClick={() => void handleRefreshMirror(detail.id!)} disabled={mirroring === detail.id}>
                            刷新镜像
                          </Button>
                          <Button variant="outline" onClick={() => void handleDeleteMirror(detail.id!)}>
                            删除镜像
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() => void handleMirror(detail.id!)}
                          disabled={mirroring === detail.id || m?.status === "downloading"}
                        >
                          {m?.status === "downloading" || mirroring === detail.id ? "镜像中..." : m?.status === "error" ? "重新镜像" : "镜像到服务端"}
                        </Button>
                      )}
                    </>
                  )
                })()}
                <Button variant="outline" onClick={() => void copySpec(detail)}>
                  {copyShortcut}
                </Button>
                <Button onClick={() => download(detail)}>下载 / 打开来源</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
