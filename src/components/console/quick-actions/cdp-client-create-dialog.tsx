/**
 * 「添加浏览器」（CDP 客户端）创建弹框：一个客户端 = 一个 Chrome 扩展连接，
 * 装扩展 → 填地址与 token → 创建后轮询等扩展连上。
 *
 * 从 resources.tsx 原样抽出（设备工具页与首页快捷操作共用）。
 * connInfo 可不传：弹框自行调 getCdpConnectionInfo()（首页场景没有页面级预取）。
 */
import { useEffect, useState } from "react"
import { Copy, Download, Plus } from "lucide-react"
import { IconBrowser } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createCdpClientResource,
  getCdpConnectionInfo,
  listCdpClientResources,
  type CdpConnectionInfo,
} from "@/api/builtinToolsClient"
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
import { Spinner } from "@/components/ui/spinner"
import { TutorialStep } from "./tutorial-step"
import { copyText } from "./copy-text"

// 浏览器接入引导：下载扩展 → 加载到 Chrome → 提示回本弹框填地址与 token。
// 与 AndroidSetupGuide 对位，长在「添加浏览器」流程里。
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

export function CdpClientCreateDialog({
  connInfo,
  open,
  onOpenChange,
  onCreated,
}: {
  /** 不传则弹框自行拉取（首页快捷操作场景）。 */
  connInfo?: CdpConnectionInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 创建成功回调：把明文 token 交给调用方弹一次性凭据框并刷新列表。 */
  onCreated: (token: string) => Promise<void> | void
}) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: number; token: string } | null>(null)
  // 已连接检测：创建后轮询列表，看这个客户端有没有连上来。
  const [connected, setConnected] = useState(false)
  // connInfo 未注入时自行拉取；注入了（设备工具页）以外部为准。
  const [selfConnInfo, setSelfConnInfo] = useState<CdpConnectionInfo | null>(null)
  const conn = connInfo !== undefined ? connInfo : selfConnInfo

  useEffect(() => {
    if (!open || connInfo !== undefined) return
    let active = true
    void getCdpConnectionInfo()
      .then((info) => { if (active) setSelfConnInfo(info) })
      .catch(() => { if (active) setSelfConnInfo(null) })
    return () => { active = false }
  }, [open, connInfo])

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
                <CdpSetupGuide connInfo={conn} />
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
                {conn ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                      {conn.ws_session_url}
                    </code>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copyText(conn.ws_session_url)}>
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
