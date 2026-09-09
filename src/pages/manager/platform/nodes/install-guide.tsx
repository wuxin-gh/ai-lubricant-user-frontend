/**
 * 客户端节点安装引导（执行节点 & 管理节点客户端共用）。
 *
 * 只有「带客户端」的节点才需要安装——它下载 agent-compose 二进制、拨号连回。
 * 纯分组容器（passive_management）不走这里。
 *
 * 安装方式统一按平台 Tab 呈现，不再有单独的「安装方式」下拉：
 * - 执行节点：Linux / macOS / Windows（同一条一键命令，脚本自识别平台）+ Docker + 安装包。
 * - 管理节点客户端：只 Docker + 安装包（`nodes/management` 二进制只支持容器化）。
 * 「安装包」tab 列出全部平台的 agent-compose 运行程序手动下载（一键命令会自动下载，
 * 离线 / 自定义部署才需手动取）。比折叠块直观，不再有「藏在底部被挡」的问题。
 *
 * 「sudo 提权」开关（默认开）把一键命令切到 `curl … | sudo bash`：docker 方式访问
 * /var/run/docker.sock 需要 root（普通用户会报 docker API 权限错）；standalone 装在
 * 当前用户目录，通常无需提权，可按需关闭。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronsUpDown, Copy, Download, Eye, EyeOff } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"
import {
  downloadNodeBinary,
  listNodeBinaries,
  type NodeBinary,
} from "@/@admin-port/api/nodes"
import { ARCH_LABEL, OS_LABEL, ROLE_LABEL, formatBytes } from "./types"

/**
 * 本地构建的节点镜像默认 tag（与后端 `agent_compose_agent_image` 默认值一致）。
 * docker / docker-compose 方式在宿主机本地 `docker build` 出这一份镜像，管理节点与其
 * 拉起的子执行节点共用，不从公共仓库拉取。服务端若改了配置，一键脚本会用真实镜像名，
 * 这里只用于「高级」手动块的占位展示。
 */
export const DEFAULT_NODE_IMAGE = "ai-lubricant-node:local"

export async function copyText(text: string, msg = "已复制") {
  if (await copyToClipboard(text)) {
    toast.success(msg)
  } else {
    toast.error("复制失败，请手动选择")
  }
}

/** 一行可复制字段：label + mono code + 复制按钮。 */
export function CopyField({
  label,
  value,
  mono = true,
  emphasize = false,
  masked = false,
}: {
  label: string
  value: string
  mono?: boolean
  /** 突出显示（一次性凭证 / 一键命令）：更大字号 + 强调边框。 */
  emphasize?: boolean
  /** 敏感字段：默认遮盖，提供显隐切换；复制始终拷贝真实值。 */
  masked?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  if (!value) return null
  const displayValue =
    masked && !revealed ? "•".repeat(Math.min(Math.max(value.length, 12), 32)) : value
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label>{label}</Label> : null}
      <div className="flex items-start gap-2">
        <code
          className={cn(
            "min-w-0 flex-1 rounded bg-muted px-2 py-1.5 break-all",
            mono ? "font-mono" : "",
            emphasize
              ? "text-sm ring-1 ring-primary/30 bg-primary/5"
              : "text-xs",
          )}
        >
          {displayValue}
        </code>
        {masked ? (
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => setRevealed((visible) => !visible)}
            aria-label={revealed ? `隐藏${label || "内容"}` : `显示${label || "内容"}`}
            title={revealed ? "隐藏" : "显示"}
          >
            {revealed ? <EyeOff /> : <Eye />}
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => void copyText(value)}
          aria-label={`复制${label || "内容"}`}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}

/** 解析安装脚本/二进制下载的公开 origin：优先服务端配置，否则回退到当前站点。 */
export function resolvePublicOrigin(serverUrl?: string): string {
  const s = (serverUrl || "").trim().replace(/\/$/, "")
  if (s) return s
  if (typeof window !== "undefined") return window.location.origin
  return ""
}

/**
 * 一键安装命令：curl 下载已拼好凭证的自包含脚本并执行。
 *
 * ``method`` 是可选的呈现覆盖：执行节点默认按 standalone 入驻，Docker 标签页需要显式
 * 请求 docker 版脚本（本地 build 镜像并起容器），不改后端节点记录。管理节点本就以
 * docker 入驻，无需传。
 *
 * ``sudo`` 为真时管道右侧用 root 执行：`curl … | sudo bash`。docker 方式访问
 * /var/run/docker.sock 需要 root；否则普通用户会报 docker API 权限错。
 */
