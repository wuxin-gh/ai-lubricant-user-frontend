import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  listCdpClientResources,
  rotateCdpToken,
  revokeCdpToken,
  updateCdpClient,
  deleteCdpClient,
  getCdpConnectionInfo,
  listMailServiceResources,
  createMailServiceResource,
  deleteMailServiceResource,
  listDeviceResources,
  createMailAddress,
  queryMailMessages,
  getDeviceControlAppRelease,
  type DeviceControlAppRelease,
  updateResource,
  deleteResource,
  revokeDevice,
  type CdpClientResource,
  type CdpConnectionInfo,
  type DeviceResource,
  type MailServiceResource,
  type MailAddress,
  type MailMessage,
  type ToolKind,
  listIosHosts,
  claimIosDevice,
  getIosHostDevices,
  getAllIosHostDevices,
  scanIosHost,
  scanAllIosHosts,
  listIosSigningProfiles,
  createIosSigningProfile,
  updateIosSigningProfile,
  deleteIosSigningProfile,
  loginAppleId,
  verifyAppleId2fa,
  sendAppleIdSms,
  startIosWdaJob,
  getIosWdaJobStatus,
  cancelIosWdaJob,
  controlIosRunner,
  type IosHostNode,
  type IosDiscoveredDevice,
  type IosSigningProfile,
  type IosWdaJobSnapshot,
  ToolHttpError,
} from "@/api/builtinToolsClient"
import { UserPageActions } from "@/components/console/user-header-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Mail,
  Plus,
  Trash2,
  Copy,
  Wrench,
  Settings,
  ArrowLeft,
  Search,
  Inbox,
  Smartphone,
  Unplug,
} from "lucide-react"
import { IconBrandAndroid, IconBrandApple, IconBrowser } from "@tabler/icons-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// 共享组件：接入引导步骤卡与「添加浏览器 / 添加设备」弹框（首页快捷操作与本页共用）。
import { CdpClientCreateDialog } from "@/components/console/quick-actions/cdp-client-create-dialog"
import { DevicePairDialog } from "@/components/console/quick-actions/device-pair-dialog"
import { copyText } from "@/components/console/quick-actions/copy-text"

/** 资源/工具类型图标：lucide 与 tabler 混用，这里只约定「接受 className」。 */
type ToolIcon = React.ComponentType<{ className?: string }>

const TOOL_KINDS: { value: ToolKind; label: string; icon: ToolIcon }[] = [
  { value: "cdp", label: "浏览器", icon: IconBrowser },
  { value: "mail", label: "邮箱", icon: Mail },
  { value: "android", label: "Android 控制", icon: IconBrandAndroid },
  { value: "ios", label: "iOS 控制", icon: IconBrandApple },
]

/** 设备平台图标：Android / iOS 各用自家品牌图标，其它平台回落到通用手机。 */
function deviceIcon(platform: string): ToolIcon {
  if (platform === "ios") return IconBrandApple
  if (platform === "android") return IconBrandAndroid
  return Smartphone
}

/** ISO 时间 → 「x 秒/分钟/小时/天前」；解析失败返回空串。 */
function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ""
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// =============================================================================
// 一次性明文弹框（连接 token / 对外开放 token 共用）
// =============================================================================

