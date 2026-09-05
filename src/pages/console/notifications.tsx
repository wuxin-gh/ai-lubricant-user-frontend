/**
 * 用户侧通知中心页：与管理端同构（列表 / 渠道配置 / 订阅配置 三 tab），
 * 但只暴露用户侧事件（任务结束/停留/删除、节点上线）。数据源是用户自己的
 * notifications 行（owner_type='user'），与平台（admin）事件隔离。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { ContentType } from '@/api/Api'
import { sharedApi } from '@/api/shared-api'
import Notifications from '@/components/console/settings/notifications'
import NotificationEvents from '@/pages/manager/platform/NotificationEvents'

const PAGE_SIZE = 20
const _USER_NOTIF = '/api/v1/users/notifications'

type UserNotification = {
  id: number
  severity: string
  kind: string
  event_type?: string | null
  title: string
  message?: string
  status: string
  created_at?: number
  read_at?: number | null
  metadata?: Record<string, unknown>
}

type UserNotificationResponse = {
  code: number
  message?: string
  data?: { items: UserNotification[]; total: number; unread_count: number }
}

/** 通用命令响应：批量删除 / 清空已读 等返回 {code,message,data:{deleted}}。 */
type NotificationCmdResponse = {
  code: number
  message?: string
  data?: { deleted: number }
}

function severityClass(s: string) {
  if (s === 'critical') return 'bg-destructive text-destructive-foreground'
  if (s === 'error') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30'
  if (s === 'warning' || s === 'warn') return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
  return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30'
}

function severityLabel(s: string) {
  if (s === 'critical') return '严重'
  if (s === 'error') return '错误'
  if (s === 'warning' || s === 'warn') return '警告'
  return '信息'
}

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

