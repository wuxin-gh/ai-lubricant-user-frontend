/**
 * 「关于」弹框：项目介绍 + 仓库地址 + 文档地址。
 *
 * 用户侧（nav-user）和管理侧（nav-manager）的头像菜单共用同一个弹框：文案走
 * common.about 命名空间，链接常量统一取 utils/brand，版本号取 serverConfig，
 * 避免两边各写一份而说法不一致。
 */
import { IconBook2, IconBrandGithub, IconExternalLink } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

import { useAppRuntime } from "@/components/app-runtime-provider"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DOCS_URL, REPOSITORY_URL } from "@/utils/brand"
import { publicUrl } from "@/utils/public-url"

const ABOUT_LINKS = [
  { labelKey: "common.about.repository", href: REPOSITORY_URL, icon: IconBrandGithub },
  { labelKey: "common.about.docs", href: DOCS_URL, icon: IconBook2 },
] as const

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