function OneTimeSecretDialog({
  title,
  secret,
  onClose,
}: {
  title: string
  secret: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl overflow-x-hidden">
        <DialogHeader className="gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Wrench className="size-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            完整内容只显示这一次。关闭前请复制并保存到安全的位置。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">一次性凭据</div>
          <Textarea readOnly rows={3} value={secret ?? ""} className="resize-none border-amber-500/20 bg-background font-mono text-xs" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            我已保存
          </Button>
          <Button onClick={() => secret && void copyText(secret)}>
            <Copy className="size-4" />
            复制完整内容
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 页面主体：UI 只展示客户端 / 邮箱服务 / 设备，instance 仅留在后端兼容层
// =============================================================================

const TOOL_KIND_VALUES: ToolKind[] = ["cdp", "mail", "android", "ios"]

export function UserToolsPage() {
  // 当前工具类型由 URL 的 ?kind= 决定：这四个 Tab 已提为侧栏一级导航项
  // （config/modes.ts 的 devices 模式），页面内不再重复画一份 Tab 栏。
  const [searchParams, setSearchParams] = useSearchParams()
  const kindParam = searchParams.get("kind")
  const activeKind: ToolKind = TOOL_KIND_VALUES.includes(kindParam as ToolKind)
    ? (kindParam as ToolKind)
    : "cdp"
  const setActiveKind = (next: ToolKind) => {
    const params = new URLSearchParams(searchParams)
    if (next === "cdp") params.delete("kind")
    else params.set("kind", next)
    setSearchParams(params, { replace: true })
  }
  const [connInfo, setConnInfo] = useState<CdpConnectionInfo | null>(null)

  const [clients, setClients] = useState<CdpClientResource[]>([])
  const [mailServices, setMailServices] = useState<MailServiceResource[]>([])
  const [androidDevices, setAndroidDevices] = useState<DeviceResource[]>([])
  const [iosDevices, setIosDevices] = useState<DeviceResource[]>([])
  const [loading, setLoading] = useState(false)

  const [createClientOpen, setCreateClientOpen] = useState(false)
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null)
  const [detailClientId, setDetailClientId] = useState<number | null>(null)
  const [clientToDelete, setClientToDelete] = useState<CdpClientResource | null>(null)

  const [mailCreateOpen, setMailCreateOpen] = useState(false)
  const [mailToDelete, setMailToDelete] = useState<MailServiceResource | null>(null)
  const [addDeviceOpen, setAddDeviceOpen] = useState(false)
  const [detailDeviceId, setDetailDeviceId] = useState<number | null>(null)
  const [deviceToRevoke, setDeviceToRevoke] = useState<DeviceResource | null>(null)
  const [deviceToDelete, setDeviceToDelete] = useState<DeviceResource | null>(null)

  // iOS DeviceKit runner management dialogs
  const [iosSigningDialogOpen, setIosSigningDialogOpen] = useState(false)
  const [iosScanOpen, setIosScanOpen] = useState(false)

  useEffect(() => {
    getCdpConnectionInfo().then(setConnInfo).catch(() => setConnInfo(null))
  }, [])

  const reloadCdp = useCallback(async () => {
    const data = await listCdpClientResources()
    setClients(data.clients || [])
  }, [])

  const reloadMail = useCallback(async () => {
    const data = await listMailServiceResources()
    setMailServices(data.services || [])
  }, [])

  const reloadDevices = useCallback(async () => {
    const data = await listDeviceResources()
    const allDevices = data.devices || []
    setAndroidDevices(allDevices.filter(d => d.platform === "android"))
    setIosDevices(allDevices.filter(d => d.platform === "ios"))
  }, [])

  const reloadActive = useCallback(async () => {
    setLoading(true)
    try {
      if (activeKind === "cdp") await reloadCdp()
      else if (activeKind === "mail") await reloadMail()
      else if (activeKind === "android" || activeKind === "ios") await reloadDevices()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [activeKind, reloadCdp, reloadMail, reloadDevices])

  useEffect(() => {
    void reloadActive()
  }, [reloadActive])

  // 设备在线状态随 WS 连接实时变化：设备 tab 激活时轮询刷新，不切换页面也能
  // 看到上线/掉线/上报信息更新。轮询失败静默（网络抖动不打断页面）。
  useEffect(() => {
    if (activeKind !== "android" && activeKind !== "ios") return
    const timer = setInterval(() => {
      void reloadDevices().catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [activeKind, reloadDevices])

  const detailClient = clients.find((client) => client.id === detailClientId) || null
  const detailDevice = [...androidDevices, ...iosDevices].find((device) => device.id === detailDeviceId) || null

  const updateClient = async (client: CdpClientResource, patch: { name?: string; enabled?: boolean }) => {
    await updateCdpClient(client.id, patch)
    await reloadCdp()
  }

  const rotateClient = async (client: CdpClientResource) => {
    const { token } = await rotateCdpToken(client.id)
    setOneTimeToken(token)
    await reloadCdp()
  }

  const revokeClientToken = async (client: CdpClientResource) => {
    await revokeCdpToken(client.id)
    toast.success("已撤销，连接将断开")
    await reloadCdp()
  }

  const deleteClient = async () => {
    if (!clientToDelete) return
    try {
      await deleteCdpClient(clientToDelete.id)
      setClientToDelete(null)
      await reloadCdp()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }

  const deleteMailService = async () => {
    if (!mailToDelete) return
    await deleteMailServiceResource(mailToDelete.resource_id)
    setMailToDelete(null)
    await reloadMail()
  }

  const revokeSelectedDevice = async () => {
    if (!deviceToRevoke) return
    try {
      await revokeDevice(deviceToRevoke.id)
      setDeviceToRevoke(null)
      toast.success("已解除配对，在线设备将收到断连")
      await reloadDevices()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解除配对失败")
    }
  }

  const updateDevice = async (device: DeviceResource, patch: { name?: string; enabled?: boolean }) => {
    await updateResource(device.id, patch)
    await reloadDevices()
  }

  const deleteSelectedDevice = async () => {
    if (!deviceToDelete) return
    try {
      await deleteResource(deviceToDelete.id)
      setDeviceToDelete(null)
      toast.success("已删除设备记录")
      await reloadDevices()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除设备失败")
    }
  }

  // 顶栏主操作：随当前 Tab 变化的「添加」按钮，挂在刷新按钮左侧（item 6）。
  const addButton = useMemo(() => {
    const map: Record<ToolKind, { label: string; onClick: () => void }> = {
      cdp: { label: "添加浏览器", onClick: () => setCreateClientOpen(true) },
      mail: { label: "添加邮箱服务", onClick: () => setMailCreateOpen(true) },
      android: { label: "添加 Android 设备", onClick: () => setAddDeviceOpen(true) },
      ios: { label: "添加 iOS 设备", onClick: () => setAddDeviceOpen(true) },
    }
    const cfg = map[activeKind]
    return (
      <div className="flex gap-2">
        {activeKind === "ios" && (
          <>
            <Button size="sm" variant="outline" onClick={() => setIosScanOpen(true)}>
              <Search className="size-4" />
              扫描设备
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIosSigningDialogOpen(true)}>
              签名配置
            </Button>
          </>
        )}
        <Button size="sm" onClick={cfg.onClick}>
          <Plus className="size-4" />
          {cfg.label}
        </Button>
      </div>
    )
  }, [activeKind])

  return (
    <div className="flex flex-col gap-4 py-4">
      <UserPageActions primary={addButton} />

      {/* Tab 栏已提为侧栏一级导航项（config/modes.ts 的 devices 模式），
          页面内不再重复画一份；切换由导航改 ?kind= 驱动，故这里只保留 Tabs 上下文。 */}
      <Tabs orientation="horizontal" value={activeKind} onValueChange={(v) => setActiveKind(v as ToolKind)}>
        <TabsList className="hidden">
          {TOOL_KINDS.map((item) => {
            const Icon = item.icon
            return (
              <TabsTrigger key={item.value} value={item.value}>
                <Icon className="size-4" />
                {item.label}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {activeKind === "cdp" ? (
        <section className="flex flex-col gap-3">
          {loading ? <ResourceLoading /> : (
            <CdpClientList
              clients={clients}
              onOpen={(client) => setDetailClientId(client.id)}
              onDelete={setClientToDelete}
            />
          )}
        </section>
      ) : activeKind === "mail" ? (
        <section className="flex flex-col gap-3">
          {loading ? <ResourceLoading /> : (
            <div className="flex flex-col gap-3">
              {mailServices.length === 0 ? <ResourceEmpty icon={Mail} text="还没有邮箱服务，点右上角「添加邮箱服务」新建一个。" /> :
                mailServices.map((service) => (
                  <MailServiceCard
                    key={service.resource_id}
                    service={service}
                    onDelete={() => setMailToDelete(service)}
                    onChanged={() => void reloadMail()}
                  />
                ))}
            </div>
          )}
        </section>
      ) : activeKind === "android" ? (
        <section className="flex flex-col gap-3">
          <DeviceControlVersionBar />
          {loading ? <ResourceLoading /> : (
            <DeviceResourceList
              devices={androidDevices}
              onOpen={(device) => setDetailDeviceId(device.id)}
              onDelete={setDeviceToDelete}
            />
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <DeviceControlVersionBar />
          {loading ? <ResourceLoading /> : (
            <DeviceResourceList
              devices={iosDevices}
              onOpen={(device) => setDetailDeviceId(device.id)}
              onDelete={setDeviceToDelete}
              onInitialize={(device) => setDetailDeviceId(device.id)}
            />
          )}
        </section>
      )}

      <CdpClientCreateDialog
        connInfo={connInfo}
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={() => reloadCdp()}
      />

      <OneTimeSecretDialog title="浏览器客户端连接 token" secret={oneTimeToken} onClose={() => setOneTimeToken(null)} />

      <CdpClientDetailDialog
        client={detailClient}
        live={detailClient
          ? {
              client_id: String(detailClient.client_id || detailClient.id),
              connected: !!detailClient.connected,
              pages: detailClient.pages || [],
            }
          : undefined}
        open={!!detailClient}
        onOpenChange={(open) => !open && setDetailClientId(null)}
        onToggle={(enabled) => detailClient && void updateClient(detailClient, { enabled })}
        onRename={async (name) => {
          if (detailClient) await updateClient(detailClient, { name })
        }}
        onRotate={(client) => void rotateClient(client)}
        onRevoke={(client) => void revokeClientToken(client)}
        onRequestDelete={(client) => {
          setDetailClientId(null)
          setClientToDelete(client)
        }}
      />

      <MailCreateDialog open={mailCreateOpen} onOpenChange={setMailCreateOpen} onCreated={() => void reloadMail()} />

      <IosScanDialog
        open={iosScanOpen}
        onOpenChange={setIosScanOpen}
        onChanged={() => void reloadDevices()}
        onOpenDevice={(id) => setDetailDeviceId(id)}
        onOpenSigningProfiles={() => setIosSigningDialogOpen(true)}
      />

      {/* 平台随工具页签走：「添加 Android/iOS 设备」按钮在哪个 Tab 点开，弹框就走哪条接入方案。 */}
      <DevicePairDialog
        open={addDeviceOpen}
        onOpenChange={setAddDeviceOpen}
        onPaired={() => void reloadDevices()}
        platform={activeKind === "ios" ? "ios" : "android"}
      />

      <DeviceDetailDialog
        device={detailDevice}
        open={!!detailDevice}
        onOpenChange={(open) => !open && setDetailDeviceId(null)}
        onRefreshDevice={reloadDevices}
        onToggle={(enabled) => detailDevice && void updateDevice(detailDevice, { enabled })}
        onRename={async (name) => {
          if (detailDevice) await updateDevice(detailDevice, { name })
        }}
        onRequestRevoke={(device) => {
          setDetailDeviceId(null)
          setDeviceToRevoke(device)
        }}
        onRequestDelete={(device) => {
          setDetailDeviceId(null)
          setDeviceToDelete(device)
        }}
      />

      <IosSigningProfileDialog
        open={iosSigningDialogOpen}
        onOpenChange={setIosSigningDialogOpen}
        onChanged={() => void reloadDevices()}
      />

      <AlertDialog open={!!clientToDelete} onOpenChange={(open) => !open && setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除客户端</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{clientToDelete?.name}」会立即失效它的连接 token，现有扩展连接将断开。确认删除？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteClient()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!mailToDelete} onOpenChange={(open) => !open && setMailToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除邮箱服务</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{mailToDelete?.display_name}」会同时删除其账户与转发别名，且不可恢复。确认删除？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteMailService()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deviceToRevoke} onOpenChange={(open) => !open && setDeviceToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解除该设备的配对？</AlertDialogTitle>
            <AlertDialogDescription>
              将清除服务端 token 并停用该设备，在线设备会立即收到断连；设备记录会保留在列表里，
              可重新配对。确认解除？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revokeSelectedDevice()}>确认解除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deviceToDelete} onOpenChange={(open) => !open && setDeviceToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除设备</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{deviceToDelete?.name || deviceToDelete?.device_id}」会移除它的设备记录与凭据，
              不可恢复；该设备需要重新走一次配对才能接入。确认删除？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSelectedDevice()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ResourceLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner className="size-6" />
    </div>
  )
}

function ResourceEmpty({ icon: Icon, text }: { icon: ToolIcon; text: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  )
}

/** 资源卡片外壳：状态点 + 图标 + 名称 + 状态徽标 + 副标题，底部一排操作。 */
function ResourceCard({
  icon: Icon,
  online,
  dimmed,
  title,
  badges,
  subtitle,
  meta,
  actions,
}: {
  icon: ToolIcon
  online: boolean
  dimmed?: boolean
  title: string
  badges?: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "min-w-0 gap-0 py-0",
        online && "ring-primary/30",
        dimmed && "opacity-70",
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 p-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              online ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
            {title}
          </span>
        </div>
        {badges ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{badges}</div> : null}
        {subtitle ? (
          <div className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 items-center justify-between gap-2 border-t px-3.5 py-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{meta}</span>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </div>
      ) : null}
    </Card>
  )
}

/** 卡片网格容器：两列到三列自适应。 */
function ResourceCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}

function CdpClientList({ clients, onOpen, onDelete }: {
  clients: CdpClientResource[]
  onOpen: (client: CdpClientResource) => void
  onDelete: (client: CdpClientResource) => void
}) {
  if (clients.length === 0) {
    return <ResourceEmpty icon={IconBrowser} text="还没有浏览器客户端，点右上角「添加浏览器」新建一个。" />
  }
  return (
    <ResourceCardGrid>
      {clients.map((client) => {
        const enabled = client.enabled ?? true
        const connected = !!client.connected
        const pages = client.pages?.length || 0
        return (
          <ResourceCard
            key={client.id}
            icon={IconBrowser}
            online={connected && enabled}
            dimmed={!enabled}
            title={client.name || `客户端 #${client.id}`}
            badges={
              <>
                <Badge variant={connected && enabled ? "default" : "secondary"}>
                  {!enabled ? "已停用" : connected ? "在线" : "离线"}
                </Badge>
                {connected && enabled ? <Badge variant="outline">{pages} 网页</Badge> : null}
              </>
            }
            subtitle={client.token_hint ? `token ${client.token_hint}` : "token 已撤销"}
            meta={`#${client.id}`}
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => onOpen(client)}>
                  <Settings className="size-4" />
                  详情
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="删除客户端"
                  onClick={() => onDelete(client)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            }
          />
        )
      })}
    </ResourceCardGrid>
  )
}

// 控制 App（被控端）当前市场版本条：在设备 tab 顶部展示市场发布的最新安装包版本号，
// 与每张设备卡片上「App vX」徽章（手机 register 上报的已装版本）对照——一眼看出
// "市场最新" vs "手机已装"是否一致。手机没连上时卡片徽章为空（没数据可上报）。
function DeviceControlVersionBar() {
  const [release, setRelease] = useState<DeviceControlAppRelease | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setLoaded(false)
    void getDeviceControlAppRelease()
      .then(setRelease)
      .finally(() => setLoaded(true))
  }, [])
  if (!loaded) return null
  const v = release?.android?.version || release?.version || ""
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline" className="text-[10px]">控制 App 市场版本</Badge>
      <span className="font-medium text-foreground">{v ? `v${v}` : "市场未发布"}</span>
      <span className="text-muted-foreground/70">
        · 手机已装版本显示在每张设备卡片的「App vX」徽章（手机连上后才上报）
      </span>
    </div>
  )
}

function DeviceResourceList({ devices, onOpen, onDelete, onInitialize }: {
  devices: DeviceResource[]
  onOpen: (device: DeviceResource) => void
  onDelete: (device: DeviceResource) => void
  /** iOS：设备行「初始化」按钮——打开签名配置弹框（prepare 在详情面板里触发，
   *  行内按钮是引导入口，避免用户先进详情才能装 runner）。 */
  onInitialize?: (device: DeviceResource) => void
}) {
  if (devices.length === 0) {
    return <ResourceEmpty icon={Smartphone} text="还没有设备，点右上角按钮接入设备。" />
  }
  return (
    <ResourceCardGrid>
      {devices.map((device) => {
        const info = device.device_info || {}
        const model = typeof info.model === "string" && info.model ? info.model : device.device_id
        const enabled = device.enabled ?? true
        const ios = device.platform === "ios"
        // 上报信息：app 版本 / 系统 / 无障碍开关（app register 时上报）。
        const appVersion = typeof info.app_version === "string" ? info.app_version : ""
        const osVersion = typeof info.os_version === "string" ? info.os_version : ""
        const accEnabled = typeof info.accessibility_enabled === "boolean" ? info.accessibility_enabled : null
        // iOS 设备的真实状态不能只看 online：一台已认领但还没跑过初始化（WDA）
        // 的 iPhone，本来就连不上 device-control，显示「离线」是误导。按
        // data.ios.wda_state 分出「待初始化 / 初始化中 / 已就绪 / 已过期 / 失败」，
        // 只有 WDA 就绪之后才用在线/离线描述连接状态。
        const iosData = device.ios
        const wdaState = ios ? String(iosData?.wda_state || "missing") : ""
        const iosPending = ios && (wdaState === "missing" || wdaState === "unspecified")
        const iosPreparing = ios && wdaState === "preparing"
        const iosReady = ios && wdaState === "ready"
        const iosFailed = ios && (wdaState === "failed" || wdaState === "expired")
        // 初始化进度来自设备（节点 inventory），不是易失的 job 快照——所以刷新
        // 页面/重启服务端后百分比依然在。
        const wdaProgress = typeof iosData?.wda_progress === "number" ? iosData.wda_progress : 0
        const wdaStage = typeof iosData?.wda_stage === "string" ? iosData.wda_stage : ""
        const stateBadge = !enabled
          ? { variant: "secondary" as const, label: "已解除配对" }
          : iosPending
            ? { variant: "outline" as const, label: "待初始化" }
            : iosPreparing
              // 有百分比就带上（"初始化中 42%"），没有就退回纯文字。
              ? {
                  variant: "secondary" as const,
                  label: wdaProgress > 0 ? `初始化中 ${wdaProgress}%` : "初始化中",
                  title: wdaStage || undefined,
                }
              : iosFailed
                ? { variant: "destructive" as const, label: wdaState === "expired" ? "已过期" : "初始化失败" }
                : iosReady
                  // WDA 就绪后连接状态才有意义；手机没插着（present=false）时
                  // 节点仍是 claimed，插回去即自动恢复，所以这里说「未连接」
                  // 而不是「离线」——离线会让人以为要重新认领。
                  ? { variant: device.online ? ("default" as const) : ("secondary" as const), label: device.online ? "在线" : "未连接" }
                  : { variant: device.online && enabled ? ("default" as const) : ("secondary" as const), label: device.online ? "在线" : "离线" }
        return (
          <ResourceCard
            key={device.id}
            icon={deviceIcon(device.platform)}
            online={ios ? !iosPending && device.online && enabled : device.online && enabled}
            dimmed={!enabled}
            title={device.name || model}
            badges={
              <>
                <Badge variant="outline">{ios ? "iOS" : "Android"}</Badge>
                <Badge variant={stateBadge.variant} title={"title" in stateBadge ? stateBadge.title : undefined}>
                  {stateBadge.label}
                </Badge>
                {!ios && accEnabled === false && (
                  <Badge variant="destructive">无障碍未开</Badge>
                )}
                {!ios && appVersion && (
                  <Badge variant="secondary" className="text-[10px]">App v{appVersion}</Badge>
                )}
              </>
            }
            subtitle={model}
            meta={
              [osVersion ? `Android ${osVersion}` : "", device.node ? `宿主节点 ${device.node.name}` : ""]
                .filter(Boolean)
                .join(" · ") || device.device_id.slice(0, 12)
            }
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => onOpen(device)}>
                  <Settings className="size-4" />
                  详情
                </Button>
                {ios && onInitialize && (
                  <Button variant={iosPending ? "default" : "outline"} size="sm" onClick={() => onInitialize(device)}>
                    <Wrench className="size-4" />
                    {iosPending ? "初始化" : iosPreparing ? "初始化中…" : "重新初始化"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="删除设备"
                  onClick={() => onDelete(device)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            }
          />
        )
      })}
    </ResourceCardGrid>
  )
}

export default UserToolsPage

// =============================================================================
// 浏览器客户端详情弹框：名称 / 启停 / 实时网页 / 危险操作。
// 三段固定结构，弹框整体不滚——只有「实时网页」列表自己滚（网页多了不再把
// 底部按钮顶出视野）。「重置 token」「撤销 token」「删除客户端」同属危险操作，
// 收在最后一段里，不再分散在正文与 footer 两处。
// =============================================================================

function CdpClientDetailDialog({
  client,
  live,
  open,
  onOpenChange,
  onToggle,
  onRename,
  onRotate,
  onRevoke,
  onRequestDelete,
}: {
  client: CdpClientResource | null
  live: {
    client_id: string
    connected: boolean
    pages: NonNullable<CdpClientResource["pages"]>
  } | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (enabled: boolean) => void
  onRename: (name: string) => Promise<void>
  onRotate: (client: CdpClientResource) => void
  onRevoke: (client: CdpClientResource) => void
  onRequestDelete: (client: CdpClientResource) => void
}) {
  const connected = !!live?.connected
  const pages = live?.pages ?? []
  const enabled = client?.enabled ?? true
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState(false)

  // client 切换（打开另一个客户端详情）时同步表单值。
  useEffect(() => {
    setName(client?.name || "")
  }, [client])

  const saveRename = async () => {
    if (!client) return
    const next = name.trim()
    if (!next || next === (client.name || "")) return
    setRenaming(true)
    try {
      await onRename(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "改名失败")
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">
            {client?.name || `客户端 #${client?.id ?? "-"}`}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant={connected && enabled ? "default" : "secondary"}>
              {!enabled ? "已停用" : connected ? "在线" : "离线"}
            </Badge>
            {client ? <span className="text-xs text-muted-foreground">#{client.id}</span> : null}
            <span className="text-xs text-muted-foreground">
              {client?.token_hint ? `token ${client.token_hint}` : "token 已撤销"}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* 正文区整体可滚，但实时网页列表自己也有上限，避免网页多时挤掉其它分区 */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`cdp-client-name-${client?.id ?? ""}`}>名称</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`cdp-client-name-${client?.id ?? ""}`}
                className="min-w-0 flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename()
                }}
                placeholder="客户端名称"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={!client || renaming || !name.trim() || name.trim() === (client?.name || "")}
                onClick={() => void saveRename()}
              >
                {renaming ? <Spinner className="size-4" /> : null}
                保存
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">启用客户端</div>
              <div className="text-xs text-muted-foreground">停用后扩展连接会被拒绝</div>
            </div>
            <Switch checked={enabled} onCheckedChange={onToggle} disabled={!client} />
          </div>

          <div className="flex min-w-0 flex-col rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-sm font-medium">实时网页</span>
              <span className="text-xs text-muted-foreground">{pages.length} 个</span>
            </div>
            {pages.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {connected ? "当前没有打开的网页" : "连接 Chrome 扩展后会显示网页"}
              </p>
            ) : (
              <div className="max-h-48 min-w-0 space-y-0.5 overflow-y-auto p-1.5">
                {pages.map((p) => (
                  <div key={p.id} className="min-w-0 rounded-md px-2 py-1.5 hover:bg-muted/60">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          p.active ? "bg-primary" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={p.title || undefined}>
                        {p.title || "（无标题）"}
                      </span>
                      {p.active ? (
                        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">
                          活动
                        </Badge>
                      ) : null}
                    </div>
                    <div
                      className="mt-0.5 min-w-0 truncate pl-3.5 text-[10px] text-muted-foreground"
                      title={p.url || undefined}
                    >
                      {p.url || "-"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <div className="text-sm font-medium">危险操作</div>
            <p className="text-xs leading-5 text-muted-foreground">
              重置会立即失效旧 token 并显示新的；撤销会断开现有连接并停用客户端；删除不可恢复。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!client}
                onClick={() => client && onRotate(client)}
              >
                重置 token
              </Button>
              {client?.token_hint ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!client}
                  onClick={() => client && onRevoke(client)}
                >
                  撤销 token
                </Button>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                disabled={!client}
                onClick={() => client && onRequestDelete(client)}
              >
                <Trash2 className="size-4" />
                删除客户端
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 手机详情弹框：与浏览器客户端详情同结构 —— 名称 / 启停 / 设备信息 / 危险操作。
// 「解除配对」与「删除」都收在危险操作里；卡片上只留「详情」和快捷删除。
// =============================================================================

function DeviceDetailDialog({
  device,
  open,
  onOpenChange,
  onRefreshDevice,
  onToggle,
  onRename,
  onRequestRevoke,
  onRequestDelete,
}: {
  device: DeviceResource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 重新拉取设备列表。iOS 面板在初始化期间靠它刷新状态——状态来自设备
   *  （节点 inventory，持久），不是易失的 job 快照，所以刷新/重启都不丢。 */
  onRefreshDevice: () => Promise<void> | void
  onToggle: (enabled: boolean) => void
  onRename: (name: string) => Promise<void>
  onRequestRevoke: (device: DeviceResource) => void
  onRequestDelete: (device: DeviceResource) => void
}) {
  const enabled = device?.enabled ?? true
  const online = !!device?.online
  const ios = device?.platform === "ios"
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    setName(device?.name || "")
  }, [device])

  const saveRename = async () => {
    if (!device) return
    const next = name.trim()
    if (!next || next === (device.name || "")) return
    setRenaming(true)
    try {
      await onRename(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "改名失败")
    } finally {
      setRenaming(false)
    }
  }

  // device_info 由设备端 register 帧上报（app 版本 / 系统 / 机型 / 无障碍开关 /
  // 上次错误）；online/last_seen 等实时字段由服务端补齐。键不固定，挑常见几个展示。
  const info = device?.device_info || {}
  const accEnabled = typeof info.accessibility_enabled === "boolean" ? info.accessibility_enabled : null
  const lastError = typeof info.last_error === "string" ? info.last_error : ""
  // last_seen_at：在线时是心跳刷新的实时点，离线时是断连时刻（服务端落库）。
  const lastSeenAt = typeof device?.last_seen_at === "string" ? device.last_seen_at : ""
  const lastSeenText = lastSeenAt ? formatRelativeTime(lastSeenAt) : ""
  const infoRows: [string, string][] = ([
    ["型号", [info.manufacturer, info.model].filter((v) => typeof v === "string" && v).join(" ")],
    ["App 版本", typeof info.app_version === "string" ? info.app_version : ""],
    ["系统", typeof info.os_version === "string" ? `Android ${info.os_version}` : ""],
    ["分辨率", typeof info.screen === "string" ? info.screen : ""],
    ["无障碍服务", accEnabled === null ? "" : accEnabled ? "已开启" : "未开启（远程控制不可用）"],
    ["设备 ID", device?.device_id || ""],
    ["宿主节点", device?.node?.name || ""],
    ["最后在线", online ? "刚刚" : lastSeenText],
  ] as [string, string][]).filter(([, value]) => value.trim().length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">{device?.name || device?.device_id || "设备"}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{ios ? "iOS" : "Android"}</Badge>
            <Badge variant={online && enabled ? "default" : "secondary"}>
              {!enabled ? "已解除配对" : online ? "在线" : "离线"}
            </Badge>
            {!ios && accEnabled === false && <Badge variant="destructive">无障碍未开</Badge>}
            <span className="text-xs text-muted-foreground">
              {device?.token_hint ? `token ${device.token_hint}` : "token 已撤销"}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`device-name-${device?.id ?? ""}`}>名称</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`device-name-${device?.id ?? ""}`}
                className="min-w-0 flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename()
                }}
                placeholder="设备名称"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={!device || renaming || !name.trim() || name.trim() === (device?.name || "")}
                onClick={() => void saveRename()}
              >
                {renaming ? <Spinner className="size-4" /> : null}
                保存
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">启用设备</div>
              <div className="text-xs text-muted-foreground">停用后该设备的连接会被拒绝</div>
            </div>
            <Switch checked={enabled} onCheckedChange={onToggle} disabled={!device} />
          </div>

          <div className="flex min-w-0 flex-col rounded-lg border">
            <div className="border-b px-3 py-2 text-sm font-medium">设备信息</div>
            <div className="flex flex-col gap-1.5 p-3">
              {infoRows.filter(([, value]) => value).map(([label, value]) => (
                <div key={label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                  <span className="shrink-0 text-muted-foreground">{label}</span>
                  <span
                    className={`min-w-0 truncate font-medium ${label === "无障碍服务" && accEnabled === false ? "text-destructive" : ""}`}
                    title={value}
                  >
                    {value}
                  </span>
                </div>
              ))}
              {device?.capabilities?.length ? (
                <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                  {device.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {online ? "设备未声明能力集" : "设备离线，连接后会上报支持的能力"}
                </p>
              )}
            </div>
          </div>

          {!ios && lastError && (
            <div className="flex flex-col gap-1 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
              <div className="text-sm font-medium">上次错误</div>
              <p className="text-xs leading-5 text-destructive">{lastError}</p>
              <p className="text-xs text-muted-foreground">由设备端最近一次断开/重连时上报</p>
            </div>
          )}

          {ios && Boolean(device.ios) && (
            <IosWdaPanel device={device} onChanged={() => void onRefreshDevice()} />
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <div className="text-sm font-medium">危险操作</div>
            <p className="text-xs leading-5 text-muted-foreground">
              解除配对会清除凭据并断开在线设备，记录保留、可重新配对；删除会移除记录，不可恢复。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!device}
                onClick={() => device && onRequestRevoke(device)}
              >
                <Unplug className="size-4" />
                解除配对
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!device}
                onClick={() => device && onRequestDelete(device)}
              >
                <Trash2 className="size-4" />
                删除设备
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// iOS DeviceKit Runner 管理面板：签名配置 + 产物选择 + runner job 控制
// =============================================================================

function IosWdaPanel({ device, onChanged }: { device: DeviceResource; onChanged: () => void }) {
  // 顶层 ios 键（服务端 store 把 data JSONB 展平到顶层，响应里没有 "data" 层）。
  const iosData = device.ios
  const wdaState = String(iosData?.wda_state || "missing")
  // 进度来自设备（节点 inventory），不是 job 快照——刷新/重启都不丢。
  const wdaProgress = typeof iosData?.wda_progress === "number" ? iosData.wda_progress : 0
  const wdaStage = typeof iosData?.wda_stage === "string" ? iosData.wda_stage : ""
  const profileExpiresAt = iosData?.profile_expires_at as string | undefined
  // 自动续签：prepare_wda 成功后服务端写入 auto_renew=true + last_renew_job_id。
  // 扫描器到期前自动派发 renew job；这里读 last_renew_job_id 轮询，运行中显示徽章。
  const autoRenewEnabled = (iosData?.auto_renew as boolean | undefined) ?? false
  const lastRenewJobId = (iosData?.last_renew_job_id as string | undefined) || null
  const runnerOnline = (iosData?.device_control_online as boolean | undefined) ?? device.online


  const [signingProfiles, setSigningProfiles] = useState<IosSigningProfile[]>([])
  const [wdaMarketVersion, setWdaMarketVersion] = useState<string>("")
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  // 当前选中签名配置的 kind（派生自 selectedProfileId，不另存 state）：
  //  asc/p12 用户填 bundle id；apple_id 服务端按团队域作用域自动派生，输入框隐藏。
  // 免费签名（自备 P12）的描述文件只覆盖使用者自己创建的 App ID，须填自己的
  // bundle id；付费（ASC / P12）保持默认。仅 prepare 用，renew/重装由服务端从
  // prepare 落库的绑定回退（不传空串默认，避免回落官方 id 覆盖用户自己的）。
  const selectedProfile = signingProfiles.find((p) => p.id === selectedProfileId) || null
  const selectedProfileKind = selectedProfile?.kind
  const [wdaBundleId, setWdaBundleId] = useState("com.deviceboxhq.goios.devicekit.runner")
  const [jobRunning, setJobRunning] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [jobSnapshot, setJobSnapshot] = useState<IosWdaJobSnapshot | null>(null)
  const [autoRenewRunning, setAutoRenewRunning] = useState(false)

  // Load signing profiles + 当前市场 DeviceKit runner 版本（只读展示，产物由宿主节点自动下载）
  useEffect(() => {
    void loadResources()
  }, [])

  const loadResources = async () => {
    try {
      const { profiles } = await listIosSigningProfiles()
      setSigningProfiles(profiles)
    } catch (e) {
      console.error("加载签名配置失败", e)
    }
    try {
      const release = await getDeviceControlAppRelease()
      setWdaMarketVersion(release?.ios?.version || release?.version || "")
    } catch {
      // 展示用，失败不阻塞
    }
  }

  // 初始化期间轮询**设备**而不是 job 快照。
  //
  // 这是「初始化后台化」的核心：wda_state / wda_progress 由设备自报、经节点
  // inventory 持久化，所以刷新页面、关弹框、服务端重启都不会丢——而 job 快照
  // 只活在服务端一条连接的内存里，一重启就 404（此前正是卡死的原因）。
  //
  // 只要设备处于 preparing 就继续轮询；到 ready/failed 自动停。用户在任意时刻
  // 关掉弹框或刷新页面都不影响 job：重新打开时按设备状态接着显示。
  //
  // onChanged 是父组件的内联箭头（每次渲染新身份），直接放进依赖会让定时器
  // 在每轮刷新后被拆掉重建。用 ref 持有最新引用，依赖里只留真正该触发重建的项。
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  useEffect(() => {
    if (!open || wdaState !== "preparing") return
    let stop = false
    const poll = async () => {
      if (stop) return
      try {
        await onChangedRef.current()
      } catch {
        // 拉取失败（网络抖动/节点离线）不打断轮询：设备状态是持久的，
        // 下一轮自然会拿到。
      }
    }
    const timer = setInterval(() => void poll(), 2500)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [open, wdaState])

  // 初始化完成后提示一次（从 preparing 转到终态的那一刻）。
  const prevWdaStateRef = useRef(wdaState)
  useEffect(() => {
    const prev = prevWdaStateRef.current
    prevWdaStateRef.current = wdaState
    if (prev !== "preparing") return
    if (wdaState === "ready") toast.success("runner 准备完成")
    else if (wdaState === "failed") toast.error("runner 初始化失败，详见下方错误")
  }, [wdaState])

  // job 快照降级为**可选**详情：只在 preparing 时拉一次，用于显示阶段日志。
  // 拿不到（404 = 服务端重启过）就静默忽略——主状态来自设备，不依赖它。
  useEffect(() => {
    if (!currentJobId || !jobRunning) return
    let stop = false
    const poll = async () => {
      try {
        const snapshot = await getIosWdaJobStatus(device.id, currentJobId)
        if (!stop) setJobSnapshot(snapshot)
      } catch (e) {
        if (stop) return
        // 快照已失效：清掉详情即可，不打断主流程（设备状态仍在轮询）。
        if (e instanceof ToolHttpError && e.status === 404) {
          setJobSnapshot(null)
          setCurrentJobId(null)
          return
        }
        console.error("轮询 job 详情失败", e)
      }
    }
    const timer = setInterval(() => void poll(), 3000)
    void poll()
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [currentJobId, jobRunning, device.id, onChanged])

  // 自动续签 job 轮询：auto_renew 开启且有 last_renew_job_id 时，读它是否在跑。
  // 用户手动 job 运行时让路（jobRunning）；终端态即停轮询，完成时刷新设备拿新过期时间。
  useEffect(() => {
    if (!autoRenewEnabled || !lastRenewJobId || jobRunning) {
      setAutoRenewRunning(false)
      return
    }
    let stop = false
    const poll = async () => {
      try {
        const snapshot = await getIosWdaJobStatus(device.id, lastRenewJobId)
        if (stop) return
        if (snapshot.status === "running") {
          setAutoRenewRunning(true)
        } else {
          setAutoRenewRunning(false)
          if (snapshot.status === "completed") {
            onChanged()
          }
        }
      } catch {
        // 节点离线/丢 snapshot：不显示运行中，下一轮自然恢复
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [autoRenewEnabled, lastRenewJobId, jobRunning, device.id, onChanged])

  const startWdaJob = async (action: "prepare" | "renew" | "reinstall") => {
    if (!selectedProfileId && action === "prepare") {
      toast.error("请选择签名配置")
      return
    }

    setJobRunning(true)
    try {
      const { job_id } = await startIosWdaJob(device.id, {
        device_id: device.device_id,
        action,
        signing_profile_id: action === "prepare" ? selectedProfileId! : undefined,
        // 仅 prepare 传 bundle id；renew/重装传空串，服务端从 prepare 落库的
        // 绑定回退（页面刷新后输入框重置为默认值，但设备装的是用户自己的 id）。
        // apple_id 免传：服务端按团队域作用域自动派生（base.TEAMID）。
        wda_bundle_id: action === "prepare" && selectedProfileKind !== "apple_id" ? wdaBundleId.trim() : "",
        xctest_config_name: "",
      })
      setCurrentJobId(job_id)
      setJobSnapshot(null)
      // job 已在节点后台跑：立刻拉一次设备，让界面切到「初始化中 N%」。
      // 之后由 wda_state==preparing 的轮询接续——弹框可以随时关掉。
      await onChanged()
      toast.success(`已发起 ${action === "prepare" ? "准备" : action === "renew" ? "续期" : "重装"}，可在后台进行`)
    } catch (e) {
      setJobRunning(false)
      toast.error(e instanceof Error ? e.message : "发起 job 失败")
    }
  }

  const cancelJob = async () => {
    if (!currentJobId) return
    try {
      await cancelIosWdaJob(device.id, currentJobId)
      setJobRunning(false)
      setCurrentJobId(null)
      toast.success("已取消 job")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消 job 失败")
    }
  }

  const wdaStateBadge = () => {
    switch (wdaState) {
      case "ready":
        return <Badge variant="default">就绪</Badge>
      case "preparing":
        return <Badge variant="secondary">准备中</Badge>
      case "renewal_due":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">将过期</Badge>
      case "expired":
        return <Badge variant="destructive">已过期</Badge>
      case "failed":
        return <Badge variant="destructive">失败</Badge>
      default:
        return <Badge variant="secondary">未准备</Badge>
    }
  }

  const [runnerBusy, setRunnerBusy] = useState(false)
  const doRunnerControl = async (action: "start" | "stop" | "restart") => {
    setRunnerBusy(true)
    try {
      await controlIosRunner(device.id, action)
      toast.success(
        action === "start" ? "已请求启动 runner 守护" :
        action === "stop" ? "已请求停止 runner 守护" :
        "已请求重启 runner 守护"
      )
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `runner ${action} 失败`)
    } finally {
      setRunnerBusy(false)
    }
  }

  const expiryDisplay = profileExpiresAt
    ? new Date(profileExpiresAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "-"

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">DeviceKit Runner 管理</div>
        <div className="flex items-center gap-1">
          <Badge variant={runnerOnline ? "default" : "secondary"}>
            {runnerOnline ? "守护在线" : "守护已停止"}
          </Badge>
          {autoRenewEnabled && (
            <Badge variant="outline" className="border-blue-500 text-blue-600">自动续签</Badge>
          )}
          {autoRenewRunning && <Badge variant="secondary">自动续签中</Badge>}
          {wdaStateBadge()}
        </div>
      </div>

      {profileExpiresAt && (
        <div className="text-xs text-muted-foreground">
          Profile 到期时间：{expiryDisplay}
        </div>
      )}

      {wdaState === "preparing" ? (
        // 进度以**设备**为准（wda_progress/wda_stage，来自节点 inventory），
        // job 快照只用来补充阶段消息。服务端重启后快照没了，进度条照样在——
        // 这是「初始化后台化」的关键：关弹框/刷新/重启都不影响。
        <div className="flex flex-col gap-2 rounded border bg-muted/20 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{wdaStage || jobSnapshot?.stage || "初始化中"}</span>
            <span className="text-xs text-muted-foreground">{wdaProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${wdaProgress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {jobSnapshot?.message || "任务在节点后台运行，可随时关闭此窗口，进度不会中断。"}
          </div>
          {currentJobId && (
            <Button variant="outline" size="sm" onClick={() => void cancelJob()}>
              取消
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>签名配置</Label>
            <Select
              value={selectedProfileId?.toString() || ""}
              onValueChange={(v) => setSelectedProfileId(v ? Number(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择签名配置" />
              </SelectTrigger>
              <SelectContent>
                {signingProfiles.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">暂无签名配置</div>
                ) : (
                  signingProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()} disabled={p.status === "expired"}>
                      {p.name} ({p.kind === "asc" ? "ASC p8" : p.kind === "apple_id" ? "Apple ID" : "P12"}
                      {p.kind === "apple_id"
                        ? p.status === "expired" ? " · 需重新登录" : " · 登录有效"
                        : p.status === "expired" ? " · 已过期" : p.status === "expiring" ? " · 即将过期" : ""})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedProfileKind === "apple_id" ? (
            <div className="flex flex-col gap-1.5">
              <Label>DeviceKit Runner Bundle ID</Label>
              <div className="text-xs text-muted-foreground">
                Apple ID 免费签名由服务端按团队域作用域自动派生 App ID
                （官方 id + 团队后缀），无需填写；登录有效即可全自动准备/续期
                （免费证书 7 天过期，自动续签刷新）。
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>DeviceKit Runner Bundle ID</Label>
              <Input
                value={wdaBundleId}
                onChange={(e) => setWdaBundleId(e.target.value)}
                placeholder="com.deviceboxhq.goios.devicekit.runner"
              />
              <div className="text-xs text-muted-foreground">
                ASC / P12 证书保持默认 DeviceKit Bundle ID；免费签名（自备 P12）须填你在开发者门户
                创建的、与描述文件匹配的 Runner App ID。仅首次初始化生效，续期/重装自动沿用。
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>DeviceKit Runner 产物</Label>
            <div className="text-xs text-muted-foreground">
              {wdaMarketVersion
                ? `市场当前版本 v${wdaMarketVersion}，宿主节点自动下载并按所选签名配置重签安装，无需手动选择。`
                : "DeviceKit Runner 产物由市场自动获取，宿主节点下载并按所选签名配置重签安装；当前市场尚未发布 iOS 包。"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void startWdaJob("prepare")}
              disabled={!selectedProfileId}
            >
              初始化 Runner
            </Button>
            {runnerOnline ? (
              <Button size="sm" variant="outline" onClick={() => void doRunnerControl("stop")} disabled={runnerBusy}>
                {runnerBusy ? <Spinner className="size-3" /> : null}
                停止守护
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void doRunnerControl("start")} disabled={runnerBusy}>
                {runnerBusy ? <Spinner className="size-3" /> : null}
                启动守护
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void doRunnerControl("restart")} disabled={runnerBusy}>
              {runnerBusy ? <Spinner className="size-3" /> : null}
              重启守护
            </Button>
            {wdaState === "ready" || wdaState === "renewal_due" || wdaState === "expired" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void startWdaJob("renew")}>
                  立即续期
                </Button>
                <Button size="sm" variant="outline" onClick={() => void startWdaJob("reinstall")}>
                  重装 Runner
                </Button>
              </>
            ) : null}
          </div>

          {signingProfiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              需要先上传签名配置
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

// =============================================================================
// iOS 签名配置管理对话框
// =============================================================================

function formatProfileDate(value?: string | null): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function signingStatusBadge(p: IosSigningProfile) {
  if (p.kind === "asc" && (!p.status || p.status === "valid")) {
    return <Badge variant="outline" className="border-green-600 text-green-600">长期有效</Badge>
  }
  if (p.kind === "apple_id") {
    // status="expired" = 会话过期（需重新登录），非描述文件到期；其余即登录有效。
    return p.status === "expired"
      ? <Badge variant="destructive">需重新登录</Badge>
      : <Badge variant="outline" className="border-green-600 text-green-600">登录有效</Badge>
  }
  switch (p.status) {
    case "expired":
      return <Badge variant="destructive">已过期</Badge>
    case "expiring":
      return <Badge variant="outline" className="border-yellow-500 text-yellow-600">即将过期</Badge>
    case "unknown":
      return <Badge variant="secondary">状态未知</Badge>
    default:
      return <Badge variant="outline" className="border-green-600 text-green-600">可用</Badge>
  }
}

type SigningProfileView = "list" | "form" | "detail"

function IosSigningProfileDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [profiles, setProfiles] = useState<IosSigningProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<SigningProfileView>("list")
  // form 态：editing 非空 = 编辑（原地换材料/改名）；null = 新建。
  const [editing, setEditing] = useState<IosSigningProfile | null>(null)
  const [detail, setDetail] = useState<IosSigningProfile | null>(null)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"asc" | "p12" | "apple_id">("apple_id")

  // ASC fields
  const [p8Key, setP8Key] = useState("")
  const [keyId, setKeyId] = useState("")
  const [issuerId, setIssuerId] = useState("")
  const [teamId, setTeamId] = useState("")

  // P12 fields
  const [p12File, setP12File] = useState<File | null>(null)
  const [p12Password, setP12Password] = useState("")
  const [mobileprovisionFile, setMobileprovisionFile] = useState<File | null>(null)

  // Apple ID fields（两步登录状态机：login → 2FA code）
  const [appleEmail, setAppleEmail] = useState("")
  const [applePassword, setApplePassword] = useState("")
  const [appleCode, setAppleCode] = useState("")
  const [appleLoginToken, setAppleLoginToken] = useState<string | null>(null)
  // SMS 2FA：login 返回 method=="sms" 时带受信电话号码列表，用户选号后发码再验码。
  const [appleMethod, setAppleMethod] = useState<"trusteddevice" | "sms" | null>(null)
  const [applePhoneNumbers, setApplePhoneNumbers] = useState<Array<{ id: number; number_with_dial_code: string }>>([])
  const [appleSelectedPhoneId, setAppleSelectedPhoneId] = useState<number | null>(null)
  const [appleSmsSending, setAppleSmsSending] = useState(false)
  // 远程 anisette 服务器（真实设备指纹，避开本地虚拟指纹被 Apple 503 拒收）。
  const [appleAnisetteServer, setAppleAnisetteServer] = useState("ani.sidestore.io")

  useEffect(() => {
    if (open) {
      setView("list")
      setEditing(null)
      setDetail(null)
      resetForm()
      void loadProfiles()
    }
  }, [open])

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const { profiles } = await listIosSigningProfiles()
      setProfiles(profiles)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载签名配置失败")
    } finally {
      setLoading(false)
    }
  }

  const openForm = (profile: IosSigningProfile | null) => {
    setEditing(profile)
    if (profile) {
      setName(profile.name)
      setKind(profile.kind)
      setP8Key("")
      setKeyId("")
      setIssuerId("")
      setTeamId("")
      setP12File(null)
      setP12Password("")
      setMobileprovisionFile(null)
      // Apple ID 编辑 = 重新登录：预填邮箱，密码/验证码留空。
      setAppleEmail(profile.kind === "apple_id" ? "" : "")
      setApplePassword("")
      setAppleCode("")
      setAppleLoginToken(null)
      setAppleMethod(null)
      setApplePhoneNumbers([])
      setAppleSelectedPhoneId(null)
    } else {
      resetForm()
    }
    setView("form")
  }

  // ── Apple ID 两步登录（不走 submitForm：材料由 Apple 侧签发，无「材料字段」）──
  // 密码随 2FA 重发：服务端 complete_2fa 内部要重新认证（绝不缓存密码）。
  const submitAppleLogin = async () => {
    if (!appleEmail.trim() || !applePassword) {
      toast.error("请输入 Apple ID 邮箱与密码")
      return
    }
    setSaving(true)
    try {
      const result = await loginAppleId({
        name: name.trim() || undefined,
        email: appleEmail.trim(),
        password: applePassword,
        profile_id: editing?.id,
        anisette_server: appleAnisetteServer || undefined,
      })
      if (result.status === "2fa_required") {
        setAppleLoginToken(result.login_token || null)
        setAppleMethod(result.method || null)
        setApplePhoneNumbers(result.phone_numbers || [])
        // SMS 默认选第一个号码；trusted-device 无号码列表。
        if (result.phone_numbers && result.phone_numbers.length > 0) {
          setAppleSelectedPhoneId(result.phone_numbers[0].id)
        } else {
          setAppleSelectedPhoneId(null)
        }
        toast.info(
          result.method === "sms"
            ? "请选择受信电话号码并触发短信验证"
            : "验证码已发送到你的 Apple 设备，请输入"
        )
      } else {
        toast.success(editing ? "重新登录成功，配置已更新" : "登录成功，已创建签名配置")
        resetForm()
        setEditing(null)
        setView("list")
        void loadProfiles()
        onChanged()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apple ID 登录失败")
    } finally {
      setSaving(false)
    }
  }

  const submitApple2fa = async () => {
    if (!appleLoginToken) {
      toast.error("登录会话已失效，请返回重新登录")
      return
    }
    if (!appleCode.trim()) {
      toast.error("请输入设备上收到的验证码")
      return
    }
    if (!applePassword) {
      toast.error("请再次输入 Apple ID 密码（完成验证需要）")
      return
    }
    if (appleMethod === "sms" && !appleSelectedPhoneId) {
      toast.error("请先选择受信电话号码")
      return
    }
    setSaving(true)
    try {
      await verifyAppleId2fa({
        login_token: appleLoginToken,
        email: appleEmail.trim(),
        password: applePassword,
        code: appleCode.trim(),
        profile_id: editing?.id,
        // SMS 路径带选中的 phone_id；trusted-device 忽略。
        phone_id: appleMethod === "sms" ? appleSelectedPhoneId || undefined : undefined,
        anisette_server: appleAnisetteServer || undefined,
      })
      toast.success(editing ? "重新登录成功，配置已更新" : "登录成功，已创建签名配置")
      resetForm()
      setEditing(null)
      setView("list")
      void loadProfiles()
      onChanged()
    } catch (e) {
      // 码错（-21669）：服务端保留 pending，login_token 仍有效，清空码让用户重输。
      const msg = e instanceof Error ? e.message : "验证失败，请重新登录"
      if (msg.includes("验证码错误")) {
        setAppleCode("")
      }
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  // SMS 2FA：用户选好号码后触发发送（Apple 会把短信码发到该号码）。
  const sendAppleSms = async () => {
    if (!appleLoginToken) {
      toast.error("登录会话已失效，请返回重新登录")
      return
    }
    if (!appleSelectedPhoneId) {
      toast.error("请先选择受信电话号码")
      return
    }
    setAppleSmsSending(true)
    try {
      await sendAppleIdSms({
        login_token: appleLoginToken,
        email: appleEmail.trim(),
        phone_id: appleSelectedPhoneId,
        anisette_server: appleAnisetteServer || undefined,
      })
      toast.info("短信验证码已发送，请输入收到的 6 位码")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "短信发送失败")
    } finally {
      setAppleSmsSending(false)
    }
  }

  const submitForm = async () => {
    if (!name.trim()) {
      toast.error("请输入配置名称")
      return
    }

    let secretData: Record<string, unknown> | null = null

    if (editing) {
      // 编辑态：材料全空 = 只改名（保留现有材料）；任一提供 = 整包替换（需齐全）。
      if (kind === "asc") {
        if (p8Key || keyId || issuerId || teamId) {
          if (!p8Key || !keyId || !issuerId || !teamId) {
            toast.error("更换 ASC 材料需填写所有字段")
            return
          }
          secretData = { p8_key: p8Key, key_id: keyId, issuer_id: issuerId, team_id: teamId }
        }
      } else if (p12File || mobileprovisionFile) {
        if (!p12File || !mobileprovisionFile) {
          toast.error("更换 P12 材料需同时上传证书和 mobileprovision")
          return
        }
        secretData = {
          p12_base64: await fileToBase64(p12File),
          p12_password: p12Password,
          mobileprovision_base64: await fileToBase64(mobileprovisionFile),
        }
      }
    } else {
      // 新建：材料必须齐全。
      if (kind === "asc") {
        if (!p8Key || !keyId || !issuerId || !teamId) {
          toast.error("ASC 配置需填写所有字段")
          return
        }
        secretData = { p8_key: p8Key, key_id: keyId, issuer_id: issuerId, team_id: teamId }
      } else {
        if (!p12File || !mobileprovisionFile) {
          toast.error("P12 配置需上传证书和 mobileprovision")
          return
        }
        secretData = {
          p12_base64: await fileToBase64(p12File),
          p12_password: p12Password,
          mobileprovision_base64: await fileToBase64(mobileprovisionFile),
        }
      }
    }

    setSaving(true)
    try {
      if (editing) {
        await updateIosSigningProfile(editing.id, {
          name: name.trim(),
          ...(secretData ? { secret_data: secretData } : {}),
        })
        toast.success("签名配置已更新")
      } else {
        await createIosSigningProfile({ name: name.trim(), kind, secret_data: secretData! })
        toast.success("签名配置已创建")
      }
      setEditing(null)
      resetForm()
      setView("list")
      void loadProfiles()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const deleteProfile = async (id: number) => {
    try {
      await deleteIosSigningProfile(id)
      toast.success("已删除")
      void loadProfiles()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }

  const deleteFromDetail = async (id: number) => {
    await deleteProfile(id)
    setDetail(null)
    setView("list")
  }

  const resetForm = () => {
    setName("")
    setKind("apple_id")
    setP8Key("")
    setKeyId("")
    setIssuerId("")
    setTeamId("")
    setP12File(null)
    setP12Password("")
    setMobileprovisionFile(null)
    setAppleEmail("")
    setApplePassword("")
    setAppleCode("")
    setAppleLoginToken(null)
    setAppleMethod(null)
    setApplePhoneNumbers([])
    setAppleSelectedPhoneId(null)
    setAppleSmsSending(false)
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(",")[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const kindDescription =
    kind === "asc"
      ? "需 Apple Developer Program 付费账号（约 ¥688/年）。p8 密钥在 App Store Connect → 用户和访问 → 集成 中创建（需账户持有人权限）。签名与续期全程自动，材料长期有效。"
      : kind === "apple_id"
        ? "用你的 Apple ID（免费，无需付费账号、无需 Mac）：登录一次即自动申请证书、注册设备并签名，含 7 天自动续期。需已开启双重认证并在受信设备上收验证码。"
        : "自备签名证书（P12 + 描述文件）。免费 Apple ID 证书 7 天过期、到期需重新导出并在此更换；付费开发者证书约 1 年。用此配置时 Runner Bundle ID 须填证书覆盖的 App ID。"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-2rem)] max-w-[1400px] flex-col overflow-hidden sm:max-w-[820px]">
        {view === "list" ? (
          <>
            <DialogHeader>
              <DialogTitle>签名配置管理</DialogTitle>
              <DialogDescription>管理 iOS Runner 签名方式，列表中展示创建时间与材料有效性状态</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">已有配置（{profiles.length}）</div>
                <Button size="sm" onClick={() => openForm(null)}>
                  <Plus className="size-4" />
                  添加签名配置
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center p-4">
                  <Spinner className="size-5" />
                </div>
              ) : profiles.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border p-6">
                  <p className="text-center text-xs text-muted-foreground">
                    暂无签名配置，先添加一个才能初始化 Runner
                  </p>
                  <Button size="sm" variant="outline" onClick={() => openForm(null)}>
                    <Plus className="size-4" />
                    立即添加
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {profiles.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded border bg-muted/20 p-2">
                      <div
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2"
                        onClick={() => {
                          setDetail(p)
                          setView("detail")
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.kind === "asc" ? "ASC API Key" : p.kind === "apple_id" ? "Apple ID" : "P12 证书"} · 创建于{" "}
                            {formatProfileDate(p.created_at)}
                          </div>
                        </div>
                        {signingStatusBadge(p)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void deleteProfile(p.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                完成
              </Button>
            </DialogFooter>
          </>
        ) : view === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? "编辑签名配置" : "添加签名配置"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "材料留空 = 保留现有材料、只改名；上传新材料 = 原地替换（配置 id 不变）"
                  : "Apple ID 登录（免费全自动）或上传 App Store Connect API Key / P12 证书"}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => setView("list")}>
                <ArrowLeft className="size-4" />
                返回列表
              </Button>

              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-col gap-1.5">
                  <Label>配置名称</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：我的 ASC Key" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>签名方式</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as "asc" | "p12" | "apple_id")} disabled={!!editing}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apple_id">Apple ID 免费签名（推荐，全自动）</SelectItem>
                      <SelectItem value="asc">App Store Connect API（付费）</SelectItem>
                      <SelectItem value="p12">P12 证书 + mobileprovision（自备）</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="rounded border bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">
                    {kindDescription}
                  </div>
                </div>

                {kind === "apple_id" ? (
                  <>
                    {editing && (
                      <p className="text-xs text-muted-foreground">
                        重新登录会保留已签发的证书与设备注册（配置 id 不变，设备绑定不断）。
                      </p>
                    )}
                    {!appleLoginToken ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label>Apple ID（邮箱）</Label>
                          <Input
                            type="email"
                            value={appleEmail}
                            onChange={(e) => setAppleEmail(e.target.value)}
                            placeholder="user@icloud.com"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>密码</Label>
                          <Input
                            type="password"
                            value={applePassword}
                            onChange={(e) => setApplePassword(e.target.value)}
                            placeholder="Apple ID 密码（只用于登录，不会保存）"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Anisette 服务器（推荐保留默认）</Label>
                          <Input
                            value={appleAnisetteServer}
                            onChange={(e) => setAppleAnisetteServer(e.target.value)}
                            placeholder="ani.sidestore.io"
                          />
                          <p className="text-xs text-muted-foreground">
                            用远程服务器取真实设备指纹（iloader 同款方案）；本地 anisette 库
                            生成虚拟指纹会被 Apple 503 拒收。留空则回退本地库。
                          </p>
                        </div>
                        <Button onClick={() => void submitAppleLogin()} disabled={saving}>
                          {saving ? <Spinner className="size-4" /> : null}
                          {editing ? "重新登录" : "登录"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="rounded border border-blue-500/40 bg-blue-500/5 p-2 text-xs leading-5 text-muted-foreground">
                          {appleMethod === "sms" ? (
                            <>选择一个受信电话号码触发短信验证码，输入收到的 6 位码完成登录。</>
                          ) : (
                            <>验证码已推送到你的 Apple 受信设备（iPhone/Mac 弹窗），输入显示的
                              6 位码完成登录。没收到？返回重新登录可再次触发推送。</>
                          )}
                        </div>
                        {appleMethod === "sms" && (
                          <>
                            <div className="flex flex-col gap-1.5">
                              <Label>受信电话号码</Label>
                              <Select
                                value={appleSelectedPhoneId ? String(appleSelectedPhoneId) : ""}
                                onValueChange={(v) => setAppleSelectedPhoneId(Number(v))}
                              >
                                <SelectTrigger><SelectValue placeholder="选择号码" /></SelectTrigger>
                                <SelectContent>
                                  {applePhoneNumbers.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                      {p.number_with_dial_code}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-fit"
                              onClick={() => void sendAppleSms()}
                              disabled={appleSmsSending || !appleSelectedPhoneId}
                            >
                              {appleSmsSending ? <Spinner className="size-4" /> : null}
                              发送短信验证码
                            </Button>
                          </>
                        )}
                        <div className="flex flex-col gap-1.5">
                          <Label>验证码</Label>
                          <Input
                            inputMode="numeric"
                            value={appleCode}
                            onChange={(e) => setAppleCode(e.target.value)}
                            placeholder="6 位验证码"
                          />
                        </div>
                        <Button onClick={() => void submitApple2fa()} disabled={saving}>
                          {saving ? <Spinner className="size-4" /> : null}
                          完成登录
                        </Button>
                        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setAppleLoginToken(null)}>
                          返回重新登录
                        </Button>
                      </>
                    )}
                  </>
                ) : kind === "asc" ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>p8 Key（私钥内容）{editing ? "（留空保留现有）" : ""}</Label>
                      <Textarea
                        value={p8Key}
                        onChange={(e) => setP8Key(e.target.value)}
                        placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                        rows={4}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label>Key ID</Label>
                        <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="AB12CD34EF" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Issuer ID</Label>
                        <Input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} placeholder="12345678-..." />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Team ID</Label>
                      <Input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="ABCDE12345" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>P12 证书文件{editing ? "（留空保留现有）" : ""}</Label>
                      <Input
                        type="file"
                        accept=".p12"
                        onChange={(e) => setP12File(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>P12 密码（可选）</Label>
                      <Input
                        type="password"
                        value={p12Password}
                        onChange={(e) => setP12Password(e.target.value)}
                        placeholder="留空表示无密码"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>mobileprovision 文件{editing ? "（留空保留现有）" : ""}</Label>
                      <Input
                        type="file"
                        accept=".mobileprovision"
                        onChange={(e) => setMobileprovisionFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  </>
                )}

                {kind !== "apple_id" && (
                  <Button onClick={() => void submitForm()} disabled={saving}>
                    {saving ? <Spinner className="size-4" /> : null}
                    {editing ? "保存" : "创建"}
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>签名配置详情</DialogTitle>
              <DialogDescription>配置信息与材料有效性状态</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => setView("list")}>
                <ArrowLeft className="size-4" />
                返回列表
              </Button>

              {detail && (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{detail.name}</div>
                    {signingStatusBadge(detail)}
                  </div>

                  <div className="flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">类型</span>
                      <span>{detail.kind === "asc" ? "App Store Connect API Key" : detail.kind === "apple_id" ? "Apple ID 免费签名" : "P12 证书 + mobileprovision"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">创建时间</span>
                      <span>{formatProfileDate(detail.created_at)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Team ID</span>
                      <span>{detail.team_id || "-"}</span>
                    </div>
                    {detail.kind === "apple_id" && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">描述文件到期</span>
                        <span>{detail.expires_at ? formatProfileDate(detail.expires_at) : "-"}</span>
                      </div>
                    )}
                    {detail.kind === "p12" && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">描述文件</span>
                        <span className="truncate">{detail.profile_name || "-"}</span>
                      </div>
                    )}
                    {detail.kind === "p12" && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">到期时间</span>
                        <span>{detail.expires_at ? formatProfileDate(detail.expires_at) : "-"}</span>
                      </div>
                    )}
                  </div>

                  {detail.kind === "apple_id" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {detail.status === "expired"
                        ? "登录会话已过期，自动续签已暂停——点下方「重新登录」即可恢复（设备绑定不受影响）。"
                        : "免费证书 7 天过期由自动续签刷新，无需手动操作；若登录会话过期会在此标红。"}
                    </p>
                  )}
                  {detail.kind === "p12" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {detail.status === "expired"
                        ? "材料已过期，请在下方原地更换新证书——否则 Runner 签名/续期将持续失败。"
                        : "材料到期后在此原地更换即可，使用它的设备无缝续用（配置 id 不变）。"}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openForm(detail)}>
                      {detail.kind === "apple_id" ? "重新登录 / 改名" : "更换材料 / 编辑"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void deleteFromDetail(detail.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// 「添加浏览器 / 添加设备」弹框与接入引导已抽到 quick-actions 共享（首页快捷操作与
// 本页共用同一组件）：
//   CdpClientCreateDialog → @/components/console/quick-actions/cdp-client-create-dialog
//   AddDeviceDialog       → @/components/console/quick-actions/device-pair-dialog

function IosScanDialog({
  open,
  onOpenChange,
  onChanged,
  onOpenDevice,
  onOpenSigningProfiles,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged: () => void
  onOpenDevice: (id: number) => void
  onOpenSigningProfiles: () => void
}) {
  // 宿主来源："all" = 全部节点；否则为单节点 id。
  const [hostScope, setHostScope] = useState("all")
  const [iosHosts, setIosHosts] = useState<IosHostNode[]>([])
  const [iosHostsLoading, setIosHostsLoading] = useState(false)
  const [devices, setDevices] = useState<IosDiscoveredDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [claiming, setClaiming] = useState(false)
  const [label, setLabel] = useState("")
  const [profiles, setProfiles] = useState<IosSigningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [iosResources, setIosResources] = useState<DeviceResource[]>([])

  useEffect(() => {
    if (!open) return
    // 加载态必须真的置起：此前初值 false 且从不置 true，扫描按钮的
    // disabled={... || iosHostsLoading} 形同虚设，宿主列表还在路上时点扫描会
    // 扫到空列表。
    setIosHostsLoading(true)
    void listIosHosts().then(({ hosts }) => setIosHosts(hosts)).catch(() => setIosHosts([]))
      .finally(() => setIosHostsLoading(false))
    void listIosSigningProfiles().then(({ profiles }) => setProfiles(profiles)).catch(() => setProfiles([]))
    void reloadIosResources()
  }, [open])

  // 资源列表单独抽成可重复调用：扫描只刷新**节点清单**（dev.claimed/device_id），
  // 资源列表此前只在弹框打开时加载一次，导致刚认领完的设备在同一会话里仍找不到
  // 对应资源（「找不到该设备的资源 id」）。扫描后必须重新拉一次。
  const reloadIosResources = async () => {
    try {
      const data = await listDeviceResources()
      setIosResources(data.devices.filter((d) => d.platform === "ios"))
    } catch {
      setIosResources([])
    }
  }

  const deviceKey = (dev: IosDiscoveredDevice) => `${dev.node_id || ""}:${dev.udid}`

  const [hostStates, setHostStates] = useState<Array<{ node_id: string; node_name: string; online: boolean; device_count: number; error: string | null }>>([])

  const runScan = async () => {
    setScanning(true)
    setSelected(new Set())
    setHostStates([])
    try {
      if (hostScope === "all") {
        await scanAllIosHosts()
        // discover 是异步的：节点收到帧后 Rescan 并上报 DevicesReport。
        // 轮询读缓存直到拿到结果或超时（USB 枚举 + lockdown 可能 2-3 秒）。
        //
        // 零宿主时**不轮询**：settled 依赖 hosts.length > 0，空列表下永远
        // false，循环会白等满 5 秒才弹提示。宿主列表在弹框打开时就已加载，
        // 这里直接短路。
        let all: IosDiscoveredDevice[] = []
        let hosts: Array<{ node_id: string; node_name: string; online: boolean; devices: IosDiscoveredDevice[]; error: string | null }> = []
        if (iosHosts.length > 0) {
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            const res = await getAllIosHostDevices()
            hosts = res.hosts
            all = res.devices
            // 至少一个节点报了无错误 + 有设备，或所有节点都报了结果（错误或空），就停。
            const settled = hosts.length > 0 && hosts.every((h) => !h.online || h.error !== null || h.devices.length > 0 || i >= 4)
            if (all.length > 0 || settled) break
          }
        }
        setHostStates(hosts.map((h) => ({
          node_id: h.node_id,
          node_name: h.node_name,
          online: h.online,
          device_count: h.devices.length,
          error: h.error,
        })))
        setDevices(all)
        if (all.length === 0) {
          const offline = hosts.filter((h) => !h.online).map((h) => h.node_name).join("、")
          const errored = hosts.filter((h) => h.online && h.error).map((h) => `${h.node_name}: ${h.error}`).join("；")
          const empty = hosts.filter((h) => h.online && !h.error && h.devices.length === 0).map((h) => h.node_name).join("、")
          const parts: string[] = []
          // iOS 扫描是宿主**能力**（节点机需能访问 Apple 设备服务/usbmuxd），
          // 不是节点角色：普通执行节点升级后同样可以扫。措辞不再泄 role=ios_host
          // 这类内部词，也不再让用户去装一个 UI 里根本没有入口的东西。
          if (hosts.length === 0) parts.push("当前没有节点上报 iOS 扫描能力——请在节点机上安装 Apple 设备驱动（Windows 装 Apple Devices/iTunes，macOS 自带），并确认节点程序已升级")
          if (offline) parts.push(`离线: ${offline}`)
          if (errored) parts.push(`错误: ${errored}`)
          if (empty) parts.push(`无设备: ${empty}`)
          toast.error(parts.length ? parts.join(" | ") : "未发现设备")
        }
      } else {
        await scanIosHost(hostScope)
        let single: IosDiscoveredDevice[] = []
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          const res = await getIosHostDevices(hostScope)
          single = res.devices
          if (single.length > 0 || i >= 4) break
        }
        const host = iosHosts.find((h) => h.node_id === hostScope)
        setDevices(single.map((d) => ({ ...d, node_id: hostScope, node_name: host?.name || hostScope })))
        if (single.length === 0) {
          toast.error(`未发现设备，请确认 iPhone 已 USB 连接到 ${host?.name || hostScope} 并已「信任此电脑」`)
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "扫描设备失败")
      setDevices([])
    } finally {
      setScanning(false)
      // 扫描会带回节点清单里新的 claimed/device_id，资源列表必须同步刷新，
      // 否则刚认领的设备在本会话内仍匹配不到资源。
      void reloadIosResources()
    }
  }

  const toggle = (dev: IosDiscoveredDevice) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = deviceKey(dev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // 找到该设备的资源 id（claimed 设备才有），用于初始化或打开详情。
  const resourceIdFor = (dev: IosDiscoveredDevice): number | null => {
    if (!dev.claimed || !dev.device_id) return null
    const res = iosResources.find((r) => r.device_id === dev.device_id)
    return res?.id ?? null
  }

  const claimOne = async (dev: IosDiscoveredDevice): Promise<number | null> => {
    try {
      const { resource_id } = await claimIosDevice({
        node_id: dev.node_id || "",
        udid: dev.udid,
        label: label.trim() || dev.name,
      })
      if (!resource_id) {
        // 服务端在认领后回写 iOS 身份时才拿得到 resource_id（它要先从节点
        // inventory 读出配对端点签发的 device_id）。拿不到说明回写那步没成功，
        // 此刻设备已认领（凭据在节点上），只是初始化还不能直接派发——提示用户
        // 重新扫描即可，那时 inventory 已带 claimed 标记、资源行也已被认领。
        toast.error(`${dev.name || dev.udid.slice(-8)} 已认领，但未能定位设备资源；请重新扫描后再初始化`)
        return null
      }
      return resource_id
    } catch (e) {
      toast.error(`${dev.name || dev.udid.slice(-8)} 接入失败：${e instanceof Error ? e.message : e}`)
      return null
    }
  }

  // 接入选中（仅认领，不初始化）。
  const claimSelected = async () => {
    const picked = devices.filter((d) => selected.has(deviceKey(d)) && !d.claimed)
    if (picked.length === 0) {
      toast.error("请先勾选要接入的设备（已接入的不可重复认领）")
      return
    }
    setClaiming(true)
    let ok = 0
    for (const dev of picked) {
      if ((await claimOne(dev)) !== null) ok++
    }
    setClaiming(false)
    if (ok > 0) {
      toast.success(`已接入 ${ok}/${picked.length} 台设备`)
      onChanged()
      await runScan()
    }
  }

  // 接入并初始化选中：claim 后立即调 prepare（需要签名配置）。
  const claimAndInitialize = async () => {
    const picked = devices.filter((d) => selected.has(deviceKey(d)) && !d.claimed)
    if (picked.length === 0) {
      toast.error("请先勾选要接入的设备")
      return
    }
    if (!selectedProfileId) {
      toast.error("请先选择签名配置")
      return
    }
    setClaiming(true)
    let ok = 0
    for (const dev of picked) {
      const rid = await claimOne(dev)
      if (rid === null) continue
      try {
        await startIosWdaJob(rid, {
          device_id: dev.udid,
          action: "prepare",
          signing_profile_id: selectedProfileId,
        })
        ok++
      } catch (e) {
        toast.error(`${dev.name || dev.udid.slice(-8)} 初始化失败：${e instanceof Error ? e.message : e}`)
      }
    }
    setClaiming(false)
    if (ok > 0) {
      toast.success(`已认领并开始初始化 ${ok}/${picked.length} 台`)
      onChanged()
      await runScan()
    }
  }

  // 对已接入设备触发初始化（prepare）。
  const initializeOne = async (dev: IosDiscoveredDevice) => {
    const rid = resourceIdFor(dev)
    if (rid === null) {
      toast.error("找不到该设备的资源 id，请刷新设备列表")
      return
    }
    if (!selectedProfileId) {
      onOpenSigningProfiles()
      toast.error("请先选择签名配置")
      return
    }
    try {
      await startIosWdaJob(rid, {
        device_id: dev.udid,
        action: "prepare",
        signing_profile_id: selectedProfileId,
      })
      toast.success(`已开始初始化：${dev.name || dev.udid.slice(-8)}`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "初始化失败")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] w-[calc(100vw-1rem)] max-w-[1600px] flex-col overflow-hidden sm:max-w-[1600px]">
        <DialogHeader>
          <DialogTitle>扫描 iOS 设备</DialogTitle>
          <DialogDescription>
            选择宿主来源（主服务器 / 远程节点 / 全部），扫描 USB 与已配对网络设备，勾选后批量接入与初始化。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 宿主来源 + 扫描 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">宿主来源</Label>
              <Select value={hostScope} onValueChange={setHostScope}>
                <SelectTrigger className="w-64"><SelectValue placeholder="全部节点" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部节点</SelectItem>
                  <SelectItem value="__local_server__" disabled>
                    主服务器（本机，待启用直连）
                  </SelectItem>
                  {iosHosts.map((h) => (
                    <SelectItem key={h.node_id} value={h.node_id}>
                      {h.name || h.node_name || h.node_id} {!h.online && "(离线)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void runScan()} disabled={scanning || iosHostsLoading}>
              {scanning ? <Spinner className="size-4" /> : <Search className="size-4" />}
              扫描
            </Button>
            <div className="flex flex-1 justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void claimSelected()} disabled={claiming || selected.size === 0}>
                {claiming ? <Spinner className="size-3" /> : null}
                接入选中（{selected.size}）
              </Button>
              <Button size="sm" onClick={() => void claimAndInitialize()} disabled={claiming || selected.size === 0 || !selectedProfileId}>
                {claiming ? <Spinner className="size-3" /> : null}
                接入并初始化（{selected.size}）
              </Button>
            </div>
          </div>

          {/* 零宿主前置提示：在用户点「扫描」之前就说清为什么扫不到，而不是
              让他白等一轮再收一条含糊的报错。与 device-pair-dialog 的空态同款。 */}
          {!iosHostsLoading && iosHosts.length === 0 && (
            <div className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
              当前没有节点可以扫描 iOS 设备。扫描需要节点机能够访问 Apple 设备服务
              （Windows 装 Apple Devices 或 iTunes，macOS 自带），且节点程序为支持该能力的版本。
              满足条件后节点会自动上报该能力，这里即可选择它作为宿主来源。
            </div>
          )}

          {/* 签名配置 + 标签 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">签名配置（初始化用）</Label>
              <Select
                value={selectedProfileId?.toString() || ""}
                onValueChange={(v) => setSelectedProfileId(v ? Number(v) : null)}
              >
                <SelectTrigger className="w-64"><SelectValue placeholder="选择签名配置" /></SelectTrigger>
                <SelectContent>
                  {profiles.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">暂无签名配置</div>
                  ) : (
                    profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()} disabled={p.status === "expired"}>
                        {p.name} ({p.kind === "asc" ? "ASC p8" : p.kind === "apple_id" ? "Apple ID" : "P12"})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {profiles.length === 0 && (
                <Button variant="link" size="sm" className="w-fit p-0" onClick={onOpenSigningProfiles}>
                  先添加签名配置 →
                </Button>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">设备名称前缀（可选）</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="我的 iPhone" />
            </div>
          </div>

          {/* 扫描结果 */}
          {devices.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border p-2">
              <Label className="text-xs text-muted-foreground">发现 {devices.length} 台设备</Label>
              {devices.map((dev) => {
                const key = deviceKey(dev)
                const rid = resourceIdFor(dev)
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded border bg-muted/20 p-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {!dev.claimed && (
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(dev)}
                          className="size-4"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{dev.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {dev.model} · iOS {dev.product_version} · {dev.connection_type}
                          {dev.node_name ? ` · ${dev.node_name}` : ""}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">UDID: ...{dev.udid.slice(-8)}</div>
                      </div>
                    </div>
                    {dev.claimed ? (
                      <div className="flex items-center gap-2">
                        {dev.wda_state && (
                          <Badge variant="outline">{dev.wda_state}</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rid !== null && onOpenDevice(rid)}
                          disabled={rid === null}
                        >
                          打开设备
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void initializeOne(dev)} disabled={!selectedProfileId}>
                          初始化
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void (async () => {
                          const rid2 = await claimOne(dev)
                          if (rid2 !== null) {
                            toast.success(`已接入：${dev.name || dev.udid.slice(-8)}`)
                            onChanged()
                            await runScan()
                          }
                        })()}
                        disabled={claiming}
                      >
                        {claiming ? <Spinner className="size-3" /> : "接入"}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              {scanning ? "扫描中…" : "点「扫描」发现设备"}
            </div>
          )}

          {/* 宿主级状态：让用户看清空结果到底是是因为没节点、节点离线、还是节点上没设备 */}
          {hostStates.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2 text-xs">
              <div className="font-medium text-muted-foreground">宿主状态</div>
              {hostStates.map((h) => (
                <div key={h.node_id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{h.node_name}</span>
                  <span className={
                    !h.online ? "text-destructive" :
                    h.error ? "text-destructive" :
                    h.device_count > 0 ? "text-primary" : "text-muted-foreground"
                  }>
                    {!h.online ? "离线" : h.error ? `错误: ${h.error}` : `${h.device_count} 台设备`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}



// =============================================================================
// 邮箱服务卡片：一行 = 一个邮箱服务（账户 + 转发别名），无实例概念
// =============================================================================

const MAILBOX_TYPES = ["TempMail", "IMAP", "Gmail", "Outlook"]

function serviceName(service: MailServiceResource): string {
  return service.display_name || service.username || `邮箱服务 #${service.resource_id}`
}

function MailServiceCard({
  service,
  onDelete,
  onChanged,
}: {
  service: MailServiceResource
  onDelete: () => void
  onChanged: () => void
}) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)

  const addresses = service.addresses || []

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Mail className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{service.display_name || service.username || `服务 #${service.resource_id}`}</span>
              <Badge variant={service.enabled === false ? "secondary" : "default"}>
                {service.enabled === false ? "停用" : "启用"}
              </Badge>
              {service.username ? (
                <span className="truncate text-xs text-muted-foreground">{service.username}</span>
              ) : null}
            </div>
            {service.mailbox_type ? (
              <span className="text-xs text-muted-foreground">{service.mailbox_type}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAccountOpen(true)}>
            <Settings className="size-4" />
            邮箱设置
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddressOpen(true)}>
            <Inbox className="size-4" />
            转发别名
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <MailMessagesPanel service={service} addresses={addresses} />

      <MailAccountDialog
        service={service}
        account={service}
        open={accountOpen}
        onOpenChange={setAccountOpen}
        onSaved={onChanged}
      />

      <MailAddressDialog
        service={service}
        addresses={addresses}
        open={addressOpen}
        onOpenChange={setAddressOpen}
        onSaved={onChanged}
      />
    </Card>
  )
}

// =============================================================================
// 邮箱账户设置弹框：账户表单 + 转发别名列表管理
// =============================================================================

function MailAccountDialog({
  service,
  account,
  open,
  onOpenChange,
  onSaved,
}: {
  service: MailServiceResource
  account: MailServiceResource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    display_name: "",
    mailbox_type: "TempMail",
    base_url: "",
    username: "",
    mail_suffix: "",
    password: "",
    secret_key: "",
  })
  const [saving, setSaving] = useState(false)
  const secrets = (account?._secrets ?? {}) as Record<string, { state: string }>

  useEffect(() => {
    if (open) {
      setForm({
        display_name: account?.display_name ?? "",
        mailbox_type: account?.mailbox_type ?? "TempMail",
        base_url: account?.base_url ?? "",
        username: account?.username ?? "",
        mail_suffix: account?.mail_suffix ?? "",
        password: "",
        secret_key: "",
      })
    }
  }, [open, account])

  const saveAccount = async () => {
    if (!form.display_name.trim()) {
      toast.error("请填写服务名称")
      return
    }
    setSaving(true)
    try {
      // 邮箱服务创建时已带账户；这里始终走通用 detail update，secret 传空则保留原值。
      const data: Record<string, unknown> = {
        display_name: form.display_name.trim(),
        mailbox_type: form.mailbox_type,
        base_url: form.base_url.trim(),
        username: form.username.trim(),
        mail_suffix: form.mail_suffix.trim(),
      }
      if (form.password) data.password = form.password
      if (form.secret_key) data.secret_key = form.secret_key
      await updateResource(account?.id ?? service.resource_id, data)
      toast.success("已保存")
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{serviceName(service)} · 邮箱设置</DialogTitle>
          <DialogDescription>配置邮箱账户。转发别名在卡片上的「转发别名」按钮里单独管理。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>服务名称</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="我的邮箱"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>类型</Label>
              <Select
                value={form.mailbox_type}
                onValueChange={(v) => setForm((f) => ({ ...f, mailbox_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAILBOX_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>服务器地址</Label>
            <Input
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              placeholder="https://mail.example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>用户名</Label>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="user@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>邮箱后缀</Label>
            <Input
              value={form.mail_suffix}
              onChange={(e) => setForm((f) => ({ ...f, mail_suffix: e.target.value }))}
              placeholder="example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>
                密码
                {secrets.password?.state === "set" && (
                  <span className="ml-1 text-xs text-muted-foreground">（已设置，留空不改）</span>
                )}
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={secrets.password?.state === "set" ? "••••••" : "密码"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                密钥
                {secrets.secret_key?.state === "set" && (
                  <span className="ml-1 text-xs text-muted-foreground">（已设置，留空不改）</span>
                )}
              </Label>
              <Input
                type="password"
                value={form.secret_key}
                onChange={(e) => setForm((f) => ({ ...f, secret_key: e.target.value }))}
                placeholder={secrets.secret_key?.state === "set" ? "••••••" : "可选"}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void saveAccount()} disabled={saving}>
            {saving && <Spinner className="mr-2 size-4" />}
            保存账户
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 转发别名弹框（从账户设置里拆出，独立管理 mail_address 明细）
// =============================================================================

function MailAddressDialog({
  service,
  addresses,
  open,
  onOpenChange,
  onSaved,
}: {
  service: MailServiceResource
  addresses: MailAddress[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [newAddress, setNewAddress] = useState("")
  const [newSource, setNewSource] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setNewAddress("")
      setNewSource("")
    }
  }, [open])

  const addAddress = async () => {
    if (!newAddress.trim()) {
      toast.error("请填写别名地址")
      return
    }
    setBusy(true)
    try {
      await createMailAddress(service.resource_id, {
        address: newAddress.trim(),
        source_address: newSource.trim() || undefined,
      })
      setNewAddress("")
      setNewSource("")
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败")
    } finally {
      setBusy(false)
    }
  }

  const removeAddress = async (a: MailAddress) => {
    try {
      await deleteResource(a.id)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl sm:max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{serviceName(service)} · 转发别名</DialogTitle>
          <DialogDescription>
            管理可查询的邮箱别名。查询时输入别名会自动替换为对应的实际来源邮箱。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {addresses.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有转发别名。</p>
          ) : (
            <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
              {addresses.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm"
                >
                  <span className="flex-1 truncate">{a.address}</span>
                  {a.source_address && (
                    <span className="text-xs text-muted-foreground">← {a.source_address}</span>
                  )}
                  <Button variant="ghost" size="icon-sm" onClick={() => void removeAddress(a)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs">别名地址</Label>
              <Input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="alias@example.com"
                className="h-8"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs">来源地址（可选）</Label>
              <Input
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="source@example.com"
                className="h-8"
              />
            </div>
            <Button size="sm" onClick={() => void addAddress()} disabled={busy}>
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 邮件解析辅助（从 admin 市场 MailMessagesPanel 搬来，纯前端 MIME/字段解析）
// =============================================================================

function decodeMimeEncodedWord(value: string): string {
  if (!value) return ""
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, encoding: string, text: string) => {
    try {
      const enc = encoding.toLowerCase()
      let ascii = ""
      if (enc === "b") {
        ascii = atob(text)
      } else {
        ascii = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_h, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      }
      const bytes = new Uint8Array(ascii.length)
      for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i)
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return text
    }
  })
}

function readMimeHeader(raw: string, name: string): string {
  if (!raw) return ""
  const headerSection = raw.split(/\r?\n\r?\n/, 1)[0] || ""
  const lines = headerSection.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${name}:\\s*(.*)$`, "i"))
    if (!m) continue
    let value = m[1]
    let j = i + 1
    while (j < lines.length && /^\s/.test(lines[j])) {
      value += " " + lines[j].trim()
      j++
    }
    return decodeMimeEncodedWord(value.trim())
  }
  return ""
}

function mailSender(row: Record<string, any>): { name: string; email: string } {
  const direct = row.from || row.sender || row.from_address
  if (direct && typeof direct === "string") {
    const bracket = direct.match(/<([^>]+)>/)
    const email = bracket ? bracket[1] : (direct.match(/[\w.+-]+@[\w.-]+/) || [""])[0]
    const name = direct.replace(/<[^>]+>/, "").replace(/^"|"$/g, "").trim() || email
    return { name, email }
  }
  const value = readMimeHeader(row.raw_content || row.raw || "", "From")
  if (!value) return { name: "", email: "" }
  const bracket = value.match(/<([^>]+)>/)
  const email = bracket ? bracket[1] : (value.match(/[\w.+-]+@[\w.-]+/) || [""])[0]
  const name = value.replace(/<[^>]+>/, "").replace(/^"|"$/g, "").trim() || email
  return { name, email }
}

function formatMailDate(row: Record<string, any>): string {
  const direct = row.date || row.created_at || row.received_at || row.time
  const candidate = typeof direct === "string" && direct ? direct : readMimeHeader(row.raw_content || row.raw || "", "Date")
  if (!candidate) return "-"
  const d = new Date(candidate)
  if (isNaN(d.getTime())) return candidate
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function withBaseTargetBlank(html: string): string {
  if (!html) return html
  const cleaned = html
    .replace(/<meta[^>]*charset[^>]*>/gi, "")
    .replace(/<meta[^>]*http-equiv=["']?content-type["']?[^>]*>/gi, "")
  const inject = '<meta charset="utf-8"><base target="_blank">'
  if (/<head[^>]*>/i.test(cleaned)) return cleaned.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
  if (/<html[^>]*>/i.test(cleaned)) return cleaned.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`)
  return `${inject}${cleaned}`
}

// =============================================================================
// 用户侧邮件查询面板（折叠框内）：地址/关键词实时查询 + 分页 + 正文查看
// 交互复用 admin 市场 MailMessagesPanel，数据层换成用户侧 queryMailMessages。
// =============================================================================

function MailMessagesPanel({
  service,
  addresses,
}: {
  service: MailServiceResource
  addresses: MailAddress[]
}) {
  const [mailAddress, setMailAddress] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [viewing, setViewing] = useState<MailMessage | null>(null)
  const [bodyMode, setBodyMode] = useState<"raw" | "html">("html")
  const searchSequence = useRef(0)

  const queryMessages = useCallback(
    async (nextPage = 1) => {
      const sequence = ++searchSequence.current
      setLoading(true)
      try {
        const data = await queryMailMessages(service.resource_id, {
          address: mailAddress || undefined,
          keyword: keyword || undefined,
          limit: 20,
          offset: (nextPage - 1) * 20,
        })
        if (sequence !== searchSequence.current) return
        setMessages(data.messages || [])
        setPage(nextPage)
        setLoaded(true)
      } catch (e) {
        if (sequence !== searchSequence.current) return
        toast.error(e instanceof Error ? e.message : "加载当前邮件失败")
      } finally {
        if (sequence === searchSequence.current) setLoading(false)
      }
    },
    [service.resource_id, mailAddress, keyword],
  )

  const viewingSender = viewing ? mailSender(viewing as Record<string, any>) : null
  const viewingDateLabel = viewing ? formatMailDate(viewing as Record<string, any>) : ""
  const viewingFromLabel = viewingSender
    ? viewingSender.email
      ? viewingSender.name && viewingSender.name !== viewingSender.email
        ? `${viewingSender.name} <${viewingSender.email}>`
        : viewingSender.email
      : "-"
    : "-"

  const addressMatches = addresses.filter((item) =>
    String(item.address ?? "").toLowerCase().includes(mailAddress.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-3">
      {!viewing && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[280px] flex-1">
            <Input
              value={mailAddress}
              onChange={(e) => setMailAddress(e.target.value)}
              placeholder="邮箱地址（留空查全部）"
              list={`mail-address-suggestions-${service.resource_id}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") void queryMessages(1)
              }}
            />
            <datalist id={`mail-address-suggestions-${service.resource_id}`}>
              {addressMatches.map((item) => (
                <option key={String(item.address)} value={String(item.address)}>
                  {item.address === item.source_address
                    ? String(item.address)
                    : `${item.address}（替换为 ${item.source_address}）`}
                </option>
              ))}
            </datalist>
          </div>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="关键词（可选）"
            className="w-[180px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void queryMessages(1)
            }}
          />
          <Button disabled={loading} onClick={() => void queryMessages(1)}>
            {loading ? <Spinner className="mr-1 size-4" /> : <Search className="size-4" />}
            搜索
          </Button>
        </div>
      )}

      {viewing ? (
        <div className="flex flex-col gap-2" style={{ height: "calc(85vh - 220px)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={() => setViewing(null)}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="font-medium">
              {String(viewing.subject || viewing.title || "（无主题）")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary">发件人：{viewingFromLabel}</Badge>
            <Badge variant="outline">
              收件：{String(viewing.received_address || viewing.requested_address || mailAddress || "-")}
            </Badge>
            <Badge variant="outline">{viewingDateLabel}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={bodyMode}
              onValueChange={(v) => {
                if (v) setBodyMode(v as "raw" | "html")
              }}
            >
              <ToggleGroupItem value="html">渲染 HTML</ToggleGroupItem>
              <ToggleGroupItem value="raw">显示原文</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded border">
            {bodyMode === "html" ? (
              viewing.html_content ? (
                <iframe
                  title="邮件 HTML 预览"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={withBaseTargetBlank(String(viewing.html_content))}
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              ) : viewing.text_content ? (
                <pre className="m-0 h-full overflow-auto whitespace-pre-wrap break-words p-3 text-sm">
                  {String(viewing.text_content)}
                </pre>
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  邮件不含正文，可切换「显示原文」查看
                </p>
              )
            ) : (
              <pre className="m-0 h-full overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
                {String(viewing.raw_content || viewing.raw || viewing.content || viewing.body || "（无原文内容）")}
              </pre>
            )}
          </div>
        </div>
      ) : messages.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {loaded ? "没有邮件" : loading ? "正在实时查询..." : "点「搜索」实时查询当前邮件"}
        </p>
      ) : (
        <TooltipProvider>
          <div className="max-h-[420px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">发送者</TableHead>
                <TableHead className="w-[200px]">邮箱</TableHead>
                <TableHead>主题</TableHead>
                <TableHead className="w-[150px]">发送时间</TableHead>
                <TableHead className="w-[70px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((row, index) => {
                const s = mailSender(row as Record<string, any>)
                const senderLabel = s.email
                  ? s.name && s.name !== s.email
                    ? `${s.name} <${s.email}>`
                    : s.email
                  : "-"
                const address = String(row.received_address || row.requested_address || mailAddress || "-")
                const subject = String(row.subject || row.title || "（无主题）")
                const dateLabel = formatMailDate(row as Record<string, any>)
                return (
                  <TableRow key={String(row.id || row.message_id || `${page}-${index}`)}>
                    <TableCell className="max-w-[200px] truncate">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{senderLabel}</span>
                        </TooltipTrigger>
                        <TooltipContent>{senderLabel}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{address}</span>
                        </TooltipTrigger>
                        <TooltipContent>{address}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{subject}</span>
                        </TooltipTrigger>
                        <TooltipContent>{subject}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="truncate">{dateLabel}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setViewing(row)
                          setBodyMode("html")
                        }}
                      >
                        查看
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
        </TooltipProvider>
      )}

      {!viewing && messages.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => void queryMessages(page - 1)}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">第 {page} 页</span>
          <Button
            variant="outline"
            size="sm"
            disabled={messages.length < 20 || loading}
            onClick={() => void queryMessages(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// 新建邮箱弹框：一步填实例名 + 账户配置（建实例后立即建 mail_account）
// =============================================================================

function MailCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: "",
    mailbox_type: "TempMail",
    base_url: "",
    username: "",
    mail_suffix: "",
    password: "",
    secret_key: "",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        name: "",
        mailbox_type: "TempMail",
        base_url: "",
        username: "",
        mail_suffix: "",
        password: "",
        secret_key: "",
      })
    }
  }, [open])

  const create = async () => {
    if (!form.name.trim()) {
      toast.error("请填写邮箱名称")
      return
    }
    setSaving(true)
    try {
      // 资源级创建：兼容容器与账户由服务端一并建好，前端只看到服务。
      await createMailServiceResource({
        display_name: form.name.trim(),
        mailbox_type: form.mailbox_type,
        base_url: form.base_url.trim() || undefined,
        username: form.username.trim() || undefined,
        mail_suffix: form.mail_suffix.trim() || undefined,
        password: form.password || undefined,
        secret_key: form.secret_key || undefined,
      })
      toast.success("已创建")
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建邮箱服务</DialogTitle>
          <DialogDescription>填入邮箱账户配置，创建后即可使用；转发别名可在创建后到「邮箱设置」里加。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="我的邮箱"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>类型</Label>
              <Select
                value={form.mailbox_type}
                onValueChange={(v) => setForm((f) => ({ ...f, mailbox_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAILBOX_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>服务器地址</Label>
            <Input
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              placeholder="https://mail.example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>用户名</Label>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="user@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>邮箱后缀</Label>
            <Input
              value={form.mail_suffix}
              onChange={(e) => setForm((f) => ({ ...f, mail_suffix: e.target.value }))}
              placeholder="example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>密码</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="密码"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>密钥</Label>
              <Input
                type="password"
                value={form.secret_key}
                onChange={(e) => setForm((f) => ({ ...f, secret_key: e.target.value }))}
                placeholder="可选"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void create()} disabled={saving}>
            {saving && <Spinner className="mr-2 size-4" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
