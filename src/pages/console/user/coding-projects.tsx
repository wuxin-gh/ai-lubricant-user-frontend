/**
 * 切换项目 / 项目管理页（Coding 模式的落地页，也是侧栏「切换项目」弹框的内容）。
 *
 * 卡片墙：每张卡显示项目信息（名称、仓库、技术栈）并直接带项目操作（编辑、删除、
 * 打开仓库）。点卡片本身 = 切换到这个项目。
 *
 * 三个状态：
 *   1. 还没有 Git 身份 → 引导先加身份（没有身份就建不了项目，远端仓库要凭证）。
 *   2. 有身份但没项目   → 引导创建第一个项目。
 *   3. 有项目           → 卡片墙。
 *
 * 「Git 身份」按钮打开 ManageProjectsDialog（按 Git 平台身份管理凭证与关联项目）。
 * 本页不再有「管理项目」按钮——项目本身的增删改就在卡片上。
 *
 * 同一份内容两处复用：/coding/projects 整页渲染，侧栏「切换项目」按钮弹框渲染。
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ExternalLink,
  FolderGit2,
  FolderPlus,
  GitBranch,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { useCurrentProject } from "@/components/console/current-project-context"
import ManageProjectsDialog from "@/components/console/project/manage-projects-dialog"
import AddIdentity from "@/components/console/settings/add-identity"
import AddProjectDialog from "@/components/console/project/add-project"
import EditProjectNameDialog from "@/components/console/project/edit-project-name"
import { StackBadges } from "@/components/ui/stack-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { getGitPlatformIcon } from "@/utils/common"

interface CodingProjectsContentProps {
  /** 选中项目后回调（弹框用它关闭自己；整页渲染时不传）。 */
  onPicked?: () => void
}