export function oneClickCommand(
  origin: string,
  nodeId: string,
  method?: "docker" | "docker-compose",
  sudo?: boolean,
): string {
  const base = origin || "<服务端地址>"
  const query = method ? `?method=${method}` : ""
  return `curl -fsSL "${base}/api/v1/public/nodes/${nodeId}/install.sh${query}" | ${sudo ? "sudo " : ""}bash`
}

/**
 * Windows 一键命令：PowerShell 下载 .bat 到临时目录再运行。.bat 会下载 Windows
 * 运行程序、注册当前用户 ONLOGON 计划任务（开机启动）、立即启动，无需 WSL/bash。
 */
export function oneClickBatCommand(origin: string, nodeId: string): string {
  const base = origin || "<服务端地址>"
  const url = `${base}/api/v1/public/nodes/${nodeId}/install.bat`
  return `powershell -Command "$b=\\"$env:TEMP\\install-node.bat\\"; Invoke-WebRequest -UseBasicParsing '${url}' -OutFile $b; & $b"`
}

/** Windows PowerShell 原生命令（无需经过 cmd.exe 的外层引号）。 */
function oneClickBatPowerShellCommand(origin: string, nodeId: string): string {
  const base = origin || "<服务端地址>"
  const url = `${base}/api/v1/public/nodes/${nodeId}/install.bat`
  return `$b="$env:TEMP\\install-node.bat"; Invoke-WebRequest -UseBasicParsing '${url}' -OutFile $b; & $b`
}

/** 手动 docker 命令模板（无 secret 时用占位符）。镜像用本地构建的默认 tag。 */
function dockerRunCmd(
  server: string,
  nodeId: string,
  secret: string,
  role: string,
  image: string,
  sudo = false,
): string {
  const img = image || DEFAULT_NODE_IMAGE
  return [
    sudo ? "sudo docker run -d \\" : "docker run -d \\",
    "  --name agent-compose-node \\",
    "  --restart always \\",
    "  -v /var/run/docker.sock:/var/run/docker.sock \\",
    `  -e AGENT_COMPOSE_SERVER="${server}" \\`,
    `  -e AGENT_COMPOSE_NODE_ID="${nodeId}" \\`,
    `  -e AGENT_COMPOSE_NODE_SECRET="${secret}" \\`,
    `  -e AGENT_COMPOSE_NODE_ROLE="${role}" \\`,
    `  -e AGENT_COMPOSE_AGENT_IMAGE="${img}" \\`,
    `  ${img}`,
  ].join("\n")
}

function composeEnvBlock(
  server: string,
  nodeId: string,
  secret: string,
  role: string,
  image: string,
): string {
  const img = image || DEFAULT_NODE_IMAGE
  return [
    `AGENT_COMPOSE_SERVER=${server}`,
    `AGENT_COMPOSE_NODE_ID=${nodeId}`,
    `AGENT_COMPOSE_NODE_SECRET=${secret}`,
    `AGENT_COMPOSE_NODE_ROLE=${role}`,
    `AGENT_COMPOSE_AGENT_IMAGE=${img}`,
  ].join("\n")
}

/**
 * 本地构建节点镜像的命令（在装了 docker 的 linux 机器上执行一次）。一键脚本会自动做
 * 同样的事；这里给「高级 / 离线部署」手动复刻：下载两个 Go 二进制 + Dockerfile +
 * entrypoint，再 `docker build`。管理节点与子执行节点共用这一份镜像。
 */
function dockerBuildCommands(origin: string, image: string, sudo = false): string {
  const base = origin || "<服务端地址>"
  const img = image || DEFAULT_NODE_IMAGE
  return [
    `set -euo pipefail`,
    `arch=$(uname -m); case $arch in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo "unsupported arch: $arch"; exit 1;; esac`,
    `mkdir -p ~/.agent-compose/image-build && cd ~/.agent-compose/image-build`,
    `curl -fsSL ${base}/api/v1/public/nodes/binaries/node-execution-linux-$arch -o node-execution`,
    `curl -fsSL ${base}/api/v1/public/nodes/binaries/agent-compose-node-management-linux-$arch -o agent-compose-node-management`,
    `curl -fsSL ${base}/api/v1/public/nodes/docker/Dockerfile -o Dockerfile`,
    `curl -fsSL ${base}/api/v1/public/nodes/docker/entrypoint.sh -o entrypoint.sh`,
    `chmod +x node-execution agent-compose-node-management entrypoint.sh`,
    `${sudo ? "sudo " : ""}docker build -t ${img} .`,
  ].join("\n")
}

