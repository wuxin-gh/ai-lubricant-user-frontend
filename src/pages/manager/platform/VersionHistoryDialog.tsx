import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { fetchMarketIndex, fetchMarketManifest } from "@/api/marketplaceRaw"

/**
 * 市场版本历史弹框：node-versions / mobile-versions / device-control-versions 共用。
 *
 * index 里每条即一个版本（item.id = 版本号）；打开时并行拉全部 manifest 补全版本说明
 * 与更新时间——版本数量少（发行历史通常几十条内），且前端 marketplaceRaw 已有 3 秒
 * 去重缓存，管理端打开两次也几乎不重复打网络。
 */

type VersionModule = "node-versions" | "mobile-versions" | "device-control-versions"

interface HistoryRow {
  version: string
  test: boolean
  updatedAt: string
  notes: string
}

/**
 * 版本号降序比较，与 MarketplaceAdmin 同口径：``YYYYMMDD-HHMM``（可带 ``-N`` 后缀）
 * 与 semver 都按数字分段比大小；缺版本号的排最后，段数不等时短的补 0。
 */
function compareVersionDesc(a: HistoryRow, b: HistoryRow): number {
  const left = a.version.trim()
  const right = b.version.trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  const segs = (v: string) => v.split(/[.\-+]/).map((s) => Number.parseInt(s, 10))
  const ls = segs(left)
  const rs = segs(right)
  for (let i = 0; i < Math.max(ls.length, rs.length); i += 1) {
    const l = Number.isFinite(ls[i]) ? ls[i] : 0
    const r = Number.isFinite(rs[i]) ? rs[i] : 0
    if (l !== r) return r - l
  }
  return right.localeCompare(left)
}

export function VersionHistoryDialog({
  module,
  title,
  open,
  onOpenChange,
}: {
  module: VersionModule
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<HistoryRow[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setRows([])
    void (async () => {
      try {
        const items = await fetchMarketIndex(module)
        const manifests = await Promise.allSettled(
          items.map((it) => fetchMarketManifest(module, it.id)),
        )
        const next: HistoryRow[] = []
        items.forEach((item, i) => {
          const settled = manifests[i]
          const manifest = settled.status === "fulfilled" ? settled.value : null
          const extra = (manifest || {}) as Record<string, unknown>
          next.push({
            version: String(manifest?.version || item.latest_version || item.id),
            test: item.test_version === true,
            updatedAt: String(extra.updated_at || ""),
            // manifest 拉取失败时回落 index summary（服务端写入时取 version_notes 首行），
            // 保证每条历史都有描述可看。
            notes: String(extra.version_notes || extra.release_notes || item.summary || ""),
          })
        })
        next.sort(compareVersionDesc)
        if (!cancelled) setRows(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [module, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader className="pb-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">市场尚未发布版本</div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={`${row.version}-${row.updatedAt}`} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">v{row.version}</span>
                    {row.test ? <Badge variant="secondary">测试版</Badge> : null}
                    {row.updatedAt ? (
                      <span className="text-xs text-muted-foreground">更新日期：{row.updatedAt}</span>
                    ) : null}
                  </div>
                  {row.notes ? (
                    <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                      {row.notes}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
