import { useMemo, useState } from "react"
import { ExternalLink, FolderPlus, GitBranch, Plus, Settings2, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { type DomainGitIdentity, type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import AddIdentity from "@/components/console/settings/add-identity"
import EditIdentity from "@/components/console/settings/edit-identity"
import AddProjectDialog from "@/components/console/project/add-project"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Badge } from "@/components/ui/badge"
import { StackBadges } from "@/components/ui/stack-badges"
import { getGitPlatformIcon } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"

interface ManageProjectsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 项目与 Git 身份管理。
 *
 * 原「配置 → Git 身份」只展示凭证；这里按身份折叠，并把该身份下的项目放在同一块，
 * 块内直接提供「添加项目」。顶部「添加新项目」走现有完整 AddProjectDialog，可选已有
 * 远端仓库或新建远端仓库。
 */
export default function ManageProjectsDialog({ open, onOpenChange }: ManageProjectsDialogProps) {
  const { identities, projects, reloadIdentities, reloadProjects } = useCommonData()
  const [addIdentityOpen, setAddIdentityOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [initialIdentityId, setInitialIdentityId] = useState<string | undefined>(undefined)
  const [editingIdentity, setEditingIdentity] = useState<DomainGitIdentity | null>(null)
  const [identityToDelete, setIdentityToDelete] = useState<DomainGitIdentity | null>(null)
  const [deletingIdentity, setDeletingIdentity] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const projectsByIdentity = useMemo(() => {
    const groups = new Map<string, DomainProject[]>()
    projects.forEach((project) => {
      const id = project.git_identity_id || "__unbound__"
      const rows = groups.get(id) || []
      rows.push(project)
      groups.set(id, rows)
    })
    return groups
  }, [projects])

  function openAddProject(identityId?: string) {
    setInitialIdentityId(identityId)
    setAddProjectOpen(true)
  }

  async function deleteIdentity() {
    if (!identityToDelete?.id) return
    setDeletingIdentity(true)
    try {
      await new Promise<void>((resolve, reject) => {
        void apiRequest(
          "v1UsersGitIdentitiesDelete",
          {},
          [identityToDelete.id as string],
          (response) => {
            if (response.code === 0) resolve()
            else reject(new Error(response.message || "删除 Git 身份失败"))
          },
          reject,
        )
      })
      toast.success("Git 身份已删除")
      setIdentityToDelete(null)
      await reloadIdentities()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 Git 身份失败")
    } finally {
      setDeletingIdentity(false)
    }
  }

  function identityLabel(identity: DomainGitIdentity) {
    return identity.remark || identity.username || identity.base_url || "未命名身份"
  }

  function projectRows(identityId: string): DomainProject[] {
    return projectsByIdentity.get(identityId) || []
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[78vh] max-h-[92vh] w-[96vw] max-w-3xl flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>管理项目</DialogTitle>
            <DialogDescription>按 Git 平台身份查看凭证与关联项目，并在对应身份下创建项目。</DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b pb-3">
            <span className="text-sm text-muted-foreground">{identities.length} 个 Git 身份 · {projects.length} 个项目</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddIdentityOpen(true)}>
                <Plus className="size-4" />添加 Git 身份
              </Button>
              <Button size="sm" onClick={() => openAddProject()}>
                <FolderPlus className="size-4" />添加新项目
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {identities.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
                <GitBranch className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">还没有 Git 平台身份，请先添加身份。</p>
                <Button variant="outline" size="sm" onClick={() => setAddIdentityOpen(true)}><Plus className="size-4" />添加 Git 身份</Button>
              </div>
            ) : (
              <div className="space-y-2 py-3">
                {identities.map((identity) => {
                  const id = identity.id || ""
                  const rows = projectRows(id)
                  const isOpen = expanded[id] ?? rows.length > 0
                  return (
                    <Collapsible key={id} open={isOpen} onOpenChange={(value) => setExpanded((current) => ({ ...current, [id]: value }))}>
                      <div className="rounded-lg border">
                        <div className="flex items-center gap-2 p-3">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-2 px-1">
                              <span className="shrink-0 text-muted-foreground">{isOpen ? "⌄" : "›"}</span>
                              <span className="shrink-0">{getGitPlatformIcon(identity.platform)}</span>
                              <span className="min-w-0 truncate font-medium">{identityLabel(identity)}</span>
                              <Badge variant="secondary" className="shrink-0">{identity.platform || "Git"}</Badge>
                              <span className="shrink-0 text-xs text-muted-foreground">{rows.length} 个项目</span>
                            </Button>
                          </CollapsibleTrigger>
                          <Button variant="ghost" size="icon" className="size-8" title="编辑凭证" onClick={() => setEditingIdentity(identity)}><Settings2 className="size-4" /></Button>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" title="删除凭证" onClick={() => setIdentityToDelete(identity)}><Trash2 className="size-4" /></Button>
                        </div>
                        <CollapsibleContent>
                          <div className="border-t bg-muted/15 p-3">
                            {rows.length > 0 ? (
                              <div className="space-y-1.5">
                                {rows.map((project) => (
                                  <div key={project.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                                    <Link to={`/console/project/${project.id}`} onClick={() => onOpenChange(false)} className="min-w-0 flex-1 truncate text-sm hover:text-primary">
                                      {project.name || project.full_name || "未命名项目"}
                                    </Link>
                                    <StackBadges stack={project.stack} max={2} className="shrink-0" />
                                    {project.repo_url && <a href={project.repo_url} target="_blank" rel="noreferrer" title="打开仓库" className="text-muted-foreground hover:text-primary"><ExternalLink className="size-3.5" /></a>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="py-2 text-sm text-muted-foreground">该身份还没有关联项目。</p>
                            )}
                            <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddProject(id)}><FolderPlus className="size-4" />添加项目</Button>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  )
                })}
                {projectsByIdentity.has("__unbound__") && (
                  <div className="rounded-lg border border-dashed p-3">
                    <div className="mb-2 text-sm font-medium">未绑定 Git 身份的项目</div>
                    {projectsByIdentity.get("__unbound__")?.map((project) => <Link key={project.id} to={`/console/project/${project.id}`} onClick={() => onOpenChange(false)} className="block truncate py-1 text-sm text-muted-foreground hover:text-primary">{project.name || project.full_name || "未命名项目"}</Link>)}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AddIdentity open={addIdentityOpen} onOpenChange={setAddIdentityOpen} onRefresh={reloadIdentities} />
      <EditIdentity open={Boolean(editingIdentity)} onOpenChange={(value) => { if (!value) setEditingIdentity(null) }} identity={editingIdentity} onRefresh={reloadIdentities} />
      <AddProjectDialog open={addProjectOpen} onOpenChange={(value) => { setAddProjectOpen(value); if (!value) setInitialIdentityId(undefined) }} initialIdentityId={initialIdentityId} onSuccess={reloadProjects} />

      <AlertDialog open={Boolean(identityToDelete)} onOpenChange={(value) => { if (!value && !deletingIdentity) setIdentityToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Git 身份？</AlertDialogTitle>
            <AlertDialogDescription>删除「{identityToDelete ? identityLabel(identityToDelete) : ""}」不会删除已有项目，但之后无法用该身份访问仓库。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingIdentity}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deletingIdentity} onClick={(event) => { event.preventDefault(); void deleteIdentity() }}>{deletingIdentity ? "删除中…" : "删除身份"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