const COMPOSE_YML = [
  "services:",
  "  agent-compose-node:",
  "    image: ${AGENT_COMPOSE_AGENT_IMAGE}",
  "    container_name: agent-compose-node",
  "    restart: always",
  "    env_file:",
  "      - ./.env",
  "    volumes:",
  "      - /var/run/docker.sock:/var/run/docker.sock",
].join("\n")

/**
 * 高级折叠区：通栏标题卡片 + 展开时自动把内容滚入弹窗可视范围。
 *
 * 之前贴近弹窗底部时点开折叠，新撑开的内容底部会被滚动区裁在页脚上方之外
 * （「点击之后挡住另外的内容」的根因——Radix Collapsible 不自动滚入视口，
 * 用户得再手动滚一下才看全）。这里在 onOpenChange 展开后用 scrollIntoView
 * nearest 把内容刚好带进可见区，两个高级块共用，后续新增的高级块也直接复用。
 */
function AdvancedSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        // 内容撑开后下一帧再滚入视口（此时高度已确定）。
        requestAnimationFrame(() => {
          contentRef.current?.scrollIntoView({ block: "nearest" })
        })
      }}
      className="group overflow-hidden rounded-lg border"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5">
            <ChevronsUpDown className="size-3.5" />
            {title}
          </span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent ref={contentRef} className="flex flex-col gap-3 border-t px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Docker「高级 / 手动部署」折叠块：本地构建镜像 + 手动 docker run + docker-compose。
 *
 * 主区已给一键命令（curl | bash，自动 build+run）；这里给需要离线 / 自定义部署的人一份
 * 可复刻的显式步骤，符合「不遮掩服务端动作」。所有命令都用本地构建的镜像 tag。
 */
