/**
 * 市场里的榜单条目卡片。
 *
 * 市场列表有两个数据源，混在同一个网格里显示：
 * - GitHub 仓库的 ``index.json``（``MarketItem``）——我们自己维护的 manifest，有版本/发布者，没有热度。
 * - 外部榜单同步下来并发布的条目（``LeaderboardDiscoverItem``）——从 GitHub 抓的仓库，
 *   有 star/fork/语言/关键词这些热度事实，但没有 manifest。
 *
 * 所以热度只画在榜单条目上：不是榜单来的本来就没有这些数字，留空比补 0 诚实。
 * ``installable=false``（开发框架、研究程序、awesome 目录）只渲染成跳 GitHub 的卡片。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { ExternalLink, GitFork, Star, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StackBadges } from "@/components/ui/stack-badges"
import { normalizeModules, normalizeSkillInstallSpec } from "./leaderboard-labels"
import { fetchLeaderboardDiscover, type LeaderboardDiscoverItem } from "@/api/marketplaceRaw"

/**
 * 客户端翻页器：上一页 / 第 x/y 页 · 共 n 个 / 下一页。
 * 复用 ModelMetadata 的 Pager 样式；资源中心「自己资源」与「市场」两处共用。
 */
export function MarketPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, totalPages)
  if (total === 0) return null
  return (
    <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
      <Button size="sm" variant="outline" onClick={() => onPageChange(current - 1)} disabled={current <= 1}>
        上一页
      </Button>
      <span>第 {current}/{totalPages} 页 · 共 {total} 个</span>
      <Button size="sm" variant="outline" onClick={() => onPageChange(current + 1)} disabled={current >= totalPages}>
        下一页
      </Button>
    </div>
  )
}

/** 默认每页条数：3 列网格 × 8 行 = 24。 */
export const MARKET_PAGE_SIZE = 24

/** 榜单的 target_module 取值，与后端 ``classify()`` 的映射一致。 */
export type LeaderboardModule = "mcp" | "skill" | "plugin" | "prompt"

/**
 * 拉取某类已发布榜单条目。``enabled=false`` 时不发请求（市场 tab 没打开就别打服务端）。
 * 失败静默返回空——榜单挂了不该让整个市场列表报错。
 * ``stackTag`` 技术栈 tag 过滤（python/typescript/web_frontend…），与后端 stack_tags @> 对齐。
 */
export function useLeaderboardMarket(
  targetModule: LeaderboardModule,
  options: { enabled?: boolean; reloadKey?: unknown; stackTag?: string } = {},
): { items: LeaderboardDiscoverItem[]; loading: boolean } {
  const { enabled = true, reloadKey, stackTag } = options
  const [items, setItems] = useState<LeaderboardDiscoverItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      setItems(await fetchLeaderboardDiscover({ target_module: targetModule, stack_tag: stackTag, limit: 200 }))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [enabled, targetModule, stackTag])

  useEffect(() => { void load() }, [load, reloadKey])

  return { items, loading }
}

/** 按关键字过滤榜单条目（仓库名/描述/语言/关键词/场景/子技能名与说明）。空串返回原数组。 */
export function filterLeaderboardItems(
  items: LeaderboardDiscoverItem[],
  query: string,
): LeaderboardDiscoverItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    const fields: string[] = [
      item.repo_full_name,
      item.description,
      item.language,
      ...(item.topics || []),
      ...(item.use_cases || []),
    ]
    // 技能集：子技能名/说明也参与匹配——搜 "docx" 能命中 anthropics/skills 集合。
    const spec = normalizeSkillInstallSpec(item.install_spec)
    for (const entry of spec.entries) {
      fields.push(entry.name)
      if (entry.description) fields.push(entry.description)
    }
    return fields.filter(Boolean).some((field) => String(field).toLowerCase().includes(q))
  })
}

/** 热度行：名次 / star / fork / 语言。名次是榜单位置事实，热度是 GitHub 事实。 */
function HeatRow({ item }: { item: LeaderboardDiscoverItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      {item.display_rank != null ? (
        <span className="font-medium text-foreground">#{item.display_rank}</span>
      ) : null}
      <span className="inline-flex items-center gap-0.5">
        <Star className="size-3" />{item.stars.toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <GitFork className="size-3" />{item.forks.toLocaleString()}
      </span>
      {item.language ? <span>{item.language}</span> : null}
    </div>
  )
}

export function LeaderboardMarketCard({
  item,
  icon: Icon,
  installed,
  busy,
  onInstall,
  installLabel = "下载",
}: {
  item: LeaderboardDiscoverItem
  icon: LucideIcon
  /** 本地已有同名资源。有则按钮置灰，避免重复下载。 */
  installed?: boolean
  /** 安装进行中（防重复点击）。 */
  busy?: boolean
  /** 可安装条目的主操作。不传则只给「打开 GitHub」。 */
  onInstall?: (item: LeaderboardDiscoverItem) => void
  installLabel?: string
}) {
  const shortName = useMemo(
    () => item.display_name || item.repo_full_name.split("/").pop() || item.repo_full_name,
    [item.display_name, item.repo_full_name],
  )
  const topics = (item.tags || item.topics || []).slice(0, 4)
  const modules = normalizeModules(item.target_modules, item.target_module)
  // 插件容器：一行卡片 + 可展开的子技能列表（名称+说明）。整包安装/引用，任务期再勾子技能。
  // skills（存量技能集）已归 plugin 容器——两类都按容器展开。纯 zip 插件（无
  // entries）不展开——它是整包，不是容器。
  const skillSpec = useMemo(
    () => (modules.includes("skills") || modules.includes("plugin")
      ? normalizeSkillInstallSpec(item.install_spec)
      : null),
    [modules, item.install_spec],
  )
  const isCollection = !!skillSpec && skillSpec.entries.length > 0
  const [expanded, setExpanded] = useState(false)

  return (
    <Card size="sm" className="shadow-none">
      <CardContent className="flex h-full flex-col p-4">
        <div className="mb-2 flex items-start gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-muted">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{shortName}</span>
              <Badge variant="outline" className="shrink-0 text-[10px]">榜单</Badge>
              {isCollection ? (
                <Badge variant="outline" className="shrink-0 text-[10px]">技能集</Badge>
              ) : modules.length > 1 ? (
                <Badge variant="outline" className="shrink-0 text-[10px]">{modules.map((m) => m.toUpperCase()).join("+")}</Badge>
              ) : null}
              {!item.installable ? (
                <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">仅浏览</Badge>
              ) : null}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {item.publisher ? `${item.publisher} · ` : ""}{item.repo_full_name}
            </div>
          </div>
        </div>

        <HeatRow item={item} />

        {item.stack && (item.stack.primary_language || (item.stack.frameworks || []).length > 0) ? (
          <StackBadges stack={item.stack} max={3} className="mt-1" />
        ) : null}

        <p className="mb-3 mt-2 line-clamp-2 text-xs text-muted-foreground">
          {item.description || "暂无描述"}
        </p>

        {isCollection && skillSpec && skillSpec.entries.length > 0 ? (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              包含 {skillSpec.entries.length} 个子技能（整包安装，任务期再勾选）
            </button>
            {expanded ? (
              <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {skillSpec.entries.map((entry, i) => (
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

        {topics.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1">
            {topics.map((topic) => (
              <Badge key={topic} variant="secondary" className="text-[10px]">{topic}</Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={item.repo_url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" />GitHub
            </a>
          </Button>
          {item.installable && onInstall ? (
            <Button size="sm" disabled={installed || busy} onClick={() => !installed && !busy && onInstall(item)}>
              {installed ? "已下载" : installLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