export function CodingProjectsContent({ onPicked }: CodingProjectsContentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    projects,
    identities,
    loadingProjects,
    loadingIdentities,
    reloadProjects,
    reloadIdentities,
  } = useCommonData()
  const { projectId: currentProjectId } = useCurrentProject()

  const [gitIdentitiesOpen, setGitIdentitiesOpen] = useState(false)
  const [addIdentityOpen, setAddIdentityOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<DomainProject | null>(null)
  const [deletingProject, setDeletingProject] = useState<DomainProject | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loading = loadingProjects || loadingIdentities

  const pick = (project: DomainProject) => {
    if (!project.id) return
    // 「当前项目」由 CurrentProjectProvider 按 URL 统一记录（侧栏按钮与面包屑共用），
    // 这里只负责跳转，避免两处写同一份状态。
    navigate(`/coding/project/${project.id}`)
    onPicked?.()
  }

  const confirmDelete = async () => {
    const projectId = deletingProject?.id
    if (!projectId) return
    setDeleting(true)
    await apiRequest("v1UsersProjectsDelete", {}, [projectId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.delete.toast.deleted"))
        setDeletingProject(null)
        void reloadProjects()
      } else {
        toast.error(resp.message || t("consoleProject.delete.toast.deleteFailed"))
      }
    })
    setDeleting(false)
  }

  if (loading && projects.length === 0 && identities.length === 0) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex min-h-64 items-center justify-center">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
              <EmptyTitle>{t("codingProjects.loading")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  // 状态 1：没有 Git 身份。没有身份就无法在远端建仓/访问仓库，先引导这一步。
  if (identities.length === 0) {
    return (
      <>
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitBranch className="size-6" />
            </EmptyMedia>
            <EmptyTitle>{t("codingProjects.noIdentity.title")}</EmptyTitle>
            <EmptyDescription>{t("codingProjects.noIdentity.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAddIdentityOpen(true)}>
              <Plus className="size-4" />
              {t("codingProjects.noIdentity.action")}
            </Button>
          </EmptyContent>
        </Empty>
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

  // 状态 2：有身份但还没有项目 —— 引导创建第一个。
  if (projects.length === 0) {
    return (
      <>
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderGit2 className="size-6" />
            </EmptyMedia>
            <EmptyTitle>{t("codingProjects.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("codingProjects.empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAddProjectOpen(true)}>
              <FolderPlus className="size-4" />
              {t("codingProjects.empty.action")}
            </Button>
          </EmptyContent>
        </Empty>
        <AddProjectDialog
          open={addProjectOpen}
          onOpenChange={setAddProjectOpen}
          onSuccess={() => {
            void reloadProjects()
          }}
        />
      </>
    )
  }

  // 状态 3：项目卡片墙。
  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            {t("codingProjects.description")}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setGitIdentitiesOpen(true)}>
              <GitBranch className="size-4" />
              {t("codingProjects.gitIdentities")}
            </Button>
            <Button size="sm" onClick={() => setAddProjectOpen(true)}>
              <FolderPlus className="size-4" />
              {t("codingProjects.create")}
            </Button>
          </div>
        </div>

        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {projects.map((project) => {
            const identity = identities.find((item) => item.id === project.git_identity_id)
            const isCurrent = !!project.id && project.id === currentProjectId
            const taskCount = project.tasks?.length ?? 0
            return (
              <Card
                key={project.id}
                className="group cursor-pointer gap-3 shadow-none transition-colors hover:border-primary/50 data-[current=true]:border-primary"
                data-current={isCurrent}
                onClick={() => pick(project)}
              >
                <CardHeader className="gap-1.5">
                  <CardTitle className="flex min-w-0 items-center gap-2 font-normal group-hover:text-primary">
                    <FolderGit2 className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">
                      {project.name || project.full_name || t("codingProjects.unnamed")}
                    </span>
                    {isCurrent ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t("codingProjects.current")}
                      </Badge>
                    ) : null}
                    {/* 操作菜单：阻止冒泡，避免点操作时同时触发「切换到这个项目」。 */}
                    <div onClick={(event) => event.stopPropagation()} className="shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingProject(project)}>
                            <Pencil className="size-4" />
                            {t("codingProjects.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeletingProject(project)}
                          >
                            <Trash2 className="size-4" />
                            {t("codingProjects.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardTitle>
                  <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="shrink-0">{getGitPlatformIcon(identity?.platform ?? project.platform)}</span>
                    <span className="min-w-0 truncate">{project.full_name || project.repo_url || "—"}</span>
                    {project.repo_url ? (
                      <a
                        href={project.repo_url}
                        target="_blank"
                        rel="noreferrer"
                        title={t("codingProjects.openRepo")}
                        className="shrink-0 hover:text-primary"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                  {/* 项目描述：卡片带上它，切换时不用点进去才知道是哪个项目。 */}
                  <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
                    {project.description || t("codingProjects.noDescription", "暂无描述")}
                  </p>
                </CardHeader>
                <CardContent className="flex min-h-6 flex-wrap items-center gap-1.5">
                  <StackBadges
                    stack={project.stack}
                    max={3}
                    truncatedTitle={t("consoleProject.stack.truncatedWarning")}
                  />
                  {taskCount > 0 ? (
                    <Badge variant="outline" className="shrink-0">
                      {t("codingProjects.taskCount", { count: taskCount })}
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <ManageProjectsDialog open={gitIdentitiesOpen} onOpenChange={setGitIdentitiesOpen} />
      <AddProjectDialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        onSuccess={() => {
          void reloadProjects()
        }}
      />
      <EditProjectNameDialog
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        project={editingProject ?? undefined}
        onSuccess={() => {
          void reloadProjects()
        }}
      />
      <AlertDialog open={!!deletingProject} onOpenChange={(open) => !open && setDeletingProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleProject.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleProject.delete.description", { name: deletingProject?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("consoleProject.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {t("consoleProject.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** 整页形态：/coding/projects 与 /coding（无项目时）渲染它。 */
export default function CodingProjectsPage() {
  return <CodingProjectsContent />
}

/** 弹框形态：侧栏「切换项目」按钮打开它。 */
export function CodingProjectsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent 基础样式里是 `sm:max-w-md`——宽度必须写成带 `sm:` 前缀的形式，
          否则 tailwind-merge 认为两者不是同一组（修饰符不同）会双双保留，而 ≥640px 时
          媒体查询里的 sm:max-w-md 排在后面胜出，写多少 max-w-* 都会被盖成 md。 */}
      <DialogContent className="w-[96vw] sm:max-w-[min(96vw,88rem)]">
        <DialogHeader>
          <DialogTitle>{t("codingProjects.switchTitle")}</DialogTitle>
          <DialogDescription>{t("codingProjects.switchDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <CodingProjectsContent onPicked={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
