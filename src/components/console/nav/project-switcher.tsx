/**
 * 侧栏「切换项目」按钮：显示当前项目名，点开切换项目弹框。
 *
 * 只在 Coding 模式出现（其它模式没有「当前项目」的概念）。模式切换器正下方，
 * 位置固定——用户切到 Coding 后第一眼就能确认自己在哪个项目里。
 *
 * 没有当前项目（首次进入 / 项目被删）时按钮显示「切换项目」，点开弹框让用户选或建。
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronsUpDown, FolderGit2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useActiveMode } from "@/hooks/use-active-mode"
import { useCurrentProject } from "@/components/console/current-project-context"
import { cn } from "@/lib/utils"
import { CodingProjectsDialog } from "@/pages/console/user/coding-projects"

export function ProjectSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const activeMode = useActiveMode()
  const { project } = useCurrentProject()
  const [open, setOpen] = useState(false)

  // 只在 Coding 模式出现：其它模式没有「当前项目」。
  if (activeMode?.id !== "coding") return null

  const label = project
    ? project.name || project.full_name || t("codingProjects.unnamed")
    : t("codingProjects.switch", "切换项目")

  return (
    <>
      <Button
        variant="outline"
        className={cn("h-10 w-full justify-between gap-2 px-2.5", className)}
        title={project ? t("codingProjects.switchCurrent", { name: label }) : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FolderGit2 className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{label}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </Button>
      <CodingProjectsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

export default ProjectSwitcher
