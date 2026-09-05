import { useMemo } from "react"
import { Copy } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import type { NodeInfo } from "@/@admin-port/api/nodes"

function copyCommand(command: string) {
  void navigator.clipboard.writeText(command).then(
    () => toast.success("命令已复制"),
    () => toast.error("复制失败"),
  )
}

/**
 * Node.js/npm 宿主环境引导。
 *
 * runtime 由节点安装脚本自动下载；Node.js 仍是 runtime 执行 cli.js 和编辑器
 * CLI 的宿主，因此缺失/未上报时必须给管理员可执行的主机安装命令，而不是只显示
 * 一行“未安装”。命令只安装 Node.js LTS，不修改服务端或节点凭证。
 */
export function NodePrerequisiteGuide({ node }: { node: NodeInfo }) {
  const caps = node.capabilities || {}
  const missingNode = !(caps.node_version || "").trim()
  const missingNpm = !(caps.npm_version || "").trim()
  const os = String(caps.os || "").toLowerCase()
  const command = useMemo(() => {
    if (os === "windows") {
      return "winget install --id OpenJS.NodeJS.LTS --source winget"
    }
    if (os === "darwin") {
      return "brew install node"
    }
    return "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
  }, [os])
  const platform = os === "windows" ? "Windows" : os === "darwin" ? "macOS" : os === "linux" ? "Linux" : "该节点系统"

  if (!missingNode && !missingNpm) return null

  return (
    <Alert variant="destructive">
      <AlertDescription>
        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium">需要在节点主机安装或补充上报 Node.js/npm</div>
            <div className="mt-1 text-xs">
              agent-compose runtime 已由安装脚本自动下载；Node.js 是运行 runtime 和编辑器 CLI 的宿主。
              当前：{missingNode ? <Badge variant="outline" className="mx-1 border-destructive text-destructive">Node.js 未上报</Badge> : null}
              {missingNpm ? <Badge variant="outline" className="mx-1 border-destructive text-destructive">npm 未上报</Badge> : null}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            在 {platform} 节点主机的终端执行以下命令。安装完成后重启节点进程，节点会重新探测并上报版本。
          </div>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{command}</code>
            <Button size="icon-sm" variant="outline" onClick={() => copyCommand(command)} aria-label="复制 Node.js 安装命令">
              <Copy />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            验证：{os === "windows" ? "node --version && npm --version" : "node --version && npm --version"}；若命令可用但仍显示未上报，请完全停止旧节点进程后重新启动，避免旧进程继续使用旧 PATH。
          </div>
        </div>
      </AlertDescription>
    </Alert>
  )
}
