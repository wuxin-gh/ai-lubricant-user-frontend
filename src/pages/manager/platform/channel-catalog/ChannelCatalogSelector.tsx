import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Search } from "lucide-react"

import { getChannelCatalog, refreshChannelCatalog } from "@/@admin-port/api/providers"
import type { ChannelCatalogEntry } from "@/@admin-port/types/admin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ChannelIcon, channelIconKey } from "./ChannelIcon"

function channelType(item: ChannelCatalogEntry): string {
  if (item.id === "custom") return "通用"
  if (item.builtin_type) return "内置"
  return "其他"
}

export function ChannelCatalogSelector({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (entry: ChannelCatalogEntry) => void
}) {
  const [items, setItems] = useState<ChannelCatalogEntry[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  // 是否已经拉过一次（无论成功失败）。避免每次返回选择都重复请求；
  // 失败也算加载过，要更新数据请点「刷新」按钮。
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError("")
    try {
      const result = refresh ? await refreshChannelCatalog() : await getChannelCatalog()
      setItems(result.items || [])
      setStale(result.stale)
      if (result.error) setError(result.error)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "渠道列表加载失败")
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  // 打开时仅在首次（未加载过）才拉，避免每次返回选择都重复请求。
  useEffect(() => {
    if (open && !loaded) void load(false)
  }, [load, open, loaded])

  // 自定义渠道恒排第一，其余按目录返回顺序（系统内置在前、远端项目随后）。
  // 索引仅前端展示用，不写进 manifest、不落库。
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? items.filter((item) => [item.name, item.description, item.category, ...(item.tags || [])]
          .some((value) => String(value || "").toLowerCase().includes(needle)))
      : items
    return [...matched].sort((a, b) => {
      const ac = a.id === "custom" ? 0 : 1
      const bc = b.id === "custom" ? 0 : 1
      return ac - bc
    })
  }, [items, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-none flex-col gap-4 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="text-lg">选择渠道</DialogTitle>
          <DialogDescription>选择后进入添加详情，配置渠道地址、协议、计费方式、冻结策略和账号。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 px-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索渠道名称、分类或标签" className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />刷新
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          {(error || stale) && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {error || "渠道列表可能不是最新，当前内容仍可正常使用"}
            </div>
          )}
          {loading && items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">正在加载渠道…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">没有匹配的渠道</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onSelect(structuredClone(item)); onOpenChange(false) }}
                  className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ChannelIcon
                        name={channelIconKey({
                          icon: item.icon,
                          builtin_type: item.builtin_type,
                          id: item.id,
                          category: item.category,
                          protocols: item.preset.chat_protocols?.map((row) => row.protocol),
                        })}
                        className="size-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-foreground">{item.name}</div>
                      <div className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{item.description}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge>{channelType(item)}</Badge>
                    {item.category && <Badge variant="outline">{item.category}</Badge>}
                    {(item.tags || []).slice(0, 4).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
