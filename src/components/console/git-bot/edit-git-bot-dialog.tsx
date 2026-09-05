import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainGitBot } from "@/api/Api"
import { ConstsGitPlatform } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useTranslation } from "react-i18next"

// 宿主机/开发环境已下线（运行时改为 agent-compose 节点）。git-bot 仍需一个
// host_id 落库，编辑时沿用原值、缺省走内置 "public_host"，不再提供宿主机选择。
interface EditGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: DomainGitBot | null
  onSuccess: () => void
}

export function EditGitBotDialog({ open, onOpenChange, bot, onSuccess }: EditGitBotDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && bot) {
      queueMicrotask(() => {
        setName(bot.name || "")
        setToken(bot.token || "")
        setPlatform(bot.platform || ConstsGitPlatform.GitPlatformGitLab)
      })
    }
  }, [open, bot])

  const handleSubmit = async () => {
    if (!bot?.id) {
      toast.error(t("consoleGitBot.toast.incompleteBot"))
      return
    }

    setLoading(true)
    await apiRequest('v1UsersGitBotsUpdate', {
      id: bot.id,
      host_id: bot.host?.id || "public_host",
      platform: platform,
      name: name || undefined,
      token: token || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleGitBot.toast.updateSuccess"))
        onOpenChange(false)
        onSuccess()
      } else {
        toast.error(t("consoleGitBot.toast.updateFailed", { message: resp.message }))
      }
    })
    setLoading(false)
  }

  const handleCancel = () => {
    setName("")
    setToken("")
    setPlatform(ConstsGitPlatform.GitPlatformGitLab)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleGitBot.dialog.editTitle")}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("consoleGitBot.fields.remarkName")}</FieldLabel>
          <FieldContent>
            <Input
              placeholder={t("consoleGitBot.placeholders.remarkName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>{t("consoleGitBot.fields.platform")}</FieldLabel>
          <FieldContent>
            <Select value={platform} onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("consoleGitBot.placeholders.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitLab}>
                  <Icon name="GitLab" />GitLab
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGithub}>
                  <Icon name="GitHub-Uncolor" />GitHub
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitee}>
                  <Icon name="Gitee" />Gitee
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitea}>
                  <Icon name="Gitea" />Gitea
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformCodeup}>
                  <Icon name="Codeup" />Codeup
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformCnb}>
                  <Icon name="Cnb" />CNB
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformAtomgit}>
                  <Icon name="GitCode" />GitCode
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Access Token</FieldLabel>
          <FieldContent>
            <Input
              type="password"
              placeholder={t("consoleGitBot.placeholders.keepToken")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleGitBot.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? t("consoleGitBot.actions.saving") : t("consoleGitBot.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
