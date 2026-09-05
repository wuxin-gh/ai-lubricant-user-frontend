/**
 * 安全中心平台管理页。
 * 从 admin-frontend 的 antd 版（`src/pages/Security/Security.tsx`）重写为 shadcn，
 * 融入 /manager 控制台。数据层继续复用 `@/@admin-port/api/*`（纯 axios），仅重写视图层。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPage, SectionCard, StatCard, StatGrid } from '@/components/manager/platform-page'
import { ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Empty,
  EmptyDescription,
  EmptyHeader,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getSecurityConfig,
  getSecurityEvents,
  getSecurityNotifications,
  getSecurityRules,
  getSecurityStats,
  markAllNotificationsRead,
  markNotificationRead,
  testSecurityRules,
  updateSecurityConfig,
  updateSecurityRules,
} from '@/@admin-port/api/security'
import type {
  Notification,
  RuleTestMatch,
  SensitiveRule,
  SecurityConfig,
  SecurityEvent,
  SecurityStats,
} from '@/@admin-port/types/admin'

// ── 工具函数 ──────────────────────────────────────────────

function severityLabel(sev: string) {
  const map: Record<string, string> = { high: '高危', warn: '警告', info: '信息' }
  return map[sev] || sev
}

function severityColor(sev: string): string {
  if (sev === 'high') return 'red'
  if (sev === 'warn') return 'gold'
  if (sev === 'info') return 'blue'
  return 'default'
}

const BADGE_TONE: Record<string, string> = {
  red: 'border-red-500/40 text-red-600 dark:text-red-400',
  gold: 'border-yellow-500/40 text-yellow-600 dark:text-yellow-400',
  blue: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  default: '',
}

function ToneBadge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn(BADGE_TONE[color] ?? '')}>
      {children}
    </Badge>
  )
}

const DOT_BG: Record<string, string> = {
  red: 'bg-red-500',
  gold: 'bg-yellow-500',
  blue: 'bg-blue-500',
}

function tagLabel(tag: string) {
  const map: Record<string, string> = {
    'secret:anthropic-key': 'Anthropic Key 泄露',
    'secret:openai-key': 'OpenAI Key 泄露',
    'secret:aws-akid': 'AWS Key 泄露',
    'secret:github-pat': 'GitHub Token 泄露',
    'secret:bearer-token': 'Bearer Token 泄露',
    'secret:google-key': 'Google Key 泄露',
    'secret:slack-token': 'Slack Token 泄露',
    'secret:stripe-key': 'Stripe Key 泄露',
    'secret:aws-secret': 'AWS Secret 泄露',
    'injection:instruction-override': '指令覆盖注入',
    'injection:role-override': '角色注入',
    'injection:exfiltration': '数据外泄指令',
    'injection:hidden-chars': '隐藏字符',
    'input:empty-messages': '空消息',
    'input:message-too-large': '消息过大',
    'input:too-many-messages': '消息过多',
    'input:invalid-role': '无效 Role',
  }
  return map[tag] || tag
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatNotifTime(value: unknown): string {
  if (!value) return '-'
  if (typeof value === 'number') {
    return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false })
  }
  if (typeof value === 'string') {
    try {
      return new Date(value).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return value
    }
  }
  return String(value)
}

// 行内代码样式（替代 antd Typography.Text code）
function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-xs', className)}>{children}</code>
  )
}

// 表格加载遮罩（替代 antd Table 的 loading 覆盖层）
function TableLoadingOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
      <Spinner className="size-6" />
    </div>
  )
}

// ── 安全配置面板 ──────────────────────────────────────────

interface ToggleRowProps {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}

function ToggleRow({ title, desc, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3">
      <div className="flex flex-col gap-0.5 pr-3">
        <span className="text-sm">{title}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

function ConfigPanel({ config, onSaved }: { config: SecurityConfig; onSaved: (c: SecurityConfig) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(config)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(config) }, [config])

  function toggle(key: keyof SecurityConfig) {
    setDraft((prev) => ({ ...prev, [key]: !prev[key] } as SecurityConfig))
  }

  function toggleDetector(key: keyof SecurityConfig['detectors']) {
    setDraft((prev) => ({ ...prev, detectors: { ...prev.detectors, [key]: !prev.detectors[key] } } as SecurityConfig))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await updateSecurityConfig(draft)
      if (res.ok) {
        onSaved(draft)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="安全策略"
      description="配置请求安全扫描、凭据遮蔽和各检测器开关"
      extra={
        editing ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setDraft(config); setEditing(false) }}>取消</Button>
            <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? <Spinner className="size-4" /> : null}保存
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>编辑</Button>
        )
      }
    >
      <ToggleRow title="安全模块" desc="总开关：启用后对所有请求执行安全扫描" checked={draft.enabled} disabled={!editing} onChange={() => toggle('enabled')} />
      <ToggleRow title="高危阻断" desc="检测到高危风险时直接拒绝请求（HTTP 400）" checked={draft.block_on_high} disabled={!editing} onChange={() => toggle('block_on_high')} />
      <ToggleRow title="凭据遮蔽" desc="转发请求前将真实密钥替换为假值，防止上游 provider 看到真实凭据" checked={draft.masking_enabled} disabled={!editing} onChange={() => toggle('masking_enabled')} />

      <div className="mt-4 mb-1 text-xs font-semibold tracking-wider text-muted-foreground">检测器</div>
      <ToggleRow title="凭据泄露检测" desc="扫描请求中是否包含 API Key、Bearer Token 等敏感凭据" checked={draft.detectors.credential_leak} disabled={!editing} onChange={() => toggleDetector('credential_leak')} />
      <ToggleRow title="提示注入检测" desc="检测指令覆盖、角色注入、数据外泄指令等注入攻击" checked={draft.detectors.prompt_injection} disabled={!editing} onChange={() => toggleDetector('prompt_injection')} />
      <ToggleRow title="输入校验" desc="校验消息大小、数量和 role 合法性" checked={draft.detectors.input_validation} disabled={!editing} onChange={() => toggleDetector('input_validation')} />

      <div className="mt-4 mb-2 text-xs font-semibold tracking-wider text-muted-foreground">输入限制</div>
      <div className="flex gap-8">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">单条消息最大字节</span>
          {editing ? (
            <Input
              type="number"
              className="w-[140px]"
              min={0}
              value={draft.input_limits.max_message_size_bytes}
              onChange={(e) => setDraft((prev) => ({ ...prev, input_limits: { ...prev.input_limits, max_message_size_bytes: Number(e.target.value || 0) } } as SecurityConfig))}
            />
          ) : (
            <span className="text-sm">{(draft.input_limits.max_message_size_bytes / 1024).toFixed(0)} KB</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">最大消息条数</span>
          {editing ? (
            <Input
              type="number"
              className="w-[140px]"
              min={0}
              value={draft.input_limits.max_messages}
              onChange={(e) => setDraft((prev) => ({ ...prev, input_limits: { ...prev.input_limits, max_messages: Number(e.target.value || 0) } } as SecurityConfig))}
            />
          ) : (
            <span className="text-sm">{draft.input_limits.max_messages}</span>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

// ── 分页控件（替代 antd Pagination） ──────────────────────

function buildPageItems(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(totalPages - 1, current + 1)
  if (start > 2) items.push('ellipsis')
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < totalPages - 1) items.push('ellipsis')
  items.push(totalPages)
  return items
}

function PageBar({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize)
  const items = buildPageItems(page, totalPages)
  return (
    <div className="mt-3 flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
      {items.map((it, idx) =>
        it === 'ellipsis' ? (
          <span key={`e-${idx}`} className="px-2 text-muted-foreground">…</span>
        ) : (
          <Button
            key={it}
            size="icon-sm"
            variant={it === page ? 'outline' : 'ghost'}
            onClick={() => onChange(it)}
          >
            {it}
          </Button>
        ),
      )}
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>下一页</Button>
    </div>
  )
}

// ── 安全事件表格 ──────────────────────────────────────────

const SEVERITY_FILTER_OPTIONS = [
  { value: '', label: '全部级别' },
  { value: 'high', label: '高危' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
]
// radix Select 不允许空字符串 value，用 sentinel 映射「全部」
const ALL_SENTINEL = '__all__'

function EventsPanel() {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [severityFilter, setSeverityFilter] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSecurityEvents({ page, page_size: pageSize, severity: severityFilter || undefined })
      setEvents(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, severityFilter])

  useEffect(() => { void fetchEvents() }, [fetchEvents])

  function renderDetail(row: SecurityEvent) {
    if (!row.detail || typeof row.detail !== 'object') return '-'
    const d = row.detail as Record<string, unknown>
    const preview =
      (typeof d.prefix === 'string' && `前缀: ${d.prefix}***`) ||
      (typeof d.match_preview === 'string' && `匹配: ${d.match_preview}`) ||
      (typeof d.reason === 'string' && d.reason) ||
      (typeof d.role === 'string' && `role: ${d.role}`) ||
      ''
    if (preview) {
      return <span className="text-xs break-all text-muted-foreground">{String(preview).slice(0, 80)}</span>
    }
    const flat = Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
    return flat
      ? <span className="text-xs break-all text-muted-foreground">{flat.slice(0, 80)}</span>
      : <span className="text-muted-foreground">-</span>
  }

  return (
    <SectionCard
      title="安全事件"
      description={`最近检测到的安全风险事件（共 ${total} 条）`}
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={severityFilter === '' ? ALL_SENTINEL : severityFilter}
            onValueChange={(v) => { setSeverityFilter(v === ALL_SENTINEL ? '' : v); setPage(1) }}
          >
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value || ALL_SENTINEL} value={o.value === '' ? ALL_SENTINEL : o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void fetchEvents()}>
            {loading ? <Spinner className="size-4" /> : null}刷新
          </Button>
        </div>
      }
    >
      <div className="relative overflow-x-auto">
        {loading ? <TableLoadingOverlay /> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 160 }}>时间</TableHead>
              <TableHead style={{ width: 80 }}>级别</TableHead>
              <TableHead style={{ width: 180 }}>类型</TableHead>
              <TableHead style={{ width: 140 }}>模型</TableHead>
              <TableHead style={{ width: 120 }}>API Key</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">暂无安全事件</TableCell>
              </TableRow>
            ) : (
              events.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><span className="text-xs text-muted-foreground">{formatTime(row.event_time)}</span></TableCell>
                  <TableCell><ToneBadge color={severityColor(row.severity || '')}>{severityLabel(row.severity || '')}</ToneBadge></TableCell>
                  <TableCell><span className="text-sm">{tagLabel(row.tag || '')}</span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{row.model || '-'}</span></TableCell>
                  <TableCell>
                    {row.api_key
                      ? <Code className="text-[11px]">{row.api_key.slice(0, 8)}…</Code>
                      : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>{renderDetail(row)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {total > pageSize ? (
        <PageBar page={page} pageSize={pageSize} total={total} onChange={(p) => setPage(p)} />
      ) : null}
    </SectionCard>
  )
}

// ── 统计面板 ──────────────────────────────────────────────

function StatsPanel({ stats }: { stats: SecurityStats | null }) {
  if (!stats) return null

  const tagEntries = Object.entries(stats.by_tag || {})
    .map(([tag, count]) => ({ tag, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count)
  const maxCount = tagEntries.reduce((m, e) => Math.max(m, e.count), 0)

  return (
    <>
      <SectionCard title="安全概览" description={`最近 ${stats.hours} 小时的安全事件统计`}>
        <StatGrid columns={4}>
          <StatCard label="事件总数" value={stats.total} />
          <StatCard label="高危事件" value={stats.by_severity?.high || 0} tone="red" />
          <StatCard label="警告事件" value={stats.by_severity?.warn || 0} tone="yellow" />
          <StatCard label="信息事件" value={stats.by_severity?.info || 0} tone="blue" />
        </StatGrid>
      </SectionCard>
      <SectionCard title="规则命中分布" description={`最近 ${stats.hours} 小时按规则 tag 的命中次数（用于识别高频误杀规则）`}>
        {tagEntries.length === 0 ? (
          <Empty className="border-0 p-6">
            <EmptyHeader>
              <EmptyDescription>暂无命中数据</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {tagEntries.map(({ tag, count }) => {
              const percent = maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0
              return (
                <div key={tag} className="flex items-center gap-2.5">
                  <span className="w-[180px] shrink-0 text-[13px]">{tagLabel(tag)}</span>
                  <Progress value={percent} className="min-w-0 flex-1" />
                  <span className="w-14 shrink-0 text-right font-mono text-[13px]">{count}</span>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </>
  )
}

// ── 安全通知面板 ──────────────────────────────────────────

const SEV_COLOR: Record<string, string> = { critical: 'red', error: 'red', warning: 'gold', info: 'blue' }

function NotificationsPanel() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSecurityNotifications(1, 20)
      setNotifications(res.rows || [])
      setTotal(res.total || 0)
      setUnreadCount(res.unread_count || 0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchNotifications() }, [fetchNotifications])

  async function handleMarkRead(id: number) {
    await markNotificationRead(id)
    void fetchNotifications()
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    void fetchNotifications()
  }

  return (
    <SectionCard
      title="安全通知"
      description={unreadCount > 0 ? `${unreadCount} 条未读通知` : `共 ${total} 条通知`}
      extra={unreadCount > 0 ? <Button size="sm" variant="outline" onClick={() => void handleMarkAllRead()}>全部已读</Button> : undefined}
    >
      <div className="relative">
        {loading ? <TableLoadingOverlay /> : null}
        {notifications.length === 0 ? (
          <Empty className="border-0 p-6">
            <EmptyHeader>
              <EmptyDescription>暂无安全通知</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col">
            {notifications.map((n) => {
              const color = SEV_COLOR[n.severity || ''] || 'blue'
              return (
                <div
                  key={n.id}
                  className={cn('flex items-start justify-between gap-3 border-b border-border py-3 last:border-b-0', n.status === 'read' ? 'opacity-60' : '')}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'mt-1.5 inline-block size-2 shrink-0 rounded-full',
                        n.status === 'unread' ? DOT_BG[color] : 'border border-border bg-transparent',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{n.title || '安全通知'}</span>
                        {n.severity ? <ToneBadge color={SEV_COLOR[n.severity] || 'default'}>{n.severity}</ToneBadge> : null}
                      </div>
                      {n.message ? <div className="text-xs text-muted-foreground">{n.message}</div> : null}
                      {n.created_at ? <div className="text-[11px] text-muted-foreground">{formatNotifTime(n.created_at)}</div> : null}
                    </div>
                  </div>
                  {n.status === 'unread' ? (
                    <Button variant="link" size="sm" className="shrink-0" onClick={() => void handleMarkRead(n.id)}>标记已读</Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── 敏感数据规则面板 ──────────────────────────────────────

const RULE_SEVERITY_OPTIONS = [
  { value: 'high', label: '高危' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
]

function makeEmptyRule(): SensitiveRule {
  return {
    id: '',
    label: '',
    pattern: '',
    ignorecase: false,
    severity: 'high',
    detect_enabled: true,
    mask_enabled: true,
    fake: '',
    group: null,
    enabled: true,
    builtin: false,
  }
}

function formatApiError(e: unknown): string {
  const err = e as {
    message?: string
    response?: { data?: { detail?: string; error?: string; errors?: Array<{ index?: number; id?: string; error?: string }> } }
  }
  const data = err.response?.data
  if (data?.errors?.length) {
    return data.errors.map((item) => {
      const pos = item.id || (item.index !== undefined ? `#${item.index + 1}` : '规则')
      return `${pos}: ${item.error || '校验失败'}`
    }).join('；')
  }
  return data?.detail || data?.error || err.message || '操作失败'
}

function normalizeFormRule(values: Partial<SensitiveRule>, builtin: boolean): SensitiveRule {
  return {
    id: String(values.id || '').trim(),
    label: String(values.label || '').trim(),
    pattern: String(values.pattern || ''),
    ignorecase: Boolean(values.ignorecase),
    severity: values.severity || 'high',
    detect_enabled: Boolean(values.detect_enabled),
    mask_enabled: Boolean(values.mask_enabled),
    fake: String(values.fake || ''),
    group: values.group === undefined || values.group === null ? null : Number(values.group),
    enabled: Boolean(values.enabled),
    builtin,
  }
}

function MatchesView({ matches }: { matches: RuleTestMatch[] }) {
  if (matches.length === 0) {
    return (
      <Empty className="border-0 p-6">
        <EmptyHeader>
          <EmptyDescription>暂无命中</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex w-full flex-col gap-2">
      {matches.map((m) => (
        <Card key={m.rule_id} size="sm" className="shadow-none">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <span>{m.label}</span>
              <ToneBadge color={severityColor(m.severity)}>{severityLabel(m.severity)}</ToneBadge>
              <Code>{m.rule_id}</Code>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex w-full flex-col gap-1.5">
              {m.fragments.map((f, idx) => (
                <div key={`${m.rule_id}-${idx}`} className="flex items-start gap-2">
                  <span className="w-20 text-xs text-muted-foreground">{f.start}-{f.end}</span>
                  <Code className="break-all whitespace-pre-wrap">{f.match}</Code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

interface FormErrors {
  id?: string
  label?: string
  pattern?: string
  fake?: string
}

function RulesPanel() {
  const [rules, setRules] = useState<SensitiveRule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testText, setTestText] = useState('')
  const [testMatches, setTestMatches] = useState<RuleTestMatch[]>([])
  const [testing, setTesting] = useState(false)
  const [editorSample, setEditorSample] = useState('')
  const [editorMatches, setEditorMatches] = useState<RuleTestMatch[]>([])
  const [form, setForm] = useState<SensitiveRule>(makeEmptyRule())
  const [errors, setErrors] = useState<FormErrors>({})
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSecurityRules()
      setRules(res.rules || [])
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchRules() }, [fetchRules])

  async function saveRules(next: SensitiveRule[], successText = '规则已保存') {
    setSaving(true)
    try {
      const res = await updateSecurityRules(next)
      setRules(res.rules || next)
      toast.success(successText)
    } catch (e) {
      toast.error(formatApiError(e))
      throw e
    } finally {
      setSaving(false)
    }
  }

  async function patchRule(index: number, patch: Partial<SensitiveRule>) {
    const prev = rules
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    setRules(next)
    try {
      await saveRules(next)
    } catch {
      setRules(prev)
    }
  }

  async function moveRule(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    const current = next[index]
    next[index] = next[target]
    next[target] = current
    await saveRules(next, '规则顺序已保存')
  }

  // 校验必填字段（替代 antd Form 的 rules）
  function validateForm(): boolean {
    const next: FormErrors = {}
    if (!String(form.id || '').trim()) next.id = '请输入规则 ID'
    if (!String(form.label || '').trim()) next.label = '请输入名称'
    if (!String(form.pattern || '').trim()) next.pattern = '请输入正则表达式'
    if (!String(form.fake || '').trim()) next.fake = '请输入遮蔽替换值'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function openAdd() {
    setEditingIndex(null)
    setEditorSample('')
    setEditorMatches([])
    setErrors({})
    setForm(makeEmptyRule())
    setEditorOpen(true)
  }

  function openEdit(index: number) {
    setEditingIndex(index)
    setEditorSample('')
    setEditorMatches([])
    setErrors({})
    setForm({ ...rules[index] })
    setEditorOpen(true)
  }

  async function handleEditorSave() {
    if (!validateForm()) return
    const builtin = editingIndex === null ? false : Boolean(rules[editingIndex]?.builtin)
    const rule = normalizeFormRule(form, builtin)
    const dup = rules.some((item, idx) => item.id === rule.id && idx !== editingIndex)
    if (dup) {
      toast.error(`id 重复: ${rule.id}`)
      return
    }
    const next = editingIndex === null
      ? [...rules, rule]
      : rules.map((item, idx) => (idx === editingIndex ? rule : item))
    await saveRules(next)
    setEditorOpen(false)
  }

  async function confirmDelete() {
    if (deleteIndex === null) return
    const index = deleteIndex
    const next = rules.filter((_, i) => i !== index)
    setDeleteIndex(null)
    await saveRules(next, '规则已删除')
  }

  async function runTest() {
    if (!testText.trim()) {
      toast.warning('请输入测试文本')
      return
    }
    setTesting(true)
    try {
      const res = await testSecurityRules(testText)
      setTestMatches(res.matches || [])
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setTesting(false)
    }
  }

  async function runEditorTest() {
    if (!editorSample.trim()) {
      toast.warning('请输入测试文本')
      return
    }
    if (!validateForm()) return
    const builtin = editingIndex === null ? false : Boolean(rules[editingIndex]?.builtin)
    const rule = normalizeFormRule(form, builtin)
    setTesting(true)
    try {
      const res = await testSecurityRules(editorSample, rule)
      setEditorMatches(res.matches || [])
    } catch (e) {
      toast.error(formatApiError(e))
    } finally {
      setTesting(false)
    }
  }

  const deleteRuleRef = deleteIndex !== null ? rules[deleteIndex] : null

  return (
    <SectionCard
      title="敏感数据规则"
      description="统一管理凭据泄露检测与转发前遮蔽正则，规则顺序会影响遮蔽优先级"
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>测试规则</Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void fetchRules()}>
            {loading ? <Spinner className="size-4" /> : null}刷新
          </Button>
          <Button size="sm" onClick={openAdd}>新增规则</Button>
        </div>
      }
    >
      <Alert className="mb-3">
        <Info className="size-4" />
        <AlertDescription>规则同时服务于敏感数据检测与凭据遮蔽；内置规则也可以编辑或删除。</AlertDescription>
      </Alert>

      <TooltipProvider>
        <div className="relative overflow-x-auto">
          {loading || saving ? <TableLoadingOverlay /> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 220 }}>规则</TableHead>
                <TableHead>正则</TableHead>
                <TableHead style={{ width: 80 }}>级别</TableHead>
                <TableHead style={{ width: 80 }}>检测</TableHead>
                <TableHead style={{ width: 80 }}>遮蔽</TableHead>
                <TableHead style={{ width: 80 }}>启用</TableHead>
                <TableHead style={{ width: 210 }}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">暂无敏感数据规则</TableCell>
                </TableRow>
              ) : (
                rules.map((row, index) => (
                  <TableRow key={`${row.id}-${index}`}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{row.label}</span>
                          {row.builtin ? <ToneBadge color="blue">内置</ToneBadge> : <Badge variant="outline">自定义</Badge>}
                        </div>
                        <Code className="text-[11px]">{row.id}</Code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block max-w-[360px] overflow-hidden align-bottom">
                            <Code className="block overflow-hidden text-ellipsis whitespace-nowrap">{row.pattern}</Code>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <pre className="m-0 whitespace-pre-wrap">{row.pattern}</pre>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell><ToneBadge color={severityColor(row.severity)}>{severityLabel(row.severity)}</ToneBadge></TableCell>
                    <TableCell><Switch size="sm" checked={row.detect_enabled} disabled={saving} onCheckedChange={(checked) => void patchRule(index, { detect_enabled: checked })} /></TableCell>
                    <TableCell><Switch size="sm" checked={row.mask_enabled} disabled={saving} onCheckedChange={(checked) => void patchRule(index, { mask_enabled: checked })} /></TableCell>
                    <TableCell><Switch size="sm" checked={row.enabled} disabled={saving} onCheckedChange={(checked) => void patchRule(index, { enabled: checked })} /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button variant="link" size="sm" onClick={() => openEdit(index)}>编辑</Button>
                        <Button variant="link" size="sm" disabled={index === 0 || saving} onClick={() => void moveRule(index, -1)}>上移</Button>
                        <Button variant="link" size="sm" disabled={index === rules.length - 1 || saving} onClick={() => void moveRule(index, 1)}>下移</Button>
                        <Button variant="link" size="sm" className="text-destructive" onClick={() => setDeleteIndex(index)}>删除</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>

      {/* 新增/编辑规则弹窗 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{editingIndex === null ? '新增敏感数据规则' : '编辑敏感数据规则'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>规则 ID</Label>
                <Input
                  value={form.id}
                  disabled={editingIndex !== null}
                  placeholder="custom-secret"
                  aria-invalid={!!errors.id}
                  onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                />
                {errors.id ? <span className="text-xs text-destructive">{errors.id}</span> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>名称</Label>
                <Input
                  value={form.label}
                  placeholder="自定义敏感数据"
                  aria-invalid={!!errors.label}
                  onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                />
                {errors.label ? <span className="text-xs text-destructive">{errors.label}</span> : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>正则表达式</Label>
              <Textarea
                rows={3}
                className="font-mono"
                value={form.pattern}
                placeholder="secret-[A-Za-z0-9]{20,}"
                aria-invalid={!!errors.pattern}
                onChange={(e) => setForm((p) => ({ ...p, pattern: e.target.value }))}
              />
              {errors.pattern ? <span className="text-xs text-destructive">{errors.pattern}</span> : null}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>风险级别</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((p) => ({ ...p, severity: v as SensitiveRule['severity'] }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_SEVERITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>遮蔽捕获组</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-full"
                  placeholder="留空=整个匹配"
                  value={form.group ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, group: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>忽略大小写</Label>
                <div className="flex h-9 items-center">
                  <Switch checked={form.ignorecase} onCheckedChange={(c) => setForm((p) => ({ ...p, ignorecase: c }))} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>遮蔽替换值</Label>
              <Input
                value={form.fake}
                placeholder="REDACTED_SECRET"
                aria-invalid={!!errors.fake}
                onChange={(e) => setForm((p) => ({ ...p, fake: e.target.value }))}
              />
              {errors.fake ? <span className="text-xs text-destructive">{errors.fake}</span> : null}
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1.5">
                <Label>参与检测</Label>
                <Switch checked={form.detect_enabled} onCheckedChange={(c) => setForm((p) => ({ ...p, detect_enabled: c }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>参与遮蔽</Label>
                <Switch checked={form.mask_enabled} onCheckedChange={(c) => setForm((p) => ({ ...p, mask_enabled: c }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>总启用</Label>
                <Switch checked={form.enabled} onCheckedChange={(c) => setForm((p) => ({ ...p, enabled: c }))} />
              </div>
            </div>

            <Card size="sm" className="mt-2 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">测试当前规则</CardTitle>
                <CardAction>
                  <Button size="sm" variant="outline" disabled={testing} onClick={() => void runEditorTest()}>
                    {testing ? <Spinner className="size-4" /> : null}运行测试
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={3}
                  value={editorSample}
                  placeholder="输入一段示例文本，测试当前表单里的正则"
                  onChange={(e) => setEditorSample(e.target.value)}
                />
                <div className="mt-3"><MatchesView matches={editorMatches} /></div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>取消</Button>
            <Button disabled={saving} onClick={() => void handleEditorSave()}>
              {saving ? <Spinner className="size-4" /> : null}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试全部规则弹窗 */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>测试敏感数据规则</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            value={testText}
            placeholder="输入示例文本，系统会用当前保存的全部规则进行匹配"
            onChange={(e) => setTestText(e.target.value)}
          />
          <div className="mt-3"><MatchesView matches={testMatches} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>关闭</Button>
            <Button disabled={testing} onClick={() => void runTest()}>
              {testing ? <Spinner className="size-4" /> : null}运行测试
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => { if (!open) setDeleteIndex(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除敏感数据规则</AlertDialogTitle>
            <AlertDialogDescription>
              {`确定删除「${deleteRuleRef?.label || deleteRuleRef?.id || ''}」吗？内置规则删除后也不会再参与检测/遮蔽。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}

// ── 主页面 ────────────────────────────────────────────────

export function Security() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<SecurityConfig | null>(null)
  const [stats, setStats] = useState<SecurityStats | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [cfg, st] = await Promise.all([getSecurityConfig(), getSecurityStats(24)])
      setConfig(cfg)
      setStats(st)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  if (loading) {
    return (
      <AdminPage
        title="安全中心"
        description="请求安全扫描、凭据遮蔽和风险检测"
        primaryActions={<ManagerRefreshButton loading onClick={() => void fetchData()} />}
      >
        <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
      </AdminPage>
    )
  }

  if (error) {
    return (
      <AdminPage
        title="安全中心"
        description="请求安全扫描、凭据遮蔽和风险检测"
        primaryActions={<ManagerRefreshButton loading onClick={() => void fetchData()} />}
      >
        <Alert variant="destructive">
          <Info className="size-4" />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void fetchData()}>重试</Button>
          </AlertAction>
        </Alert>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title="安全中心"
      description="请求安全扫描、凭据遮蔽和风险事件监控"
      primaryActions={<ManagerRefreshButton loading={loading} onClick={() => void fetchData()} />}
    >
      <StatsPanel stats={stats} />
      {config ? <ConfigPanel config={config} onSaved={(c) => { setConfig(c); toast.success('安全配置已保存') }} /> : null}
      <RulesPanel />
      <NotificationsPanel />
      <EventsPanel />
    </AdminPage>
  )
}

export default Security
