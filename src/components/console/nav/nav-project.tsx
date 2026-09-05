import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
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
import { useCommonData } from "../data-provider"
import CanonicalCreateTaskDialog from "../task/canonical-create-task-dialog"
import { IconChevronDown, IconChevronRight, IconDots, IconFolder, IconFolderOpen, IconFolderPlus, IconLoader, IconPlus, IconPointFilled } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import ManageProjectsDialog from "../project/manage-projects-dialog"
import { TaskActionsDropdown } from "../task/task-actions-dropdown"
import { type DomainProjectTask } from "@/api/Api"
import { getTaskDisplayName } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { FolderOpen, ListTodo } from "lucide-react"
import { useTranslation } from "react-i18next"

type SidebarTaskItemProps = {
  task: DomainProjectTask
  isActive: boolean
  onStop: (task: DomainProjectTask) => void
  onDelete: (task: DomainProjectTask) => void
  onRenameSuccess: () => void
}

function SidebarTaskItem({ task, isActive, onStop, onDelete, onRenameSuccess }: SidebarTaskItemProps) {
  const isPending = task.status === "pending"
  const isProcessing = task.status === "processing"
  const isFinished = task.status === "finished" || task.status === "error"
  const TaskIcon =
    isFinished
      ? IconPointFilled
      : isProcessing
        ? IconPointFilled
        : IconLoader

  return (
    <SidebarMenuSubButton
      size="md"
      isActive={isActive}
      asChild
      className="group/task-row py-4"
    >
      <div className="flex w-full min-w-0 items-center gap-1">
        <Link
          to={`/console/task/${task.id}`}
          className="min-w-0 flex-1 flex items-center gap-2 truncate"
        >
          <TaskIcon
            className={cn(
              "size-3.5 shrink-0",
              isPending && "animate-spin text-primary",
              isProcessing && "text-success",
              isFinished && "text-muted-foreground/40"
            )}
          />
          <span className="truncate">{getTaskDisplayName(task)}</span>
        </Link>
        <TaskActionsDropdown
          task={task}
          onStop={onStop}
          onDelete={onDelete}
          onRenameSuccess={onRenameSuccess}
          triggerClassName="opacity-0 group-hover/task-row:opacity-100 hover:opacity-100 text-muted-foreground/50 group-hover/task-row:text-sidebar-accent-foreground hover:text-primary"
        />
      </div>
    </SidebarMenuSubButton>
  )
}

