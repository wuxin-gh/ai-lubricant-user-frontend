import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Descriptions,
  Empty,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  getNotificationSummary,
  getNotifications,
  getNotificationDetail,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
} from '../../api/dashboard'
import type { Notification, NotificationSummary } from '../../api/dashboard'
// 复用渠道页的渠道编辑弹框，就地打开（不跳转渠道页）。
import { UnifiedProviderModal } from '@/pages/manager/platform/Channels'

const SEVERITY_OPTIONS = [
  { value: '', label: '全部级别' },
  { value: 'critical', label: '严重' },
  { value: 'error', label: '错误' },
  { value: 'warning', label: '警告' },
  { value: 'info', label: '信息' },
]

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
]

function severityColor(s: string) {
  switch (s) {
    case 'critical':
      return 'red'
    case 'error':
      return 'volcano'
    case 'warning':
      return 'gold'
    default:
      return 'blue'
  }
}

function severityLabel(s: string) {
  if (s === 'critical') return '严重'
  if (s === 'error') return '错误'
  if (s === 'warning') return '警告'
  return s || '信息'
}

/** 后端把时间序列化为 unix 秒（float）；这里统一转毫秒再算相对时间。 */
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

interface Props {
  open: boolean
  onClose: () => void
}

export function NotificationsDialog({ open, onClose }: Props) {
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailCache, setDetailCache] = useState<Record<number, Notification>>({})
  // 就地打开的渠道编辑弹框：只保存渠道 id，弹框自行加载详情。
  const [editProviderId, setEditProviderId] = useState<string | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null)
  const pageSize = 15

  const fetchData = useCallback(
    async (p: number) => {
      setLoading(true)
      setError(null)
      try {
        const res = await getNotifications({
          page: p,
          page_size: pageSize,
          severity: severity || undefined,
          status: status || undefined,
        })
        setItems(res.items || [])
        setTotal(res.total || 0)
        setUnreadCount(res.unread_count || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载通知失败')
      } finally {
        setLoading(false)
      }
    },
    [severity, status],
  )

  useEffect(() => {
    if (open) {
      setPage(1)
      void fetchData(1)
    }
  }, [open, fetchData])

  useEffect(() => {
    if (!open) return
    void fetchData(page)
  }, [page, open, fetchData])

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead()
      void fetchData(page)
      message.success('已标记全部为已读')
    } catch {
      message.error('操作失败')
    }
  }

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id)
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'read' as const } : item)),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      message.error('标已读失败')
    }
  }

  // 单条删除：弹框内不做多选（窄弹窗不适合批量勾选），只提供逐条删除。
  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '删除该通知',
      content: '删除后不可恢复，确认继续？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteNotification(id)
          setTotal((prev) => Math.max(0, prev - 1))
          // 当前页删空且非首页：回退一页（fetchData 由 page effect 触发）；否则原地重拉。
          if (items.length === 1 && page > 1) {
            setPage((p) => Math.max(1, p - 1))
          } else {
            void fetchData(page)
          }
          message.success('已删除通知')
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败')
        }
      },
    })
  }

  // 展开时按需拉取单条详情（含 detail 长文本），列表接口不返回 detail 以保持轻量。
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
        message.error('加载详情失败')
      } finally {
        setDetailLoadingId((prev) => (prev === id ? null : prev))
      }
    },
    [expandedId, detailCache],
  )

  // 点击「渠道」就在通知弹框内就地打开该渠道的编辑弹框：渠道 id 即渠道名，直接传给弹框。
  const openChannelEditor = (providerName: string) => {
    setEditProviderId(providerName)
  }

  // 展开区：优先用 detailCache（含 detail 长文本 + 完整字段），否则回落到列表行。
  const renderDetail = (item: Notification) => {
    const full = detailCache[item.id] ?? item
    const loadingDetail = detailLoadingId === item.id && !detailCache[item.id]
    const infoRows: { label: string; value: ReactNode }[] = []
    if (full.source) infoRows.push({ label: '来源', value: full.source })
    if (full.kind) infoRows.push({ label: '类型', value: full.kind })
    if (full.provider_name) {
      // 「渠道」可点击：就地打开该渠道的编辑弹框（不关闭通知弹框、不跳转渠道页）。
      const providerName = full.provider_name
      infoRows.push({
        label: '渠道',
        value: (
          <Typography.Link
            onClick={(e) => {
              e.stopPropagation()
              openChannelEditor(providerName)
            }}
          >
            {providerName}
          </Typography.Link>
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
    if (full.request_log_id) {
      infoRows.push({ label: '请求日志', value: `#${full.request_log_id}` })
    }
    const metaKeys = full.metadata ? Object.keys(full.metadata) : []

    return (
      <div
        style={{ marginTop: 10, borderTop: '1px solid var(--admin-border)', paddingTop: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        {loadingDetail ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Spin size="small" />
          </div>
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {infoRows.length > 0 ? (
              <Descriptions
                size="small"
                column={2}
                colon={false}
                items={infoRows.map((r, i) => ({
                  key: i,
                  label: (
                    <span style={{ color: 'var(--text2)', fontSize: 12 }}>{r.label}</span>
                  ),
                  children: <span style={{ fontSize: 12 }}>{r.value}</span>,
                }))}
              />
            ) : null}
            {full.detail ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  详情
                </Typography.Text>
                <pre
                  style={{
                    margin: '4px 0 0',
                    padding: '8px 10px',
                    background: 'var(--bg2, rgba(0,0,0,0.03))',
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 260,
                    overflowY: 'auto',
                  }}
                >
                  {full.detail}
                </pre>
              </div>
            ) : null}
            {metaKeys.length > 0 ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  元数据
                </Typography.Text>
                <pre
                  style={{
                    margin: '4px 0 0',
                    padding: '8px 10px',
                    background: 'var(--bg2, rgba(0,0,0,0.03))',
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  {JSON.stringify(full.metadata, null, 2)}
                </pre>
              </div>
            ) : null}
            {!full.detail && metaKeys.length === 0 && infoRows.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                暂无更多详情
              </Typography.Text>
            ) : null}
          </Space>
        )}
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const body = useMemo(() => {
    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
        </div>
      )
    }
    if (error) return <Empty description={error} />
    if (items.length === 0) return <Empty description="暂无通知" />

    return (
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {items.map((item) => {
          const isUnread = item.status === 'unread'
          const isExpanded = expandedId === item.id
          return (
            <div
              key={item.id}
              style={{
                border: '1px solid var(--admin-border)',
                borderRadius: 6,
                padding: '10px 12px',
                background: isUnread ? 'rgba(96,165,250,0.06)' : 'transparent',
                cursor: 'pointer',
              }}
              onClick={() => void handleToggleExpand(item.id)}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={6}>
                  {isUnread ? <Badge status="processing" /> : null}
                  <Tag color={severityColor(item.severity)}>{severityLabel(item.severity)}</Tag>
                  <Typography.Text strong={isUnread}>{item.title}</Typography.Text>
                  {(item.occurrence_count ?? 0) > 1 ? (
                    <Tag color="default">×{item.occurrence_count}</Tag>
                  ) : null}
                </Space>
                <Space size={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {timeAgo(item.created_at)}
                  </Typography.Text>
                  {isUnread ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleMarkRead(item.id)
                      }}
                    >
                      标已读
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(item.id)
                    }}
                    aria-label="删除"
                  >
                    <Trash2 style={{ fontSize: 14 }} />
                  </Button>
                </Space>
              </Space>
              {item.message ? (
                <div style={{ marginTop: 4, color: 'var(--text2)', fontSize: 13 }}>
                  {item.message}
                </div>
              ) : null}
              {isExpanded ? renderDetail(item) : null}
            </div>
          )
        })}
      </Space>
    )
  }, [error, items, expandedId, loading, detailCache, detailLoadingId, handleToggleExpand])

  return (
    <Modal
      title={
        <Space>
          <span>通知中心</span>
          {unreadCount > 0 ? <Badge count={unreadCount} /> : null}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={620}
    >
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Select
            value={severity}
            options={SEVERITY_OPTIONS}
            onChange={(v) => {
              setSeverity(v)
              setPage(1)
            }}
            style={{ width: 130 }}
          />
          <Select
            value={status}
            options={STATUS_OPTIONS}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            style={{ width: 130 }}
          />
          <Typography.Text type="secondary">共 {total} 条</Typography.Text>
        </Space>
        {unreadCount > 0 ? (
          <Button size="small" onClick={handleMarkAllRead}>
            全部已读
          </Button>
        ) : null}
      </Space>

      <div style={{ maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 }}>{body}</div>

      {totalPages > 1 ? (
        <Space
          style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
        >
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <Typography.Text type="secondary">
            {page} / {totalPages}
          </Typography.Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </Space>
      ) : null}

      {/* 渠道编辑弹框：就地打开，关闭后不影响通知列表态 */}
      <UnifiedProviderModal
        open={editProviderId !== null}
        providerId={editProviderId ?? undefined}
        initialTab="overview"
        onClose={() => setEditProviderId(null)}
      />
    </Modal>
  )
}

/**
 * 获取未读通知数，用于在菜单项旁显示 badge
 */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const summary: NotificationSummary = await getNotificationSummary()
    return summary.unread_count || 0
  } catch {
    return 0
  }
}
