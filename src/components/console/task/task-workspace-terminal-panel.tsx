import { useCallback, useEffect, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { IconAlertCircle, IconPlus, IconReload, IconTerminal2, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import Terminal from "@/components/common/terminal"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { useTheme } from "@/components/theme-context"
import { cn } from "@/lib/utils"
import { deleteUserTaskTerminal, listUserTaskTerminals, userTaskTerminalWs, type UserTaskTerminal } from "@/api/userTaskClient"

interface TaskWorkspaceTerminalPanelProps {
  taskId: string
  onClosePanel?: () => void
}

/**
 * 任务工作目录终端面板。侧栏是终端列表（新建 / 切换 / 关闭），右侧是 xterm。
 * 走任务级端点 /api/v1/users/tasks/{id}/terminals 与 .../terminal（ws），
 * cwd 由服务端按任务工作区解析，浏览器绝不传节点本地路径。
 */
export function TaskWorkspaceTerminalPanel({ taskId, onClosePanel }: TaskWorkspaceTerminalPanelProps) {
  const { resolvedTheme } = useTheme()
  const [sessions, setSessions] = useState<UserTaskTerminal[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [optimisticCreatedAt, setOptimisticCreatedAt] = useState(0)
  const [optimisticId, setOptimisticId] = useState<string | null>(null)
  const [signal, setSignal] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [titles, setTitles] = useState<Record<string, string>>({})

  const fetchSessions = useCallback(async () => {
    try {
      const result = await listUserTaskTerminals(taskId)
      const next = [...(result.terminals || [])].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
      setSessions(next)
      if (optimisticId && next.some((session) => session.id === optimisticId)) setOptimisticId(null)
      return next
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载终端列表失败")
      return []
    }
  }, [optimisticId, taskId])

  useEffect(() => {
    setSessions([])
    setCurrentId(null)
    setOptimisticId(null)
    setConnectionStatus("disconnected")
  }, [taskId])
  useEffect(() => { void fetchSessions() }, [fetchSessions])
  useEffect(() => {
    if (sessions.length > 0 && currentId === null) {
      setCurrentId(sessions[0].id)
      setSignal((value) => value + 1)
    }
  }, [currentId, sessions])
  useEffect(() => {
    if (connectionStatus === "connected") void fetchSessions()
  }, [connectionStatus, fetchSessions])

  function newSession() {
    const newId = uuidv4()
    setOptimisticCreatedAt(Date.now() / 1000)
    setOptimisticId(newId)
    setCurrentId(newId)
    setSignal((value) => value + 1)
  }

  async function closeSession(event: React.MouseEvent, terminalId: string) {
    event.stopPropagation()
    if (!window.confirm("确认关闭这个终端？终端中的进程会立即结束。")) return
    try {
      if (optimisticId === terminalId && !sessions.some((session) => session.id === terminalId)) {
        setOptimisticId(null)
        if (currentId === terminalId) {
          setCurrentId(sessions[0]?.id || null)
          setSignal((value) => value + 1)
        }
        toast.success("终端已关闭")
        return
      }
      await deleteUserTaskTerminal(taskId, terminalId)
      const next = await fetchSessions()
      if (currentId === terminalId) {
        setCurrentId(next[0]?.id || null)
        setSignal((value) => value + 1)
      }
      toast.success("终端已关闭")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "关闭终端失败")
    }
  }

  const displaySessions = [...sessions]
  if (currentId && optimisticId === currentId && !sessions.some((session) => session.id === currentId)) {
    displaySessions.unshift({ id: currentId, created_at: optimisticCreatedAt, title: "新终端" })
  }

  function statusIcon(terminalId: string) {
    if (terminalId !== currentId) return <IconTerminal2 className="size-3.5 shrink-0 text-muted-foreground" />
    if (connectionStatus === "connecting") return <Spinner className="size-3.5 shrink-0" />
    if (connectionStatus === "connected") return <IconTerminal2 className="size-3.5 shrink-0 text-green-600" />
    return <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border">
      <div className="flex w-48 shrink-0 flex-col border-r bg-muted/10">
        <div className="flex items-center justify-between border-b p-2">
          <Button variant="ghost" size="icon" className="size-6" title="新建终端" onClick={newSession}><IconPlus className="size-4" /></Button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-6" title="刷新列表" onClick={() => void fetchSessions()}><IconReload className="size-4" /></Button>
            {onClosePanel && <Button variant="ghost" size="icon" className="size-6" title="收起面板" onClick={onClosePanel}><IconX className="size-4" /></Button>}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {displaySessions.length ? (
            <div className="flex flex-col gap-1">
              {displaySessions.map((session) => (
                <div key={session.id} className={cn("group flex items-center gap-2 rounded-md px-2 transition-colors", session.id === currentId ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => { setCurrentId(session.id); setSignal((value) => value + 1) }}>
                    {statusIcon(session.id)}
                    <span className="truncate text-xs">{titles[session.id] || String(session.title || "") || session.id.slice(0, 8)}</span>
                  </button>
                  <Button variant="ghost" size="icon" className="size-5 shrink-0 hover:bg-destructive/10 hover:text-destructive" title="关闭终端" onClick={(event) => void closeSession(event, session.id)}><IconX className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          ) : <div className="px-1 text-xs text-muted-foreground">点击 + 创建终端</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {currentId ? (
          <Terminal
            ws={userTaskTerminalWs(taskId, currentId)}
            theme={resolvedTheme === "dark" ? "Dracula" : "Tomorrow"}
            signal={signal}
            onTitleChanged={(title) => setTitles((current) => ({ ...current, [currentId]: title }))}
            onUserNameChanged={() => {}}
            onConnectionStatusChanged={setConnectionStatus}
          />
        ) : (
          <Empty className="h-full w-full"><EmptyHeader><EmptyMedia variant="icon"><IconTerminal2 className="size-6" /></EmptyMedia><EmptyDescription>点击 + 创建终端</EmptyDescription></EmptyHeader></Empty>
        )}
      </div>
    </div>
  )
}
