/**
 * 「关于」弹框：项目介绍 + 仓库地址 + 文档地址。
 *
 * 用户侧（nav-user）和管理侧（nav-manager）的头像菜单共用同一个弹框：文案走
 * common.about 命名空间，链接常量统一取 utils/brand，版本号取 serverConfig，
 * 避免两边各写一份而说法不一致。
 */
import { useEffect, useState } from "react"
import { IconApple, IconBrandGithub, IconBook2, IconExternalLink, IconSquareRoundedArrowDown } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

import { useAppRuntime } from "@/components/app-runtime-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"
import { getMobileAppRelease, type MobileAppRelease } from "@/api/builtinToolsClient"
import { DOCS_URL, REPOSITORY_URL } from "@/utils/brand"
import { publicUrl } from "@/utils/public-url"

const ABOUT_LINKS = [
  { labelKey: "common.about.repository", href: REPOSITORY_URL, icon: IconBrandGithub },
  { labelKey: "common.about.docs", href: DOCS_URL, icon: IconBook2 },
] as const

// 下载行：icon + 平台名 + mono 地址 + 复制按钮。地址可能为空（未配置/未发布）。
// url 可能是站内相对路径（proxy_download_url）——复制时补全成绝对地址，粘贴到
// 别处（手机浏览器/聊天工具）才能直接打开；显示仍用原样（同站内短路径更清爽）。
function DownloadLinkRow({
  icon: Icon,
  title,
  url,
  download,
  copyLabel,
}: {
  icon: typeof IconBrandGithub
  title: string
  url: string
  download?: boolean
  copyLabel: string
}) {
  const copy = async () => {
    const absolute = url.startsWith("http")
      ? url
      : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`
    if (await copyToClipboard(absolute)) {
      toast.success(copyLabel)
    } else {
      toast.error("复制失败，请手动选择")
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <a
          href={url}
          {...(download ? { download: true } : {})}
          target="_blank"
          rel="noreferrer"
          className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {url}
        </a>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => void copy()}
      >
        <IconSquareRoundedArrowDown className="size-3.5" />
        复制链接
      </Button>
    </div>
  )
}

// 移动端 App 下载区：开弹框时拉一次最新发行信息；失败/未配置整块隐藏（关于弹框
// 是介绍位，不因市场未启用而出现空区块）。Android 优先站内代理直链（手机浏览器
// 无需直连 GitHub），iOS 是 App Store 跳转链接（iOS 装不了自下载包）。
function MobileDownloadSection() {
  const { t } = useTranslation()
  const [release, setRelease] = useState<MobileAppRelease | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMobileAppRelease().then((r) => { if (!cancelled) setRelease(r) })
    return () => { cancelled = true }
  }, [])

  const androidUrl = release?.android?.proxy_download_url || release?.android?.download_url || ""
  const iosUrl = release?.ios?.store_url || ""
  if (!androidUrl && !iosUrl) return null

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-muted-foreground">{t("common.about.downloads")}</span>
      {androidUrl && (
        <DownloadLinkRow
          icon={IconSquareRoundedArrowDown}
          title={t("common.about.androidApp")}
          url={androidUrl}
          download
          copyLabel={t("common.about.copyAndroidUrl")}
        />
      )}
      {iosUrl && (
        <DownloadLinkRow
          icon={IconApple}
          title={t("common.about.iosApp")}
          url={iosUrl}
          copyLabel={t("common.about.copyIosUrl")}
        />
      )}
    </div>
  )
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const version = serverConfig?.current_version

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-8">
            <img src={publicUrl("/ai-lubricant.svg")} alt="Ai Lubricant" className="size-10 shrink-0" />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex items-center gap-2">
                <DialogTitle>Ai Lubricant</DialogTitle>
                {version && <Badge variant="secondary">{version}</Badge>}
              </div>
              <span className="truncate text-xs text-muted-foreground">{t("common.about.tagline")}</span>
            </div>
          </div>
          <DialogDescription className="leading-relaxed">
            {t("common.about.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <MobileDownloadSection />
          {ABOUT_LINKS.map(({ labelKey, href, icon: Icon }) => (
            <a
              key={labelKey}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium">{t(labelKey)}</span>
                <span className="truncate text-xs text-muted-foreground">{href}</span>
              </span>
              <IconExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
