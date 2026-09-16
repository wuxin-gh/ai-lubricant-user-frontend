import { CircleQuestionMark } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ConstsGitPlatform } from "@/api/Api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Keyed loosely (Record<string, string>) rather than by enum value so the
// empty-string "no platform selected" state indexes the same maps.
const PLATFORM_KEYS: Record<string, string> = {
  [ConstsGitPlatform.GitPlatformGithub]: "github",
  [ConstsGitPlatform.GitPlatformGitLab]: "gitlab",
  [ConstsGitPlatform.GitPlatformGitea]: "gitea",
  [ConstsGitPlatform.GitPlatformGitee]: "gitee",
  [ConstsGitPlatform.GitPlatformCodeup]: "codeup",
  [ConstsGitPlatform.GitPlatformCnb]: "cnb",
  [ConstsGitPlatform.GitPlatformAtomgit]: "atomgit",
}

const PLATFORM_LABELS: Record<string, string> = {
  [ConstsGitPlatform.GitPlatformGithub]: "GitHub",
  [ConstsGitPlatform.GitPlatformGitLab]: "GitLab",
  [ConstsGitPlatform.GitPlatformGitea]: "Gitea",
  [ConstsGitPlatform.GitPlatformGitee]: "Gitee",
  [ConstsGitPlatform.GitPlatformCodeup]: "Codeup",
  [ConstsGitPlatform.GitPlatformCnb]: "CNB",
  [ConstsGitPlatform.GitPlatformAtomgit]: "AtomGit",
}

export default function GitTokenHelp({ platform }: { platform: ConstsGitPlatform | "" }) {
  const { t } = useTranslation()
  const platformKey = PLATFORM_KEYS[platform]
  const platformLabel = PLATFORM_LABELS[platform]
  const prefix = platformKey
    ? `consoleSettings.identities.help.platforms.${platformKey}`
    : ""

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={t("consoleSettings.identities.help.howToGet")}
        >
          <CircleQuestionMark className="size-3.5" />
          {t("consoleSettings.identities.help.howToGet")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        {platformKey ? (
          <div className="flex flex-col gap-3 text-xs">
            <p className="font-medium">
              {t("consoleSettings.identities.help.title", { platform: platformLabel })}
            </p>
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-muted-foreground">
                {t("consoleSettings.identities.help.stepsLabel")}
              </p>
              <p className="whitespace-pre-line leading-5">
                {t(`${prefix}.steps`)}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-muted-foreground">
                {t("consoleSettings.identities.help.addressLabel")}
              </p>
              <code className="break-all rounded bg-muted px-2 py-1 text-[11px]">
                {t(`${prefix}.address`)}
              </code>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-muted-foreground">
                {t("consoleSettings.identities.help.permissionsLabel")}
              </p>
              <p className="whitespace-pre-line leading-5">
                {t(`${prefix}.permissions`)}
              </p>
            </div>
            <p className="border-t pt-2 leading-5 text-muted-foreground">
              {t("consoleSettings.identities.help.securityHint")}
            </p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("consoleSettings.identities.help.selectPlatform")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
