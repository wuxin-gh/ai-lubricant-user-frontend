import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fetchMarketIndex, fetchMarketManifest, type MarketItem, type MarketManifest } from "@/api/marketplaceRaw"
import {
  LeaderboardMarketCard,
  filterLeaderboardItems,
  useLeaderboardMarket,
} from "@/components/marketplace/LeaderboardMarketCards"
import {
  createResourceReference,
  deleteResourceReference,
  listResourceReferences,
  type ResourceReference,
} from "@/api/resourceReferences"
import type { ProjectPrompt } from "@/@admin-port/api/projectPrompts"
import ProjectPromptsSettings from "@/components/console/settings/project-prompts"
import { ProjectPrompts } from "@/pages/manager/platform/ProjectPrompts"
import { toast } from "sonner"

type View = "local" | "market"

export function PromptResourcePanel({ forcedView, userMode = false }: { forcedView?: View; userMode?: boolean } = {}) {
  const [internalView, setInternalView] = useState<View>("local")
  const view = forcedView ?? internalView
  const setView: (value: View) => void = forcedView ? () => {} : setInternalView
  const [market, setMarket] = useState<MarketItem[]>([])
  const [references, setReferences] = useState<ResourceReference[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [referencing, setReferencing] = useState<string | null>(null)
  const [detail, setDetail] = useState<MarketManifest | null>(null)
  // 榜单里的提示词条目：与 index.json 条目混在同一网格，只有这些有 star/fork 热度。
  const { items: boardItems, loading: boardLoading } = useLeaderboardMarket("prompt", {
    enabled: view === "market",
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [items, refs] = await Promise.all([
        fetchMarketIndex("prompts").catch(() => []),
        userMode
          ? Promise.resolve([] as ResourceReference[])
          : listResourceReferences("project_prompt").catch(() => []),
      ])
      setMarket(items)
      setReferences(refs)
    } finally {
      setLoading(false)
    }
  }, [userMode])

  useEffect(() => { void load() }, [load])

  const referenceByMarket = useMemo(
    () => new Map(references.map((reference) => [reference.market_id, reference])),
    [references],
  )
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? market.filter((item) => JSON.stringify(item).toLowerCase().includes(needle)) : market
  }, [market, query])
  const boardFiltered = useMemo(() => filterLeaderboardItems(boardItems, query), [boardItems, query])

  const toggleReference = async (marketId: string) => {
    setReferencing(marketId)
    try {
      const current = referenceByMarket.get(marketId)
      if (current) {
        await deleteResourceReference(current.id)
        setReferences((rows) => rows.filter((row) => row.id !== current.id))
        toast.success("已取消引用项目提示词")
      } else {
        const created = await createResourceReference("prompts", marketId)
        setReferences((rows) => [...rows.filter((row) => row.market_id !== marketId), created])
        await load()
        toast.success("已引用项目提示词，现在可以分配给团队")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败")
    } finally {
      setReferencing(null)
    }
  }

  const openDetail = async (item: MarketItem) => {
    const manifest = await fetchMarketManifest("prompts", item.id)
    if (!manifest) toast.error("加载提示词失败")
    else setDetail(manifest)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {!forcedView && (
          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList>
              <TabsTrigger value="local">本地（CRUD）</TabsTrigger>
              <TabsTrigger value="market">市场（{market.length}）</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {view === "market" && <Input className="max-w-sm" placeholder="搜索名称或内容" value={query} onChange={(event) => setQuery(event.target.value)} />}
        {view === "market" && <Button className="ml-auto" size="sm" variant="outline" onClick={() => void load()}>刷新</Button>}
      </div>

      {view === "local" ? (
        // 本地 Tab：直接复用既有 CRUD 组件，不再只读展示。
        userMode ? <ProjectPromptsSettings /> : <ProjectPrompts />
      ) : loading || boardLoading ? <Empty><Spinner /> 加载中...</Empty> : items.length === 0 && boardFiltered.length === 0 ? <Empty>暂无项目提示词</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((raw) => {
            const item = raw as MarketItem & ProjectPrompt
            const referenced = referenceByMarket.get(item.id)
            return (
              <Card key={item.id} size="sm" className="shadow-none">
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <div className="flex size-9 items-center justify-center rounded-md bg-muted"><FileText className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{item.display_name || item.name || item.id}</span>
                        <Badge variant="outline" className="text-[10px]">市场</Badge>
                        {!userMode && referenced && <Badge variant="secondary" className="text-[10px]">已引用</Badge>}
                      </div>
                      {item.latest_version && <span className="text-[11px] text-muted-foreground">v{item.latest_version}</span>}
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-3 text-xs text-muted-foreground">{item.summary || "暂无描述"}</p>
                  <div className="mt-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void openDetail(item)}>查看</Button>
                    {!userMode && (
                      <Button size="sm" variant={referenced ? "outline" : "default"} disabled={referencing === item.id} onClick={() => void toggleReference(item.id)}>
                        {referencing === item.id ? "处理中..." : referenced ? "取消引用" : "引用"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {/* 榜单来的提示词仓库：有 star/fork 热度，没有 manifest，所以只跳 GitHub。 */}
          {boardFiltered.map((it) => (
            <LeaderboardMarketCard key={`board-${it.id}`} item={it} icon={FileText} />
          ))}
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{detail?.display_name || detail?.name}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{detail.summary}</p>
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">
                {String((detail.resource as Record<string, unknown> | undefined)?.content || "")}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
