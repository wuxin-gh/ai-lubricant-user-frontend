/**
 * 「开始编程」引导：先选项目，再创建任务。
 *
 * CanonicalCreateTaskDialog 只在传入 projectId 时才绑定项目——不传就没有项目
 * 选择，任务落到"未关联项目"，用户还得自己找。所以首页这个入口先让用户挑一个
 * 项目（没有项目则引导去建），选中后再开任务弹框。
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowRight, FolderGit2, Plus } from "lucide-react"

import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import CanonicalCreateTaskDialog from "@/components/console/task/canonical-create-task-dialog"

export function StartCodingDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, loadingProjects } = useCommonData()

  const [projectId, setProjectId] = useState("")
  const [taskOpen, setTaskOpen] = useState(false)

  // 打开时默认选第一个项目：多数用户只有一个，少点一次。
  useEffect(() => {
    if (!open) return
    setProjectId(projects[0]?.id || "")
    setTaskOpen(false)
  }, [open, projects])

  const close = (next: boolean) => {
    if (!next) setTaskOpen(false)
    onOpenChange(next)
  }

  const goProjects = () => {
    close(false)
    navigate("/coding/projects")
  }

  const start = () => {
    if (!projectId) return
    setTaskOpen(true)
  }

  return (
    <>
      <Dialog open={open && !taskOpen} onOpenChange={close}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("quickActions.startCoding.title", "开始编程")}</DialogTitle>
            <DialogDescription>
              {t(
                "quickActions.startCoding.desc",
                "先选一个项目，再描述你想做什么。任务会跑在该项目的代码上。",
              )}
            </DialogDescription>
          </DialogHeader>

          {loadingProjects ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : projects.length === 0 ? (
            /* 没有项目：任务没有代码可跑，先引导建项目。 */
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t(
                  "quickActions.startCoding.noProject",
                  "你还没有项目。任务需要跑在项目代码上，先建一个项目吧。",
                )}
              </div>
            </div>
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setProjectId(project.id || "")}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                    project.id === projectId ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{project.name || project.id}</span>
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              {t("quickActions.cancel", "取消")}
            </Button>
            {projects.length === 0 ? (
              <Button onClick={goProjects}>
                <Plus className="size-4" />
                {t("quickActions.startCoding.newProject", "去新建项目")}
              </Button>
            ) : (
              <Button onClick={start} disabled={!projectId}>
                {t("quickActions.startCoding.next", "下一步")}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 选中项目后才开任务弹框（它要求 projectId 才会绑定项目）。 */}
      {projectId ? (
        <CanonicalCreateTaskDialog
          open={taskOpen}
          onOpenChange={(next) => {
            setTaskOpen(next)
            if (!next) close(false)
          }}
          projectId={projectId}
        />
      ) : null}
    </>
  )
}
