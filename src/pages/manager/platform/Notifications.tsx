/**
 * 通知中心页（shadcn 版）。
 * 取代原来的弹框形态，升级为独立的管理页。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Trash2 } from 'lucide-react'
import { AdminPage } from '@/components/manager/platform-page'
import { ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import {
  getNotifications,
  getNotificationDetail,
  getNotifyEventTypes,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  batchDeleteNotifications,
  clearReadNotifications,
} from '@/@admin-port/api/dashboard'
import type { Notification, NotifyEventType } from '@/@admin-port/api/dashboard'
import { publishNotificationUnread } from '@/components/manager/notification-unread'
// 复用渠道页的渠道编辑弹框，就地打开（不跳转到渠道页）。
import { UnifiedProviderModal } from './Channels'
// 渠道配置 tab：从团队设置搬来的 webhook 渠道增删改查。
import TeamNotifications from '@/components/manager/team-notifications'
import NotificationEvents from './NotificationEvents'

const PAGE_SIZE = 20

function severityClass(s: string) {
  if (s === 'critical') return 'bg-destructive text-destructive-foreground'
  if (s === 'error') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30'
  if (s === 'warning') return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
  return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30'
}

function severityLabel(s: string) {
  if (s === 'critical') return '严重'
  if (s === 'error') return '错误'
  if (s === 'warning') return '警告'
  return '信息'
}

/** 后端把时间序列化为 unix 秒（float）；这里统一转毫秒。 */
function toMillis(value: string | number | undefined | null): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const asNum = Number(value)
  if (!Number.isNaN(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function timeAgo(value: string | number | undefined | null): string {
  const ms = toMillis(value)
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatTime(value: string | number | undefined | null): string {
  const ms = toMillis(value)
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

export function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [eventType, setEventType] = useState('')
  // 事件目录：用于把 event_type 渲染成中文名，并按一级分类分组做筛选下拉。
  const [eventTypes, setEventTypes] = useState<NotifyEventType[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailCache, setDetailCache] = useState<Record<number, Notification>>({})
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null)
  // 就地打开的渠道编辑弹框：只保存渠道 id，弹框自行加载详情。
  const [editProviderId, setEditProviderId] = useState<string | null>(null)
  // 通知中心三 tab：通知列表 / 渠道配置 / 事件配置。渠道只负责「往哪推」，
  // 事件负责「推什么、什么时候推、满足什么条件才推」，两者由绑定关系连接。
  const [activeTab, setActiveTab] = useState<'list' | 'channels' | 'events'>('list')
  // 多选删除：与用户端同口径，只保留当前页可见项的选中态；筛选/翻页后由 fetchData 清空。
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [pendingAction, setPendingAction] = useState<'batch' | 'clear-read' | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // 只认最后一次发起的请求：筛选切换很容易让第 2 页的响应压掉第 1 页的结果，
  // 出现「筛选条件和列表对不上」。序号比对后，过期响应直接丢弃。
  const requestSeqRef = useRef(0)

  const fetchData = useCallback(
    async (p: number) => {
      const seq = ++requestSeqRef.current
      setLoading(true)
      setError(null)
      try {
        const res = await getNotifications({
          page: p,
          page_size: PAGE_SIZE,
          severity: severity || undefined,
          status: status || undefined,
          event_type: eventType || undefined,
        })
        if (seq !== requestSeqRef.current) return
        setItems(res.items ?? [])
        setTotal(res.total ?? 0)
        const nextUnread = res.unread_count ?? 0
        setUnreadCount(nextUnread)
        publishNotificationUnread(nextUnread)
        setSelectedIds(new Set())
      } catch (err) {
        if (seq !== requestSeqRef.current) return
        setError(err instanceof Error ? err.message : '加载通知失败')
      } finally {
        if (seq === requestSeqRef.current) setLoading(false)
      }
    },
    [severity, status, eventType],
  )

  // 单一拉取入口。原来拆成两个 effect（一个盯筛选、一个盯页码），筛选一变
  // fetchData 重建，两个 effect 会同时触发，一次操作打 2~3 个请求。
  // 现在筛选变化只负责把页码归位，拉取统一由这里按 (page, 筛选) 触发一次。
  useEffect(() => {
    void fetchData(page)
  }, [page, fetchData])

  // 事件目录是静态的，只在挂载时拉一次；拉失败只丢筛选下拉，不影响列表。
  useEffect(() => {
    void (async () => {
      try {
        setEventTypes(await getNotifyEventTypes())
      } catch {
        setEventTypes([])
      }
    })()
  }, [])

  const resetToFirstPage = () => setPage(1)

  // 管理端只列平台级事件：用户侧事件（task.* / node.online）由用户自己在
  // /console/notifications 配置，混进这里会让管理员误以为能代配。
  const platformEventGroups = (() => {
    const groups = new Map<string, NotifyEventType[]>()
    for (const et of eventTypes) {
      if (et.owner_scope !== 'platform') continue
      const bucket = groups.get(et.category) ?? []
      bucket.push(et)
      groups.set(et.category, bucket)
    }
    return [...groups.entries()]
  })()

  const eventTypeName = (type: string | undefined) =>
    (type && eventTypes.find((et) => et.type === type)?.name) || type || ''

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead()
      setUnreadCount(0)
      publishNotificationUnread(0)
      void fetchData(page)
      toast.success('已标记全部为已读')
    } catch {
      toast.error('操作失败')
    }
  }

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id)
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'read' as const } : item)),
      )
      setUnreadCount((prev) => {
        const next = Math.max(0, prev - 1)
        publishNotificationUnread(next)
        return next
      })
    } catch {
      toast.error('标已读失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteNotification(id)
      // 当前页删空且非首页：回退一页（fetchData 会清空选中态），否则原地重拉。
      if (items.length === 1 && page > 1) {
        setPage((p) => Math.max(1, p - 1))
        return
      }
      void fetchData(page)
      toast.success('已删除通知')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id))

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (items.length > 0 && items.every((item) => prev.has(item.id))) return new Set()
      return new Set(items.map((item) => item.id))
    })
  }

  // 批量删除/清空已读统一走 pendingAction → AlertDialog → execute，二次确认后一次落地。
  const executeAction = async () => {
    if (!pendingAction) return
    setActionLoading(true)
    try {
      let deleted = 0
      if (pendingAction === 'batch') {
        deleted = (await batchDeleteNotifications(Array.from(selectedIds))).deleted
      } else {
        deleted = (await clearReadNotifications()).deleted
      }
      toast.success(`已删除 ${deleted} 条通知`)
      setPendingAction(null)
      const emptied = deleted >= items.length
      if (emptied && page > 1) setPage((p) => Math.max(1, p - 1))
      else void fetchData(page)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionLoading(false)
    }
  }

  // 展开时按需拉取单条详情（含 detail 长文本）；列表接口不返回 detail 以保持轻量。
  const handleToggleExpand = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null)
        return
      }
      setExpandedId(id)
      if (detailCache[id]) return
      setDetailLoadingId(id)
      try {
        const full = await getNotificationDetail(id)
        setDetailCache((prev) => ({ ...prev, [id]: full }))
      } catch {
        toast.error('加载详情失败')
      } finally {
        setDetailLoadingId((prev) => (prev === id ? null : prev))
      }
    },
    [expandedId, detailCache],
  )

  // 点击「渠道」就地在通知中心打开该渠道的编辑弹框：渠道 id 即渠道名，直接传给弹框。
  const openChannelEditor = (providerName: string) => {
    setEditProviderId(providerName)
  }

  // 展开区：优先用 detailCache（含 detail 长文本 + 完整字段），否则回落到列表行。
  const renderDetail = (item: Notification) => {
    const full = detailCache[item.id] ?? item
    const loadingDetail = detailLoadingId === item.id && !detailCache[item.id]
    const infoRows: { label: string; value: React.ReactNode }[] = []
    if (full.source) infoRows.push({ label: '来源', value: full.source })
    // 事件类型是通知的内部分类锚点，渲染成目录里的中文名（目录没拉到就回落原值）。
    if (full.event_type) infoRows.push({ label: '事件', value: eventTypeName(full.event_type) })
    if (full.kind) infoRows.push({ label: '类型', value: full.kind })
    if (full.provider_name) {
      // 「渠道」可点击：就地打开该渠道的编辑弹框（不跳转渠道页）。
      const providerName = full.provider_name
      infoRows.push({
        label: '渠道',
        value: (
          <button
            type="button"
            className="text-left text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              openChannelEditor(providerName)
            }}
          >
            {providerName}
          </button>
        ),
      })
    }
    if (full.account_username) infoRows.push({ label: '账号', value: full.account_username })
    if (full.model) infoRows.push({ label: '模型', value: full.model })
    if ((full.occurrence_count ?? 0) > 1) {
      infoRows.push({ label: '出现次数', value: full.occurrence_count })
    }
    if (full.first_seen_at) infoRows.push({ label: '首次', value: formatTime(full.first_seen_at) })
    if (full.last_seen_at) infoRows.push({ label: '最近', value: formatTime(full.last_seen_at) })
    if (full.request_log_id) infoRows.push({ label: '请求日志', value: `#${full.request_log_id}` })
    const metaKeys = full.metadata ? Object.keys(full.metadata) : []

    return (
      <div
        className="mt-3 flex flex-col gap-3 border-t pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        {loadingDetail ? (
          <div className="flex justify-center py-3">
            <Spinner className="size-4" />
          </div>
        ) : (
          <>
            {infoRows.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                {infoRows.map((r, i) => (
                  <div key={i} className="flex flex-col">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="break-all">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {full.detail && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">详情</div>
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2.5 py-2 text-xs leading-relaxed">
                  {full.detail}
                </pre>
              </div>
            )}
            {metaKeys.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">元数据</div>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2.5 py-2 text-xs leading-relaxed">
                  {JSON.stringify(full.metadata, null, 2)}
                </pre>
              </div>
            )}
            {!full.detail && metaKeys.length === 0 && infoRows.length === 0 && (
              <span className="text-xs text-muted-foreground">暂无更多详情</span>
            )}
          </>
        )}
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <AdminPage
      title={
        <span className="flex items-center gap-2">
          通知中心
          {unreadCount > 0 && (
            <Badge variant="destructive" className="rounded-full px-1.5 text-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </span>
      }
      description="查看系统告警与运行通知"
      primaryActions={
        <>
          <ManagerRefreshButton loading={loading} onClick={() => void fetchData(page)} />
          {unreadCount > 0 && (
            <Button size="sm" onClick={() => void handleMarkAllRead()}>
              <Bell className="h-4 w-4" />
              全部已读
            </Button>
          )}
        </>
      }
    >
      {/* 通知中心 tab：通知列表 / 渠道配置 / 事件配置 */}
      <div className="mb-4 flex gap-1 border-b pb-px">
        {(
          [
            ['list', '通知列表'],
            ['channels', '渠道配置'],
            ['events', '事件配置'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              activeTab === key
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'list' && (
        <>
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={severity || '__all__'}
          onValueChange={(v) => {
            setSeverity(v === '__all__' ? '' : v)
            resetToFirstPage()
          }}
        >
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部级别</SelectItem>
            <SelectItem value="critical">严重</SelectItem>
            <SelectItem value="error">错误</SelectItem>
            <SelectItem value="warning">警告</SelectItem>
            <SelectItem value="info">信息</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status || '__all__'}
          onValueChange={(v) => {
            setStatus(v === '__all__' ? '' : v)
            resetToFirstPage()
          }}
        >
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="unread">未读</SelectItem>
            <SelectItem value="read">已读</SelectItem>
          </SelectContent>
        </Select>
        {/* 事件类型筛选：按一级分类分组，让「只看冻结」「只看安全」一步到位。 */}
        {platformEventGroups.length > 0 && (
          <Select
            value={eventType || '__all__'}
            onValueChange={(v) => {
              setEventType(v === '__all__' ? '' : v)
              resetToFirstPage()
            }}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部事件</SelectItem>
              {platformEventGroups.map(([category, list]) => (
                <div key={category}>
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{category}</div>
                  {list.map((et) => (
                    <SelectItem key={et.type} value={et.type}>
                      {et.name}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-sm text-muted-foreground">共 {total} 条</span>
      </div>

      {/* 批量操作条：有列表项才显示。删除选中只对选中项生效；清空已读删全部已读、未读保留。 */}
      {!loading && !error && items.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全选当前页" />
          <span className="text-sm text-muted-foreground">
            已选 {selectedIds.size} / {items.length} 项
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="ml-auto"
            disabled={selectedIds.size === 0}
            onClick={() => setPendingAction('batch')}
          >
            <Trash2 className="size-3.5" />
            删除选中
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPendingAction('clear-read')}
          >
            清空已读
          </Button>
        </div>
      )}

      {/* 列表 */}
      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Bell className="mb-3 size-10 opacity-30" />
          <span>暂无通知</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const isUnread = item.status === 'unread'
              const isExpanded = expandedId === item.id
              const selected = selectedIds.has(item.id)
              return (
                <div
                  key={item.id}
                  className={`cursor-pointer rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50 ${isUnread ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800/40 dark:bg-blue-950/20' : ''} ${selected ? 'ring-1 ring-primary/40' : ''}`}
                  onClick={() => void handleToggleExpand(item.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {/* 行内复选框：stopPropagation 防止触发展开。 */}
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSelected(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`选择通知 ${item.title}`}
                        className="mt-0.5 shrink-0"
                      />
                      {isUnread && (
                        <span className="mt-0.5 size-2 shrink-0 rounded-full bg-blue-500" />
                      )}
                      <span
                        className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-medium ${severityClass(item.severity)}`}
                      >
                        {severityLabel(item.severity)}
                      </span>
                      <span className={`text-sm ${isUnread ? 'font-semibold' : ''}`}>
                        {item.title}
                      </span>
                      {(item.occurrence_count ?? 0) > 1 && (
                        <span className="rounded border px-1 text-xs text-muted-foreground">
                          ×{item.occurrence_count}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
                      {isUnread && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleMarkRead(item.id)
                          }}
                        >
                          标已读
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(item.id)
                        }}
                        aria-label="删除"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {item.message && (
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  )}
                  {isExpanded && renderDetail(item)}
                </div>
              )
            })}
          </div>

          {/* 翻页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}

        </>
      )}
      {activeTab === 'channels' && <TeamNotifications />}
      {activeTab === 'events' && <NotificationEvents />}

      {/* 渠道编辑弹框：就地打开，关闭后不影响通知列表态 */}
      <UnifiedProviderModal
        open={editProviderId !== null}
        providerId={editProviderId ?? undefined}
        initialTab="overview"
        onClose={() => setEditProviderId(null)}
      />

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open && !actionLoading) setPendingAction(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'batch' ? '删除选中通知' : '清空已读通知'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'batch'
                ? `将永久删除选中的 ${selectedIds.size} 条平台通知，操作不可恢复。确认继续？`
                : '将永久删除所有已读平台通知，未读通知保留。操作不可恢复，确认继续？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionLoading}
              onClick={(e) => { e.preventDefault(); void executeAction() }}
            >
              {actionLoading ? <Spinner className="size-4" /> : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  )
}
