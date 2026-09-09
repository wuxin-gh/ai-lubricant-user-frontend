import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  listCdpClientResources,
  createCdpClientResource,
  rotateCdpToken,
  revokeCdpToken,
  updateCdpClient,
  deleteCdpClient,
  getCdpConnectionInfo,
  listMailServiceResources,
  createMailServiceResource,
  deleteMailServiceResource,
  listDeviceResources,
  mintDevicePairingCodeResource,
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
  getIosHostDevices,
  claimIosDevice,
  listIosSigningProfiles,
  createIosSigningProfile,
  updateIosSigningProfile,
  deleteIosSigningProfile,
  loginAppleId,
  verifyAppleId2fa,
  startIosWdaJob,
  getIosWdaJobStatus,
  cancelIosWdaJob,
  type IosHostNode,
  type IosDiscoveredDevice,
  type IosSigningProfile,
  type IosWdaJobSnapshot,
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
  Download,
  ArrowLeft,
  Search,
  Inbox,
  Smartphone,
  Unplug,
} from "lucide-react"
import { IconBrandAndroid, IconBrandApple, IconBrowser } from "@tabler/icons-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/utils/clipboard"

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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ""
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
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

async function copyText(text: string) {
  if (await copyToClipboard(text)) {
    toast.success("已复制")
  } else {
    toast.error("复制失败，请手动选择")
  }
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

export function UserToolsPage() {
  const [activeKind, setActiveKind] = useState<ToolKind>("cdp")
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

  // iOS WDA management dialogs
  const [iosSigningDialogOpen, setIosSigningDialogOpen] = useState(false)

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
          <Button size="sm" variant="outline" onClick={() => setIosSigningDialogOpen(true)}>
            签名配置
          </Button>
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

      <Tabs orientation="horizontal" value={activeKind} onValueChange={(v) => setActiveKind(v as ToolKind)}>
        <TabsList className="flex-row flex-nowrap">
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

      {/* 平台随工具页签走：「添加 Android/iOS 设备」按钮在哪个 Tab 点开，弹框就走哪条接入方案。 */}
      <AddDeviceDialog
        open={addDeviceOpen}
        onOpenChange={setAddDeviceOpen}
        onPaired={() => void reloadDevices()}
        platform={activeKind === "ios" ? "ios" : "android"}
      />

      <DeviceDetailDialog
        device={detailDevice}
        open={!!detailDevice}
        onOpenChange={(open) => !open && setDetailDeviceId(null)}
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

function DeviceResourceList({ devices, onOpen, onDelete }: {
  devices: DeviceResource[]
  onOpen: (device: DeviceResource) => void
  onDelete: (device: DeviceResource) => void
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
        return (
          <ResourceCard
            key={device.id}
            icon={deviceIcon(device.platform)}
            online={device.online && enabled}
            dimmed={!enabled}
            title={device.name || model}
            badges={
              <>
                <Badge variant="outline">{ios ? "iOS" : "Android"}</Badge>
                <Badge variant={device.online && enabled ? "default" : "secondary"}>
                  {!enabled ? "已解除配对" : device.online ? "在线" : "离线"}
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
  onToggle,
  onRename,
  onRequestRevoke,
  onRequestDelete,
}: {
  device: DeviceResource | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

          {ios && device?.data?.ios && (
            <IosWdaPanel device={device} onChanged={() => onOpenChange(false)} />
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
// iOS WDA 管理面板：签名配置 + 产物选择 + WDA job 控制
// =============================================================================

function IosWdaPanel({ device, onChanged }: { device: DeviceResource; onChanged: () => void }) {
  const iosData = device.data?.ios as Record<string, unknown> | undefined
  const wdaState = (iosData?.wda_state as string) || "missing"
  const profileExpiresAt = iosData?.profile_expires_at as string | undefined
  // 自动续签：prepare_wda 成功后服务端写入 auto_renew=true + last_renew_job_id。
  // 扫描器到期前自动派发 renew job；这里读 last_renew_job_id 轮询，运行中显示徽章。
  const autoRenewEnabled = (iosData?.auto_renew as boolean | undefined) ?? false
  const lastRenewJobId = (iosData?.last_renew_job_id as string | undefined) || null

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
  const [wdaBundleId, setWdaBundleId] = useState("com.facebook.WebDriverAgentRunner.xctrunner")
  const [jobRunning, setJobRunning] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [jobSnapshot, setJobSnapshot] = useState<IosWdaJobSnapshot | null>(null)
  const [autoRenewRunning, setAutoRenewRunning] = useState(false)

  // Load signing profiles + 当前市场 WDA iOS 版本（只读展示，产物由宿主节点自动下载）
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

  // Poll job status when job is running
  useEffect(() => {
    if (!currentJobId || !jobRunning) return
    let stop = false
    const poll = async () => {
      try {
        const snapshot = await getIosWdaJobStatus(device.id, currentJobId)
        if (!stop) {
          setJobSnapshot(snapshot)
          if (snapshot.status === "completed" || snapshot.status === "failed") {
            setJobRunning(false)
            if (snapshot.status === "completed") {
              toast.success("WDA 准备完成")
              onChanged()
            } else {
              toast.error(`WDA job 失败: ${snapshot.message}`)
            }
          }
        }
      } catch (e) {
        if (!stop) {
          console.error("轮询 job 状态失败", e)
        }
      }
    }
    const timer = setInterval(() => void poll(), 2000)
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
      toast.success(`已发起 ${action === "prepare" ? "准备" : action === "renew" ? "续期" : "重装"} job`)
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

  const expiryDisplay = profileExpiresAt
    ? new Date(profileExpiresAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "-"

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">WebDriverAgent 管理</div>
        <div className="flex items-center gap-1">
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

      {jobRunning && jobSnapshot ? (
        <div className="flex flex-col gap-2 rounded border bg-muted/20 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{jobSnapshot.stage}</span>
            <span className="text-xs text-muted-foreground">{jobSnapshot.percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${jobSnapshot.percent}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{jobSnapshot.message}</div>
          <Button variant="outline" size="sm" onClick={() => void cancelJob()}>
            取消
          </Button>
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
              <Label>WDA Bundle ID</Label>
              <div className="text-xs text-muted-foreground">
                Apple ID 免费签名由服务端按团队域作用域自动派生 App ID
                （官方 id + 团队后缀），无需填写；登录有效即可全自动准备/续期
                （免费证书 7 天过期，自动续签刷新）。
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>WDA Bundle ID</Label>
              <Input
                value={wdaBundleId}
                onChange={(e) => setWdaBundleId(e.target.value)}
                placeholder="com.facebook.WebDriverAgentRunner.xctrunner"
              />
              <div className="text-xs text-muted-foreground">
                ASC / P12 付费证书保持默认即可；免费签名（自备 P12）须填你在 Xcode 里
                创建的 App ID（如 com.你的名字.WebDriverAgentRunner），须与描述文件
                匹配。仅首次「准备 WDA」生效，续期/重装自动沿用。
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>WDA 产物</Label>
            <div className="text-xs text-muted-foreground">
              {wdaMarketVersion
                ? `市场当前版本 v${wdaMarketVersion}，宿主节点自动下载并按所选签名配置重签安装，无需手动选择。`
                : "WDA 产物由市场自动获取，宿主节点下载并按所选签名配置重签安装；当前市场尚未发布 iOS 包。"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void startWdaJob("prepare")}
              disabled={!selectedProfileId}
            >
              准备 WDA
            </Button>
            {wdaState === "ready" || wdaState === "renewal_due" || wdaState === "expired" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void startWdaJob("renew")}>
                  立即续期
                </Button>
                <Button size="sm" variant="outline" onClick={() => void startWdaJob("reinstall")}>
                  重装
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
      })
      if (result.status === "2fa_required") {
        setAppleLoginToken(result.login_token || null)
        toast.info("验证码已发送到你的 Apple 设备，请输入")
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
    setSaving(true)
    try {
      await verifyAppleId2fa({
        login_token: appleLoginToken,
        email: appleEmail.trim(),
        password: applePassword,
        code: appleCode.trim(),
        profile_id: editing?.id,
      })
      toast.success(editing ? "重新登录成功，配置已更新" : "登录成功，已创建签名配置")
      resetForm()
      setEditing(null)
      setView("list")
      void loadProfiles()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "验证失败，请重新登录")
    } finally {
      setSaving(false)
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
        : "自备签名证书（P12 + 描述文件）。免费 Apple ID 证书 7 天过期、到期需重新导出并在此更换；付费开发者证书约 1 年。用此配置时 WDA Bundle ID 须填证书覆盖的 App ID。"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[92vw] max-w-2xl overflow-y-auto">
        {view === "list" ? (
          <>
            <DialogHeader>
              <DialogTitle>签名配置管理</DialogTitle>
              <DialogDescription>管理 WDA 签名方式，列表中展示创建时间与材料有效性状态</DialogDescription>
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
                    暂无签名配置，先添加一个才能「准备 WDA」
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
                        <Button onClick={() => void submitAppleLogin()} disabled={saving}>
                          {saving ? <Spinner className="size-4" /> : null}
                          {editing ? "重新登录" : "登录"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="rounded border border-blue-500/40 bg-blue-500/5 p-2 text-xs leading-5 text-muted-foreground">
                          验证码已推送到你的 Apple 受信设备（iPhone/Mac 弹窗），输入显示的
                          6 位码完成登录。没收到？返回重新登录可再次触发推送。
                        </div>
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
                        ? "材料已过期，请在下方原地更换新证书——否则 WDA 签名/续期将持续失败。"
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

// =============================================================================
// 添加浏览器弹框：与「添加设备」同形态的两阶段流程。
// 阶段一填名称并内嵌接入步骤（下载扩展 / 装扩展 / 填地址）；阶段二创建成功后
// 显示一次性 token + 桥接地址，等扩展连上来即提示成功。
// 接入教程不再是独立弹框——步骤就长在创建流程里（item 1 / item 5）。
// =============================================================================

function CdpClientCreateDialog({
  connInfo,
  open,
  onOpenChange,
  onCreated,
}: {
  connInfo: CdpConnectionInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 创建成功回调：把明文 token 交给页面弹一次性凭据框并刷新列表。 */
  onCreated: (token: string) => Promise<void> | void
}) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: number; token: string } | null>(null)
  // 已连接检测：创建后轮询列表，看这个客户端有没有连上来。
  const [connected, setConnected] = useState(false)

  const reset = () => {
    setName("")
    setCreated(null)
    setConnected(false)
  }

  const create = async () => {
    const next = name.trim()
    if (!next) {
      toast.error("请填写客户端名称")
      return
    }
    setCreating(true)
    try {
      const { client, token } = await createCdpClientResource(next)
      setCreated({ id: client.id, token })
      await onCreated(token)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建客户端失败")
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    if (!open || !created || connected) return
    const tick = async () => {
      try {
        const { clients } = await listCdpClientResources()
        const mine = clients.find((c) => c.id === created.id)
        if (mine?.connected) {
          setConnected(true)
          toast.success("扩展已连接")
        }
      } catch {
        // 轮询失败不打扰用户，下一轮再试。
      }
    }
    const timer = setInterval(() => void tick(), 2000)
    return () => clearInterval(timer)
  }, [open, created, connected])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="max-h-[88vh] w-[92vw] max-w-lg overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加浏览器</DialogTitle>
          <DialogDescription>
            一个客户端 = 一个 Chrome 扩展连接。按下面步骤装好扩展，填入地址与 token 即接入。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!created ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cdp-client-name">客户端名称</Label>
                <Input
                  id="cdp-client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create()
                  }}
                  placeholder="例如：办公浏览器"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <CdpSetupGuide connInfo={connInfo} />
              </div>

              <Button onClick={() => void create()} disabled={creating || !name.trim()}>
                {creating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                创建并显示 token
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-4">
              {connected ? (
                <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <IconBrowser className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">扩展已连接</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{name}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  等待扩展用下面的地址与 token 连接
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label>连接 token（明文只显示这一次）</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                    {created.token}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copyText(created.token)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  忘了不用重建客户端——在客户端详情里「重置 token」可拿一个新的（旧的立即失效）。
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>桥接地址（扩展内「服务器地址」）</Label>
                {connInfo ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                      {connInfo.ws_session_url}
                    </code>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copyText(connInfo.ws_session_url)}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    正在加载桥接地址
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {created ? "完成" : "取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 浏览器接入引导：下载扩展 → 加载到 Chrome → 提示回本弹框填地址与 token。
// 与 AndroidSetupGuide 对位，长在「添加浏览器」流程里。
// =============================================================================

function CdpSetupGuide({ connInfo }: { connInfo: CdpConnectionInfo | null }) {
  return (
    <>
      <TutorialStep index={1} title="下载并解压扩展">
        <p className="text-xs leading-5 text-muted-foreground">
          下载扩展压缩包并解压到固定目录，之后不要删除或移动。
        </p>
        {connInfo ? (
          <Button variant="outline" size="sm" asChild>
            <a href={connInfo.extension_download_url} download={connInfo.extension_file_name}>
              <Download className="size-4" />
              下载 Chrome 扩展
            </a>
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            正在加载下载地址
          </div>
        )}
      </TutorialStep>

      <TutorialStep index={2} title="加载到 Chrome">
        <p className="text-xs leading-5 text-muted-foreground">
          打开 <code className="rounded bg-muted px-1.5 py-0.5">chrome://extensions</code>，启用「开发者模式」，
          点「加载已解压的扩展程序」，选中上一步解压出的目录。
        </p>
      </TutorialStep>

      <TutorialStep index={3} title="填入地址与 token">
        <p className="text-xs leading-5 text-muted-foreground">
          点下方按钮创建客户端，会拿到桥接地址和一次性 token；点开扩展图标把两项填进去即连接。
        </p>
      </TutorialStep>
    </>
  )
}

// =============================================================================
// Android 接入引导（长在「添加设备」流程里）：
// 下载控制 App（marketplace mobile-version 直链）+ 开启无障碍服务。
// =============================================================================

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
        <p className="text-xs text-muted-foreground">
          若系统弹出通知权限（Android 13+），建议允许；省电策略会杀长连接，可在系统设置里
          对该 App 关闭电池优化（可选）。
        </p>
      </TutorialStep>
    </>
  )
}

// =============================================================================
// 添加设备弹框：Android（装控制 App + 配对码）与 iOS（宿主节点 + USB 扫描认领）两条
// 完全不同的接入方案，平台由顶部工具页签决定（哪个 Tab 的「添加」按钮进来就走哪条）。
// =============================================================================

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

function AddDeviceDialog({
  open,
  onOpenChange,
  onPaired,
  platform,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPaired: () => void
  platform: "android" | "ios"
}) {
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

  // iOS 新流程：选 ios_host 节点 → 扫描设备 → 认领 → 引导 WDA 准备
  const [iosHostId, setIosHostId] = useState("")
  const [iosDiscoveredDevices, setIosDiscoveredDevices] = useState<IosDiscoveredDevice[]>([])
  const [iosScanning, setIosScanning] = useState(false)
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

  // Scan devices when iOS host is selected
  const scanIosDevices = async () => {
    if (!iosHostId) {
      toast.error("请先选择 iOS 宿主节点")
      return
    }
    setIosScanning(true)
    try {
      const { devices } = await getIosHostDevices(iosHostId)
      setIosDiscoveredDevices(devices)
      if (devices.length === 0) {
        toast.error("未发现设备，请确认 iPhone 已 USB 连接到该节点")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "扫描设备失败")
      setIosDiscoveredDevices([])
    } finally {
      setIosScanning(false)
    }
  }

  // Claim iOS device
  const claimDevice = async (udid: string, deviceName: string) => {
    setIosClaiming(true)
    try {
      const { device_id } = await claimIosDevice({
        node_id: iosHostId,
        udid,
        label: label.trim() || deviceName,
      })
      setIosClaimedDeviceId(device_id)
      toast.success(`已接入设备：${label.trim() || deviceName}`)
      // Start polling for device readiness
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
    setIosDiscoveredDevices([])
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
      <DialogContent className="max-h-[88vh] w-[92vw] max-w-lg overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{platform === "android" ? "添加 Android 设备" : "添加 iOS 设备"}</DialogTitle>
          <DialogDescription>
            {platform === "android"
              ? "手机安装控制 App，生成配对码后在 App 内填入即可接入。"
              : "iPhone 用数据线连到一台运行 iOS 宿主节点的电脑（Windows/Linux/Mac 均可，无需 Mac），手机「信任此电脑」后扫描认领即可接入；接入后在设备列表「准备 WDA」，宿主节点自动下载、签名并安装到手机。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!code && !iosClaimedDeviceId ? (
            <>
              {platform === "ios" && (
                <>
                  <TutorialStep index={1} title="把 iPhone 连到宿主节点">
                    <p className="text-xs leading-5 text-muted-foreground">
                      用数据线把 iPhone 连到运行 iOS 宿主节点的电脑，并在手机弹窗里「信任此电脑」。
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      iPhone 接入由宿主节点经 WDA 驱动，<b>无需在手机上手动安装任何 App</b>——
                      这点与 Android（装控制 App + 配对码）的方案不同。WDA 由宿主节点在
                      接入后的「准备 WDA」步骤自动下载、重签并安装到手机；宿主节点
                      Windows/Linux/Mac 均可，无需 Mac 或 Xcode。
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      接入后先在设备列表「准备 WDA」里配置签名方式：Apple ID 免费
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
                                {h.name || h.node_id} {!h.online && "(离线)"}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {iosHosts.length === 0 && !iosHostsLoading && (
                        <p className="text-xs text-muted-foreground">
                          暂无可用的 iOS 宿主节点。请先接入具备 ios_mgmt 能力的节点。
                        </p>
                      )}
                    </div>
                  </TutorialStep>

                  {iosHostId && (
                    <TutorialStep index={3} title="扫描设备并接入">
                      <div className="flex flex-col gap-2">
                        <Button onClick={() => void scanIosDevices()} disabled={iosScanning}>
                          {iosScanning ? <Spinner className="size-4" /> : "扫描设备"}
                        </Button>

                        {iosDiscoveredDevices.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <Label className="text-xs text-muted-foreground">发现的设备</Label>
                            <div className="flex flex-col gap-2 rounded-md border p-2">
                              {iosDiscoveredDevices.map((dev) => (
                                <div
                                  key={dev.udid}
                                  className="flex items-center justify-between gap-3 rounded border bg-muted/20 p-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium">{dev.name}</div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {dev.model} · iOS {dev.product_version} · {dev.connection_type}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">UDID: ...{dev.udid.slice(-8)}</div>
                                  </div>
                                  {dev.claimed ? (
                                    <Badge variant="outline">已接入</Badge>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={() => void claimDevice(dev.udid, dev.name)}
                                      disabled={iosClaiming}
                                    >
                                      {iosClaiming ? <Spinner className="size-3" /> : "接入"}
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-1.5">
                          <Label className="text-xs text-muted-foreground">设备名称（可选，接入后可改）</Label>
                          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="我的 iPhone" />
                        </div>
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
                  接下来在设备列表点「准备 WDA」，宿主节点会自动下载、签名、安装并启动 WDA
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// 步骤行：接入引导（AndroidSetupGuide / CdpSetupGuide）共用的编号条目
// =============================================================================

function TutorialStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {index}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
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
