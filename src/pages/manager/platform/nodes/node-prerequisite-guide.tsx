/**
 * 节点环境面板的可操作引导：Node.js/npm 缺失时给「安装」按钮（服务端下发
 * InstallHostTool，节点下载官方归档解压到自管目录，无需 root），不再只是
 * 一条要管理员自己上主机敲的命令。
 *
 * 组件既给行内按钮（环境表格的 Node.js/npm 行），也给整块缺项告警
 * （审批弹窗默认环境 Tab 时一眼看到）。必装标记对应审批硬门禁：缺 node/npm
 * 节点连 runtime（node dist/cli.js）都起不来，必须装。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Copy } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"
import {
  installNodeHostTool,
  listNodes,
  type NodeInfo,
} from "@/@admin-port/api/nodes"
import { nodeBelowFloor, npmBelowFloor, NODE_FLOOR_MAJOR } from "./types"

/** 安装期间的环境面板自身轮询：成功 ack 后服务端把版本折进 capabilities，
 *  listNodes 刷新即见；这里不等父级刷新，自己把最新 caps 拉回来。 */
const INSTALL_POLL_MS = 3000

export function useNodeHostToolInstall(
  node: NodeInfo | null | undefined,
  onRefresh?: (node: NodeInfo) => void,
) {
  const [installing, setInstalling] = useState(false)
  const pollRef = useRef<number | null>(null)
  const nodeId = node?.node_id || ""

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current)
  }, [])

  const pollCapabilities = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(() => {
      void listNodes()
        .then((list) => {
          const fresh = list.find((n) => n.node_id === nodeId)
          if (!fresh) return
          const caps = fresh.capabilities || {}
          const done = Boolean((caps.node_version || "").trim())
          if (done && onRefresh) onRefresh(fresh)
          if (done) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current)
            pollRef.current = null
            setInstalling(false)
          }
        })
        .catch(() => {
          // 单次轮询失败静默；下一轮再试。
        })
    }, INSTALL_POLL_MS)
  }

  const installNodeJS = async () => {
    if (!nodeId || installing) return
    setInstalling(true)
    try {
      const result = await installNodeHostTool(nodeId)
      toast.success(
        result.node_version
          ? `Node.js 已安装（v${result.node_version.replace(/^v/, "")}）`
          : "Node.js 安装命令已下发，节点正在安装…",
      )
      if (result.node_version) {
        setInstalling(false)
      } else {
        pollCapabilities()
      }
    } catch (err) {
      setInstalling(false)
      toast.error(err instanceof Error ? err.message : "安装失败")
    }
  }

  return { installing, installNodeJS }
}

/**
 * Node.js/npm 缺失时的整块告警（含一键安装 + 必装标记）。
 * 已装好时返回 null。手动安装命令收进折叠兜底：节点离线 / 无外网时管理员
 * 仍可以自己上主机装。
 */
