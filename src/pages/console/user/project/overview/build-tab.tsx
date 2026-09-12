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
  // mac 节点（node-ios/ios_host 也是合法构建节点）。环境检测拆两半：
  // xcodebuild_version = Xcode 本体；xcode_ios_sdk = iOS 真机平台组件（Xcode 15+
  // 独立安装项，缺它真机构建 destination 解析直接失败）。下拉里所有 mac 节点都
  // 列出来——环境不全的禁用并标注缺哪个，而不是整块藏掉。
  const darwinNodes = useMemo(
    () => nodes.filter((n) => n.node_role === "execution" || n.node_role === "ios_host"),
    [nodes],
  )
  const buildNodes = useMemo(
    () => darwinNodes.filter((n) => !!n.capabilities?.xcodebuild_version && !!n.capabilities?.xcode_ios_sdk),
    [darwinNodes],
  )

  /** 缺环境提示：缺哪个说哪个，给可操作的修复动作。 */
  const envGapLabel = (n: NodeInfo): string => {
    const gaps: string[] = []
    if (!n.capabilities?.xcodebuild_version) gaps.push("缺 Xcode")
    if (!n.capabilities?.xcode_ios_sdk) gaps.push("缺 iOS 平台组件")
    return gaps.join("，")
  }

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

  // ── 空态：一个 mac 节点都没有 ─────────────────────────────────────────
  // 环境不全的节点仍出现在下拉里（禁用+标注），所以这里只剩「无 mac 节点」一种空态。
  if (!darwinNodes.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        暂无 macOS 节点（执行节点或 iOS 设备主机均可，需安装完整 Xcode）。
        <br />
        绑定后即可在此构建 WDA。
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
                  {/* 所有 mac 节点都列出：环境齐全的可选；缺的禁用并在文案里
                      直接标注缺什么（缺 Xcode / 缺 iOS 平台组件），管理员一眼
                      知道去补哪块。 */}
                  {darwinNodes.map((n) => {
                    const ready = !!n.capabilities?.xcodebuild_version && !!n.capabilities?.xcode_ios_sdk
                    const gap = envGapLabel(n)
                    return (
                      <SelectItem key={n.node_id} value={n.node_id} disabled={!ready}>
                        {ready
                          ? `${n.node_name}（Xcode ${n.capabilities?.xcodebuild_version} · iOS SDK ${n.capabilities?.xcode_ios_sdk}）`
                          : `${n.node_name}（${gap}）`}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {!!darwinNodes.length && !buildNodes.length && (
                <div className="text-xs text-muted-foreground">
                  当前 macOS 节点缺少 iOS 构建环境。缺 Xcode：在节点详情「环境」面板自动安装；
                  缺 iOS 平台组件：在该 Mac 执行 <code>xcodebuild -downloadPlatform iOS</code>，完成后点节点详情「刷新标签」。
                </div>
              )}
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
