/**
 * 「手机访问」弹框：展示手机端 App 的下载方式（Android APK / iOS App Store）。
 *
 * 与「关于」弹框里的下载区同源（都走 getMobileAppRelease），但这里是独立入口，
 * 面向"我就是要装手机端"的场景，所以给二维码/复制链接这类便于手机扫码取用的形式。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Smartphone } from "lucide-react"
import { IconApple, IconSquareRoundedArrowDown } from "@tabler/icons-react"

import { getMobileAppRelease, type MobileAppRelease } from "@/api/builtinToolsClient"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { REPOSITORY_URL } from "@/utils/brand"
import { copyText } from "./copy-text"

/** 下载行：平台名 + 版本 + 下载按钮 + 复制链接。 */
function DownloadRow({
  icon: Icon,
  title,
  subtitle,
  url,
  download,
  downloadLabel,
  copyLabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  url: string
  download?: boolean
  downloadLabel: string
  copyLabel: string
}) {
  // 相对路径补成绝对地址：复制出去（发到手机上）才能直接打开。
  const absolute = url.startsWith("http")
    ? url
    : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Icon className="size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void copyText(absolute)} title={copyLabel}>
          <Copy className="size-4" />
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={absolute} {...(download ? { download: "" } : { target: "_blank", rel: "noreferrer" })}>
            {downloadLabel}
          </a>
        </Button>
      </div>
    </div>
  )
}

export function MobileAccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [release, setRelease] = useState<MobileAppRelease | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    let cancelled = false
    void getMobileAppRelease()
      .then((r) => { if (!cancelled) setRelease(r) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const androidUrl = release?.android?.proxy_download_url || release?.android?.download_url || ""
  const androidVersion = release?.android?.version || release?.version || ""
  const iosUrl = release?.ios?.store_url || ""
  const hasAny = Boolean(androidUrl || iosUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            {t("quickActions.mobileAccess.title", "手机访问")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "quickActions.mobileAccess.desc",
              "装上手机端 App，就能在手机上访问和使用平台。用手机扫下面链接，或复制发到手机上打开。",
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : hasAny ? (
          <div className="flex flex-col gap-2.5">
            {androidUrl ? (
              <DownloadRow
                icon={IconSquareRoundedArrowDown}
                title={t("quickActions.mobileAccess.android", "Android 版")}
                subtitle={androidVersion ? `v${androidVersion}` : undefined}
                url={androidUrl}
                download
                downloadLabel={t("quickActions.mobileAccess.download", "下载")}
                copyLabel={t("quickActions.mobileAccess.copyLink", "已复制下载链接")}
              />
            ) : null}
            {iosUrl ? (
              <DownloadRow
                icon={IconApple}
                title={t("quickActions.mobileAccess.ios", "iPhone / iPad 版")}
                url={iosUrl}
                downloadLabel={t("quickActions.mobileAccess.download", "下载")}
                copyLabel={t("quickActions.mobileAccess.copyLink", "已复制下载链接")}
              />
            ) : null}
          </div>
        ) : (
          /* 平台还没发布手机端安装包：不丢一句死话，给可操作的去处。 */
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {t(
                "quickActions.mobileAccess.empty",
                "本平台还没有发布手机端安装包。",
              )}
            </div>
            <Button variant="outline" asChild>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                {t("quickActions.mobileAccess.viewReleases", "去发行页查看")}
              </a>
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("quickActions.done", "完成")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
