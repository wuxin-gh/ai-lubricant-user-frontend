/**
 * 「接入手机」（添加设备）弹框：Android（装控制 App + 配对码）与 iOS（宿主节点 +
 * UDID 认领）两条完全不同的接入方案，由 platform prop 决定走哪条。
 *
 * 从 resources.tsx 原样抽出（设备工具页与首页快捷操作共用）。
 */
import { useEffect, useState } from "react"
import { Copy, Download, Plus, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { IconBrandAndroid, IconBrandApple } from "@tabler/icons-react"
import { copyToClipboard } from "@/utils/clipboard"

import {
  claimIosDevice,
  getDeviceControlAppRelease,
  listDeviceResources,
  listIosHosts,
  mintDevicePairingCodeResource,
  type DeviceControlAppRelease,
  type DeviceResource,
  type IosHostNode,
} from "@/api/builtinToolsClient"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { formatBytes } from "@/pages/manager/platform/nodes/types"
import { TutorialStep } from "./tutorial-step"
import { copyText } from "./copy-text"

// Android 接入引导（长在「添加设备」流程里）：
// 下载控制 App（marketplace mobile-version 直链）+ 开启无障碍服务。
function AndroidSetupGuide({
  release,
  loaded,
  startIndex = 1,
}: {
  release: DeviceControlAppRelease | null
  loaded: boolean
  startIndex?: number
}) {
  // 优先走服务端代理下载路径（同站相对 URL）；手机/浏览器无需直连 GitHub。
  const androidUrl = release?.android?.proxy_download_url || release?.android?.download_url || ""
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const androidVersion = release?.android?.version || release?.version || ""
  const androidSize = release?.android?.size_bytes ? formatBytes(release.android.size_bytes) : ""
  return (
    <>
      <TutorialStep index={startIndex} title="下载控制 App（Android）">
        <p className="text-xs leading-5 text-muted-foreground">
          用手机浏览器下载最新 APK 并安装；下载经本服务器代理转发（无需直连 GitHub）。
          安装时系统会要求允许「安装未知来源应用」，请允许。
          手机浏览器下载失败时，可复制链接发到手机上打开。
        </p>
        {!loaded ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            正在获取最新版本
          </div>
        ) : androidUrl ? (
          <div className="flex flex-col gap-1.5">
            <Button variant="outline" size="sm" asChild className="w-fit">
              <a href={androidUrl} download>
                <Download className="size-4" />
                下载 Android App{androidVersion ? `（v${androidVersion}${androidSize ? ` · ${androidSize}` : ""}）` : ""}
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit text-xs text-muted-foreground"
              onClick={() => void copyText(androidUrl.startsWith("http") ? androidUrl : `${origin}${androidUrl}`)}
            >
              <Copy className="size-3.5" />
              复制下载链接
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            暂未发布控制 App 安装包（市场管理页「设备控制 App」上传后这里会出现下载入口）。
          </p>
        )}
      </TutorialStep>

      <TutorialStep index={startIndex + 1} title="开启无障碍服务">
        <p className="text-xs leading-5 text-muted-foreground">
          装好后打开 App，按其首页的「打开无障碍设置」按钮跳转到系统
          <b> 设置 → 辅助功能 → 设备控制</b> 并开启（部分机型在「无障碍」或「更多设置」下）。
          远程读屏与点击都依赖它，不开则连上后也无法操作设备。
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          若系统弹出通知权限（Android 13+），建议允许；省电策略会杀长连接，可在系统设置里
          对该 App 关闭电池优化（可选）。
        </p>
      </TutorialStep>
    </>
  )
}

/** 设备 device_info 里的字符串字段（model / os_version / ...），空安全。 */
function strInfo(device: DeviceResource | null, key: string): string {
  const v = device?.device_info?.[key]
  return typeof v === "string" ? v : ""
}

/** 内网地址：App 配对时上报的 lan_ips 数组，渲染成一行。 */
function lanIpsInfo(device: DeviceResource | null): string {
  const raw = device?.device_info?.lan_ips
  if (Array.isArray(raw) && raw.length > 0) return raw.filter((x) => typeof x === "string").join(" / ")
  return ""
}

/** 配对成功面板里的一个信息格子：有值才渲染。 */
function DeviceInfoField({ label, value, className }: { label: string; value: string; className?: string }) {
  if (!value) return null
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <span className="text-muted-foreground">{label}：</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  )
}

