import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import dayjs from "dayjs"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { listUserTasks, type UserTaskSummary } from "@/api/userTaskClient"
import {
  listChatConversations,
  deleteChatConversation,
  listConversations,
  deleteConversation,
  listAgents,
  type ChatConversation,
  type AgentConversation,
  type AgentInstance,
} from "@/api/agentClient"
import { TaskInput } from "@/components/console/task/task-input"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Item, ItemContent, ItemDescription, ItemFooter, ItemHeader, ItemTitle } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { getTaskDisplayName } from "@/utils/common"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { X } from "lucide-react"

const PAGE_SIZE = 24
type HistoryTab = "task" | "chat" | "agent"
const VALID_TABS: HistoryTab[] = ["task", "chat", "agent"]

type ConvToDelete = { kind: "chat" | "agent"; id: string; title: string }

function taskStatusLabel(task: UserTaskSummary): string {
  if (task.workspace_state === "dispatch_failed") return "派发失败"
  // 节点正在准备环境（建目录 / 拉代码 / 起运行环境）时，status 仍是 pending，
  // 但「等待中」会让人以为排队没动静——实际正在干活，而且这段最耗时。
  // 失败的那一步同样在这里点名，列表上就能看出是哪步崩的。
  const stage = task.runtime_stage
  if (stage?.ok === false) return `${stage.label || "准备"}失败`
  if (stage?.preparing) return stage.label || "环境准备中"
  // pending 覆盖了「还没派发」和「环境已就绪、等用户说第一句话」两种处境，
  // 统一显示「等待中」的话，用户分不清该等还是该动手。有运行时句柄即已就绪。
  if (task.status === "pending") return task.node_session_id ? "待输入" : "等待派发"
  return ({ processing: "运行中", finished: "已完成", error: "错误" } as Record<string, string>)[task.status] || task.status || "未知"
}

