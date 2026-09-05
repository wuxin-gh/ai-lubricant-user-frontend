/**
 * 节点终端弹框——xterm 连到某个授权节点宿主机的 shell。
 *
 * 管理端与用户侧共用，靠 `scope` 显式区分（不再从 pathname 推导）：
 * - `admin` 走 `/api/v1/admin/nodes/{id}/terminal`，由平台管理员鉴权
 * - `user` 走 `/api/v1/teams/my-nodes/{id}/terminal`，服务端校验 GroupNode 授权 +
 *   节点已审批在线
 *
 * 关闭弹框即离开终端：浏览器断开只解除观察，节点上的 PTY 仍存活一段时间，带同一个
 * terminal_id 连回去就续接原 shell；所以关闭时给三个选择——留下、断开保留、关闭
 * 终端。文件浏览器与 AI 助手两侧都开放，它们各自按 scope 打对应的后端路径。
 */
import { useCallback, useRef, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import {
  IconFolder,
  IconReload,
  IconRobot,
  IconTerminal2,
  IconXboxXFilled,
} from "@tabler/icons-react"
import Terminal, { type TerminalHandle } from "@/components/common/terminal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { nodeTerminalWsPath } from "@/@admin-port/api/nodes"
import { NodeFileBrowser } from "@/pages/manager/platform/nodes/node-file-browser"
import { NodeTerminalAgentChat } from "@/pages/manager/platform/nodes/node-terminal-agent-chat"
import themes from "@/utils/terminalThemes"

/** 终端归属：决定 ws 路径与文件浏览器走管理端还是用户侧接口。 */
export type NodeTerminalScope = "admin" | "user"

/**
 * 稳定的 terminal_id 存储键。
 *
 * 浏览器断开只是解除观察，节点上的 PTY 仍然存活；下次带同一个 terminal_id 连回去
 * 就续接原 shell，cwd 和前台进程都不变。所以这个 id 必须跨刷新/重连保持，存
 * localStorage 而不是内存。
 */
function terminalIdStorageKey(nodeId: string): string {
  return `node-terminal-id:${nodeId}`
}

/**
 * 解析本次要连接的 terminal_id。
 *
 * 显式传入优先（节点详情「终端」Tab 的「续接」就是这样指定某个具体终端的），此时
 * 不能落到本机 localStorage 里那个「我自己的终端」上，否则点续接会连错终端。显式
 * 续接的 id 也写回 localStorage，后续重开停在同一个终端上。
 *
 * 没传时才回到默认行为：复用本机保存的 id，没有就新建。
 */
function loadOrCreateTerminalId(nodeId: string, requested?: string): string {
  if (!nodeId) return ""
  const key = terminalIdStorageKey(nodeId)
  const wanted = (requested || "").trim()
  if (wanted) {
    localStorage.setItem(key, wanted)
    return wanted
  }
  const saved = localStorage.getItem(key)
  if (saved) return saved
  const created = uuidv4()
  localStorage.setItem(key, created)
  return created
}

function terminalWsPath(
  scope: NodeTerminalScope,
  nodeId: string,
  terminalId: string,
  envId?: string,
): string {
  if (!nodeId) return ""
  const query = `?terminal_id=${encodeURIComponent(terminalId)}${
    envId ? `&env_id=${encodeURIComponent(envId)}` : ""
  }`
  if (scope === "user") {
    return `/api/v1/teams/my-nodes/${encodeURIComponent(nodeId)}/terminal${query}`
  }
  return `${nodeTerminalWsPath(nodeId)}${query}`
}

export function NodeTerminalDialog({
  open,
  onOpenChange,
  scope,
  nodeId,
  nodeName,
  terminalId: requestedTerminalId,
  envId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: NodeTerminalScope
  nodeId: string
  nodeName?: string
  /** 续接某个已存在的终端（节点详情「终端」Tab）；不传则复用/新建本机终端。 */
  terminalId?: string
  /** 可选：在某个命名共享环境里开维护 shell（节点把 HOME 指向环境目录）。 */
  envId?: string
}) {
  // 终端组件的挂载信号。每次打开弹框都新建一份状态：弹框关掉后组件卸载，
  // 下次打开要重新建连接，沿用旧 signal 不会触发重连。
  const [signal] = useState(1)
  const [terminalId] = useState(() => loadOrCreateTerminalId(nodeId, requestedTerminalId))
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [currentTheme, setCurrentTheme] = useState(() => {
    const savedTheme = localStorage.getItem("terminalTheme")
    if (savedTheme === "MonkeyCode") {
      localStorage.setItem("terminalTheme", "AiLubricant")
      return "AiLubricant"
    }
    return savedTheme || "AiLubricant"
  })
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  // 文件浏览器当前目录：作为 Agent 终端上下文的 cwd。状态由 NodeFileBrowser 持有，
  // 这里只保留最新路径供发送消息时取用。
  const [filePath, setFilePath] = useState("/")
  // Agent 正在该终端执行命令时，服务端通过 WS 推 agent_command_start/end；
  // 这里记下当前运行的命令，用来在终端上方提示并禁止键盘输入。
  const [agentCommand, setAgentCommand] = useState<{ running: boolean; command: string }>({
    running: false,
    command: "",
  })
  const terminalHandle = useRef<TerminalHandle | null>(null)

  const onFileBrowserPathChange = useCallback((path: string) => {
    setFilePath(path)
  }, [])

  const ws = terminalWsPath(scope, nodeId, terminalId, envId)
  const displayName = nodeName || nodeId

  /** 收起浮窗并关闭弹框。浮窗是 portal，不随弹框卸载，必须显式收。 */
  const dismiss = useCallback(() => {
    setFileBrowserOpen(false)
    setAssistantOpen(false)
    setLeaveConfirmOpen(false)
    onOpenChange(false)
  }, [onOpenChange])

  /** 断开并保留：PTY 留在节点上，稍后带同一 id 可续接。 */
  const detachAndClose = useCallback(() => {
    dismiss()
  }, [dismiss])

  /** 关闭终端并离开：显式杀掉节点 PTY（连带前台进程），清掉本机续接 id。 */
  const closeTerminalAndLeave = useCallback(() => {
    terminalHandle.current?.closeTerminal()
    localStorage.removeItem(terminalIdStorageKey(nodeId))
    dismiss()
  }, [dismiss, nodeId])

  /** 关闭意图统一入口：连着时先问一句，没连上直接走。 */
  const requestClose = useCallback(() => {
    if (status === "connected") {
      setLeaveConfirmOpen(true)
      return
    }
    dismiss()
  }, [dismiss, status])

  const statusBadge = () => {
    if (status === "connecting") {
      return (
        <Badge variant="secondary" className="gap-1">
          <Spinner className="size-3" />
          连接中
        </Badge>
      )
    }
    if (status === "connected") {
      return (
        <Badge variant="outline" className="gap-1 text-green-600 dark:text-green-400">
          <IconTerminal2 className="size-3" />
          已连接
        </Badge>
      )
    }
    return (
      <Badge variant="secondary" className="gap-1 text-danger">
        <IconXboxXFilled className="size-3" />
        未连接
      </Badge>
    )
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) return
          requestClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
          // 终端里 Ctrl-C / Esc 是给远端 shell 的，不该关弹框；关闭统一走标题栏按钮。
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="truncate text-sm font-medium">{displayName}</DialogTitle>
              {statusBadge()}
              {title ? (
                <span className="truncate text-xs text-muted-foreground">{title}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={status === "connecting"}
                onClick={() => terminalHandle.current?.reconnect()}
              >
                <IconReload />
                重连
              </Button>
              <Select
                value={currentTheme}
                onValueChange={(value) => {
                  setCurrentTheme(value)
                  localStorage.setItem("terminalTheme", value)
                }}
              >
                <SelectTrigger className="hidden w-[150px] md:flex" size="sm">
                  <SelectValue placeholder="主题" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>主题</SelectLabel>
                    {Object.keys(themes).map((theme) => (
                      <SelectItem key={theme} value={theme}>
                        {themes[theme as keyof typeof themes].name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Separator orientation="vertical" className="h-5" />
              <Button variant="ghost" size="sm" onClick={requestClose}>
                关闭
              </Button>
            </div>
          </div>
          {agentCommand.running ? (
            <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <Spinner className="size-3" />
              <span className="min-w-0 truncate">
                Agent 正在终端执行命令
                {agentCommand.command ? `：${agentCommand.command}` : "…"}（此时键盘输入已锁定）
              </span>
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {ws ? (
              <Terminal
                ws={ws}
                theme={currentTheme}
                signal={signal}
                onTitleChanged={setTitle}
                onUserNameChanged={() => {}}
                onConnectionStatusChanged={setStatus}
                onReady={(handle) => {
                  terminalHandle.current = handle
                }}
                onAgentCommandChanged={(running, command) =>
                  setAgentCommand({ running, command })
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                缺少节点 ID，请从节点列表进入
              </div>
            )}
            <Button
              type="button"
              size="icon"
              className="absolute bottom-6 right-6 z-30 h-12 w-12 rounded-full shadow-lg"
              onClick={() => setFileBrowserOpen((value) => !value)}
              aria-label="打开文件浏览器"
              title="文件浏览器"
            >
              <IconFolder className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="absolute bottom-6 right-20 z-30 h-12 w-12 rounded-full shadow-lg"
              onClick={() => setAssistantOpen((value) => !value)}
              aria-label="打开 AI 助手"
              title="AI 助手"
            >
              <IconRobot className="h-5 w-5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        浮窗走 portal 且非模态，放在 Dialog 外面：它们要浮在终端之上、并且能在
        弹框内容区之外自由拖动。仅在弹框打开时渲染。
      */}
      {open ? (
        <>
          <NodeFileBrowser
            scope={scope}
            nodeId={nodeId}
            open={fileBrowserOpen}
            onOpenChange={setFileBrowserOpen}
            onPathChange={onFileBrowserPathChange}
            className="z-[60]"
          />
          <NodeTerminalAgentChat
            scope={scope}
            nodeId={nodeId}
            nodeName={displayName}
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            terminalHandleRef={terminalHandle}
            filePath={filePath}
            agentCommandRunning={agentCommand.running}
            className="z-[60]"
          />
        </>
      ) : null}

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭终端？</AlertDialogTitle>
            <AlertDialogDescription>
              浏览器断开只是解除观察，节点上的 shell 与正在运行的命令会保留一段时间，
              稍后可重新进入续接（工作目录和前台进程不变）。
              也可以直接关闭终端，立即终止其中运行的命令并释放该节点上的 shell。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-between">
            <AlertDialogCancel>留在此页</AlertDialogCancel>
            <div className="flex gap-2">
              <AlertDialogAction
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                onClick={detachAndClose}
              >
                断开并保留
              </AlertDialogAction>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={closeTerminalAndLeave}
              >
                关闭终端
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default NodeTerminalDialog
