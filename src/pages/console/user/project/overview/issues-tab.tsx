import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type DomainProjectIssue,
} from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IconPlus, IconUser } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import ProjectIssueList from "@/components/console/project/issue-list"
import ViewIssueDialog from "@/components/console/project/issue-detail"
import CreateIssueDialog from "@/components/console/project/create-issue"
import { useTranslation } from "react-i18next"

interface ProjectOverviewIssuesTabProps {
  projectId: string
  onTaskCreated?: () => void
}

const STATUS_ALL = "__all__"
const PRIORITY_ALL = "__all__"

export default function ProjectOverviewIssuesTab({ projectId, onTaskCreated }: ProjectOverviewIssuesTabProps) {
  const { t } = useTranslation()
  const [issues, setIssues] = useState<DomainProjectIssue[]>([])
  const [typeFilter, setTypeFilter] = useState<string>("__all__")
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_ALL)
  const [priorityFilter, setPriorityFilter] = useState<string>(PRIORITY_ALL)
  const [isCreateIssueDialogOpen, setIsCreateIssueDialogOpen] = useState(false)
  const [viewingIssue, setViewingIssue] = useState<DomainProjectIssue | undefined>(undefined)
  const [viewIssueDialogOpen, setViewIssueDialogOpen] = useState(false)
  // 「分配给我」在服务端过滤（assignee_id=自己），不是筛当前页——否则没加载到的
  // 需求会被漏掉。非 owner 的调用者后端本来就只返回分配给自己的。
  const [onlyMine, setOnlyMine] = useState(false)
  const statusOptions = [
    { value: STATUS_ALL, label: t("projectOverview.issues.allStatuses") },
    { value: "unassigned", label: "待分配" },
    { value: "designing", label: "设计中" },
    { value: "design_pending_confirmation", label: "设计待确认" },
    { value: "design_confirmed", label: "设计已确认" },
    { value: "developing", label: "开发中" },
    { value: "diagnosing", label: "定位中" },
    { value: "reason_pending_confirmation", label: "原因待确认" },
    { value: "reason_confirmed", label: "原因已确认" },
    { value: "fixing", label: "修复中" },
    { value: "completed", label: "已完成" },
    { value: "fixed", label: "已修复" },
    { value: "closed", label: "已关闭" },
  ]
  const priorityOptions = [
    { value: PRIORITY_ALL, label: t("projectOverview.issues.allPriorities") },
    { value: "3", label: t("projectOverview.issues.priority.high") },
    { value: "2", label: t("projectOverview.issues.priority.medium") },
    { value: "1", label: t("projectOverview.issues.priority.low") },
  ]

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (typeFilter !== "__all__" && issue.type !== typeFilter) return false
      if (statusFilter !== STATUS_ALL && issue.status !== statusFilter) return false
      if (priorityFilter !== PRIORITY_ALL && issue.priority?.toString() !== priorityFilter) return false
      return true
    })
  }, [issues, typeFilter, statusFilter, priorityFilter])

  const fetchProjectIssues = useCallback(async () => {
    if (!projectId) return
    const query = onlyMine ? { only_assigned_to_me: true } : {}
    await apiRequest("v1UsersProjectsIssuesDetail", query, [projectId], (resp) => {
      if (resp.code === 0) {
        const rawIssues = resp.data?.issues || []
        const sorted = [...rawIssues].sort((a, b) => {
          // Closed/terminal issues sink to the bottom; active ones float up.
          const getStatusOrder = (s?: string) =>
            s === "closed" ? 3 : s === "completed" || s === "fixed" ? 2 : 1
          const d = getStatusOrder(a.status) - getStatusOrder(b.status)
          if (d !== 0) return d
          const pA = a.priority ?? 999
          const pB = b.priority ?? 999
          if (pA !== pB) return pA - pB
          return (b.created_at ?? 0) - (a.created_at ?? 0)
        })
        setIssues(sorted)
      } else {
        toast.error(resp.message || t("projectOverview.toast.fetchIssuesFailed"))
      }
    })
  }, [projectId, t, onlyMine])

  const handleViewIssue = (issue: DomainProjectIssue) => {
    setViewingIssue(issue)
    setViewIssueDialogOpen(true)
  }

  useEffect(() => {
    if (!projectId) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (!active) {
        return
      }
      setIssues([])
      fetchProjectIssues()
    })

    return () => {
      active = false
    }
  }, [projectId, fetchProjectIssues])

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-row gap-2 items-center shrink-0">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[110px] h-8 text-sm">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部类型</SelectItem>
            <SelectItem value="requirement">需求</SelectItem>
            <SelectItem value="bug">Bug</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-sm">
            <SelectValue placeholder={t("projectOverview.issues.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder={t("projectOverview.issues.allPriorities")} />
          </SelectTrigger>
          <SelectContent>
            {priorityOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 分配给我：服务端按 assignee_id 收窄。非 owner 本来就只看得到分配给自己的，
            这个开关是给 owner/创建者用的（他们默认看全部）。 */}
        <Button
          variant={onlyMine ? "default" : "outline"}
          size="sm"
          className="h-8 text-sm"
          onClick={() => setOnlyMine((v) => !v)}
        >
          <IconUser className="size-4" />
          分配给我
        </Button>
        <Button variant="default" size="sm" className="ml-auto" onClick={() => setIsCreateIssueDialogOpen(true)}>
          <IconPlus />
          {t("projectOverview.issues.create")}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ProjectIssueList
          issues={filteredIssues}
          projectId={projectId}
          onViewIssue={handleViewIssue}
          onTaskCreated={onTaskCreated}
          onIssueDeleted={fetchProjectIssues}
        />
      </div>
      <CreateIssueDialog
        open={isCreateIssueDialogOpen}
        onOpenChange={setIsCreateIssueDialogOpen}
        projectId={projectId}
        onSuccess={fetchProjectIssues}
      />
      <ViewIssueDialog
        open={viewIssueDialogOpen}
        onOpenChange={setViewIssueDialogOpen}
        issue={viewingIssue}
        projectId={projectId}
        onSuccess={fetchProjectIssues}
        onTaskCreated={onTaskCreated}
      />
    </div>
  )
}