export default function TasksPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab")
  const tab: HistoryTab = VALID_TABS.includes(tabParam as HistoryTab) ? tabParam as HistoryTab : "task"
  const setTab = useCallback((next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next === "task") params.delete("tab"); else params.set("tab", next)
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const [tasks, setTasks] = useState<UserTaskSummary[]>([])
  const [taskPage, setTaskPage] = useState(1)
  const [taskHasMore, setTaskHasMore] = useState(true)
  const [taskLoading, setTaskLoading] = useState(false)
  const taskLoadingRef = useRef(false)
  const taskLoadedRef = useRef(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const [chatConvs, setChatConvs] = useState<ChatConversation[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatLoadedRef = useRef(false)
  const [agentConvs, setAgentConvs] = useState<AgentConversation[]>([])
  const [agentLoading, setAgentLoading] = useState(false)
  const agentLoadedRef = useRef(false)
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [convToDelete, setConvToDelete] = useState<ConvToDelete | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTasks = useCallback(async (page: number, append: boolean) => {
    if (taskLoadingRef.current) return
    taskLoadingRef.current = true; setTaskLoading(true)
    try {
      const result = await listUserTasks({ page, page_size: PAGE_SIZE })
      setTasks((current) => append ? [...current, ...result.rows] : result.rows)
      setTaskHasMore(page * PAGE_SIZE < result.total)
      setTaskPage(page); taskLoadedRef.current = true
    } catch (error) {
      setTaskHasMore(false)
      toast.error(error instanceof Error ? error.message : t("consoleTasks.toast.fetchFailed"))
    } finally { taskLoadingRef.current = false; setTaskLoading(false) }
  }, [t])

  const fetchChatConvs = useCallback(async () => {
    setChatLoading(true)
    try { setChatConvs(await listChatConversations(50)); chatLoadedRef.current = true }
    catch (error) { toast.error(error instanceof Error ? error.message : "加载失败") }
    finally { setChatLoading(false) }
  }, [])
  const fetchAgentConvs = useCallback(async () => {
    setAgentLoading(true)
    try { const [rows, list] = await Promise.all([listConversations(50), listAgents()]); setAgentConvs(rows); setAgents(list); agentLoadedRef.current = true }
    catch (error) { toast.error(error instanceof Error ? error.message : "加载失败") }
    finally { setAgentLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === "task" && !taskLoadedRef.current) void fetchTasks(1, false)
    if (tab === "chat" && !chatLoadedRef.current) void fetchChatConvs()
    if (tab === "agent" && !agentLoadedRef.current) void fetchAgentConvs()
  }, [fetchAgentConvs, fetchChatConvs, fetchTasks, tab])
  useEffect(() => {
    if (tab !== "task") return
    const el = loadMoreRef.current; if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && taskHasMore && !taskLoading) void fetchTasks(taskPage + 1, true)
    }, { rootMargin: "200px" })
    observer.observe(el); return () => observer.disconnect()
  }, [fetchTasks, tab, taskHasMore, taskLoading, taskPage])

  const agentName = (id?: number | null) => agents.find((item) => item.id === id)?.display_name || agents.find((item) => item.id === id)?.name || `Agent #${id ?? "-"}`
  const confirmDelete = async () => {
    if (!convToDelete) return
    setDeleting(true)
    try {
      if (convToDelete.kind === "chat") { await deleteChatConversation(convToDelete.id); setChatConvs((rows) => rows.filter((r) => r.id !== convToDelete.id)) }
      else { await deleteConversation(convToDelete.id); setAgentConvs((rows) => rows.filter((r) => r.id !== convToDelete.id)) }
    } catch (error) { toast.error(error instanceof Error ? error.message : "删除失败") }
    finally { setDeleting(false); setConvToDelete(null) }
  }

  return (
    <div className="flex flex-1 flex-col items-center">
      <h1 className="text-4xl pt-24 pb-10 text-center">{t("consoleTasks.title")}</h1>
      {/* 内嵌输入框：对话 / Agent / 项目 三模式，直接在页面上发起任务，不用先开弹框。 */}
      <div className="w-full max-w-[1040px] pb-6">
        <TaskInput onTaskCreated={() => { taskLoadedRef.current = true; void fetchTasks(1, false) }} />
      </div>
      <Separator className="my-4" />
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList><TabsTrigger value="task">开发任务</TabsTrigger><TabsTrigger value="chat">聊天</TabsTrigger><TabsTrigger value="agent">Agent 聊天</TabsTrigger></TabsList>
        <TabsContent value="task" className="mt-4">
          <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4">
            {tasks.map((task) => <Item variant="outline" key={task.id} className="group cursor-pointer hover:border-primary/50" onClick={() => navigate(`/console/task/${task.id}`)}>
              <ItemContent><ItemHeader className="items-start gap-2"><ItemTitle className="min-w-0 flex-1 truncate font-normal group-hover:text-primary">{task.status === "error" && <span className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />}{getTaskDisplayName(task)}</ItemTitle><Badge variant={task.status === "processing" ? "default" : task.workspace_state === "dispatch_failed" ? "destructive" : "outline"}>{taskStatusLabel(task)}</Badge></ItemHeader><ItemDescription className="truncate">{task.provider} · {task.model_id || task.models?.[0] || "默认模型"}</ItemDescription></ItemContent>
              <ItemFooter className="flex justify-between border-t pt-3 text-xs text-muted-foreground"><span>{task.node_id || "未绑定节点"}</span><span>{task.created_at ? dayjs(task.created_at).fromNow() : ""}</span></ItemFooter>
            </Item>)}
          </div>
          {taskLoadedRef.current && tasks.length === 0 && !taskLoading && <div className="py-12 text-center text-sm text-muted-foreground">暂无开发任务</div>}
          <div ref={loadMoreRef} className="flex justify-center py-8">{taskLoading && <Spinner className="size-6" />}</div>
        </TabsContent>
        <TabsContent value="chat" className="mt-4"><ConversationGrid rows={chatConvs} loading={chatLoading} onOpen={(id) => navigate(`/console/chat?conversationId=${id}`)} onDelete={(row) => setConvToDelete({ kind: "chat", id: row.id, title: row.title || "新对话" })} /></TabsContent>
        <TabsContent value="agent" className="mt-4"><ConversationGrid rows={agentConvs} loading={agentLoading} subtitle={(row) => agentName((row as AgentConversation).agent_id)} onOpen={(id) => { const row = agentConvs.find((r) => r.id === id); navigate(`/console/agent-chat?agentId=${row?.agent_id ?? ""}&conversationId=${id}`) }} onDelete={(row) => setConvToDelete({ kind: "agent", id: row.id, title: row.title || "新对话" })} /></TabsContent>
      </Tabs>
      <AlertDialog open={!!convToDelete} onOpenChange={(open) => !open && setConvToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除会话</AlertDialogTitle><AlertDialogDescription>确定删除「{convToDelete?.title}」吗？</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmDelete() }} disabled={deleting}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}

function ConversationGrid({ rows, loading, onOpen, onDelete, subtitle }: { rows: Array<ChatConversation | AgentConversation>; loading: boolean; onOpen: (id: string) => void; onDelete: (row: ChatConversation | AgentConversation) => void; subtitle?: (row: ChatConversation | AgentConversation) => string }) {
  return <><div className="grid w-full grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4">{rows.map((row) => <Item variant="outline" key={row.id} className="group cursor-pointer" onClick={() => onOpen(row.id)}><ItemContent><ItemHeader><ItemTitle className="min-w-0 flex-1 truncate">{row.title || "新对话"}</ItemTitle><button type="button" onClick={(event) => { event.stopPropagation(); onDelete(row) }}><X className="size-4" /></button></ItemHeader><ItemDescription>{subtitle?.(row) || row.model || "默认模型"}</ItemDescription></ItemContent><ItemFooter className="justify-end border-t pt-3 text-xs text-muted-foreground">{row.updated_at ? dayjs(row.updated_at).fromNow() : ""}</ItemFooter></Item>)}</div><div className="flex justify-center py-8">{loading && <Spinner />}</div></>
}
