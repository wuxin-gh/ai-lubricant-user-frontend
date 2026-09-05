import { useCallback, useEffect, useState } from "react"
import { Ban, Folder, KeyRound, List, RefreshCw, Terminal } from "lucide-react"
import { IconDeviceDesktop, IconInfoCircle } from "@tabler/icons-react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import type { DomainVMPort } from "@/api/Api"
import {
  disableEditorSessionApiKey,
  editorDisplayName,
  editorModeOptions,
  getEditorDetail,
  listEditorPorts,
  rotateEditorSessionApiKey,
  type EditorInstance,
  type EditorSession,
} from "@/api/editorClient"
import { editorNodeHealth, type EditorNodeHealth, type NodeInfo } from "@/api/nodes"
import { SubagentBlock } from "@/components/console/agent/agent-message-list"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { useCommonData } from "@/components/console/data-provider"
import EditorFileExplorer from "@/components/console/editor/editor-file-explorer"
import EditorSessionChat from "@/components/console/editor/editor-session-chat"
import { EditorTerminalPanel } from "@/components/console/editor/editor-terminal-panel"
import type { EditorSessionSubAgent } from "@/components/console/editor/editor-session-stream-client"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export default function EditorSessionDetailPage() {
  const { editorId = "", sessionId = "" } = useParams<{ editorId: string; sessionId: string }>()
  const { nodes, projects, reloadNodes } = useCommonData()
  const setDynamicBreadcrumbs = useBreadcrumbTask()?.setDynamicSegments
  const [editor, setEditor] = useState<EditorInstance | null>(null)
  const [session, setSession] = useState<EditorSession | null>(null)
  const [subAgents, setSubAgents] = useState<EditorSessionSubAgent[]>([])
  const [activeSubAgentId, setActiveSubAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [ports, setPorts] = useState<DomainVMPort[] | undefined>(undefined)
  const [portsSupported, setPortsSupported] = useState(true)
  const [filesSignal, setFilesSignal] = useState(0)
  const [keyPending, setKeyPending] = useState(false)

  const loadDetail = useCallback(async () => {
    const nextEditor = await getEditorDetail(editorId)
    const found = (nextEditor.sessions || []).find((item) => item.id === sessionId)
    if (!found) throw new Error("Session 不存在或不属于当前编辑器")
    setEditor(nextEditor)
    setSession(found)
    return nextEditor
  }, [editorId, sessionId])

  const loadPorts = useCallback(async () => {
    try {
      const result = await listEditorPorts(editorId)
      setPortsSupported(Boolean(result.supported))
      setPorts((result.ports || []).map((port) => ({
        port: port.port,
        status: port.status as DomainVMPort["status"],
        preview_url: port.preview_url,
        error_message: port.error_message,
      })))
    } catch {
      setPorts([])
    }
  }, [editorId])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadDetail(), loadPorts()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 session 详情失败")
    } finally {
      setLoading(false)
    }
  }, [loadDetail, loadPorts])

  async function refreshAll() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([loadDetail(), loadPorts(), reloadNodes()])
      setFilesSignal((value) => value + 1)
      toast.success("刷新成功")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!editor || !session || !setDynamicBreadcrumbs) return
    const projectId = editor.project_id || ""
    const project = projects.find((item) => item.id === projectId)
    setDynamicBreadcrumbs([
      { label: project?.name || "项目", ...(projectId ? { href: `/console/project/${projectId}` } : {}) },
      { label: editorDisplayName(editor), href: `/console/editor/${editor.id}` },
      { label: session.task_name || "未命名任务" },
    ])
    return () => setDynamicBreadcrumbs(null)
  }, [editor, projects, session, setDynamicBreadcrumbs])

  async function rotateKey() {
    if (!session) return
    setKeyPending(true)
    try {
      await rotateEditorSessionApiKey(editorId, session.id)
      await loadDetail()
      toast.success("任务 API Key 已轮换")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "轮换 API Key 失败")
    } finally {
      setKeyPending(false)
    }
  }

  async function disableKey() {
    if (!session) return
    setKeyPending(true)
    try {
      await disableEditorSessionApiKey(editorId, session.id)
      await loadDetail()
      toast.success("任务 API Key 已停用")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停用 API Key 失败")
    } finally {
      setKeyPending(false)
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  if (!editor || !session) return <div className="flex h-full items-center justify-center"><Card><CardContent className="py-10 text-center">Session 不存在</CardContent></Card></div>

  const node = nodes.find((item) => item.node_id === editor.node_id) || null
  const nodeHealth = editorNodeHealth(editor.node_id, nodes)
  const modeLabel = editorModeOptions(editor.provider).find((option) => option.value === (session.mode || ""))?.label || session.mode || "编辑器默认"
  const previewPortCount = (ports ?? []).length
  // 工作区进程只在会话未关闭时在节点上运行；关闭后目录/终端访问会报 not running。
  const workspaceReady = session.status !== "closed" && session.status !== "error"
  const keyDisabled = Boolean(session.api_key_copy?.disabled)
  // 任务关闭/错误后 session 已不可用：鉴权链路 _validate_editor_request_context
  // 只放行 active/pending_first_request，closed 态下派生 Key 实际已失效（虽未标
  // disabled）；轮换后端更有 s.status<>'closed' 守卫会直接 404。故与终端等按钮
  // 一致置灰。
  const keyLocked = keyDisabled || !workspaceReady

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3 md:p-4">
      <div className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-medium" title={session.id}>{session.task_name || "未命名任务"}</h2>
            <Badge variant="secondary">{editor.provider}</Badge>
            <Badge variant={session.status === "active" ? "default" : "outline"}>{session.status}</Badge>
            <span className="hidden truncate text-xs text-muted-foreground lg:inline">{session.model || "默认模型"} · {modeLabel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={terminalOpen ? "bg-accent text-primary" : ""}
              disabled={!workspaceReady}
              onClick={() => setTerminalOpen((prev) => !prev)}
              title={workspaceReady ? "在编辑器工作目录打开终端" : "工作区未运行，无法打开终端"}
            >
              <Terminal className="size-3.5" /> 终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={previewOpen ? "bg-accent text-primary" : ""}
              disabled={!workspaceReady}
              onClick={() => setPreviewOpen((prev) => !prev)}
              title={workspaceReady ? "端口预览" : "工作区未运行，无端口预览"}
            >
              <IconDeviceDesktop className="size-3.5" /> 预览{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
            </Button>
            <Popover open={directoryOpen && workspaceReady} onOpenChange={setDirectoryOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={directoryOpen ? "bg-accent text-primary" : ""} disabled={!workspaceReady} title={workspaceReady ? "编辑器目录" : "工作区未运行，无法浏览目录"}>
                  <Folder className="size-3.5" /> 目录
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] p-0">
                <div className="h-[min(32rem,var(--radix-popover-content-available-height))]">
                  <EditorFileExplorer editorId={editorId} disabled={false} refreshSignal={filesSignal} onClosePanel={() => setDirectoryOpen(false)} />
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="sm" disabled={keyPending || keyLocked} onClick={() => void rotateKey()} title={keyDisabled ? "API Key 已停用" : !workspaceReady ? "任务已关闭，API Key 已失效" : "轮换任务 API Key"}>
              <KeyRound className="size-3.5" /> 轮换 Key
            </Button>
            <Button variant="ghost" size="sm" disabled={keyPending || keyLocked} onClick={() => void disableKey()} title={keyDisabled ? "API Key 已停用" : !workspaceReady ? "任务已关闭，API Key 已失效" : "停用任务 API Key"}>
              <Ban className="size-3.5 text-destructive" /> 停用 Key
            </Button>
            <NodeInfoPopover node={node} editor={editor} health={nodeHealth} />
            <Button variant="ghost" size="sm" asChild title="关联任务列表"><Link to={`/console/editor/${editorId}`}><List className="size-3.5" /> 关联任务列表</Link></Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refreshAll()} title="刷新">
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 刷新
            </Button>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
          <ResizablePanel defaultSize={terminalOpen ? 65 : 100} minSize={30} className="relative min-h-0">
            <div className="flex h-full min-h-0 gap-3">
              {subAgents.length > 0 && (
                <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/20 md:flex">
                  <div className="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs font-medium">子 Agent · {subAgents.length}</div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                    {subAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className={cn("cursor-pointer rounded-md", activeSubAgentId === agent.id && "ring-2 ring-primary")}
                        onClick={() => setActiveSubAgentId(agent.id === activeSubAgentId ? null : agent.id)}
                      >
                        <SubagentBlock subagent={agent} />
                      </div>
                    ))}
                  </div>
                </aside>
              )}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border">
                <EditorSessionChat
                  editorId={editorId}
                  session={session}
                  active
                  onSubAgents={setSubAgents}
                  subAgents={subAgents}
                  activeSubAgentId={activeSubAgentId}
                  onSelectSubAgent={setActiveSubAgentId}
                  modelLabel={{ model: session.model || "默认模型", mode: modeLabel }}
                />
              </div>
            </div>
          </ResizablePanel>
          {terminalOpen && (
            <>
              <ResizableHandle withHandle className="my-1 shrink-0 bg-transparent after:hidden" />
              <ResizablePanel defaultSize={35} minSize={15} className="min-h-0">
                <EditorTerminalPanel editorId={editorId} onClosePanel={() => setTerminalOpen(false)} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader className="flex-row items-center justify-start gap-2 pr-8">
            <DialogTitle>端口预览</DialogTitle>
            {!portsSupported && <span className="text-xs text-muted-foreground">当前节点未提供端口能力</span>}
          </DialogHeader>
          <TaskPreviewPanel ports={ports} onRefresh={() => void loadPorts()} disabled={false} embedded />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NodeInfoPopover({ node, editor, health }: { node: NodeInfo | null; editor: EditorInstance; health: EditorNodeHealth }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={open ? "bg-accent text-primary" : ""} title="节点信息">
          <IconInfoCircle className="size-3.5" /> 节点信息
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-3">
        {health.abnormal && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">编辑器状态异常：{health.reason}</div>}
        {node ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{node.node_name || node.node_id}</span>
              <Badge variant="outline">{node.node_role}</Badge>
              <Badge variant="outline" className={node.connected ? "text-green-600 dark:text-green-400" : ""}>{node.connected ? "在线" : "离线"}</Badge>
            </div>
            <div className="grid gap-2">
              <Row label="节点 ID" value={node.node_id} mono />
              <Row label="运行中会话" value={`${node.active_sessions ?? 0} 个`} />
              <Row label="编辑器占用" value={`${node.editor_occupancy ?? 0} 个`} />
              <Row label="最近心跳" value={node.last_heartbeat_at || "尚未上报"} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{editor.node_id ? "节点不存在" : "未指定节点，由调度自动挑选"}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right font-medium ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</span>
    </div>
  )
}
