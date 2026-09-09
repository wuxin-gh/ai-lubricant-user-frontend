/**
 * 榜单条目「外部数据」查看弹窗（只读）。
 *
 * 上游事实只在这里看：仓库 / 榜单 / 名次 / 热度 / 上游分类 / 上游描述 / 时间戳。
 * 一个字都改不了——它们是同步进来的参考（external_data 快照），不是编辑对象。
 * 要编辑资源（身份 / 分类 / 启动方式 / 标签）去「编辑」，那是和正常市场资源同一套表单。
 */
import { ExternalLink, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fmtSyncAt } from "./leaderboard-labels"
import type { LeaderboardItem } from "@/api/marketplaceAdmin"
import { BOARD_LABELS, MODULE_LABELS, normalizeModules } from "./leaderboard-labels"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  )
}

export function LeaderboardItemInfo({
  item,
  onClose,
  onEdit,
}: {
  item: LeaderboardItem | null
  onClose: () => void
  /** 「去编辑」——看完信息直接切到编辑弹窗，不用回卡片再点一次。 */
  onEdit: (item: LeaderboardItem) => void
}) {
  if (!item) return null
  const published = item.status === "published"

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] w-[92vw] max-w-2xl gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b bg-muted/30 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 pr-8 text-base">
            <span className="min-w-0 truncate">{item.repo_full_name}</span>
            <a
              href={item.repo_url}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-muted-foreground hover:text-primary"
              aria-label={`在 GitHub 打开 ${item.repo_full_name}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            {published ? (
              <Badge variant="default" className="shrink-0 text-[10px]">已发布</Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0 text-[10px]">草稿</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 px-6 py-5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            外部数据（只读，同步自上游）
          </div>
          <Row label="仓库">{item.repo_full_name}</Row>
          <Row label="GitHub 地址">
            <a href={item.repo_url} target="_blank" rel="noreferrer noopener" className="text-primary underline break-all">
              {item.repo_url}
            </a>
          </Row>
          <Row label="来源榜单">{BOARD_LABELS[item.board] || item.board}</Row>
          <Row label="上游名次">
            {item.upstream_rank != null
              ? `第 ${item.upstream_rank} 名${item.rank_overridden ? "（展示名次已手动固定，不再跟随上游）" : ""}`
              : "未上榜"}
          </Row>
          <Row label="分类">
            {normalizeModules(item.target_modules, item.target_module).length > 0 ? (
              <span className="inline-flex flex-wrap gap-1">
                {normalizeModules(item.target_modules, item.target_module).map((m) => (
                  <Badge key={m} variant="default" className="text-[10px]">{MODULE_LABELS[m]}</Badge>
                ))}
              </span>
            ) : <Badge variant="secondary" className="text-[10px]">未分类</Badge>}
            {!item.installable ? <span className="ml-2 text-xs text-muted-foreground">仅浏览（无下载入口）</span> : null}
          </Row>
          <Row label="热度">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3" />{item.stars.toLocaleString()} star
              <span className="text-muted-foreground">· {item.forks.toLocaleString()} fork</span>
            </span>
          </Row>
          {item.language ? <Row label="主要语言">{item.language}</Row> : null}
          {item.upstream_category ? <Row label="上游分类">{item.upstream_category}</Row> : null}
          {item.description ? <Row label="上游描述">{item.description}</Row> : null}
          {(item.topics || []).length > 0 ? (
            <Row label="关键词">
              <span className="flex flex-wrap gap-1">
                {item.topics.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
              </span>
            </Row>
          ) : null}
          {(item.use_cases || []).length > 0 ? (
            <Row label="上游场景">
              <span className="flex flex-wrap gap-1">
                {item.use_cases.map((u) => <Badge key={u} variant="outline" className="text-[10px]">{u}</Badge>)}
              </span>
            </Row>
          ) : null}
          {item.launch_spec_status ? <Row label="启动方式状态">{item.launch_spec_status}</Row> : null}
          {item.launch_spec_error ? (
            <Row label="补全错误"><span className="text-destructive">{item.launch_spec_error}</span></Row>
          ) : null}
          <Row label="最近同步">{fmtSyncAt(item.last_synced_at) || "-"}</Row>
          <Row label="上游更新">{fmtSyncAt(item.upstream_updated_at) || "-"}</Row>
          {published ? (
            <Row label="发布信息">
              {item.published_by ? `由 ${item.published_by}` : "已发布"}{item.published_at ? ` · ${fmtSyncAt(item.published_at)}` : ""}
            </Row>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t bg-muted/30 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button variant="outline" onClick={() => { onClose(); onEdit(item) }}>去编辑</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