function DockerAdvancedBlock({
  origin,
  server,
  nodeIdVal,
  secretVal,
  role,
  image,
  sudo = false,
}: {
  origin: string
  server: string
  nodeIdVal: string
  secretVal: string
  role: string
  image: string
  sudo?: boolean
}) {
  return (
    <AdvancedSection title="高级：手动构建与部署">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          一键命令会自动完成以下步骤。离线 / 自定义部署时可手动执行。
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">① 首次：在宿主机本地构建镜像</span>
          （管理节点与其子执行节点共用，不从公共仓库拉取）：
        </p>
        <CopyField label="① 本地构建镜像" value={dockerBuildCommands(origin, image, sudo)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">② 用 docker run 启动</span>：
        </p>
        <CopyField label="② docker run 启动" value={dockerRunCmd(server, nodeIdVal, secretVal, role, image, sudo)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">③ 或改用 docker-compose</span>：新建目录，
          写入 <code>.env</code> 与 <code>docker-compose.yml</code>，再{" "}
          <code>{sudo ? "sudo docker compose up -d" : "docker compose up -d"}</code>
          （先完成 ① 构建镜像）：
        </p>
        <CopyField label=".env" value={composeEnvBlock(server, nodeIdVal, secretVal, role, image)} />
        <CopyField label="docker-compose.yml" value={COMPOSE_YML} />
      </div>
    </AdvancedSection>
  )
}

/** 一键命令块（含凭证时展示，缺凭证时提示不可再取）。 */
function OneClickBlock({
  hasSecret,
  oneClick,
  hint,
  label = "一键安装",
}: {
  hasSecret: boolean
  oneClick: string
  hint: string
  /** 复制字段标题；同一平台下有多种终端命令时区分用。 */
  label?: string
}) {
  if (!hasSecret) {
    return (
      <div className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
        一键命令含一次性凭证，仅在刚入驻时可用。请重新入驻获取。
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{hint}</p>
      <CopyField label={label} value={oneClick} emphasize />
    </div>
  )
}

export function useNodeBinaries(open: boolean) {
  const [binaries, setBinaries] = useState<NodeBinary[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingName, setDownloadingName] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void listNodeBinaries()
      .then((list) => {
        if (!cancelled) setBinaries(list)
      })
      .catch(() => {
        if (!cancelled) setBinaries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const onDownloadBinary = useCallback(async (name: string) => {
    setDownloadingName(name)
    try {
      await downloadNodeBinary(name)
      toast.success(`已开始下载 ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败")
    } finally {
      setDownloadingName(null)
    }
  }, [])

  return { binaries, loading, downloadingName, onDownloadBinary }
}

/** 「安装包」tab 内容：全部平台的 agent-compose 运行程序手动下载列表。 */
function BinaryDownloads({
  binaries,
  loading,
  downloadingName,
  onDownloadBinary,
}: {
  binaries: NodeBinary[]
  loading: boolean
  downloadingName: string | null
  onDownloadBinary: (name: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        一键命令会自动下载对应平台的运行程序；离线安装或自定义部署时可在此手动获取
        全部平台的 <code>agent-compose</code> 运行程序。
      </p>
      {loading ? (
        <div className="flex h-12 items-center justify-center">
          <Spinner />
        </div>
      ) : binaries.length === 0 ? (
        <div className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
          未配置节点运行程序目录。请将 agent-compose 的 dist 构建产物放到服务端的节点程序目录后刷新。
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {binaries.map((b) => {
            const platform =
              b.os || b.arch
                ? `${OS_LABEL[b.os] || b.os || "?"} / ${ARCH_LABEL[b.arch] || b.arch || "?"}`
                : "校验文件"
            return (
              <div
                key={b.name}
                className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{b.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {platform}
                    {b.size ? ` · ${formatBytes(b.size)}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingName === b.name}
                  onClick={() => onDownloadBinary(b.name)}
                >
                  {downloadingName === b.name ? <Spinner /> : <Download />}
                  下载
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 客户端节点安装引导主体：凭证展示 + 按平台的安装命令 + 运行程序下载。
 *
 * 结果态（持有 secret）与待审批节点「安装方式」按钮（仅公开字段）共用。secret 为空
 * 时一键命令不可用，只展示手动模板与二进制下载。
 */
export function NodeInstallGuide({
  nodeId,
  secret,
  otpauthUri,
  role,
  launched,
  serverUrl,
  agentImage,
}: {
  nodeId: string
  secret?: string
  otpauthUri?: string
  /** "execution" | "management"（顶层角色；管理客户端只展示容器方式）。 */
  role?: string
  launched?: boolean
  serverUrl?: string
  /** 服务端配置的节点镜像 tag；空则用本地构建默认 {@link DEFAULT_NODE_IMAGE}。 */
  agentImage?: string
}) {
  const resolvedRole = role || "execution"
  const isManagement = resolvedRole === "management"
  const hasSecret = Boolean(secret)
  const origin = resolvePublicOrigin(serverUrl)
  const server = origin || "<服务端地址>"
  const nodeIdVal = nodeId || "<node_id>"
  const secretVal = secret || "<secret>"
  const image = (agentImage || "").trim() || DEFAULT_NODE_IMAGE
  // sudo 提权（默认开）：docker 方式访问 docker.sock 必须有 root，否则 build 镜像时就报
  // 「permission denied … docker API」；standalone 装在当前用户目录，不需要时可关闭。
  const [useSudo, setUseSudo] = useState(true)
  const oneClick = oneClickCommand(origin, nodeId, undefined, useSudo)
  const dockerOneClick = oneClickCommand(origin, nodeId, "docker", useSudo)
  const oneClickBat = oneClickBatCommand(origin, nodeId)
  const oneClickBatPowerShell = oneClickBatPowerShellCommand(origin, nodeId)

  const bin = useNodeBinaries(true)

  // 安装方式区挂载时滚入弹窗可见区——入驻弹窗刚打开时内容比可视区高，一键命令
  // 和两个高级入口本来沉在最底、被 footer 上方的滚动区边界"挡住够不着"。打开即滚到
  // 这块，用户立刻看到一键命令与折叠入口，不用先瞎滚。
  const installMethodsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      installMethodsRef.current?.scrollIntoView({ block: "start" })
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {hasSecret ? null : (
        <Alert>
          <AlertDescription>
            secret 仅在入驻时一次性展示，此处无法再次获取。一键安装命令已失效，若凭证已丢失请撤销入驻后重新入驻。
          </AlertDescription>
        </Alert>
      )}

      {launched ? (
        <Alert>
          <AlertDescription>
            该执行节点已由其管理节点自动拉起，通常无需再手动执行安装命令。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">角色</span>
          <span className="text-sm">{ROLE_LABEL[resolvedRole] || resolvedRole}</span>
        </div>
        {origin ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">服务端地址</span>
            <code className="font-mono text-xs break-all">{origin}</code>
          </div>
        ) : null}
      </div>

      <CopyField label="节点 ID" value={nodeId} />
      {hasSecret ? (
        <div className="flex flex-col gap-1">
          <CopyField label="节点凭证（secret）" value={secret!} emphasize masked />
          <p className="text-xs text-muted-foreground">
            此凭证仅显示一次，请立即保存；丢失后需重新入驻。节点用 secret 派生 TOTP 动态码认证，secret 本身不会在网络上明文传输。
          </p>
        </div>
      ) : null}
      {otpauthUri ? (
        <CopyField label="otpauth URI（可选，可扫入验证器）" value={otpauthUri} />
      ) : null}

      <div ref={installMethodsRef} className="flex flex-col gap-3">
        <Label>安装方式（按平台选择）</Label>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium leading-none">sudo 提权执行</span>
            <span className="text-xs text-muted-foreground">
              Docker 方式需 root 访问 /var/run/docker.sock，默认开启以避免「permission denied … docker API」报错；
              standalone 方式装在当前用户目录，无需提权时可关闭。Windows 命令不受影响。
            </span>
          </div>
          <Switch
            checked={useSudo}
            onCheckedChange={setUseSudo}
            aria-label="sudo 提权执行"
          />
        </div>
        {isManagement ? (
          // 管理节点客户端：只支持容器化。
          <Tabs
            defaultValue="docker"
            onValueChange={() => installMethodsRef.current?.scrollIntoView({ block: "start" })}
          >
            <TabsList>
              <TabsTrigger value="docker">Docker</TabsTrigger>
              <TabsTrigger value="binaries">安装包</TabsTrigger>
            </TabsList>
            <TabsContent value="docker" className="flex flex-col gap-3 pt-3">
              <p className="text-xs text-muted-foreground">
                管理节点客户端只支持容器化安装。它挂载 <code>docker.sock</code>，在本机按服务端指令启停执行节点，
                子执行节点复用同一份本地镜像。一键命令会在本机构建镜像并启动，无需推送公共仓库。
              </p>
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={dockerOneClick}
                hint="在目标 Linux 机器执行下面一条命令即可（自动下载二进制、本地构建镜像并启动管理节点）："
              />
              <DockerAdvancedBlock
                origin={origin}
                server={server}
                nodeIdVal={nodeIdVal}
                secretVal={secretVal}
                role="management"
                image={image}
                sudo={useSudo}
              />
            </TabsContent>
            <TabsContent value="binaries" className="pt-3">
              <BinaryDownloads
                binaries={bin.binaries}
                loading={bin.loading}
                downloadingName={bin.downloadingName}
                onDownloadBinary={(n) => void bin.onDownloadBinary(n)}
              />
            </TabsContent>
          </Tabs>
        ) : (
          // 执行节点：一键命令覆盖三大平台，另给 Docker 与安装包下载。
          <Tabs
            defaultValue="linux"
            onValueChange={() => installMethodsRef.current?.scrollIntoView({ block: "start" })}
          >
            <TabsList>
              <TabsTrigger value="linux">Linux</TabsTrigger>
              <TabsTrigger value="macos">macOS</TabsTrigger>
              <TabsTrigger value="windows">Windows</TabsTrigger>
              <TabsTrigger value="docker">Docker</TabsTrigger>
              <TabsTrigger value="binaries">安装包</TabsTrigger>
            </TabsList>
            <TabsContent value="linux" className="pt-3">
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={oneClick}
                hint="在目标 Linux 机器执行下面一条命令即可（自动下载对应平台运行程序并连回服务端）："
              />
            </TabsContent>
            <TabsContent value="macos" className="pt-3">
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={oneClick}
                hint="在目标 macOS 机器执行同样的一键命令（自动识别 Intel / Apple Silicon）："
              />
            </TabsContent>
            <TabsContent value="windows" className="flex flex-col gap-4 pt-3">
              <p className="text-xs text-muted-foreground">
                任选当前终端对应的命令。命令会下载并运行 .bat，获取 Windows 运行程序、注册当前用户登录时启动的计划任务并立即启动。
              </p>
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={oneClickBat}
                label="CMD"
                hint="在命令提示符（CMD）中执行："
              />
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={oneClickBatPowerShell}
                label="PowerShell"
                hint="在 PowerShell 中执行："
              />
            </TabsContent>
            <TabsContent value="docker" className="flex flex-col gap-3 pt-3">
              <p className="text-xs text-muted-foreground">
                需要本机已安装 docker。挂载 <code>docker.sock</code> 让节点在本机拉起沙箱容器。
                一键命令会在本机构建节点镜像并启动，无需推送公共仓库。
              </p>
              <OneClickBlock
                hasSecret={hasSecret}
                oneClick={dockerOneClick}
                hint="在装有 docker 的机器执行下面一条命令即可（自动下载二进制、本地构建镜像并启动执行节点）："
              />
              <DockerAdvancedBlock
                origin={origin}
                server={server}
                nodeIdVal={nodeIdVal}
                secretVal={secretVal}
                role="execution"
                image={image}
                sudo={useSudo}
              />
            </TabsContent>
            <TabsContent value="binaries" className="pt-3">
              <BinaryDownloads
                binaries={bin.binaries}
                loading={bin.loading}
                downloadingName={bin.downloadingName}
                onDownloadBinary={(n) => void bin.onDownloadBinary(n)}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
