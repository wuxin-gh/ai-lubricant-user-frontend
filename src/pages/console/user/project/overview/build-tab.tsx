/** 项目详情 — 构建 tab（Stage 4：WDA recipe 端到端）。
 *
 * 选 recipe（本轮只 WDA）→ 选构建节点（须具备 xcodebuild 能力）→ 一键构建。
 * 构建只编译/打包、绝不签名——产物暂存服务端，运营方在「下载 .ipa」拿到包后
 * 手动拖入市场管理页 device-control-versions 上传弹框发布（iOS 资产 = WDA runner）。
 * 使用者侧「准备 WDA」再从市场解析产物、经节点出口代理下载重签安装。
 */
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import {
  cancelProjectBuild,
  getProjectBuild,
  projectBuildArtifactUrl,
  startProjectBuild,
  type ProjectBuildSnapshot,
} from "@/api/builtinToolsClient"
import type { NodeInfo } from "@/api/nodes"

/** 本轮唯一 recipe；服务端校验同一集合。 */
const RECIPES = [{ value: "xcode_wda", label: "WebDriverAgent（iOS 自动化 runner）" }]

const STAGE_LABEL: Record<string, string> = {
  cloning: "拉取源码",
  building: "编译",
  packaging: "打包",
  uploading: "上传产物",
}

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] || stage
}

export default function ProjectBuildTab({ projectId, nodes }: { projectId: string; nodes: NodeInfo[] }) {
  // 具备 Xcode 构建能力的节点（hostTools 探针上报的 xcodebuild_version 标签）。
  // mac 的 node-ios（ios_host）同样承载 xcodebuild，是首选构建节点——服务端
  // start 校验 capability + 使用权，这里只做展示过滤。
  const darwinNodes = useMemo(
    () => nodes.filter((n) => n.node_role === "execution" || n.node_role === "ios_host"),
    [nodes],
  )
  const buildNodes = useMemo(
    () => darwinNodes.filter((n) => !!n.capabilities?.xcodebuild_version),
    [darwinNodes],
  )

  const [recipeKind, setRecipeKind] = useState(RECIPES[0].value)
  const [nodeId, setNodeId] = useState("")
  const [starting, setStarting] = useState(false)

  // 构建进度
  const [buildId, setBuildId] = useState<string | null>(null)
  const [build, setBuild] = useState<ProjectBuildSnapshot | null>(null)

  const reset = () => {
    setBuildId(null)
    setBuild(null)
  }

  // 轮询构建进度：2s
  useEffect(() => {
    if (!buildId) return
    let stop = false
    const poll = async () => {
      try {
        const snapshot = await getProjectBuild(buildId)
        if (stop) return
        setBuild(snapshot)
        if (snapshot.status === "failed") {
          toast.error(`构建失败：${snapshot.message || snapshot.stage}`)
        }
      } catch (e) {
        if (!stop) console.error("轮询构建状态失败", e)
      }
    }
    const timer = setInterval(() => void poll(), 2000)
    void poll()
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [buildId])

  const start = async () => {
    if (!nodeId) {
      toast.error("请选择构建节点")
      return
    }
    setStarting(true)
    try {
      const result = await startProjectBuild(projectId, {
        recipe_kind: recipeKind,
        node_id: nodeId,
      })
      setBuildId(result.build_id)
      setBuild(null)
      toast.success("构建已发起")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发起构建失败")
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    if (!buildId) return
    try {
      await cancelProjectBuild(buildId)
      toast.success("已取消构建")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消失败")
    }
  }

  // ── 空态：没有 Xcode 节点 ─────────────────────────────────────────────
  if (!buildNodes.length) {
    // 区分两种缺因：有 macOS 节点但缺 Xcode（指引去环境面板检测/看原因），
    // 和根本没有 macOS 节点。node-ios（ios_host）也是合法构建节点。
    const macWithoutXcode = darwinNodes.some((n) => !(n.capabilities?.xcodebuild_version || "").trim())
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {macWithoutXcode ? (
          <>
            macOS 节点未检测到完整 Xcode（xcodebuild），无法构建。
            <br />
            Xcode 无法远程自动安装：请在该节点上从 App Store 安装完整 Xcode 后，由管理员在
            节点详情「环境」面板点「检测 Xcode」——检测成功即刷新构建能力，无需重启节点
            （旧版节点程序需重启一次才能上报）。
          </>
        ) : (
          <>
            暂无 macOS 节点（执行节点或 iOS 设备主机均可，需安装完整 Xcode）。
            <br />
            绑定后即可在此构建 WDA。
          </>
        )}
      </div>
    )
  }

  const buildRunning = build?.status === "running" || (!!buildId && !build)

  return (
    <div className="space-y-3 min-h-0 overflow-y-auto">
      <p className="text-xs text-muted-foreground">
        构建在节点上执行（拉取源码 → 编译 → 打包），产物暂存服务端供运营方下载后上传市场；签名一律走 go-ios ASC 路径（任意 OS 可签），在设备「准备 WDA」时按签名配置重签安装。
      </p>

      {!buildId ? (
        <div className="flex flex-col gap-3 rounded border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>构建对象</Label>
              <Select value={recipeKind} onValueChange={setRecipeKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECIPES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>构建节点</Label>
              <Select value={nodeId} onValueChange={setNodeId}>
                <SelectTrigger><SelectValue placeholder="选择节点" /></SelectTrigger>
                <SelectContent>
                  {buildNodes.map((n) => (
                    <SelectItem key={n.node_id} value={n.node_id}>
                      {n.node_name}（{n.capabilities?.xcodebuild_version}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void start()} disabled={starting}>
              {starting && <Spinner className="mr-2 h-4 w-4" />}
              开始构建
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded border p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">构建进度</div>
            <div className="flex items-center gap-2">
              {build?.status === "completed" ? (
                <Badge variant="default">构建完成</Badge>
              ) : build?.status === "failed" ? (
                <Badge variant="destructive">构建失败</Badge>
              ) : (
                <Badge variant="secondary">构建中</Badge>
              )}
              {buildRunning && (
                <Button variant="outline" size="sm" onClick={() => void cancel()}>取消</Button>
              )}
              {(build?.status === "completed" || build?.status === "failed") && (
                <Button variant="outline" size="sm" onClick={reset}>再次构建</Button>
              )}
            </div>
          </div>

          {build && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span>{stageLabel(build.stage)}</span>
                <span className="text-muted-foreground">{build.percent}%</span>
              </div>
              <Progress value={build.percent} />
              {build.message && <div className="text-xs text-muted-foreground">{build.message}</div>}
              {build.log_tail && (
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">{build.log_tail}</pre>
              )}
              {build.status === "completed" && build.artifact_sha256 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-muted-foreground">
                    产物已生成：sha256 {build.artifact_sha256.slice(0, 16)}…（{build.artifact_size_bytes ? `${(build.artifact_size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}）
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" asChild className="w-fit">
                      <a href={projectBuildArtifactUrl(build.build_id)} download>
                        下载 .ipa
                      </a>
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      下载后到市场管理页「设备控制 App」上传，平台选 iOS，文件名按 device-control-&lt;版本&gt;-ios.ipa。
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