export function NodePrerequisiteGuide({
  node,
  onRefresh,
}: {
  node: NodeInfo
  /** 装完后把刷新的节点交回父级（父级状态里的快照不会自己变）。 */
  onRefresh?: (node: NodeInfo) => void
}) {
  const caps = node.capabilities || {}
  // 缺失或低于下限都算待处理：旧版（如 macOS 自带 Node 10.x）装不了新编辑器 CLI。
  const missingNode = nodeBelowFloor(caps)
  const missingNpm = npmBelowFloor(caps)
  const nodeReported = Boolean((caps.node_version || "").trim())
  const os = String(caps.os || "").toLowerCase()
  const { installing, installNodeJS } = useNodeHostToolInstall(node, onRefresh)
  // Docker 容器节点装进的是容器文件系统，宿主重装镜像即丢；引导管理员
  // 在宿主机装或换 standalone。
  const isDocker = ["docker", "docker-compose"].includes(String(node.startup_method || ""))
  const offline = !node.connected

  const manualCommand = useMemo(() => {
    if (os === "windows") {
      return "winget install --id OpenJS.NodeJS.LTS --source winget"
    }
    if (os === "darwin") {
      return "brew install node"
    }
    return "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
  }, [os])

  if (!missingNode && !missingNpm) return null
  const platform = os === "windows" ? "Windows" : os === "darwin" ? "macOS" : os === "linux" ? "Linux" : "该节点系统"

  return (
    <Alert variant="destructive">
      <AlertDescription>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {nodeReported ? "节点上的 Node.js/npm 版本过低，需升级" : "需要在节点主机安装或补充 Node.js/npm"}
            </span>
            <Badge variant="outline" className="border-destructive text-destructive">必装</Badge>
            {missingNode ? (
              <Badge variant="outline" className="border-destructive text-destructive">
                {nodeReported ? `Node.js v${(caps.node_version || "").replace(/^v/, "")} < v${NODE_FLOOR_MAJOR}` : "Node.js 未上报"}
              </Badge>
            ) : null}
            {missingNpm ? <Badge variant="outline" className="border-destructive text-destructive">npm 过低或未上报</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            Node.js 是运行 agent-compose runtime（node dist/cli.js）和编辑器 CLI 安装（npm）的宿主；
            版本过低（如 macOS 自带的 Node 10.x）时编辑器 CLI 的安装脚本跑不起来，也无法通过审批。
          </div>
          {isDocker ? (
            <div className="text-xs">
              该节点以容器方式运行：请在宿主机安装 Node.js 后重建镜像，或改用 standalone 方式入驻。
            </div>
          ) : offline ? (
            <div className="text-xs">
              节点当前离线，无法远程安装。请先在目标机器启动节点进程
              <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono">~/.agent-compose/start-node.sh</code>
              后再试。
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={installing} onClick={() => void installNodeJS()}>
                {installing ? <Spinner /> : null}
                {installing ? "安装中（下载+解压约 1-5 分钟）…" : nodeReported ? `升级 Node.js 到 v${NODE_FLOOR_MAJOR}+（含 npm）` : "在节点上安装 Node.js（含 npm）"}
              </Button>
              <span className="text-xs text-muted-foreground">
                节点自动下载官方 LTS 归档解压到自管目录，无需 root；装完版本会自动刷新。
              </span>
            </div>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">手动安装（离线 / 自定义部署）</summary>
            <div className="mt-2 flex flex-col gap-2">
              <div>
                在 {platform} 节点主机的终端执行以下命令。安装完成后重启节点进程，节点会重新探测并上报版本。
              </div>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{manualCommand}</code>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => {
                    void copyToClipboard(manualCommand).then((ok) =>
                      ok ? toast.success("命令已复制") : toast.error("复制失败，请手动选择"),
                    )
                  }}
                  aria-label="复制 Node.js 安装命令"
                >
                  <Copy />
                </Button>
              </div>
              <div>
                验证：<code className="rounded bg-background px-1 py-0.5 font-mono">node --version && npm --version</code>；
                若命令可用但仍显示未上报，请完全停止旧节点进程后重新启动，避免旧进程继续使用旧 PATH。
              </div>
            </div>
          </details>
        </div>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Xcode 检测入口（仅 macOS 节点且未上报 xcodebuild_version 时渲染）。
 *
 * Xcode 是 App Store 专供（约 7GB、Apple ID 登录、交互式许可），节点无法自动
 * 安装。这里下发检测型 InstallHostTool：节点探测到 xcodebuild 后，服务端将版本
 * 立即折进 capabilities，按钮成功返回后刷新本地节点快照，构建页无需等待重启。
 */
export function XcodeDetectButton({
  node,
  onRefresh,
}: {
  node: NodeInfo
  onRefresh?: (node: NodeInfo) => void
}) {
  const caps = node.capabilities || {}
  const [detecting, setDetecting] = useState(false)
  if (String(caps.os || "").toLowerCase() !== "darwin") return null
  if ((caps.xcodebuild_version || "").trim()) return null
  if (!node.connected) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="节点离线，无法远程检测">
        <AlertCircle className="size-3.5" />
        离线
      </span>
    )
  }
  const detect = async () => {
    if (!node.node_id || detecting) return
    setDetecting(true)
    try {
      const result = await installNodeHostTool(node.node_id, "xcode")
      if (result.xcodebuild_version?.trim()) {
        const freshList = await listNodes()
        const fresh = freshList.find((item) => item.node_id === node.node_id)
        if (fresh) onRefresh?.(fresh)
        toast.success(`已检测到完整 Xcode（${result.xcodebuild_version.trim()}），构建能力标签已刷新`)
      } else {
        // 旧版节点没有回报 xcodebuild_version 字段，只能重启后重新注册刷新标签。
        toast.success("已检测到完整 Xcode；当前节点程序较旧，请重启节点进程以刷新构建能力标签")
      }
    } catch (err) {
      // 节点 ack 的错误就是给用户看的原因（无法自动安装 + App Store 步骤），原样展示。
      toast.error(err instanceof Error ? err.message : "Xcode 检测失败")
    } finally {
      setDetecting(false)
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={detecting} onClick={() => void detect()}>
      {detecting ? <Spinner /> : null}
      {detecting ? "检测中…" : "检测 Xcode"}
    </Button>
  )
}

/** 环境表格行的行内安装按钮（Node.js/npm 行共用：一次归档两个都装上）。 */
export function NodeJSInstallButton({
  node,
  onRefresh,
  compact = false,
}: {
  node: NodeInfo
  onRefresh?: (node: NodeInfo) => void
  /** 表格行内用小按钮；整块告警里用默认。 */
  compact?: boolean
}) {
  const caps = node.capabilities || {}
  const missingNode = nodeBelowFloor(caps)
  const missingNpm = npmBelowFloor(caps)
  const { installing, installNodeJS } = useNodeHostToolInstall(node, onRefresh)
  const isDocker = ["docker", "docker-compose"].includes(String(node.startup_method || ""))
  if (!missingNode && !missingNpm) return null
  // 有版本但过低 = 升级；无版本 = 安装。InstallHostTool 装 LTS 即升即装。
  const reported = Boolean((caps.node_version || "").trim())
  if (isDocker || !node.connected) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={isDocker ? "容器节点请在宿主机安装 Node.js" : "节点离线，无法远程安装"}>
        <AlertCircle className="size-3.5" />
        {isDocker ? "容器节点需宿主机安装" : "离线"}
      </span>
    )
  }
  return (
    <Button size={compact ? "sm" : "default"} variant="outline" disabled={installing} onClick={() => void installNodeJS()}>
      {installing ? <Spinner /> : null}
      {installing ? "安装中…" : reported ? "升级" : "安装"}
    </Button>
  )
}