export default function UserNotificationsPage() {
  const api = sharedApi
  const [items, setItems] = useState<UserNotification[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState<'list' | 'channels' | 'events'>('list')
  // 多选删除：只保留当前页可见项的选中态，翻页/筛选后清空，避免删到看不见的条目。
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [pendingAction, setPendingAction] = useState<'batch' | 'clear-read' | 'clear-all' | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const requestSeqRef = useRef(0)

  const fetchData = useCallback(async (p: number) => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.request<UserNotificationResponse>({
        path: `${_USER_NOTIF}?page=${p}&page_size=${PAGE_SIZE}${severity ? `&severity=${severity}` : ''}${status ? `&status=${status}` : ''}`,
        method: 'GET',
        format: 'json',
      })
      if (seq !== requestSeqRef.current) return
      const payload = res.data
      if (payload?.code === 0 && payload.data) {
        setItems(payload.data.items ?? [])
        setTotal(payload.data.total ?? 0)
        setUnreadCount(payload.data.unread_count ?? 0)
        setSelectedIds(new Set())
      } else {
        setError(payload?.message || '加载通知失败')
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      setError(err instanceof Error ? err.message : '加载通知失败')
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [severity, status])

  useEffect(() => { void fetchData(page) }, [page, fetchData])

  const resetToFirstPage = () => setPage(1)

  const markRead = async (id: number) => {
    try {
      await api.request({ path: `${_USER_NOTIF}/${id}/read`, method: 'PUT', format: 'json' })
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'read' } : item)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      toast.error('标已读失败')
    }
  }

  const markAllRead = async () => {
    try {
      await api.request({ path: `${_USER_NOTIF}/read-all`, method: 'PUT', format: 'json' })
      setUnreadCount(0)
      void fetchData(page)
      toast.success('已标记全部为已读')
    } catch {
      toast.error('操作失败')
    }
  }

  const remove = async (id: number) => {
    try {
      await api.request({ path: `${_USER_NOTIF}/${id}`, method: 'DELETE', format: 'json' })
      const wasUnread = items.find((it) => it.id === id)?.status === 'unread'
      const wasLastOnPage = items.length === 1 && page > 1
      if (wasLastOnPage) {
        setPage((p) => Math.max(1, p - 1))
        return
      }
      setItems((prev) => prev.filter((item) => item.id !== id))
      setTotal((prev) => Math.max(0, prev - 1))
      if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1))
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    } catch {
      toast.error('删除失败')
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

  // 批量删除/清空已读/清空所有 统一走 pendingAction → AlertDialog → execute，二次确认后一次落地。
  const executeAction = async () => {
    if (!pendingAction) return
    setActionLoading(true)
    try {
      let deleted = 0
      if (pendingAction === 'batch') {
        const ids = Array.from(selectedIds)
        const res = await api.request<NotificationCmdResponse>({
          path: `${_USER_NOTIF}/batch-delete`, method: 'POST', type: ContentType.Json, body: { ids }, format: 'json',
        })
        if (res.data?.code !== 0) throw new Error(res.data?.message || '批量删除失败')
        deleted = res.data.data?.deleted ?? 0
      } else {
        // clear-read / clear-all 都是无 body POST：endpoint 不声明 body 参数，不发 Content-Type 也不会 422。
        const sub = pendingAction === 'clear-all' ? 'clear-all' : 'clear-read'
        const res = await api.request<NotificationCmdResponse>({
          path: `${_USER_NOTIF}/${sub}`, method: 'POST', format: 'json',
        })
        if (res.data?.code !== 0) throw new Error(res.data?.message || '清空失败')
        deleted = res.data.data?.deleted ?? 0
      }
      toast.success(`已删除 ${deleted} 条通知`)
      setPendingAction(null)
      setSelectedIds(new Set())
      // 批量删除只动了当前页选中项：删空且非首页回退一页；清空类跨全部页：统一回首页。
      if (pendingAction === 'batch') {
        const emptied = deleted >= items.length
        if (emptied && page > 1) setPage((p) => Math.max(1, p - 1))
        else void fetchData(page)
      } else if (page > 1) {
        setPage(1)
      } else {
        void fetchData(1)
      }
    } catch (err) {
      // api.request 在非 2xx 时抛出的不是 Error，而是带 .error 的响应对象：
      // .error 是后端 JSON 体（{detail} 或 {code,message}），这里尽量把明细提到 toast。
      const body = (err as { error?: { detail?: string; message?: string } })?.error
      const msg = body?.detail || body?.message || (err instanceof Error ? err.message : '') || '操作失败'
      toast.error(msg)
    } finally {
      setActionLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Bell className="size-5" />
          通知中心
          {unreadCount > 0 && (
            <Badge variant="destructive" className="rounded-full px-1.5 text-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchData(page)}>刷新</Button>
          {unreadCount > 0 && <Button size="sm" onClick={() => void markAllRead()}>全部已读</Button>}
        </div>
      </div>

      <div className="flex gap-1 border-b pb-px">
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
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              tab === key
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={severity || '__all__'} onValueChange={(v) => { setSeverity(v === '__all__' ? '' : v); resetToFirstPage() }}>
              <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部级别</SelectItem>
                <SelectItem value="critical">严重</SelectItem>
                <SelectItem value="error">错误</SelectItem>
                <SelectItem value="warn">警告</SelectItem>
                <SelectItem value="info">信息</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status || '__all__'} onValueChange={(v) => { setStatus(v === '__all__' ? '' : v); resetToFirstPage() }}>
              <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                <SelectItem value="unread">未读</SelectItem>
                <SelectItem value="read">已读</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">共 {total} 条</span>
          </div>

          {/* 批量操作条：有列表项才显示，避免空态还顶着一排按钮。 */}
          {!loading && !error && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPendingAction('clear-all')}
              >
                清空所有
              </Button>
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
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
                  const selected = selectedIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border px-4 py-3 ${isUnread ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800/40 dark:bg-blue-950/20' : ''} ${selected ? 'ring-1 ring-primary/40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleSelected(item.id)}
                            aria-label={`选择通知 ${item.title}`}
                            className="mt-0.5 shrink-0"
                          />
                          {isUnread && <span className="mt-0.5 size-2 shrink-0 rounded-full bg-blue-500" />}
                          <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-medium ${severityClass(item.severity)}`}>
                            {severityLabel(item.severity)}
                          </span>
                          <span className={`text-sm ${isUnread ? 'font-semibold' : ''}`}>{item.title}</span>
                          {item.event_type && <Badge variant="outline" className="text-xs">{item.event_type}</Badge>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
                          {isUnread && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void markRead(item.id)}>标已读</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void remove(item.id)} aria-label="删除">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      {item.message && <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>}
                    </div>
                  )
                })}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                  <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {tab === 'channels' && <Notifications />}
      {tab === 'events' && <NotificationEvents scope="user" />}

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open && !actionLoading) setPendingAction(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'batch' ? '删除选中通知' : pendingAction === 'clear-read' ? '清空已读通知' : '清空所有通知'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'batch'
                ? `将永久删除选中的 ${selectedIds.size} 条通知，操作不可恢复。确认继续？`
                : pendingAction === 'clear-read'
                  ? '将永久删除所有已读通知，未读通知保留。操作不可恢复，确认继续？'
                  : '将永久删除全部通知（包括未读），操作不可恢复。确认继续？'}
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
    </div>
  )
}
