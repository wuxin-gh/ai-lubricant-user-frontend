import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainGitIdentity } from "@/api/Api"
import { ConstsGitPlatform } from "@/api/Api"
import Icon from "@/components/common/Icon"
import GitTokenHelp from "@/components/console/settings/git-token-help"
import { useTranslation } from "react-i18next"

interface EditIdentityProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  identity: DomainGitIdentity | null
  onRefresh?: () => void
  trigger?: React.ReactNode
}

export default function EditIdentity({
  open,
  onOpenChange,
  identity,
  onRefresh,
  trigger,
}: EditIdentityProps) {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform | "">("")

  const isInstallationApp = identity?.is_installation_app === true

  useEffect(() => {
    if (identity) {
      setBaseUrl(identity.base_url || "")
      setRemark(identity.remark || "")
      setPlatform(identity.platform || "")
      setAccessToken(identity.access_token || "")
    }
  }, [identity])

  const handleSave = () => {
    if (!identity?.id) {
      toast.error(t("consoleSettings.identities.toast.incomplete"))
      return
    }

    if (!baseUrl.trim()) {
      toast.error(t("consoleSettings.identities.toast.baseUrlRequired"))
      return
    }
    if (!platform) {
      toast.error(t("consoleSettings.identities.toast.platformRequired"))
      return
    }

    // username / email are deliberately absent: the username is a display label
    // the server derives from the host (git_service._fill_identity_username) and
    // re-derives whenever the token changes, so it is not user-editable; nothing
    // consumes an email. Omitting them also leaves any stored value untouched.
    const updateData: {
      access_token?: string
      base_url: string
      platform: ConstsGitPlatform
      remark?: string
    } = {
      base_url: baseUrl.trim(),
      platform: platform as ConstsGitPlatform,
      remark: remark.trim(),
    }

    // The server never returns the plaintext access token (only the masked form),
    // so an empty field means "keep the stored token" — omit it from the payload
    // and update_identity leaves it untouched. Send a new value only when typed.
    if (accessToken.trim()) {
      updateData.access_token = accessToken.trim()
    }

    apiRequest('v1UsersGitIdentitiesUpdate', updateData, [identity.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.identities.toast.updateSuccess"))
        setAccessToken("")
        setBaseUrl("")
        setRemark("")
        setPlatform("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("consoleSettings.identities.toast.updateFailed", { message: resp.message }))
      }
    })
  }

  const handleCancel = () => {
    setAccessToken("")
    setBaseUrl("")
    setRemark("")
    setPlatform("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.identities.edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>{t("consoleSettings.identities.labels.platformType")}</FieldLabel>
              <FieldContent>
                <Select
                  value={platform}
                  onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}
                  disabled
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleSettings.identities.placeholders.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGithub}>
                      <Icon name="GitHub-Uncolor" className="fill-foreground" />GitHub
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitLab}>
                      <Icon name="GitLab" />GitLab
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitea}>
                      <Icon name="Gitea" />Gitea
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitee}>
                      <Icon name="Gitee" />Gitee
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
            <Field className="flex-[2]">
              <FieldLabel>{t("consoleSettings.identities.labels.platformUrl")}</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("consoleSettings.identities.placeholders.githubUrl")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  disabled
                />
              </FieldContent>
            </Field>
          </div>
          {!isInstallationApp && (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Access Token</FieldLabel>
                <GitTokenHelp platform={platform} />
              </div>
              <FieldContent>
                <Input
                  placeholder={t("consoleSettings.identities.placeholders.keepToken")}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </FieldContent>
            </Field>
          )}
          <Field>
            <FieldLabel>{t("consoleSettings.identities.labels.remark")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.identities.placeholders.optional")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleSettings.identities.actions.cancel")}
          </Button>
          <Button onClick={handleSave}>
            {t("consoleSettings.identities.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
