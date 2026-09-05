import { ConstsProjectIssuePriority, type DomainProjectIssue } from "@/api/Api"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import dayjs from "dayjs"
import IssueMenu from "./issue-menu"
import { IconChevronDown, IconCircleDot, IconCancel, IconCircleCheck, IconChevronUp, IconChevronsUp, IconAlertTriangle, IconBug, IconClockPause, IconSparkles } from "@tabler/icons-react"
import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"
import { issueStatusMeta, issueTypeLabel, isTerminalStatus } from "./issue-meta"

interface IssueCardProps {
  issue: DomainProjectIssue
  projectId: string
  onViewIssue: (issue: DomainProjectIssue) => void
  onTaskCreated?: () => void
  onIssueDeleted?: () => void
}

export default function IssueCard({ issue, projectId, onViewIssue, onTaskCreated, onIssueDeleted }: IssueCardProps) {
  const { t } = useTranslation()

  const meta = useMemo(() => issueStatusMeta(issue.status), [issue.status])
  const terminal = isTerminalStatus(issue.status)
  const isBug = issue.type === "bug"

  const statusIcon = useMemo(() => {
    switch (meta.tone) {
      case "closed":
        return <IconCancel />
      case "done":
        return <IconCircleCheck />
      case "pending":
        return <IconClockPause />
      default:
        return <IconCircleDot />
    }
  }, [meta.tone])

  const priority = useMemo(() => {
    switch (issue.priority) {
      case ConstsProjectIssuePriority.ProjectIssuePriorityThree:
        return <>
          <IconChevronsUp className="text-primary" />
          {t("consoleProject.issue.priority.high")}
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityTwo:
        return <>
          <IconChevronUp className="text-primary" />
          {t("consoleProject.issue.priority.medium")}
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityOne:
        return <>
          <IconChevronDown className="" />
          {t("consoleProject.issue.priority.low")}
        </>
      default:
        return null
    }
  }, [issue.priority, t])

  return (
    <div className={cn("border rounded-md flex flex-col group hover:border-primary/50 p-2 gap-1 cursor-default", terminal && "bg-muted/30")}>
      <div className="flex flex-row items-center gap-2">
        <Badge variant={isBug ? "destructive" : "outline"} className="shrink-0">
          {isBug ? <IconBug /> : <IconSparkles />}
          {issueTypeLabel(issue.type)}
        </Badge>
        <Badge
          variant="secondary"
          className={cn(
            "shrink-0",
            meta.tone === "active" && "text-primary bg-primary/15",
            meta.tone === "pending" && "text-amber-700 bg-amber-500/15 dark:text-amber-300",
            meta.tone === "confirmed" && "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300",
            meta.tone === "done" && "text-primary",
            meta.tone === "closed" && "text-muted-foreground",
          )}>
          {statusIcon}
          {meta.label}
        </Badge>
        <div
          className={cn("flex-1 text-sm group-hover:text-primary cursor-pointer hover:underline line-clamp-1 break-all", issue.status === "closed" && "line-through text-muted-foreground hover:line-through", terminal && issue.status !== "closed" && "text-muted-foreground")}
          onClick={() => onViewIssue(issue)}
        >
          {issue.title}
        </div>
        <IssueMenu issue={issue} projectId={projectId} onTaskCreated={onTaskCreated} onIssueDeleted={onIssueDeleted} />
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2 break-all">{issue.summary}</div>
      <Separator className="my-2" />
      <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground">
        <Badge variant="outline" className={cn("flex flex-row gap-1 items-center", terminal && "text-muted-foreground")}>
          {priority}
        </Badge>
        {!issue.design_document && !isBug && <Badge variant="outline" className={cn(terminal && "text-muted-foreground")}>
          <IconAlertTriangle />
          {t("consoleProject.issue.missingDesign")}
        </Badge>}
        <div className="flex-1 text-right">{t("consoleProject.issue.createdAt", { time: dayjs((issue.created_at || 0) * 1000).fromNow() })}</div>
      </div>
    </div>
  )
}
