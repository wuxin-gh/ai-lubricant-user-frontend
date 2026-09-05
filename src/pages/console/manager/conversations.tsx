import { useEffect, useMemo, useState } from "react"
import { IconMessages } from "@tabler/icons-react"
import { Eye } from "lucide-react"
import { toast } from "sonner"

import type { Dbv2Cursor, GithubComChaitinMonkeyCodeBackendDomainTeamConversationItem as DomainTeamConversationItem } from "@/api/Api"
import ConversationDetailDialog, {
  type ConversationDetailKind,
} from "@/components/manager/conversation-detail-dialog"
import {
  ManagerListEmpty,
  ManagerListLoading,
  ManagerListCard,
} from "@/components/manager/manager-list-page"
import { TeamDataTablePagination } from "@/components/manager/team-data-table-pagination"
import { ManagerPageActions, ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiRequest } from "@/utils/requestUtils"
import { useTranslation } from "react-i18next"

// Three conversation kinds: project (MonkeyCode domain, SQLite), agent and chat
// (ClickHouse). project uses v1TeamsConversationsList (items carry
// creator/attachment/task); agent/chat use admin endpoints (a different item
// shape: ClickHouse rows with no creator/attachment).
type ConvKind = "project" | "agent" | "chat"

// ClickHouse conversation row (shape returned by admin/agent|chat/conversations).
interface StoreConversationItem {
  id: string
  title?: string
  model?: string
  agent_id?: number | null
  user_id?: string | null
  kind?: string
  created_at?: string
  updated_at?: string
}

interface ManagerUserRow {
  user: {
    id: string
    name?: string | null
    email?: string | null
  }
}

const ENDPOINT_BY_KIND: Record<ConvKind, string> = {
  project: "v1TeamsConversationsList",
  agent: "v1AdminAgentConversationsList",
  chat: "v1AdminChatConversationsList",
}

