
import { useState, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import type { DomainAudit, Dbv2Cursor } from "@/api/Api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconChevronLeft, IconChevronRight, IconChevronsLeft } from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslation } from "react-i18next"
import { ManagerPageActions, ManagerRefreshButton } from "@/components/manager/manager-header-actions"

// created_at 是 unix 秒（后端 mc_audits / operation_logs 统一口径）。JS Date 需要毫秒，
// 所以 ×1000。之前直接 new Date(秒) 把它当毫秒，落到了 1970 年。
const formatTimestamp = (timestamp: number | string | undefined, language: string, fallback: string) => {
  if (timestamp === undefined || timestamp === null || timestamp === "") return fallback
  const seconds = typeof timestamp === "string" ? Number(timestamp) : timestamp
  if (!Number.isFinite(seconds)) return fallback
  const date = new Date(seconds * 1000)
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-')
}

// 后端只回稳定的动作码（如 delete_provider / user.create）；中文/英文文案由前端 i18n
// 负责，避免把中文写进后端让英文用户看到中文。未命中的码回退为码本身。
const operationLabel = (operation: string | undefined, t: (k: string, o?: Record<string, unknown>) => string) => {
  if (!operation) return "-"
  const label = t(`managerLogs.operations.${operation.replace(/\./g, "_")}`, { defaultValue: "" })
  return label || operation
}

export default function TeamManagerLogs() {
  const { i18n, t } = useTranslation()
  const [audits, setAudits] = useState<DomainAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogContent, setDialogContent] = useState<string>('')
  const [dialogTitle, setDialogTitle] = useState<string>('')
  const [pageSize, setPageSize] = useState(20)

  const fetchAudits = async (cursorToUse?: string, limit?: number) => {
    setLoading(true)
    setCurrentCursor(cursorToUse)
    await apiRequest('v1TeamsAuditsList', {
      cursor: cursorToUse,
      limit: limit || pageSize
    }, [], (resp) => {
      if (resp.code === 0) {
        const data = resp.data as { audits?: DomainAudit[]; page?: Dbv2Cursor }
        setAudits(data.audits || [])
        setHasNextPage(data.page?.has_next_page || false)
        setNextCursor(data.page?.cursor)
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    setCursorHistory([undefined])
    fetchAudits()
  }, [])

  const handleNextPage = () => {
    if (nextCursor && hasNextPage) {
      setCursorHistory(prev => [...prev, currentCursor])
      fetchAudits(nextCursor)
    }
  }

  const handlePrevPage = () => {
    if (cursorHistory.length > 1) {
      const newHistory = [...cursorHistory]
      newHistory.pop()
      const prevCursor = newHistory[newHistory.length - 1]
      setCursorHistory(newHistory)
      fetchAudits(prevCursor)
    }
  }

  const handleFirstPage = () => {
    setCursorHistory([undefined])
    fetchAudits(undefined)
  }

  const handlePageSizeChange = (newSize: string) => {
    const size = parseInt(newSize, 10)
    setPageSize(size)
    setCursorHistory([undefined])
    fetchAudits(undefined, size)
  }

  // 操作者显示 name + email（不做强绑定）；管理端单密码体系统一是「管理员」。
  const operatorLabel = (audit: DomainAudit) => {
    const name = audit.user?.name
    const email = audit.user?.email
    if (name && email) return `${name}（${email}）`
    return name || email || t("managerLogs.unknown")
  }

  // 「具体值」摘要：展示后端算好的 target（操作对象，如邮箱/名称/id）。
  const targetSummary = (audit: DomainAudit) => audit.target || "-"

  // 详情：把 before(request)/after(response) 合成一个可读对象，供查看与恢复。
  const handleViewDetails = (audit: DomainAudit) => {
    setDialogTitle(t("managerLogs.dialog.detailsTitle"))
    const before = audit.request
    const after = audit.response
    const parse = (v: string | undefined) => {
      if (!v) return null
      try { return JSON.parse(v) } catch { return v }
    }
    const detail = {
      [t("managerLogs.dialog.before")]: parse(before),
      [t("managerLogs.dialog.after")]: parse(after),
    }
    setDialogContent(JSON.stringify(detail, null, 2))
    setDialogOpen(true)
  }

  if (loading && audits.length === 0) {
    return (
      <Empty className="bg-muted">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  }

  const hasDetails = (audit: DomainAudit) => Boolean(audit.request || audit.response)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <ManagerPageActions
        primary={<ManagerRefreshButton loading={loading} onClick={() => void fetchAudits(currentCursor)} />}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">{t("managerLogs.columns.time")}</TableHead>
              <TableHead>{t("managerLogs.columns.user")}</TableHead>
              <TableHead className="w-[160px]">{t("managerLogs.columns.operation")}</TableHead>
              <TableHead>{t("managerLogs.columns.target")}</TableHead>
              <TableHead className="sticky right-0 w-[96px] bg-background text-right">{t("managerLogs.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && audits.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-3.5">
                  <div className="flex items-center justify-center gap-2">
                    <Spinner className="size-4" />
                    {t("managerLogs.loading")}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {audits.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-3.5">
                  {t("managerLogs.empty")}
                </TableCell>
              </TableRow>
            )}
            {!loading && audits.map((audit) => (
              <TableRow key={audit.id}>
                <TableCell className="tabular-nums">{formatTimestamp(audit.created_at, i18n.language, t("managerLogs.unknown"))}</TableCell>
                <TableCell className="truncate" title={operatorLabel(audit)}>{operatorLabel(audit)}</TableCell>
                <TableCell className="truncate" title={operationLabel(audit.operation, t)}>{operationLabel(audit.operation, t)}</TableCell>
                <TableCell className="truncate" title={targetSummary(audit)}>{targetSummary(audit)}</TableCell>
                <TableCell className="sticky right-0 bg-background text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewDetails(audit)}
                    disabled={!hasDetails(audit)}
                  >
                    {t("managerLogs.actions.viewDetails")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4 py-4 border-t bg-background shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {t("managerPagination.perPage")}
            </span>
            <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[80px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground mr-2">
            {t("managerPagination.page", { page: cursorHistory.length })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFirstPage}
            disabled={cursorHistory.length <= 1 || loading}
            title={t("managerPagination.firstPage")}
          >
            <IconChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrevPage}
            disabled={cursorHistory.length <= 1 || loading}
            title={t("managerPagination.prevPage")}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!hasNextPage || loading}
            title={t("managerPagination.nextPage")}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap bg-muted break-all text-sm p-4 rounded-md">
            {dialogContent}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
