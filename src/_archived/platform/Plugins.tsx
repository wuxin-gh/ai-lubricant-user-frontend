import { useCallback, useEffect, useMemo, useState } from "react"
import { Package } from "lucide-react"
import { AdminPage } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  fetchMarketIndex,
  fetchMarketManifest,
  invalidateMarketCache,
  manifestToPluginSpec,
  useMarketplaceEnabled,
  type MarketItem,
  type MarketManifest,
} from "@/api/marketplaceRaw"
import { fetchPluginListing, type PluginListItem } from "@/lib/agent-resources-api"
import { toast } from "sonner"

type View = "local" | "market"
type DisplayItem = MarketItem | PluginListItem

export function Plugins() {
  const [view, setView] = useState<View>("local")
  const [localItems, setLocalItems] = useState<PluginListItem[]>([])
  const [marketItems, setMarketItems] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [detail, setDetail] = useState<MarketManifest | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // undefined=探测中，false=服务端未配 [marketplace]，true=可用
  const marketEnabled = useMarketplaceEnabled()

  const load = useCallback(async (flush = false) => {
    setLoading(true)
    try {
      // fetchMarketIndex 内部会自己解析仓库配置，未启用时返回 []，这里不用再判断
      const [local, market] = await Promise.all([
        fetchPluginListing().catch(() => []),
        fetchMarketIndex("plugins", flush).catch(() => []),
      ])
      setLocalItems(local); setMarketItems(market)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const current: DisplayItem[] = view === "local" ? localItems : marketItems
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? current.filter((item) => JSON.stringify(item).toLowerCase().includes(q)) : current
  }, [current, query])
  const localKeys = useMemo(() => new Set(localItems.flatMap((item) => [item.id, item.name].filter(Boolean))), [localItems])

  const openDetail = async (item: MarketItem) => {
    setDetailLoading(true); setDetail(null)
    try { setDetail(await fetchMarketManifest("plugins", item.id)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "加载失败") }
    finally { setDetailLoading(false) }
  }
  const download = (manifest: MarketManifest) => {
    if (!manifest.download_url) { toast.error("该插件没有下载地址"); return }
    window.open(manifest.download_url, "_blank", "noopener,noreferrer")
  }
  const copySpec = (manifest: MarketManifest) => {
    void navigator.clipboard?.writeText(JSON.stringify(manifestToPluginSpec(manifest), null, 2))
    toast.success("已复制 NodePluginSpec；在编辑器资源中勾选可直接保存并下载")
  }

  return (
    <AdminPage title="插件" description="查看平台本地插件与 GitHub 市场资源。市场下载不会创建安装记录；在编辑器资源选择器中勾选后由节点下载和物化。" primaryActions={<ManagerRefreshButton loading={loading} onClick={() => { invalidateMarketCache(); void load(true) }} />}>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}><TabsList><TabsTrigger value="local">本地可用（{localItems.length}）</TabsTrigger><TabsTrigger value="market">市场（{marketItems.length}）</TabsTrigger></TabsList></Tabs>
      <Input placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-sm" />
      {loading || (view === "market" && marketEnabled === undefined) ? <Empty><Spinner /> 加载中...</Empty> : view === "market" && marketEnabled === false ? <Empty><div>市场未启用</div><div className="text-xs text-muted-foreground">在服务端 env.ini 的 [marketplace] 配置 GitHub 仓库后即可使用</div></Empty> : filtered.length === 0 ? <Empty>{view === "local" ? "暂无本地插件" : "市场暂无插件"}</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const market = item as MarketItem
            const isMarket = view === "market"
            const exists = isMarket && localKeys.has(market.name || market.id)
            return <Card key={item.id} size="sm" className="shadow-none"><CardContent className="flex h-full flex-col p-4">
              <div className="mb-2 flex items-start gap-2"><div className="flex size-9 items-center justify-center rounded-md bg-muted"><Package className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{market.display_name || item.name || item.id}</span>{isMarket && <Badge variant="outline" className="text-[10px]">GitHub</Badge>}{exists && <Badge variant="secondary" className="text-[10px]">本地已有</Badge>}</div>{isMarket && <span className="text-[11px] text-muted-foreground">{market.latest_version ? `v${market.latest_version}` : ""}{market.publisher ? ` · ${market.publisher}` : ""}</span>}</div></div>
              <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{market.summary || item.description || "暂无描述"}</p>
              <div className="mt-auto flex gap-2">{isMarket ? <Button size="sm" variant="outline" onClick={() => void openDetail(market)}>查看与下载</Button> : <Badge variant="outline">本地资源</Badge>}</div>
            </CardContent></Card>
          })}
        </div>
      )}
      <Dialog open={!!detail || detailLoading} onOpenChange={(open) => { if (!open) { setDetail(null); setDetailLoading(false) } }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{detail?.display_name || detail?.name || "插件详情"}</DialogTitle></DialogHeader>
        {detailLoading ? <div className="py-8 text-center text-sm text-muted-foreground"><Spinner /> 加载中...</div> : detail ? <div className="flex flex-col gap-3 text-sm"><p className="text-muted-foreground">{detail.summary || detail.description || "暂无描述"}</p><div className="grid grid-cols-2 gap-2"><div>version: {detail.version || "-"}</div><div>publisher: {detail.publisher || "-"}</div><div className="col-span-2 break-all">download: {detail.download_url || "-"}</div></div><pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(detail, null, 2)}</pre><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => copySpec(detail)}>复制 NodePluginSpec</Button><Button onClick={() => download(detail)}>下载</Button></div></div> : null}
      </DialogContent></Dialog>
    </AdminPage>
  )
}
