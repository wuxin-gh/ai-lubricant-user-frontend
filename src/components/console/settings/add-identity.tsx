import { useState, useEffect } from "react"
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
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { ConstsGitPlatform } from "@/api/Api"
import Icon from "@/components/common/Icon"
import GitTokenHelp from "@/components/console/settings/git-token-help"
import { useTranslation } from "react-i18next"

interface AddIdentityProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddIdentity({
  open,
  onOpenChange,
  onRefresh,
}: AddIdentityProps) {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform | "">("")

  // Set a default Base URL for the selected platform; users can still edit it for self-hosted instances.
  useEffect(() => {
    if (platform) {
      switch (platform) {
        case ConstsGitPlatform.GitPlatformGithub:
          // GitHub's REST API lives on api.github.com, not on the web host
          // (github.com serves no /api/v3). git_clients._github_api_base now
          // maps the web host across, but pre-fill the API host so the value
          // shown is what the field actually means.
          setBaseUrl("https://api.github.com")
          break
        case ConstsGitPlatform.GitPlatformGitLab:
          setBaseUrl("https://gitlab.com")
          break
        case ConstsGitPlatform.GitPlatformGitea:
          setBaseUrl("https://gitea.com")
          break
        case ConstsGitPlatform.GitPlatformGitee:
          setBaseUrl("https://gitee.com")
          break
        case ConstsGitPlatform.GitPlatformCodeup:
          setBaseUrl("https://openapi-rdc.aliyuncs.com")
          break
        case ConstsGitPlatform.GitPlatformCnb:
          setBaseUrl("https://api.cnb.cool")
          break
        case ConstsGitPlatform.GitPlatformAtomgit:
          setBaseUrl("https://api.atomgit.com")
          break
        default:
          setBaseUrl("")
      }
    } else {
      setBaseUrl("")
    }
  }, [platform])

  const handleSave = () => {
    // Validate platform first: the baseUrl default is derived from the selected
    // platform, so reporting "missing token" before "missing platform" misleads
    // a user who simply hasn't picked one yet.
    if (!platform) {
      toast.error(t("consoleSettings.identities.toast.platformRequired"))
      return
    }
    if (!accessToken.trim()) {
      toast.error(t("consoleSettings.identities.toast.accessTokenRequired"))
      return
    }
    if (!baseUrl.trim()) {
      toast.error(t("consoleSettings.identities.toast.baseUrlRequired"))
      return
    }

    // username / email are not asked for: the username is a display label the
    // server resolves from the host (git_service._fill_identity_username), and
    // nothing consumes an email. See edit-identity.tsx for the same rationale.
    apiRequest('v1UsersGitIdentitiesCreate', {
      access_token: accessToken.trim(),
      base_url: baseUrl.trim(),
      platform: platform as ConstsGitPlatform,
      remark: remark.trim() || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.identities.toast.addSuccess"))
        setAccessToken("")
        setBaseUrl("")
        setRemark("")
        setPlatform("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("consoleSettings.identities.toast.addFailed", { message: resp.message }))
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.identities.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>{t("consoleSettings.identities.labels.platformType")}</FieldLabel>
              <FieldContent>
                <Select value={platform} onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}>
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
                  placeholder={t("consoleSettings.identities.placeholders.gitlabUrl")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>
          <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>Access Token</FieldLabel>
                  <GitTokenHelp platform={platform} />
                </div>
                <FieldContent>
                  <Input
                    placeholder={t("consoleSettings.identities.placeholders.accessToken")}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                  />
                </FieldContent>
              </Field>
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
