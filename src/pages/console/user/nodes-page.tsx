import { RefreshCw, Server } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import Nodes from "@/components/console/settings/nodes"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"

/**
 * 执行节点页（/console/nodes）。原先藏在「配置」弹框的节点分区，提为侧栏顶级页面。
 *
 * 节点的入驻/审批/分配归管理端；这里是使用侧：查看被授权的节点、开终端（含文件浏览
 * 器与 AI 助手）、删除执行节点与运行时管理（详情「运行时」tab）。列表本体复用设置
 * 弹框里的 `Nodes` 组件（它自取 useCommonData().nodes）；页面自带页头，故不传
 * showHeader——`Nodes` 内部标题栏只在设置弹框里渲染，避免双标题栏。
 */
export default function UserNodesPage() {
  const { reloadNodes } = useCommonData()
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reloadNodes()
      toast.success("已刷新节点列表")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 py-2">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <Server className="size-4" />
            执行节点
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            任务与编辑器的运行时节点。节点由管理端入驻、审批并分配给分组；这里可查看被授权的节点、打开终端，并对执行节点做删除与运行时管理（升级、装编辑器、升级代理）。
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Nodes />
      </div>
    </div>
  )
}
