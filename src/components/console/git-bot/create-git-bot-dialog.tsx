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
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState } from "react"
import { ConstsGitPlatform } from "@/api/Api"
import { sharedApi } from "@/api/shared-api"
import { toast } from "sonner"
import type { DomainGitBot } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useTranslation } from "react-i18next"

// 宿主机/开发环境已下线（运行时改为 agent-compose 节点）。git-bot 仍需一个
// host_id 落库，统一走内置 "public_host"，不再提供宿主机选择。
const GIT_BOT_HOST_ID = "public_host"

interface CreateGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (bot: DomainGitBot) => void
}

export function CreateGitBotDialog({ open, onOpenChange, onSuccess }: CreateGitBotDialogProps) {
  const { t } = useTranslation()
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [accessToken, setAccessToken] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!accessToken) {
      toast.error(t("consoleGitBot.toast.missingAccessToken"))
      return
    }
    
    setLoading(true)
    try {
      const api = sharedApi
      const res = await api.api.v1UsersGitBotsCreate({
        host_id: GIT_BOT_HOST_ID,
        name: remark || undefined,
        token: accessToken,
        platform: platform,
      })
      if (res.data.code === 0) {
        toast.success(t("consoleGitBot.toast.createSuccess"))
        onOpenChange(false)
        setRemark("")
        setPlatform(ConstsGitPlatform.GitPlatformGitLab)
        setAccessToken("")
        if (res.data.data && onSuccess) {
          onSuccess(res.data.data)
        }
      } else {
        toast.error(res.data.message || t("consoleGitBot.toast.createFailed"))
      }
    } catch {
      toast.error(t("consoleGitBot.toast.createFailed"))
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setRemark("")
    setPlatform(ConstsGitPlatform.GitPlatformGitLab)
    setAccessToken("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleGitBot.dialog.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("consoleGitBot.dialog.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t("consoleGitBot.fields.remark")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleGitBot.placeholders.remark")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
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
                placeholder={t("consoleGitBot.placeholders.accessToken")}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleGitBot.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? t("consoleGitBot.actions.creating") : t("consoleGitBot.actions.createShort")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
