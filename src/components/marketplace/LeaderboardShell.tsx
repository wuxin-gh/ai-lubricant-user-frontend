/**
 * 外部榜单容器：市场管理页里「外部榜单」父级 tab 的内容。
 *
 * 只渲染榜单列表。配置在独立的「配置」父级 tab 里（由父页面 MarketplaceAdmin 切换）。
 * 列表内用「状态」筛选切换草稿/已发布，不拆两个视图。
 *
 * 容器只管「配没配过」的兜底：未配置时给个 Empty + 跳配置按钮，不在容器里堆同步状态。
 */
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import {
  fetchLeaderboardStatus,
  type LeaderboardStatus,
} from "@/api/marketplaceAdmin"
import { LeaderboardItemsView } from "./LeaderboardItemsView"
import { toast } from "sonner"

export function LeaderboardShell({ onGoConfig }: { onGoConfig: () => void }) {
  const [status, setStatus] = useState<LeaderboardStatus | null>(null)

  useEffect(() => {
    fetchLeaderboardStatus()
      .then((st) => setStatus(st))
      .catch((err) => toast.error(err instanceof Error ? err.message : "读取同步状态失败"))
  }, [])

  const notConfigured = status !== null && !status.configured

  if (!status) return null

  if (notConfigured) {
    return (
      <Empty>
        <div className="text-base font-medium">外部榜单同步未启用</div>
        <div className="text-sm text-muted-foreground">
          先到「配置」tab 打开同步并选好仓库；同步的条目会作为草稿进入这里，
          只有点了发布的条目才会对用户可见。
        </div>
        <Button size="sm" variant="outline" className="mt-3" onClick={onGoConfig}>去配置</Button>
      </Empty>
    )
  }

  return <LeaderboardItemsView onCountsChange={() => {}} />
}
