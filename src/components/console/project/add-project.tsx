import {
  ConstsGitPlatform,
  type DomainAuthRepository,
  type DomainGitIdentity,
} from "@/api/Api"
import { Button } from "@/components/ui/button"
import { StackBadges } from "@/components/ui/stack-badges"
import { type DomainStackProfile } from "@/api/Api"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getGitPlatformIcon } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconCheck, IconChevronDown, IconGitBranch, IconLoader, IconReload } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { useIdentityRepos } from "@/hooks/useIdentityRepos"
import { createRepositoryForIdentity } from "@/api/editorClient"
import AddIdentity from "@/components/console/settings/add-identity"
import { useTranslation } from "react-i18next"

interface RepoOption {
  gitIdentityId: string
  username: string
  repository: DomainAuthRepository
}

/** 平台是否支持在本系统内直接远端建仓（与后端 CREATE_CAPABLE_PLATFORMS 对齐）。 */
const CREATE_CAPABLE_PLATFORMS: string[] = [
  ConstsGitPlatform.GitPlatformGithub,
  ConstsGitPlatform.GitPlatformGitLab,
  ConstsGitPlatform.GitPlatformGitea,
  ConstsGitPlatform.GitPlatformGitee,
]

/** 仓库来源：选择身份下已有仓库，或在远端新建一个仓库。 */
type RepoMode = "existing" | "new"

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /** 打开时预选的 Git 身份（来自「管理项目」弹框里某个身份块的「添加项目」）。 */
  initialIdentityId?: string
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  onSuccess,
  initialIdentityId,
}: AddProjectDialogProps) {
  const [name, setName] = useState("")
  const [nameAutoFilled, setNameAutoFilled] = useState(true)
  // 团队共享：开启后同团队成员可访问该项目（除删除/授权外可操作）；
  // 默认关闭 = 仅自己 + 显式协作者可见。
  const [isTeamShared, setIsTeamShared] = useState(false)
  const [selectedSource, setSelectedSource] = useState<string>("")
  const [selectedRepoValue, setSelectedRepoValue] = useState("")
  // 持久化已选仓库，避免分页/搜索后当前页不含它时标签丢失
  const [selectedRepoOption, setSelectedRepoOption] = useState<RepoOption | null>(null)
  const [repoMode, setRepoMode] = useState<RepoMode>("existing")
  const [newRepoName, setNewRepoName] = useState("")
  const [newRepoDescription, setNewRepoDescription] = useState("")
  const [newRepoPrivate, setNewRepoPrivate] = useState(true)
  const [newRepoOwner, setNewRepoOwner] = useState("")
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [addIdentityOpen, setAddIdentityOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [onboarding, setOnboarding] = useState<{ id: string; name: string; description?: string } | null>(null)
  const [onboardingStack, setOnboardingStack] = useState<DomainStackProfile | null>(null)
  const [stackScanning, setStackScanning] = useState(false)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const { identities, reloadIdentities } = useCommonData()

  // 打开创建项目弹框时若用户还没有任何 Git 身份，直接弹出绑定 Git 账号弹框，
  // 免得让用户先看到空身份态、再点跳转。绑完返回这里能就地刷新身份列表。
  useEffect(() => {
    if (open && identities.length === 0) {
      setAddIdentityOpen(true)
    }
  }, [open, identities.length])

  // 从「管理项目」弹框某身份块打开时预选该身份；仅在打开瞬间应用一次。
  useEffect(() => {
    if (open && initialIdentityId) {
      setSelectedSource(initialIdentityId)
    }
  }, [open, initialIdentityId])

  const selectedIdentityId = selectedSource

  const selectedIdentity = useMemo(
    () => identities.find((i) => i.id === selectedIdentityId),
    [identities, selectedIdentityId]
  )

  const {
    repos,
    loading: loadingIdentityRepos,
    loadingMore,
    hasNext,
    total,
    keyword,
    setKeyword,
    loadMore,
    reload,
  } = useIdentityRepos(selectedIdentityId, { enabled: open && !!selectedIdentityId })

  const identityRepoOptions = useMemo<RepoOption[]>(() => {
    if (!selectedIdentityId) return []
    const username =
      selectedIdentity?.username ||
      selectedIdentity?.remark ||
      t("consoleProject.create.unnamedIdentity")
    return repos
      .filter((repo) => repo.url?.trim())
      .map((repo) => ({ gitIdentityId: selectedIdentityId, username, repository: repo }))
  }, [repos, selectedIdentity, selectedIdentityId, t])

  const selectedRepoLabel = selectedRepoOption
    ? (selectedRepoOption.repository.full_name || selectedRepoOption.repository.url || "").replace(
        `${selectedRepoOption.username}/`,
        ""
      )
    : ""

  const identityLabel = (identity: DomainGitIdentity) =>
    identity.remark || identity.username || identity.base_url || t("consoleProject.create.unnamedIdentity")

  // 当前身份平台是否支持远端建仓；不支持时隐藏「新建仓库」入口并回落到「已有仓库」。
  const canCreateRepo = useMemo(
    () => !!selectedIdentity && CREATE_CAPABLE_PLATFORMS.includes(selectedIdentity.platform as ConstsGitPlatform),
    [selectedIdentity]
  )

  useEffect(() => {
    if (!canCreateRepo && repoMode === "new") {
      setRepoMode("existing")
    }
  }, [canCreateRepo, repoMode])

  // 切换身份时清空已选仓库与新建仓库表单（仓库列表由 useIdentityRepos 自动重拉）
  useEffect(() => {
    setSelectedRepoValue("")
    setSelectedRepoOption(null)
    setNewRepoName("")
    setNewRepoDescription("")
    setNewRepoOwner("")
    setNewRepoPrivate(true)
  }, [selectedIdentityId])

  useEffect(() => {
    if (!nameAutoFilled) return
    if (repoMode === "new" && newRepoName.trim()) {
      setName(newRepoName.trim())
      return
    }
    const repositoryName = (selectedRepoOption?.repository.full_name || "").split("/").filter(Boolean).pop()
    if (repositoryName) setName(repositoryName)
  }, [nameAutoFilled, newRepoName, repoMode, selectedRepoOption])

  const openOnboarding = async (projectId: string, projectName: string) => {
    try {
      setOnboarding({ id: projectId, name: projectName })
      setOnboardingStack(null)
      setStackScanning(true)
    } catch {
      navigate(`/console/project/${projectId}`)
    }
  }

  // 建项目后异步扫技术栈；onboarding 弹框展示识别结果。后端 fire-and-forget
  // 扫描，前端轮询 GET /stack（1.5s × 10，拿到非空即停；关框即停）。
  useEffect(() => {
    if (!onboarding?.id) return
    const controller = new AbortController()
    let attempts = 0
    let timer: number | undefined
    const maxAttempts = 10
    const poll = () => {
      attempts += 1
      apiRequest(
        "v1UsersProjectsStackDetail",
        {},
        [onboarding.id],
        (resp) => {
          if (controller.signal.aborted) return
          const stack = resp?.data?.stack
          if (stack) {
            setOnboardingStack(stack)
            setStackScanning(false)
          } else if (attempts < maxAttempts) {
            timer = window.setTimeout(poll, 1500)
          } else {
            setStackScanning(false)
          }
        },
        () => {
          if (!controller.signal.aborted && attempts < maxAttempts) {
            timer = window.setTimeout(poll, 1500)
          } else {
            setStackScanning(false)
          }
        },
        null,
        controller.signal,
      )
    }
    timer = window.setTimeout(poll, 1500)
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [onboarding?.id])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("consoleProject.create.toast.nameRequired"))
      return
    }
    if (!selectedIdentityId) {
      toast.error(t("consoleProject.create.toast.identityRequired"))
      return
    }

    const createReq: {
      name: string
      description?: string
      platform?: ConstsGitPlatform
      git_identity_id?: string
      repo_url?: string
      is_team_shared?: boolean
    } = {
      name: name.trim(),
      platform: selectedIdentity?.platform as ConstsGitPlatform,
      git_identity_id: selectedIdentityId,
      is_team_shared: isTeamShared,
    }

    if (repoMode === "new") {
      // 先在远端真实建仓，拿到 canonical URL，再建本系统项目。
      const repoName = newRepoName.trim()
      if (!repoName) {
        toast.error(t("consoleProject.create.toast.newRepoNameRequired", "请填写新仓库名称"))
        return
      }
      setLoading(true)
      let repoUrl = ""
      try {
        const created = await createRepositoryForIdentity(selectedIdentityId, {
          name: repoName,
          description: newRepoDescription.trim() || undefined,
          private: newRepoPrivate,
          owner: newRepoOwner.trim() || undefined,
        })
        repoUrl = created.url
        // 新仓库需在下次列出时出现；刷新身份仓库缓存。
        reload(true)
        toast.success(t("consoleProject.create.toast.repoCreated", "远程仓库创建成功"))
      } catch (error) {
        setLoading(false)
        toast.error(
          error instanceof Error
            ? error.message
            : t("consoleProject.create.toast.repoCreateFailed", "创建远程仓库失败")
        )
        return
      }
      if (!repoUrl) {
        setLoading(false)
        toast.error(t("consoleProject.create.toast.repoCreateFailed", "创建远程仓库失败"))
        return
      }
      createReq.repo_url = repoUrl
    } else {
      if (!selectedRepoValue) {
        toast.error(t("consoleProject.create.toast.repositoryRequired"))
        return
      }
      const repo = selectedRepoOption
      if (!repo?.repository.url) {
        toast.error(t("consoleProject.create.toast.availableRepositoryRequired"))
        return
      }
      createReq.git_identity_id = repo.gitIdentityId
      createReq.repo_url = repo.repository.url
      setLoading(true)
    }

    await apiRequest(
      "v1UsersProjectsCreate",
      createReq,
      [],
      (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleProject.create.toast.created"))
          onOpenChange(false)
          resetForm()
          onSuccess?.()
          const projectId = resp.data?.id
          if (projectId) {
            void openOnboarding(projectId, name.trim())
          }
        } else {

          // 远端仓库可能已创建成功，仅本地建项目失败：提示用户仓库已存在，可重试。
          toast.error(
            repoMode === "new"
              ? t("consoleProject.create.toast.repoCreatedButProjectFailed", {
                  message: resp.message || "",
                  defaultValue: "远程仓库已创建，但项目创建失败，请重试（仓库已存在，无需重复新建）。{{message}}",
                })
              : resp.message || t("consoleProject.create.toast.createFailed")
          )
        }
      }
    )
    setLoading(false)
  }

  const resetForm = () => {
    setName("")
    setNameAutoFilled(true)
    setSelectedSource("")
    setSelectedRepoValue("")
    setSelectedRepoOption(null)
    setRepoMode("existing")
    setNewRepoName("")
    setNewRepoDescription("")
    setNewRepoOwner("")
    setNewRepoPrivate(true)
    setIsTeamShared(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
    resetForm()
  }

  const canSubmit =
    !!name.trim() &&
    !!selectedIdentityId &&
    (repoMode === "new" ? !!newRepoName.trim() : !!selectedRepoValue)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("consoleProject.create.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("consoleProject.create.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameAutoFilled(false) }}
              placeholder={t("consoleProject.create.namePlaceholder")}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("consoleProject.create.repository")}</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-foreground"
                  onClick={() => setAddIdentityOpen(true)}
                >
                  {t("consoleProject.create.addGitIdentity", "添加 Git 账号")}
                </Button>
              </div>
              {identities.length > 0 ? (
                <RadioGroup
                  value={selectedSource}
                  onValueChange={(v) => {
                    setSelectedSource(v)
                    setSelectedRepoValue("")
                    setSelectedRepoOption(null)
                  }}
                  className="grid grid-cols-2 gap-2"
                  disabled={loading}
                >
                  {identities.map((identity) => (
                    <label
                      key={identity.id}
                      htmlFor={`repo-source-${identity.id}`}
                      className={cn(
                        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/30",
                        selectedSource === identity.id && "text-primary"
                      )}
                    >
                      <RadioGroupItem
                        value={identity.id || ""}
                        id={`repo-source-${identity.id}`}
                        className="shrink-0"
                      />
                      {getGitPlatformIcon(identity.platform)}
                      <span className="truncate">{identityLabel(identity)}</span>
                    </label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-dashed bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    {t("consoleProject.create.noGitIdentity")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddIdentityOpen(true)}
                  >
                    {t("consoleProject.create.addGitIdentity", "添加 Git 账号")}
                  </Button>
                </div>
              )}
            </div>

            {selectedIdentityId ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={repoMode === "existing" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRepoMode("existing")}
                    disabled={loading}
                  >
                    {t("consoleProject.create.modeExisting", "选择已有仓库")}
                  </Button>
                  <Button
                    type="button"
                    variant={repoMode === "new" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRepoMode("new")}
                    disabled={loading || !canCreateRepo}
                    title={!canCreateRepo ? t("consoleProject.create.newRepoUnsupported", "当前 Git 平台暂不支持远端建仓") : undefined}
                  >
                    {t("consoleProject.create.modeNew", "新建远程仓库")}
                  </Button>
                </div>

                {repoMode === "new" ? (
                  <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                    <div className="grid gap-2">
                      <Label htmlFor="new-repo-name">{t("consoleProject.create.newRepoName", "仓库名称")}</Label>
                      <Input
                        id="new-repo-name"
                        value={newRepoName}
                        onChange={(e) => { setNewRepoName(e.target.value); if (nameAutoFilled) setName(e.target.value) }}
                        placeholder={t("consoleProject.create.newRepoNamePlaceholder", "例如：my-new-project")}
                        disabled={loading}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-repo-description">{t("consoleProject.create.newRepoDescription", "仓库描述（可选）")}</Label>
                      <Textarea
                        id="new-repo-description"
                        value={newRepoDescription}
                        onChange={(e) => setNewRepoDescription(e.target.value)}
                        placeholder={t("consoleProject.create.newRepoDescriptionPlaceholder", "简要说明这个仓库的用途")}
                        disabled={loading}
                        className="min-h-16"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-repo-owner">{t("consoleProject.create.newRepoOwner", "组织 / Namespace（可选）")}</Label>
                      <Input
                        id="new-repo-owner"
                        value={newRepoOwner}
                        onChange={(e) => setNewRepoOwner(e.target.value)}
                        placeholder={t("consoleProject.create.newRepoOwnerPlaceholder", "留空则创建在当前账户下")}
                        disabled={loading}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border bg-background p-3">
                      <div>
                        <Label>{t("consoleProject.create.newRepoPrivate", "私有仓库")}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t("consoleProject.create.newRepoPrivateHint", "关闭后创建公开仓库。")}
                        </p>
                      </div>
                      <Switch checked={newRepoPrivate} onCheckedChange={setNewRepoPrivate} disabled={loading} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label>{t("consoleProject.create.selectRepositoryLabel")}</Label>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen} modal={true}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={repoPopoverOpen}
                          className="w-full justify-between font-normal"
                          disabled={loading}
                        >
                          <span className={cn("truncate", !selectedRepoValue && "text-muted-foreground")}>
                            {selectedRepoValue
                              ? selectedRepoLabel
                              : loadingIdentityRepos
                                ? t("consoleProject.create.loadingRepositories")
                                : t("consoleProject.create.selectRepository")}
                          </span>
                          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder={t("consoleProject.create.searchRepository")}
                            value={keyword}
                            onValueChange={setKeyword}
                          />
                          <CommandList className="max-h-48 p-1">
                            {loadingIdentityRepos && identityRepoOptions.length === 0 ? (
                              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                                <Spinner />
                                {t("consoleProject.create.loadingRepositories")}
                              </div>
                            ) : identityRepoOptions.length === 0 ? (
                              keyword.trim() ? (
                                <CommandEmpty>{t("consoleProject.create.repositoryNotFound")}</CommandEmpty>
                              ) : (
                                <div className="p-4">
                                  <p className="mb-3 text-sm">
                                    {t("consoleProject.create.noRepositoriesDescription")}
                                  </p>
                                  <Button type="button" size="sm" onClick={() => reload()}>
                                    {t("consoleProject.common.retry")}
                                  </Button>
                                </div>
                              )
                            ) : (
                              <>
                                {identityRepoOptions.map((option) => {
                                  const value = `${option.gitIdentityId}:${option.repository.url || ""}`
                                  const repoName = (
                                    option.repository.full_name || option.repository.url || ""
                                  ).replace(`${option.username}/`, "")
                                  const desc = option.repository.description
                                  return (
                                    <CommandItem
                                      key={value}
                                      value={value}
                                      onSelect={() => {
                                        setSelectedRepoValue(value)
                                        setSelectedRepoOption(option)
                                        setNameAutoFilled(true)
                                        setRepoPopoverOpen(false)
                                      }}
                                      className={cn(
                                        "cursor-pointer flex flex-col items-start gap-0.5 py-1 [&>svg:last-child]:hidden",
                                        selectedRepoValue === value &&
                                          "bg-muted/50 data-[selected=true]:bg-muted/70"
                                      )}
                                    >
                                      <div className="flex items-center gap-2 w-full min-w-0">
                                        <IconGitBranch className="size-4 shrink-0" />
                                        <span className="truncate flex-1 text-sm">{repoName}</span>
                                        <IconCheck
                                          className={cn(
                                            "size-4 shrink-0",
                                            selectedRepoValue === value ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                      </div>
                                      <span
                                        className="text-xs text-muted-foreground truncate w-full pl-6"
                                        title={desc || undefined}
                                      >
                                        {desc || t("consoleProject.create.noDescription")}
                                      </span>
                                    </CommandItem>
                                  )
                                })}
                                {hasNext ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-center text-muted-foreground"
                                    disabled={loadingMore}
                                    onClick={() => loadMore()}
                                  >
                                    {loadingMore ? <Spinner className="size-4" /> : null}
                                    {t("consoleProject.create.loadMoreRepositories", {
                                      loaded: identityRepoOptions.length,
                                      total,
                                    })}
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => reload(true)}
                        disabled={loading || loadingIdentityRepos || !selectedIdentityId}
                        aria-label={t("consoleProject.create.refreshRepositoriesAria")}
                      >
                        <IconReload className={cn("size-4", loadingIdentityRepos && "animate-spin")} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* 团队共享：开启后同团队成员可访问本项目（可读写，但不能删项目/管协作者）。
              关闭时仍可事后单独把项目共享给某个人（项目详情的协作者管理）。 */}
          <div className="flex items-center justify-between rounded-md border bg-background p-3">
            <div>
              <Label>团队共享</Label>
              <p className="text-xs text-muted-foreground">
                开启后同团队成员可访问本项目；删除项目与协作者管理仍仅限创建者。
              </p>
            </div>
            <Switch checked={isTeamShared} onCheckedChange={setIsTeamShared} disabled={loading} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading || !canSubmit}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!onboarding} onOpenChange={(open) => {
      if (!open && onboarding) {
        const id = onboarding.id
        setOnboarding(null)
        navigate(`/console/project/${id}`)
      }
    }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>项目已创建：{onboarding?.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="font-medium">项目已可创建开发任务</p>
            <p className="mt-1 text-sm text-muted-foreground">进入项目后直接选择执行节点、父 API Key 和客户端；Task 持有独立运行时与工作区。</p>
          </div>
          <div className="grid gap-2">
            <Label>{t("consoleProject.stack.title")}</Label>
            {stackScanning ? (
              <p className="text-sm text-muted-foreground">{t("consoleProject.stack.scanning")}</p>
            ) : onboardingStack ? (
              <StackBadges
                stack={onboardingStack}
                truncatedTitle={t("consoleProject.stack.truncatedWarning")}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("consoleProject.stack.none")}</p>
            )}
          </div>
          <div className="grid gap-2"><Label>下一步</Label><p className="text-sm text-muted-foreground">进入项目的「任务」页创建和查看全部开发任务。</p></div>
        </div>
        <DialogFooter><Button onClick={() => { if (!onboarding) return; const id = onboarding.id; setOnboarding(null); navigate(`/console/project/${id}`) }}>进入项目管理</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AddIdentity
      open={addIdentityOpen}
      onOpenChange={setAddIdentityOpen}
      onRefresh={() => {
        void reloadIdentities()
      }}
    />
    </>
  )
}