export function DevicePairDialog({
  open,
  onOpenChange,
  onPaired,
  platform: platformProp,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPaired: () => void
  /** 不传（首页快捷操作）则弹框第一步先选 Android / iPhone；传入则直接进入对应流程。 */
  platform?: "android" | "ios"
}) {
  const [platform, setPlatform] = useState<"android" | "ios" | null>(platformProp ?? null)
  // 打开时同步外部传入的平台（/devices 页固定传值）；未传则停留在选择步。
  useEffect(() => {
    if (!open) return
    setPlatform(platformProp ?? null)
  }, [open, platformProp])
  const [label, setLabel] = useState("")
  const [code, setCode] = useState<string | null>(null)
  const [ttl, setTtl] = useState(0)
  const [generating, setGenerating] = useState(false)

  // 接入引导：弹框打开即拉一次 marketplace 最新安装包直链（Android=APK / iOS=IPA，
  // 设备控制被控端）。两平台共用同一份版本信息。
  const [deviceControlRelease, setDeviceControlRelease] = useState<DeviceControlAppRelease | null>(null)
  const [deviceControlLoaded, setDeviceControlLoaded] = useState(false)
  useEffect(() => {
    if (!open) return
    setDeviceControlLoaded(false)
    void getDeviceControlAppRelease()
      .then(setDeviceControlRelease)
      .finally(() => setDeviceControlLoaded(true))
  }, [open])

  // iOS 单台认领：选宿主节点 → 填 UDID → 认领。批量扫描走顶部「扫描设备」入口。
  const [iosHostId, setIosHostId] = useState("")
  const [iosManualUdid, setIosManualUdid] = useState("")
  const [iosClaiming, setIosClaiming] = useState(false)
  const [iosClaimedDeviceId, setIosClaimedDeviceId] = useState<string | null>(null)

  // iOS hosts 列表
  const [iosHosts, setIosHosts] = useState<IosHostNode[]>([])
  const [iosHostsLoading, setIosHostsLoading] = useState(false)

  // 已知设备快照：配对码发出后轮询，出现新 device_id 即配对成功。
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set())
  const [pairedName, setPairedName] = useState<string | null>(null)
  // 配对成功那一刻的设备记录：手机信息（型号/系统/App 版本/内网 IP）在配对请求里
  // 已随 device_info 落库，直接取来展示——不必等 WS register 上来。
  const [pairedDevice, setPairedDevice] = useState<DeviceResource | null>(null)

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  // 用户在 App 内只需填服务器地址（不带路径）：App 自己固定拼 /mcp/device-control 的
  // 请求路径（pair + ws），这里展示/复制的也就是纯地址，杜绝路径不一致导致连不上。
  const serverAddr = origin
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)

  // Load iOS hosts when platform is iOS
  useEffect(() => {
    if (!open || platform !== "ios") return
    setIosHostsLoading(true)
    void listIosHosts()
      .then(({ hosts }) => setIosHosts(hosts))
      .catch(() => setIosHosts([]))
      .finally(() => setIosHostsLoading(false))
  }, [open, platform])

  // Claim one iOS device by UDID (single-device manual add path).
  const claimDevice = async (udid: string, deviceName: string) => {
    if (!iosHostId) {
      toast.error("请先选择 iOS 宿主节点")
      return
    }
    if (!udid) {
      toast.error("请输入设备 UDID")
      return
    }
    setIosClaiming(true)
    try {
      const { device_id } = await claimIosDevice({
        node_id: iosHostId,
        udid,
        label: label.trim() || deviceName,
      })
      setIosClaimedDeviceId(device_id)
      toast.success(`已接入设备：${label.trim() || deviceName}`)
      setTimeout(() => {
        onPaired()
        onOpenChange(false)
      }, 1000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "认领设备失败")
    } finally {
      setIosClaiming(false)
    }
  }

  const generate = async () => {
    if (platform === "android") {
      setGenerating(true)
      setPairedName(null)
      try {
        try {
          const { devices } = await listDeviceResources()
          setKnownIds(new Set(devices.map((d) => d.device_id)))
        } catch {
          setKnownIds(new Set())
        }
        const { code, ttl } = await mintDevicePairingCodeResource(label.trim())
        setCode(code)
        setTtl(ttl)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "生成配对码失败")
      } finally {
        setGenerating(false)
      }
    }
  }

  useEffect(() => {
    if (!open || !code || pairedName) return
    let stop = false
    const tick = async () => {
      try {
        const { devices } = await listDeviceResources()
        const fresh = devices.find((d) => !knownIds.has(d.device_id))
        if (fresh && !stop) {
          setPairedName(fresh.name || fresh.device_id.slice(0, 12))
          setPairedDevice(fresh)
          onPaired()
          toast.success(`已连接：${fresh.name || fresh.device_id.slice(0, 12)}`)
        }
      } catch {
        // 轮询失败不打扰用户，下一轮再试。
      }
    }
    const timer = setInterval(() => void tick(), 2000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [open, code, knownIds, pairedName, onPaired])

  const copy = (text: string, msg: string) => {
    void copyToClipboard(text).then((ok) => {
      if (ok) toast.success(msg)
      else toast.error("复制失败，请手动选择")
    })
  }

  const reset = () => {
    setLabel("")
    setCode(null)
    setTtl(0)
    setPairedName(null)
    setPairedDevice(null)
    setKnownIds(new Set())
    setIosHostId("")
    setIosManualUdid("")
    setIosClaimedDeviceId(null)
  }

  // 每次打开都回到全新表单：radix 的 onOpenChange 只在点遮罩/ESC 时触发，
  // 「完成」按钮和 iOS 认领成功路径直接调 onOpenChange prop，旧数据会残留到
  // 下一次打开（表现为「要再点一次生成配对码」）。这里以 open 为准在打开时重置。
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent
        className={
          platform === null
            // 还没选类型：矮而宽，只放两个大按钮，不让用户一进来就面对长表单。
            ? "w-[calc(100vw-2rem)] max-w-3xl"
            // 选了类型：按原尺寸展开，放接入步骤。
            : "flex h-[90vh] w-[calc(100vw-2rem)] max-w-[1280px] flex-col overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle>
            {platform === null
              ? "控制手机"
              : platform === "android"
                ? "添加 Android 设备"
                : "添加 iOS 设备"}
          </DialogTitle>
          <DialogDescription>
            {platform === null
              ? "选手机类型，平台会按它的接入方案一步步带你。"
              : platform === "android"
                ? "手机安装控制 App，生成配对码后在 App 内填入即可接入。"
                : "iPhone 用数据线连到一台运行 iOS 宿主节点的电脑（Windows/Linux/Mac 均可，无需 Mac），手机「信任此电脑」后扫描认领即可接入；接入后在设备列表「初始化 Runner」，宿主节点自动下载、签名并安装到手机。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {platform === null ? (
            <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPlatform("android")}
                className="flex items-center justify-center gap-3 rounded-xl border p-8 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <IconBrandAndroid className="size-8 shrink-0 text-primary" />
                <span className="text-base font-medium">Android 手机</span>
              </button>
              <button
                type="button"
                onClick={() => setPlatform("ios")}
                className="flex items-center justify-center gap-3 rounded-xl border p-8 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <IconBrandApple className="size-8 shrink-0 text-primary" />
                <span className="text-base font-medium">iPhone（iPad）</span>
              </button>
            </div>
          ) : !code && !iosClaimedDeviceId ? (
            <>
              {platform === "ios" && (
                <>
                  <TutorialStep index={1} title="把 iPhone 连到宿主节点">
                    <p className="text-xs leading-5 text-muted-foreground">
                      用数据线把 iPhone 连到运行 iOS 宿主节点的电脑，并在手机弹窗里「信任此电脑」。
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      iPhone 接入由宿主节点经 DeviceKit Runner 驱动，<b>无需在手机上手动安装任何 App</b>——
                      这点与 Android（装控制 App + 配对码）的方案不同。Runner 由宿主节点在
                      接入后的「初始化 Runner」步骤自动下载、重签并安装到手机；宿主节点
                      Windows/Linux/Mac 均可，无需 Mac 或 Xcode。
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      接入后先在设备列表「初始化 Runner」里配置签名方式：Apple ID 免费
                      全自动（推荐，登录一次即可、含 7 天自动续期）、付费 App Store Connect
                      API Key（全自动）或自备 P12 证书（免费 Apple ID 证书 7 天过期）。
                    </p>
                  </TutorialStep>

                  <TutorialStep index={2} title="选择 iOS 宿主节点">
                    <div className="flex flex-col gap-1.5">
                      <Select value={iosHostId} onValueChange={setIosHostId}>
                        <SelectTrigger><SelectValue placeholder="选择节点" /></SelectTrigger>
                        <SelectContent>
                          {iosHostsLoading ? (
                            <div className="flex items-center justify-center p-2">
                              <Spinner className="size-4" />
                            </div>
                          ) : iosHosts.length === 0 ? (
                            <div className="p-2 text-xs text-muted-foreground">暂无 iOS 宿主节点</div>
                          ) : (
                            iosHosts.map((h) => (
                              <SelectItem key={h.node_id} value={h.node_id}>
                                {h.name || h.node_name || h.node_id} {!h.online && "(离线)"}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {iosHosts.length === 0 && !iosHostsLoading && (
                        <p className="text-xs text-muted-foreground">
                          当前没有节点可以扫描 iOS 设备。扫描需要节点机能够访问 Apple
                          设备服务（Windows 装 Apple Devices 或 iTunes，macOS 自带），
                          且节点程序为支持该能力的版本。
                        </p>
                      )}
                    </div>
                  </TutorialStep>

                  {iosHostId && (
                    <TutorialStep index={3} title="输入设备 UDID 认领">
                      <div className="flex flex-col gap-2">
                        <p className="text-xs leading-5 text-muted-foreground">
                          在宿主节点上用 <code>ios.exe list</code> 或
                          <code>idevice_id -l</code> 拿到 iPhone 的 UDID，填入下方认领。
                          要批量扫描多台设备，请改用顶部「扫描设备」。
                        </p>
                        <div className="flex flex-col gap-1.5">
                          <Label>设备 UDID</Label>
                          <Input
                            value={iosManualUdid}
                            onChange={(e) => setIosManualUdid(e.target.value)}
                            placeholder="00008101-XXXXXXXX"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>设备名称（可选，接入后可改）</Label>
                          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="我的 iPhone" />
                        </div>
                        <Button
                          onClick={() => void claimDevice(iosManualUdid.trim(), label.trim() || iosManualUdid.trim())}
                          disabled={!iosManualUdid.trim() || iosClaiming}
                        >
                          {iosClaiming ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                          认领设备
                        </Button>
                      </div>
                    </TutorialStep>
                  )}
                </>
              )}

              {platform === "android" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label>设备名称（可选）</Label>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如 我的手机" />
                  </div>

                  <div className="flex flex-col gap-2">
                    <AndroidSetupGuide release={deviceControlRelease} loaded={deviceControlLoaded} />
                  </div>

                  <Button onClick={() => void generate()} disabled={generating}>
                    {generating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                    生成配对码
                  </Button>
                </>
              )}
            </>
          ) : code ? (
            <div className="flex flex-col gap-4">
              {pairedName ? (
                <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="flex items-start gap-3">
                    <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">设备已连接</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{pairedName}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{pairedDevice?.online ? "在线" : "连接中"}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
                    <DeviceInfoField label="型号" value={strInfo(pairedDevice, "model")} />
                    <DeviceInfoField label="系统" value={strInfo(pairedDevice, "os_version")} />
                    <DeviceInfoField label="厂商" value={strInfo(pairedDevice, "manufacturer")} />
                    <DeviceInfoField label="App 版本" value={strInfo(pairedDevice, "app_version")} />
                    <DeviceInfoField
                      label="内网地址"
                      value={lanIpsInfo(pairedDevice)}
                      className="col-span-2"
                    />
                    <DeviceInfoField
                      label="无障碍"
                      value={
                        pairedDevice?.device_info?.accessibility_enabled === true
                          ? "已开启"
                          : pairedDevice?.device_info?.accessibility_enabled === false
                            ? "未开启（连上后无法远程操作）"
                            : ""
                      }
                      className="col-span-2"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  等待设备使用配对码
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label>配对码（{Math.ceil(ttl / 60)} 分钟内有效，只能用一次）</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-base font-bold tracking-[0.15em]">
                    {code}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(code, "已复制配对码")}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">配对码大小写不敏感，App 内输入小写也可以。</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>服务器地址（App 内只需填这个地址，无需填路径）</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                    {serverAddr}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(serverAddr, "已复制地址")}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  App 会自动拼接请求路径；地址填错时 App 会提示「未能在该地址找到设备控制服务端」。
                </p>
                {isLoopback && (
                  <p className="text-xs text-destructive">
                    这是本机回环地址，手机连不上。请把 localhost 换成电脑的局域网 IP，并确保手机与电脑在同一网络。
                  </p>
                )}
              </div>

              <Button variant="outline" onClick={() => void generate()} disabled={generating}>
                {generating ? <Spinner className="size-4" /> : null}
                重新生成
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">设备已接入</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  接下来在设备列表点「初始化 Runner」，宿主节点会自动下载、签名、安装并启动 DeviceKit Runner。
                </div>
              </div>
            </div>
          )}
        </div>

        {platform !== null ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>完成</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