function formatTime(value: number | undefined, language: string) {
  if (!value) return "-"
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return new Date(value * 1000).toLocaleString(locale, { hour12: false }).replace(/\//g, "-")
}

// ClickHouse returns ISO/datetime strings (not unix seconds); format separately.
function formatDateStr(value: string | undefined, language: string) {
  if (!value) return "-"
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z")
  if (Number.isNaN(d.getTime())) return value
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return d.toLocaleString(locale, { hour12: false }).replace(/\//g, "-")
}

function creatorName(item: DomainTeamConversationItem) {
  return item.creator?.name || item.creator?.email || "-"
}

export default function TeamManagerConversations() {
  const { t, i18n } = useTranslation()
  const [detailId, setDetailId] = useState<string | undefined>()
  const [detailTaskId, setDetailTaskId] = useState<string | undefined>()
  const [detailCreatorName, setDetailCreatorName] = useState<string | undefined>()
  const [detailOpen, setDetailOpen] = useState(false)
  const [kind, setKind] = useState<ConvKind>("project")
  const [conversations, setConversations] = useState<DomainTeamConversationItem[]>([])
  const [storeConversations, setStoreConversations] = useState<StoreConversationItem[]>([])
  const [users, setUsers] = useState<ManagerUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pageSize, setPageSize] = useState(20)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>()
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasNextPage, setHasNextPage] = useState(false)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined])

  const fetchConversations = async (activeKind: ConvKind, cursor?: string, limit = pageSize) => {
    setLoading(true)
    setCurrentCursor(cursor)
    const projectPage = activeKind === "project" ? Math.max(1, Number(cursor) || 1) : 1
    const params = activeKind === "project"
      ? { page: projectPage, size: limit }
      : { cursor, limit }
    await apiRequest(ENDPOINT_BY_KIND[activeKind], params, [], (resp) => {
      if (resp.code === 0) {
        const page = resp.data?.page as Dbv2Cursor | number | undefined
        if (activeKind === "project") {
          setConversations(resp.data?.conversations || [])
          setStoreConversations([])
          const total = Number(resp.data?.total || 0)
          const returnedPageSize = Number(resp.data?.page_size || limit)
          const hasNext = projectPage * returnedPageSize < total
          setNextCursor(hasNext ? String(projectPage + 1) : undefined)
          setHasNextPage(hasNext)
        } else {
          setStoreConversations((resp.data?.conversations || []) as StoreConversationItem[])
          setConversations([])
          const cursorPage = page as Dbv2Cursor | undefined
          setNextCursor(cursorPage?.cursor)
          setHasNextPage(!!cursorPage?.has_next_page)
        }
      } else {
        toast.error(resp.message || t("managerConversations.toast.fetchFailed"))
      }
    })
    setLoading(false)
  }

  const userNameById = useMemo(() => new Map(users.map(({ user }) => [user.id, user.name || user.email || "-"])), [users])

  useEffect(() => {
    fetchConversations(kind)
    apiRequest("v1TeamsUsersAllList", {}, [], (resp) => {
      if (resp.code === 0) setUsers((resp.data?.users || []) as ManagerUserRow[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchKind = (next: ConvKind) => {
    if (next === kind) return
    setDetailOpen(false)
    setDetailId(undefined)
    setDetailTaskId(undefined)
    setDetailCreatorName(undefined)
    setKind(next)
    setCursorHistory([undefined])
    setConversations([])
    setStoreConversations([])
    fetchConversations(next, undefined)
  }

  const goFirst = () => {
    setCursorHistory([undefined])
    fetchConversations(kind, undefined)
  }

  const goPrev = () => {
    if (cursorHistory.length <= 1) return
    const nextHistory = [...cursorHistory]
    nextHistory.pop()
    const prev = nextHistory[nextHistory.length - 1]
    setCursorHistory(nextHistory)
    fetchConversations(kind, prev)
  }

  const goNext = () => {
    if (!nextCursor || !hasNextPage) return
    setCursorHistory((prev) => [...prev, currentCursor])
    fetchConversations(kind, nextCursor)
  }

  const changePageSize = (size: number) => {
    setPageSize(size)
    setCursorHistory([undefined])
    fetchConversations(kind, undefined, size)
  }

  const openStoreDetail = (item: StoreConversationItem) => {
    setDetailId(item.id)
    setDetailTaskId(undefined)
    setDetailCreatorName(item.user_id ? userNameById.get(item.user_id) || "-" : "-")
    setDetailOpen(true)
  }

  const openProjectDetail = (item: DomainTeamConversationItem) => {
    if (!item.task_id) return
    setDetailId(item.id)
    setDetailTaskId(item.task_id)
    setDetailCreatorName(creatorName(item))
    setDetailOpen(true)
  }

  const isProject = kind === "project"
  const count = isProject ? conversations.length : storeConversations.length
  const isEmpty = !loading && count === 0

  const kindTabs = (
    <Tabs className="shrink-0" value={kind} onValueChange={(v) => switchKind(v as ConvKind)}>
      <TabsList>
        <TabsTrigger value="project">{t("managerConversations.tabs.project")}</TabsTrigger>
        <TabsTrigger value="agent">{t("managerConversations.tabs.agent")}</TabsTrigger>
        <TabsTrigger value="chat">{t("managerConversations.tabs.chat")}</TabsTrigger>
      </TabsList>
    </Tabs>
  )

  const pageActions = (
    <ManagerPageActions
      primary={(
        <ManagerRefreshButton
          loading={loading}
          onClick={() => void fetchConversations(kind, currentCursor)}
        />
      )}
    />
  )

  // Root must join the flex height chain (min-h-0 + flex-1); otherwise
  // ManagerListCard has no bounded height, the table pushes the footer
  // pagination out of view, and platform-scope's overflow-hidden clips it.
  if (loading && count === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {pageActions}
        {kindTabs}
        <ManagerListLoading title={t("managerConversations.loading")} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {pageActions}
      {kindTabs}
      <ManagerListCard
        title={t("managerConversations.title")}
        description={t("managerConversations.description")}
        icon={<IconMessages />}
        count={count}
        pagination={
          <TeamDataTablePagination
            page={cursorHistory.length}
            pageSize={pageSize}
            loading={loading}
            hasNextPage={hasNextPage}
            canPrevPage={cursorHistory.length > 1}
            onFirstPage={goFirst}
            onPrevPage={goPrev}
            onNextPage={goNext}
            onPageSizeChange={changePageSize}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="px-6">{t("managerConversations.columns.input")}</TableHead>
              <TableHead>{t("managerConversations.columns.creator")}</TableHead>
              {isProject && <TableHead>{t("managerConversations.columns.attachments")}</TableHead>}
              <TableHead>{t("managerConversations.columns.time")}</TableHead>
              <TableHead className="w-[80px] text-right">
                {t("managerConversations.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEmpty && (
              <ManagerListEmpty
                colSpan={isProject ? 5 : 4}
                title={t("managerConversations.empty.title")}
                description={t("managerConversations.empty.description")}
              />
            )}
            {isProject &&
              conversations.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-6">
                    <div className="max-w-[560px] space-y-1">
                      <div className="truncate font-medium">{item.content || "-"}</div>
                      <div className="truncate text-xs leading-4 text-muted-foreground">
                        {item.task_title || item.task_id || t("managerConversations.fallback.unlinkedTask")}
                        {item.project_name ? ` · ${item.project_name}` : ""}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[180px] truncate text-sm">{creatorName(item)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.attachment_count ? "secondary" : "outline"}>
                      {item.attachment_count || 0}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatTime(item.created_at, i18n.language)}</TableCell>
                  <TableCell className="text-right">
                    {/* Project conversations use task history for a read-only message view. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!item.task_id}
                      onClick={() => openProjectDetail(item)}
                      title={
                        item.task_id
                          ? t("managerConversations.actions.viewDetail")
                          : t("managerConversations.actions.detailUnavailable")
                      }
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            {!isProject &&
              storeConversations.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-6">
                    <div className="max-w-[560px] space-y-1">
                      <div className="truncate font-medium">
                        {item.title || t("managerConversations.fallback.untitled")}
                      </div>
                      <div className="truncate text-xs leading-4 text-muted-foreground">
                        {item.model || "-"}
                        {item.agent_id ? ` · agent #${item.agent_id}` : ""}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[180px] truncate text-sm">
                      {item.user_id ? userNameById.get(item.user_id) || "-" : "-"}
                    </div>
                  </TableCell>
                  <TableCell>{formatDateStr(item.updated_at || item.created_at, i18n.language)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openStoreDetail(item)}
                      title={t("managerConversations.actions.viewDetail")}
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </ManagerListCard>
      <ConversationDetailDialog
        kind={kind as ConversationDetailKind}
        conversationId={detailId}
        taskId={detailTaskId}
        creatorName={detailCreatorName}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) {
            setDetailId(undefined)
            setDetailTaskId(undefined)
            setDetailCreatorName(undefined)
          }
        }}
      />
    </div>
  )
}