export default function NavProject() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpen, state } = useSidebar()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [createTaskProjectId, setCreateTaskProjectId] = useState<string | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<DomainProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [taskToStop, setTaskToStop] = useState<DomainProjectTask | null>(null)
  const [stopping, setStopping] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  const { projects, reloadProjects, unlinkedTasks, reloadUnlinkedTasks, historicalTasks, reloadHistoricalTasks } = useCommonData()

  const renderTaskList = (tasks: DomainProjectTask[], keyPrefix: string) => (
    tasks.map((task: DomainProjectTask, index) => {
      return (
        <SidebarTaskItem
          key={`${keyPrefix}-${task.id ?? index}-${index}`}
          task={task}
          isActive={location.pathname === `/console/task/${task.id}`}
          onStop={setTaskToStop}
          onDelete={setTaskToDelete}
          onRenameSuccess={() => {
            reloadProjects()
            reloadUnlinkedTasks()
            reloadHistoricalTasks()
          }}
        />
      )
    })
  )

  const handleConfirmDeleteTask = () => {
    if (!taskToDelete?.id) {
      setTaskToDelete(null)
      return
    }
    const taskId = taskToDelete.id
    const isOnDeletedPage = location.pathname === `/console/task/${taskId}`
    setDeleting(true)
    apiRequest(
      "v1UsersTasksDelete",
      {},
      [taskId],
      (resp) => {
        setDeleting(false)
        setTaskToDelete(null)
        if (resp.code === 0) {
          toast.success(t("navProject.toast.taskDeleted"))
          reloadProjects()
          reloadUnlinkedTasks()
          reloadHistoricalTasks()
          if (isOnDeletedPage) {
            navigate("/console/tasks")
          }
        } else {
          toast.error(resp.message || t("navProject.toast.deleteFailed"))
        }
      },
      () => {
        setDeleting(false)
        setTaskToDelete(null)
      }
    )
  }

  const handleConfirmStopTask = () => {
    if (!taskToStop?.id) {
      setTaskToStop(null)
      return
    }
    setStopping(true)
    apiRequest(
      "v1UsersTasksStopUpdate",
      { id: taskToStop.id },
      [],
      (resp) => {
        setStopping(false)
        setTaskToStop(null)
        if (resp.code === 0) {
          toast.success(t("navProject.toast.taskStopped"))
          reloadProjects()
          reloadUnlinkedTasks()
          reloadHistoricalTasks()
        } else {
          toast.error(resp.message || t("navProject.toast.stopFailed"))
        }
      },
      () => {
        setStopping(false)
        setTaskToStop(null)
      }
    )
  }

  const isUnlinkedActive = location.pathname === "/console/tasks"
  const isCollapsed = !isMobile && state === "collapsed"

  return (
    <SidebarGroup className="mt-4 p-0">
      <ManageProjectsDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
      <CanonicalCreateTaskDialog
        open={!!createTaskProjectId}
        onOpenChange={(open) => !open && setCreateTaskProjectId(null)}
        projectId={createTaskProjectId || ""}
      />

      {isCollapsed ? (
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("navProject.emptyProject")} isActive={isUnlinkedActive} asChild>
              <Link to="/console/tasks">
                <ListTodo />
                <span>{t("navProject.emptyProject")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={projects.length > 0 ? t("navProject.expandProjectList") : t("navProject.actions.createProject")}
              isActive={location.pathname.startsWith("/console/project/")}
              onClick={() => {
                if (projects.length > 0) {
                  setOpen(true)
                } else {
                  setAddDialogOpen(true)
                }
              }}
            >
              <FolderOpen />
              <span>{projects.length > 0 ? t("navProject.projectList") : t("navProject.actions.createProject")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : (
        <SidebarMenu className="gap-2">
            <SidebarMenuItem>
              <SidebarMenuSub className="border-none px-0 mx-0">
                <SidebarMenuSubItem className="flex flex-col gap-0.5">
                  {renderTaskList(unlinkedTasks, "unlinked")}
                </SidebarMenuSubItem>
              </SidebarMenuSub>
              <SidebarMenuSub className="border-none px-0 mx-0">
                <SidebarMenuSubItem className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="group/history-row flex h-8 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => setHistoryExpanded((expanded) => !expanded)}
                  >
                    {historyExpanded ? (
                      <IconFolderOpen className="size-3.5 shrink-0 opacity-40" />
                    ) : (
                      <IconFolder className="size-3.5 shrink-0 opacity-40" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">{t("navProject.historyTasks")}</span>
                    {historyExpanded ? (
                      <IconChevronDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/history-row:opacity-50" />
                    ) : (
                      <IconChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/history-row:opacity-50" />
                    )}
                  </button>
                  {historyExpanded && renderTaskList(historicalTasks, "history")}
                  {historyExpanded && (
                    <SidebarMenuSubButton
                      asChild
                      size="md"
                      isActive={location.pathname === "/console/tasks"}
                      className="group/task-row py-4"
                    >
                      <div className="flex w-full min-w-0 items-center gap-1">
                        <Link
                          to="/console/tasks"
                          className="min-w-0 flex-1 flex items-center gap-2 truncate"
                        >
                          <IconDots className="size-3.5 shrink-0" />
                          <span className="truncate">{t("navProject.actions.viewMore")}</span>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 opacity-0 pointer-events-none"
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                      </div>
                    </SidebarMenuSubButton>
                  )}
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </SidebarMenuItem>
            {projects.length > 0 && <Separator className="my-2" />}
            {projects.length > 0 ? projects.map((project) => {
              const projectId = project.id ?? ""
              const isProjectActive =
                location.pathname === `/console/project/${projectId}` ||
                location.pathname.startsWith(`/console/project/${projectId}/`) ||
                (project.tasks || []).some((task) => location.pathname === `/console/task/${task.id}`)
              const projectExpanded = expandedProjects[projectId] ?? isProjectActive
              const hasChildren = (project.tasks || []).length > 0
              return (
                <SidebarMenuItem key={projectId}>
                  <div
                    className={cn(
                      "group/project-row flex w-full items-center gap-1 overflow-hidden rounded-md pl-1 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 my-1",
                      isProjectActive && "font-medium text-primary"
                    )}
                  >
                    {hasChildren && (
                      <button
                        type="button"
                        aria-label={projectExpanded ? "收起" : "展开"}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setExpandedProjects((current) => ({ ...current, [projectId]: !projectExpanded }))
                        }}
                        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-primary"
                      >
                        {projectExpanded ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />}
                      </button>
                    )}
                    <Link
                      to={`/console/project/${projectId}`}
                      className={cn(
                        "min-w-0 flex-1 flex items-center gap-2 truncate text-sidebar-foreground/70 group-hover/project-row:text-primary",
                        isProjectActive && "text-primary",
                        !hasChildren && "pl-1"
                      )}
                    >
                      {projectExpanded ? (
                        <IconFolderOpen className="size-3.5 shrink-0 opacity-50" />
                      ) : (
                        <IconFolder className="size-3.5 shrink-0 opacity-50" />
                      )}
                      <span className="truncate">{project.name}</span>
                    </Link>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 text-muted-foreground/50 group-hover/project-row:text-primary hover:text-primary"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCreateTaskProjectId(projectId)
                          }}
                        >
                          <IconPlus className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">创建任务</TooltipContent>
                    </Tooltip>
                  </div>
                  {projectExpanded && hasChildren && (
                    <SidebarMenuSub className="mr-0 gap-0.5 pl-1">
                      <SidebarMenuSubItem className="flex flex-col gap-0.5">
                        {(project.tasks || []).map((task: DomainProjectTask, index) => (
                          <SidebarTaskItem
                            key={`${projectId}-${task.id ?? index}-${index}`}
                            task={task}
                            isActive={location.pathname === `/console/task/${task.id}`}
                            onStop={setTaskToStop}
                            onDelete={setTaskToDelete}
                            onRenameSuccess={() => {
                              reloadProjects()
                              reloadUnlinkedTasks()
                              reloadHistoricalTasks()
                            }}
                          />
                        ))}
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )
            }) : (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  {t("navProject.noProjects")}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setAddDialogOpen(true)} className="[&>svg]:size-3.5">
                <IconFolderPlus />
                <span>{t("navProject.actions.manageProjects", "管理项目")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
      )}
      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("navProject.deleteTask.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("navProject.deleteTask.description", { task: getTaskDisplayName(taskToDelete) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("navProject.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDeleteTask()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("navProject.deleteTask.deleting") : t("navProject.deleteTask.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!taskToStop} onOpenChange={(open) => !open && setTaskToStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("navProject.stopTask.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("navProject.stopTask.description", { task: getTaskDisplayName(taskToStop) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stopping}>{t("navProject.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmStopTask()
              }}
              disabled={stopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {stopping ? t("navProject.stopTask.stopping") : t("navProject.stopTask.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  )
}
