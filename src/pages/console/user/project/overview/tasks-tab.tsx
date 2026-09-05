import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import dayjs from "dayjs"
import { toast } from "sonner"

import {
  batchDeleteUserTasks,
  batchStopUserTasks,
  listUserTasks,
  type UserTaskSummary,
} from "@/api/userTaskClient"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemFooter, ItemHeader, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { getTaskDisplayName } from "@/utils/common"
import { IconListDetails, IconPlayerStopFilled, IconTrash } from "@tabler/icons-react"

const PAGE_SIZE = 24

function isStoppable(task: UserTaskSummary): boolean {
  return task.status === "pending" || task.status === "processing"
}

export default function ProjectOverviewTasksTab({ projectId, refreshKey }: { projectId: string; refreshKey?: number }) {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<UserTaskSummary[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingAction, setPendingAction] = useState<"stop" | "delete" | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const fetchTasks = useCallback(async (nextPage: number, append: boolean) => {
    if (!projectId || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const result = await listUserTasks({ project_id: projectId, page: nextPage, page_size: PAGE_SIZE })
      setTasks((current) => append ? [...current, ...result.rows] : result.rows)
      setHasMore(nextPage * PAGE_SIZE < result.total)
      setPage(nextPage)
      if (!append) setSelectedIds(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载任务失败")
    } finally {
      loadingRef.current = false
      setLoading(false)
      setInitialLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setTasks([])
    setInitialLoading(true)
    void fetchTasks(1, false)
  }, [fetchTasks, refreshKey])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) void fetchTasks(page + 1, true)
    }, { rootMargin: "200px" })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fetchTasks, hasMore, loading, page])

  const toggleSelected = (taskId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const allSelected = tasks.length > 0 && tasks.every((task) => selectedIds.has(task.id))
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(tasks.map((task) => task.id)))
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id))
  const stoppableSelected = selectedTasks.filter(isStoppable)

  const executeBatchAction = async () => {
    if (!pendingAction || selectedIds.size === 0) return
    const ids = pendingAction === "stop" ? stoppableSelected.map((task) => task.id) : Array.from(selectedIds)
    if (ids.length === 0) {
      toast.info("所选任务没有可停止的任务")
      setPendingAction(null)
      return
    }
    setActionLoading(true)
    try {
      const result = pendingAction === "stop"
        ? await batchStopUserTasks(ids)
        : await batchDeleteUserTasks(ids)
      const count = pendingAction === "stop" ? result.stopped : result.deleted
      const failed = result.failed?.length || 0
      toast.success(`${pendingAction === "stop" ? "已停止" : "已删除"} ${count} 个任务${failed ? `，${failed} 个失败` : ""}`)
      if (failed) toast.error(result.failed.map((item) => `${item.id}: ${item.error}`).join("；"))
      setPendingAction(null)
      await fetchTasks(1, false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量操作失败")
    } finally {
      setActionLoading(false)
    }
  }

  if (initialLoading && tasks.length === 0) return <div className="flex flex-1 items-center justify-center"><Spinner className="size-8" /></div>
  if (tasks.length === 0) return <Empty className="flex-1 border"><EmptyHeader><EmptyMedia variant="icon"><IconListDetails /></EmptyMedia><EmptyTitle>暂无开发任务</EmptyTitle><EmptyDescription>从项目顶部或侧边栏创建第一个任务。</EmptyDescription></EmptyHeader></Empty>

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全选任务" />
          <span className="text-sm text-muted-foreground">已选 {selectedIds.size} 项</span>
          <Button type="button" size="sm" variant="outline" className="ml-auto gap-1" disabled={stoppableSelected.length === 0} onClick={() => setPendingAction("stop")} title="仅停止等待中或运行中的任务">
            <IconPlayerStopFilled className="size-3.5" />停止
          </Button>
          <Button type="button" size="sm" variant="destructive" className="gap-1" disabled={selectedIds.size === 0} onClick={() => setPendingAction("delete")}>
            <IconTrash className="size-3.5" />删除
          </Button>
        </div>
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4">
          {tasks.map((task) => {
            const selected = selectedIds.has(task.id)
            return (
              <Item variant="outline" key={task.id} className={`group cursor-pointer hover:border-primary/50 ${selected ? "border-primary ring-1 ring-primary/30" : ""}`} onClick={() => navigate(`/console/task/${task.id}`)}>
                <ItemContent>
                  <ItemHeader className="items-start gap-2">
                    <Checkbox checked={selected} onCheckedChange={() => toggleSelected(task.id)} onClick={(event) => event.stopPropagation()} aria-label={`选择任务 ${getTaskDisplayName(task)}`} className="mt-0.5 shrink-0" />
                    <ItemTitle className="min-w-0 flex-1 truncate font-normal group-hover:text-primary">{getTaskDisplayName(task)}</ItemTitle>
                    <Badge variant={task.status === "processing" ? "default" : "outline"}>{task.status}</Badge>
                  </ItemHeader>
                  <ItemDescription className="truncate">{task.provider} · {task.model_id || task.models?.[0] || "默认模型"}</ItemDescription>
                </ItemContent>
                <ItemFooter className="flex justify-between border-t pt-3 text-xs text-muted-foreground"><span>{task.node_id || "未绑定节点"}</span><span>{task.created_at ? dayjs(task.created_at).fromNow() : ""}</span></ItemFooter>
              </Item>
            )
          })}
        </div>
        <div ref={sentinelRef} className="flex justify-center py-8">{loading && <Spinner />}</div>
      </div>
      <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open && !actionLoading) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction === "stop" ? "停止所选任务" : "删除所选任务"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === "stop"
                ? `将停止 ${stoppableSelected.length} 个等待中或运行中的任务，任务记录仍会保留。确认继续？`
                : `将永久删除 ${selectedIds.size} 个任务，操作不可恢复。确认继续？`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>取消</AlertDialogCancel>
            <AlertDialogAction className={pendingAction === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} disabled={actionLoading} onClick={(event) => { event.preventDefault(); void executeBatchAction() }}>
              {actionLoading ? <Spinner className="size-4" /> : pendingAction === "stop" ? "停止" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
