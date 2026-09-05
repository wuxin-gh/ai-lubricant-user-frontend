/**
 * 榜单条目视图：草稿与已发布在一个列表里，用「状态」筛选切换，不拆两个 tab。
 *
 * 筛选轴：
 * - 榜单（board）= 上游哪个榜抓来的（同步时按它预填默认分类）
 * - 状态（status）= 草稿 / 已发布 / 全部
 * - 仅浏览（installable=false）= 资源中心不给下载入口，但发布后照样给用户看
 *
 * 编辑走与市场资源同一个弹框（``MarketplaceEditDialog`` 榜单变体）：分类多选、
 * 身份与安装参数由上游预填。MCP 启动方式有专门的批量识别弹框（勾选一次提交），
 * 单条的「补启动方式」按钮保留。
 */
import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Info, Pencil, Plus, ShieldCheck, Sparkles, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { StackBadges } from "@/components/ui/stack-badges"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createLeaderboardItem,
  fetchLeaderboardItems,
  fillLeaderboardLaunchSpec,
  publishLeaderboardItems,
  unpublishLeaderboardItems,
  updateLeaderboardItem,
  verifyLeaderboardItem,
  type LeaderboardItem,
} from "@/api/marketplaceAdmin"
import { ALL_BOARDS, ALL_MODULES, BOARD_LABELS, MODULE_LABELS, normalizeModules } from "./leaderboard-labels"
import { MarketplaceEditDialog, type LeaderboardCurationPatch } from "./MarketplaceEditDialog"
import { LeaderboardItemInfo } from "./LeaderboardItemInfo"
import { LeaderboardLaunchSpecDialog } from "./LeaderboardLaunchSpecDialog"
import { toast } from "sonner"

/** 条目的全部分类：多选数组优先，旧数据/旧后端（JSON 字符串、单值列）由 normalizeModules 收口。 */
function modulesOf(item: LeaderboardItem): string[] {
  return normalizeModules(item.target_modules, item.target_module)
}

type StatusFilter = "draft" | "published" | "all"
/** 仅浏览筛选：全部 / 只看仅浏览 / 只看可安装。 */
type BrowseFilter = "all" | "browse" | "installable"

/** 技术栈 tag 快捷筛选项（stack_tags 投影里的常用值；探针识别会覆盖更多）。 */
const STACK_TAG_FILTERS = [
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
  // MCP 启动方式批量识别弹框
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false)
  // 手动添加 GitHub 项目
  const [addOpen, setAddOpen] = useState(false)
  const [addRepo, setAddRepo] = useState("")
  const [adding, setAdding] = useState(false)
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
      const result = await publishLeaderboardItems(ids)
      const parts = [`已发布 ${result.count} 项`]
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} 项已是发布态`)
      if (result.failed.length > 0) {
        parts.push(`${result.failed.length} 项失败`)
        toast.warning(parts.join("；"), {
          description: result.failed.map((f) => `#${f.id} ${f.error}`).join("\n"),
        })
      } else {
        toast.success(parts.join("；"))
      }
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败")
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

  const handleFillLaunch = (item: LeaderboardItem) =>
    void withBusy(item.id, async () => {
      try {
        await fillLeaderboardLaunchSpec(item.id)
        toast.success("已提交给专用 agent，补出的启动方式是草稿，确认后再发布")
        await load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "触发补全失败")
      }
    })

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
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />手动添加
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLaunchDialogOpen(true)}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />批量识别
          </Button>
          <Button size="sm" disabled={selected.size === 0} onClick={() => void handlePublish([...selected])}>
            批量发布（{selected.size}）
          </Button>
          <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => void handleUnpublish([...selected])}>
            批量撤回（{selected.size}）
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
            return (
              <Card key={item.id} className={busy ? "opacity-60" : ""}>
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex items-start gap-2">
                    <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{item.repo_full_name}</span>
                        <a
                          href={item.repo_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`在 GitHub 打开 ${item.repo_full_name}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          title="点击修改排序（资源中心索引）"
                          onClick={() => void handleEditSort(item)}
                          className="inline-flex items-center gap-0.5 rounded px-1 font-medium text-foreground hover:bg-muted"
                        >
                          #{item.sort_order ?? item.display_rank ?? "-"}
                        </button>
                        <span className="flex items-center gap-0.5">
                          <Star className="h-3 w-3" />{item.stars.toLocaleString()}
                        </span>
                        {item.language ? <span>{item.language}</span> : null}
                        <span>{BOARD_LABELS[item.board] || item.board}</span>
                      </div>
                    </div>
                  </div>

                  {item.description ? (
                    <div className="line-clamp-2 text-sm text-muted-foreground">{item.description}</div>
                  ) : null}

                  <div className="flex flex-wrap gap-1">
                    {published ? (
                      <Badge variant="default" className="text-[10px]">已发布</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">草稿</Badge>
                    )}
                    {modules.map((m) => (
                      <Badge key={m} variant="outline" className="text-[10px]">{MODULE_LABELS[m]}</Badge>
                    ))}
                    {browseOnly ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">仅浏览</Badge>
                    ) : null}
                    {item.launch_spec_status === "filled" ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-600">启动方式已补</Badge>
                    ) : null}
                    {item.launch_spec_status === "verified" ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-600">已验证</Badge>
                    ) : null}
                    {item.launch_spec_status === "failed" ? (
                      <Badge variant="outline" className="text-[10px] text-destructive">补全失败</Badge>
                    ) : null}
                    {item.stack && (item.stack.primary_language || (item.stack.frameworks || []).length > 0) ? (
                      <StackBadges stack={item.stack} max={2} />
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setInfoItem(item)}>
                      <Info className="mr-1 h-3 w-3" />信息
                    </Button>

                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setDetail(item)}>
                      <Pencil className="mr-1 h-3 w-3" />编辑
                    </Button>

                    {modules.includes("mcp") && !["filled", "verified"].includes(item.launch_spec_status) ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleFillLaunch(item)}>
                        <Sparkles className="mr-1 h-3 w-3" />补启动方式
                      </Button>
                    ) : null}

                    {modules.includes("mcp") && ["filled", "failed", "verified"].includes(item.launch_spec_status) ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleVerify(item)}>
                        <ShieldCheck className="mr-1 h-3 w-3" />验证
                      </Button>
                    ) : null}

                    {published ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleUnpublish([item.id])}>撤回</Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => void handlePublish([item.id])}>发布</Button>
                    )}
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

      {/* 编辑走与市场资源同一个弹框（榜单变体：分类多选 + 上游预填 + 逐项同步） */}
      <MarketplaceEditDialog
        open={!!detail}
        onOpenChange={(v) => { if (!v) setDetail(null) }}
        mode="skill"
        item={null}
        onSave={async () => { /* 榜单变体不走这里 */ }}
        leaderboardItem={detail}
        onLeaderboardSave={handleSaveDetail}
        onFillLaunch={(it) => handleFillLaunch(it)}
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

      {/* 批量识别仓库信息 */}
      <LeaderboardLaunchSpecDialog
        open={launchDialogOpen}
        onOpenChange={setLaunchDialogOpen}
        onDone={() => void load()}
      />
    </div>
  )
}

