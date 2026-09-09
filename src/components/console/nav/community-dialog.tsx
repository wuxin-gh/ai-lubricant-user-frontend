import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "react-i18next"
import { ImagePreview } from "@/components/common/image-preview"
import { fetchCommunityConfig, type CommunityConfigPublic } from "@/api/marketplaceRaw"

interface CommunityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const GROUP_TYPE_LABEL_KEYS: Record<string, string> = {
  wechat: "consoleShell.community.types.wechat",
  feishu: "consoleShell.community.types.feishu",
  dingtalk: "consoleShell.community.types.dingtalk",
  qq: "consoleShell.community.types.qq",
  other: "consoleShell.community.types.other",
}

function groupLabel(group: CommunityConfigPublic["groups"][number], t: (key: string) => string): string {
  const custom = (group.label || "").trim()
  if (custom) return custom
  return t(GROUP_TYPE_LABEL_KEYS[group.type] || GROUP_TYPE_LABEL_KEYS.other)
}

export default function CommunityDialog({ open, onOpenChange }: CommunityDialogProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<CommunityConfigPublic | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setConfig(null)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    void fetchCommunityConfig().then((data) => {
      if (cancelled) return
      setConfig(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [open])

  const groups = config?.groups ?? []
  const notice = config?.notice
  const noticeEnabled = notice?.enabled === true
  const entries = notice?.entries ?? []
  const hasNotice = noticeEnabled && entries.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col overflow-hidden p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="pb-0 pr-8">
          <DialogTitle>{t("consoleShell.community.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          <Tabs defaultValue="groups">
            <TabsList>
              <TabsTrigger value="groups">{t("consoleShell.community.tabs.groups")}</TabsTrigger>
              <TabsTrigger value="notice" disabled={!hasNotice}>
                {t("consoleShell.community.tabs.notice")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="groups" className="mt-4">
              {loading ? (
                <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
              ) : groups.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {groups.map((group) => (
                    <div key={group.id} className="flex flex-col items-center gap-3 rounded-xl border px-4 py-4">
                      <div className="text-sm font-medium">{groupLabel(group, t)}</div>
                      <ImagePreview
                        src={group.qr_image}
                        alt={t("consoleShell.community.qrAlt", { name: groupLabel(group, t) })}
                        title={groupLabel(group, t)}
                        allowDataImage
                        triggerClassName="w-full"
                        imageClassName="aspect-square w-full rounded-lg border bg-white object-contain p-2"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {t("consoleShell.community.empty")}
                </div>
              )}
            </TabsContent>
            <TabsContent value="notice" className="mt-4">
              {hasNotice ? (
                <div className="space-y-4">
                  {entries.map((entry) =>
                    entry.kind === "image" ? (
                      <div key={entry.id} className="flex justify-center">
                        <img src={entry.image} alt={t("consoleShell.community.noticeImageAlt")} className="max-h-80 rounded-lg border object-contain" />
                      </div>
                    ) : (
                      <p key={entry.id} className="whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
                    ),
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {t("consoleShell.community.noticeEmpty")}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
