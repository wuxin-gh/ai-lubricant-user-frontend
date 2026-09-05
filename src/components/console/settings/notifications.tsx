import { useState, useEffect } from "react"
import { Bell, CirclePlus, Link2, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
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
import { IconPencil, IconTrash } from "@tabler/icons-react"
import {
  ConstsNotifyChannelKind,
  type DomainNotifyChannel,
} from "@/api/Api"
import { sharedApi } from "@/api/shared-api"
import Icon from "@/components/common/Icon"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { useTranslation } from "react-i18next"

/** Receiver type used by the UI; wechat_work maps to the API wecom kind. */
export type ReceiverType = "dingtalk" | "feishu" | "wechat_work" | "webhook"
type ApiReceiverKind = "dingtalk" | "feishu" | "wecom" | "webhook"

const RECEIVER_TYPE_OPTIONS: { value: ReceiverType; icon: React.ReactNode }[] = [
  { value: "dingtalk", icon: <Icon name="dingtalk" className="size-4" /> },
  { value: "feishu", icon: <Icon name="lark" className="size-4" /> },
  { value: "wechat_work", icon: <Icon name="wecom" className="size-4" /> },
  { value: "webhook", icon: <Link2 className="size-4" /> },
]

const RECEIVER_TO_API_KIND: Record<ReceiverType, ApiReceiverKind> = {
  dingtalk: ConstsNotifyChannelKind.NotifyChannelDingTalk,
  feishu: ConstsNotifyChannelKind.NotifyChannelFeishu,
  wechat_work: ConstsNotifyChannelKind.NotifyChannelWeCom,
  webhook: ConstsNotifyChannelKind.NotifyChannelWebhook,
}

/** UI ReceiverType -> API notify channel kind */
function toApiKind(type: ReceiverType): ApiReceiverKind {
  return RECEIVER_TO_API_KIND[type]
}

const API_KIND_TO_RECEIVER: Partial<Record<ConstsNotifyChannelKind, ReceiverType>> = {
  [ConstsNotifyChannelKind.NotifyChannelDingTalk]: "dingtalk",
  [ConstsNotifyChannelKind.NotifyChannelFeishu]: "feishu",
  [ConstsNotifyChannelKind.NotifyChannelWeCom]: "wechat_work",
  [ConstsNotifyChannelKind.NotifyChannelWebhook]: "webhook",
}

/** API ConstsNotifyChannelKind -> UI ReceiverType */
function fromApiKind(kind?: ConstsNotifyChannelKind): ReceiverType {
  return kind ? API_KIND_TO_RECEIVER[kind] ?? "webhook" : "webhook"
}

function getReceiverTypeIcon(type: ReceiverType): React.ReactNode {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? <Link2 className="size-4" />
}

export default function Notifications() {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<DomainNotifyChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<DomainNotifyChannel | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [channelToDelete, setChannelToDelete] = useState<DomainNotifyChannel | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const [formType, setFormType] = useState<ReceiverType>("webhook")
  const [formName, setFormName] = useState("")
  const [formWebhookUrl, setFormWebhookUrl] = useState("")
  const [formSecret, setFormSecret] = useState("")

  const api = sharedApi
  const getReceiverTypeLabel = (type: ReceiverType): string =>
    t(`consoleSettings.notifications.receiverTypes.${type}`)

  // Webhook / DingTalk / Feishu / WeCom channels are a plain outbound POST and
  // work in every edition, so loading them must NOT be gated on the online
  // edition — that gate left the whole receiver list permanently empty in
  // offline builds (``pnpm dev`` and ``build:offline``). Only the WeChat MP card
  // below stays online-only, since it needs a public account to obtain an openid.
  const loadChannels = async () => {
    setLoadingChannels(true)
    try {
      const res = await api.api.v1UsersNotifyChannelsList()
      if (res.data?.code === 0 && res.data?.data) {
        setChannels(res.data.data)
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.loadChannelsFailed"))
    } finally {
      setLoadingChannels(false)
    }
  }

  useEffect(() => {
    loadChannels()
  }, [])

  const resetForm = () => {
    setFormType("webhook")
    setFormName("")
    setFormWebhookUrl("")
    setFormSecret("")
    setEditingChannel(null)
  }

  const openAddDialog = () => {
    resetForm()
    setAddDialogOpen(true)
  }

  const openEditDialog = (ch: DomainNotifyChannel) => {
    setEditingChannel(ch)
    setFormType(fromApiKind(ch.kind))
    setFormName(ch.name ?? "")
    setFormWebhookUrl(ch.webhook_url ?? "")
    setFormSecret("")
    setAddDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error(t("consoleSettings.notifications.toast.nameRequired"))
      return
    }
    if (!formWebhookUrl.trim()) return
    const name = formName.trim()

    setSaving(true)
    try {
      if (editingChannel?.id) {
        const res = await api.api.v1UsersNotifyChannelsUpdate(
          editingChannel.id,
          {
            name,
            webhook_url: formWebhookUrl.trim(),
            ...(formSecret.trim() && { secret: formSecret.trim() }),
          }
        )
        if (res.data?.code === 0) {
          toast.success(t("consoleSettings.notifications.toast.saveSuccess"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.saveFailed"))
        }
      } else {
        const res = await api.api.v1UsersNotifyChannelsCreate({
          kind: toApiKind(formType),
          name,
          webhook_url: formWebhookUrl.trim(),
          ...(formSecret.trim() && { secret: formSecret.trim() }),
        })
        if (res.data?.code === 0) {
          toast.success(t("consoleSettings.notifications.toast.addSuccess"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.addFailed"))
        }
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.operationFailed"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (ch: DomainNotifyChannel) => {
    setChannelToDelete(ch)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!channelToDelete?.id) return
    setDeleting(true)
    try {
      const res = await api.api.v1UsersNotifyChannelsDelete(channelToDelete.id)
      if (res.data?.code === 0) {
        toast.success(t("consoleSettings.notifications.toast.removeSuccess"))
        setChannelToDelete(null)
        setDeleteDialogOpen(false)
        loadChannels()
      } else {
        toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.removeFailed"))
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.removeFailed"))
    } finally {
      setDeleting(false)
    }
  }

  const handleTest = async (ch: DomainNotifyChannel) => {
    if (!ch.id) return
    setTestingId(ch.id)
    try {
      const res = await api.api.v1UsersNotifyChannelsTestCreate(ch.id)
      if (res.data?.code === 0) {
        toast.success(t("consoleSettings.notifications.toast.testSent"))
      } else {
        toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.testFailed"))
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.testFailed"))
    } finally {
      setTestingId(null)
    }
  }

  const listChannels = () => (
    <ItemGroup className="flex flex-col gap-4">
      {channels.map((ch) => {
        // Notify center: built-in channel, no webhook/secret, cannot be renamed
        // or removed — it is only ever bound/unbound from the event editor.
        const builtin = ch.kind === ConstsNotifyChannelKind.NotifyChannelNotifyCenter
        return (
        <Item key={ch.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden sm:flex">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {builtin ? <Bell className="size-4" /> : getReceiverTypeIcon(fromApiKind(ch.kind))}
            </div>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{ch.name ?? t("consoleSettings.notifications.fallback.unnamed")}</ItemTitle>
            <ItemDescription className="break-all">
              {builtin
                ? t("consoleSettings.notifications.notifyCenter.description")
                : ch.webhook_url || getReceiverTypeLabel(fromApiKind(ch.kind))}
            </ItemDescription>
          </ItemContent>
          {builtin ? null : (
          <ItemActions>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTest(ch)}
              disabled={!!testingId}
            >
              {testingId === ch.id ? <Spinner className="size-4" /> : t("consoleSettings.notifications.actions.test")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog(ch)}>
                  <IconPencil />
                  {t("consoleSettings.notifications.actions.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(ch)}
                >
                  <IconTrash />
                  {t("consoleSettings.notifications.actions.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
          )}
        </Item>
      )})}
    </ItemGroup>
  )

  const loadingContent = (
    <Empty className="min-h-full border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner className="size-6" />
        </EmptyMedia>
      </EmptyHeader>
      <EmptyContent>
        <EmptyDescription>{t("consoleSettings.notifications.loading")}</EmptyDescription>
      </EmptyContent>
    </Empty>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <Bell />
            {t("consoleSettings.notifications.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.notifications.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddDialog}
        >
          <CirclePlus className="size-4" />
          {t("consoleSettings.notifications.actions.addReceiver")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingChannels ? (
          loadingContent
        ) : channels.length > 0 ? (
          listChannels()
        ) : (
          <Empty className="min-h-full border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bell className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                {t("consoleSettings.notifications.empty")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingChannel ? t("consoleSettings.notifications.dialog.editTitle") : t("consoleSettings.notifications.dialog.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.receiverType")}</Label>
              <Select
                value={formType}
                onValueChange={(v) => setFormType(v as ReceiverType)}
                disabled={!!editingChannel}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECEIVER_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        {opt.icon}
                        {getReceiverTypeLabel(opt.value)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingChannel && (
                <p className="text-xs text-muted-foreground">{t("consoleSettings.notifications.receiverTypeLocked")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.name")}</Label>
              <Input
                placeholder={t("consoleSettings.notifications.placeholders.name", { receiver: getReceiverTypeLabel(formType) })}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {formType === "webhook" ? t("consoleSettings.notifications.labels.webhookUrl") : t("consoleSettings.notifications.labels.robotWebhookUrl")}
              </Label>
              <Input
                placeholder="https://..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.secret")}</Label>
              <Input
                type="password"
                placeholder={t("consoleSettings.notifications.placeholders.secret")}
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("consoleSettings.notifications.secretDescription")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              {t("consoleSettings.notifications.actions.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !formName.trim() ||
                !formWebhookUrl.trim() ||
                saving
              }
            >
              {saving ? <Spinner className="size-4" /> : editingChannel ? t("consoleSettings.notifications.actions.save") : t("consoleSettings.notifications.actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleSettings.notifications.remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleSettings.notifications.remove.description", { name: channelToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChannelToDelete(null)} disabled={deleting}>
              {t("consoleSettings.notifications.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner className="size-4" /> : t("consoleSettings.notifications.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
