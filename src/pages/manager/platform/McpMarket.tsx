/**
 * MCP 市场（平台管理页）。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/mcp`（纯 axios）。
 * 交互、状态、API 调用、修订冲突处理、一次性 token 流程、热重载语义、manifest 驱动面板逻辑均与原版保持一致。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronsUpDown, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPage } from '@/components/manager/platform-page'
import { ManagerRefreshButton } from '@/components/manager/manager-header-actions'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { McpUserPermissionEditor, type PermissionEditorApi } from '@/components/console/mcp/McpUserPermissionEditor'
import { McpUserManagerDialog, type McpUserManagerApi } from '@/components/console/mcp/McpUserManagerDialog'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
import { McpServiceDialog } from './McpServiceDialog'
import { McpGithubImportDialog, type McpGithubImportPayload } from '@/components/manager/McpGithubImportDialog'
import {
  listMcpServices, deleteMcpService,
  testMcpService, getMcpServiceTools, listMcpEnvVars, saveMcpEnvVars, getMcpClientConfig,
  listMcpUsers, createMcpUser, updateMcpUser, deleteMcpUser, rotateMcpUserToken,
  getAgentByMcpUser,
  getMcpUserParams, setMcpUserParams, listMcpUserAuthorizationOptions,
  getServiceUsers, setServiceUsers,
  getMcpMarketSettings,
  listMcpServiceManifests, reloadMcpService,
  getMcpInstallStatus,
  getMcpServiceConfiguration, listMcpResource, createMcpResource, updateMcpResource, deleteMcpResource,
  rotateMcpResourceToken, revokeMcpResourceToken,
  queryMcpView, executeMcpAction,
  getMcpServiceSop, saveMcpServiceSop,
  type McpService, type CreateMcpPayload, type UpdateMcpPayload,
  type McpTool, type McpEnvVar, type McpClientConfig, type McpUser,
  type McpServiceManifest, type McpServiceManifestEntry, type McpManifestAction,
  type McpConfigField,
  type McpSopFile,
  type McpMarketSettings,
  type McpConfigurationContract, type McpResourceDefinition, type McpApplyResult,
  type McpViewDefinition, type McpActionDefinition, type McpReferenceOptions,
} from '@/@admin-port/api/mcp'
import { fetchMarketIndex, isMarketplaceEnabled, manifestToMcpService, MARKET_SOURCE, type MarketManifest } from '@/api/marketplaceRaw'

const CATEGORIES = ['全部', 'browser', 'search', 'file', 'code', 'media', 'custom'] as const

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  system: { label: '系统内置', color: '#38bdf8' },
  official: { label: '官方', color: '#22d3ee' },
  smithery: { label: 'Smithery', color: '#a78bfa' },
  'mcp.so': { label: 'mcp.so', color: '#f59e0b' },
  community: { label: '社区', color: '#94a3b8' },
  catalog: { label: '内置目录', color: '#818cf8' },
  [MARKET_SOURCE]: { label: 'GitHub 市场', color: '#22c55e' },
}

type TopTab = 'installed' | 'catalog'

type OptionValue = string | number
interface RefOption { value: OptionValue; label: string }

// =============================================================================
// 通用确认弹层：替代 antd Modal.confirm（受控 AlertDialog）
// =============================================================================
interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

function useConfirm() {
  const [state, setState] = useState<ConfirmOptions | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useCallback((opts: ConfirmOptions) => setState(opts), [])
  const node = (
    <AlertDialog open={!!state} onOpenChange={(o) => { if (!o && !busy) setState(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          {state?.description ? <AlertDialogDescription>{state.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{state?.cancelText || '取消'}</AlertDialogCancel>
          <Button
            variant={state?.destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={async () => {
              if (!state) return
              setBusy(true)
              try { await state.onConfirm() } finally { setBusy(false); setState(null) }
            }}
          >
            {state?.confirmText || '确定'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { confirm, confirmNode: node }
}

// =============================================================================
// 多选（可搜索，替代 antd Select mode="multiple"），值类型 string|number
// =============================================================================
function MultiSelect({ value, onChange, options, placeholder, disabled }: {
  value: OptionValue[]
  onChange: (value: OptionValue[]) => void
  options: RefOption[]
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedSet = new Set(value.map((v) => String(v)))
  const labelOf = (v: OptionValue) => options.find((o) => String(o.value) === String(v))?.label ?? String(v)
  const toggle = (v: OptionValue) => {
    if (selectedSet.has(String(v))) onChange(value.filter((item) => String(item) !== String(v)))
    else onChange([...value, v])
  }
  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="h-auto min-h-9 w-full justify-between">
          <span className="flex flex-1 flex-wrap items-center gap-1 py-0.5 text-left">
            {value.length ? (
              value.map((v) => (
                <Badge key={String(v)} variant="secondary" className="gap-1">
                  {labelOf(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="opacity-60 hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); toggle(v) }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem key={String(opt.value)} value={String(opt.value)} onSelect={() => toggle(opt.value)}>
                <span className="flex-1">{opt.label}</span>
                {selectedSet.has(String(opt.value)) ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// 单选（可搜索、可清除）：替代 antd Select showSearch allowClear
function SearchSelect({ value, onChange, options, placeholder }: {
  value: OptionValue | undefined
  onChange: (value: OptionValue | undefined) => void
  options: RefOption[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedLabel = value != null ? options.find((o) => String(o.value) === String(value))?.label ?? String(value) : ''
  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('flex-1 truncate text-left', value != null ? '' : 'text-muted-foreground')}>
            {value != null ? selectedLabel : placeholder}
          </span>
          <span className="flex items-center gap-1">
            {value != null ? (
              <span
                role="button"
                tabIndex={-1}
                className="opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onChange(undefined) }}
              >
                <X className="size-4" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem
                key={String(opt.value)}
                value={String(opt.value)}
                onSelect={() => { onChange(opt.value); setOpen(false) }}
              >
                <span className="flex-1">{opt.label}</span>
                {value != null && String(value) === String(opt.value) ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// 带显示/隐藏切换的密文输入（替代 antd Input.Password）
function PasswordInput({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pr-9"
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShow((s) => !s)}
      >
        {show ? '隐藏' : '显示'}
      </button>
    </div>
  )
}

// 小卡片：模拟 antd 的 <Card size="small" title extra>（标题行 + body）。
function SectionCardLike({ title, extra, children, className, bodyClassName }: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card size="sm" className={cn('shadow-none', className)}>
      {(title || extra) ? (
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          {title ? <CardTitle className="text-sm">{title}</CardTitle> : <span />}
          {extra ? <div className="flex items-center gap-2">{extra}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  )
}

export function McpMarket({ initialTab = "installed", lockTab = false, bare = false }: { initialTab?: TopTab; lockTab?: boolean; bare?: boolean } = {}) {
  const [tab, setTab] = useState<TopTab>(initialTab)
  const [services, setServices] = useState<McpService[]>([])
  const [catalog, setCatalog] = useState<McpService[]>([])
  const [manifests, setManifests] = useState<Record<string, McpServiceManifest>>({})
  const [loading, setLoading] = useState(true)
  const [marketConfigured, setMarketConfigured] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<string>('全部')
  const [sourceFilter, setSourceFilter] = useState<string>('全部')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [editing, setEditing] = useState<McpService | null>(null)
  const [installing, setInstalling] = useState<McpService | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [manage, setManage] = useState<McpService | null>(null)
  const [managePanel, setManagePanel] = useState<string>('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPrincipalId, setSettingsPrincipalId] = useState<number | null>(null)
  const openUserDetail = (principalId: number) => {
    setSettingsPrincipalId(principalId)
    setSettingsOpen(true)
  }
  // 形态 C：部署 stdio 到执行节点的选择弹窗
  const [deployTarget, setDeployTarget] = useState<McpService | null>(null)
  const [deployNodes, setDeployNodes] = useState<any[]>([])
  const [deployNodeId, setDeployNodeId] = useState('')
  const [deploying, setDeploying] = useState(false)

  const { confirm, confirmNode } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [svc, mans, marketItems, marketEnabled] = await Promise.all([
        listMcpServices().catch(() => []),
        listMcpServiceManifests().catch(() => [] as McpServiceManifestEntry[]),
        // GitHub 市场（modules/mcp）：服务端代理读取已验证 marketplace 配置；未配置/失败返回 []。
        fetchMarketIndex('mcp').catch(() => []),
        // 同步判断市场是否已配置且验证通过：决定市场 tab 是显示条目还是「市场未配置」。
        isMarketplaceEnabled().catch(() => false),
      ])
      // 内置工具（CDP / 邮箱等）不在「MCP 市场」展示，改为用户侧「内置工具」独立管理
      //（用户拥有实例 + token 分享，见 /console 内置工具页）。市场只留外部第三方 MCP。
      setServices(svc.filter((s) => !s.builtin && !BUILTIN_TOOLS_MOVED_OUT.has(s.name || "")))
      // 市场不再合并旧本地 catalog 残留：只展示已验证 marketplace index 的条目；
      // 未配置市场时 catalog 为空，UI 显示「市场未配置」。已安装状态仍由本地 services 映射。
      setMarketConfigured(!!marketEnabled)
      const installedNames = new Set(
        svc.filter((s) => !s.builtin && !BUILTIN_TOOLS_MOVED_OUT.has(s.name || "")).map((s) => s.name),
      )
      const marketCatalog = marketItems
        .map((it) => ({
          id: `market:${it.id}`,
          name: it.name || it.id,
          display_name: it.display_name || it.name || it.id,
          description: it.summary || '',
          category: it.category || 'custom',
          version: it.latest_version || null,
          author: it.publisher || null,
          source: MARKET_SOURCE,
          template: true,
          builtin: false,
          enabled: true,
          transport: 'streamable-http',
          command: null,
          args: [],
          env_template: {},
          url: null,
          icon: null,
          docs_url: null,
          tools_cache: null,
          tools_cached_at: null,
          created_at: '',
          updated_at: '',
          __market_id: it.id,
          __installed: installedNames.has(it.name || it.id),
        })) as unknown as McpService[]
      setCatalog(marketCatalog)
      const map: Record<string, McpServiceManifest> = {}
      mans.forEach((m) => { if (m?.service?.name && m?.manifest) map[m.service.name] = m.manifest })
      setManifests(map)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 安装进度轮询：全局形态服务若处于中间态（configuring/starting/testing），
  // 定时拉 install/status 把步骤合进 services，卡片步骤条自动推进。
  // session 形态无安装流程、ready/error 是终态，都不轮询。
  useEffect(() => {
    const pending = services.filter(
      s => s.deploy_scope !== 'session'
        && s.deploy_scope !== undefined
        && ['configuring', 'starting', 'testing', 'created'].includes(s.install_state || '')
    )
    if (pending.length === 0) return
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        pending.map(s => getMcpInstallStatus(s.id).catch(() => null))
      )
      setServices(prev => prev.map(svc => {
        const u = updates.find(x => x && x.id === svc.id)
        if (!u) return svc
        return { ...svc, install_state: u.install_state, install_step: u.install_step,
          install_error: u.install_error, tools_cache: svc.tools_cache }
      }))
    }, 2000)
    return () => clearInterval(timer)
  }, [services])

  const installedNames = useMemo(() => new Set(services.map(s => s.name)), [services])

  const filteredInstalled = useMemo(() => {
    if (filter === '全部') return services
    return services.filter(s => s.category === filter)
  }, [services, filter])

  const filteredCatalog = useMemo(() => {
    let items = catalog
    if (sourceFilter !== '全部') items = items.filter(s => (s.source || 'catalog') === sourceFilter)
    if (filter !== '全部') items = items.filter(s => s.category === filter)
    return items
  }, [catalog, filter, sourceFilter])

  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    catalog.forEach(s => set.add(s.source || 'catalog'))
    return ['全部', ...Array.from(set)]
  }, [catalog])

  const handleCreate = () => { setEditing(null); setInstalling(null); setDialogOpen(true) }

  const handleGithubCreate = async (p: McpGithubImportPayload) => {
    const { createMcpService } = await import('@/@admin-port/api/mcp')
    await createMcpService({
      name: p.name,
      display_name: p.display_name,
      description: p.description,
      category: 'custom',
      transport: p.transport,
      command: p.command || undefined,
      url: p.url || undefined,
      docs_url: p.docs_url || undefined,
      env_template: {},
      source: 'github',
      template: false,
      enabled: true,
    } as CreateMcpPayload)
    await load()
    toast.success(`已从 GitHub 识别并创建 MCP「${p.name}」`)
    setTab('installed')
  }

  const handleInstallFromCatalog = async (svc: McpService) => {
    // 市场只负责下载：从 manifest/catalog 直接创建本地服务。连接参数、运行设置、
    // MCP 用户授权统一在「MCP」管理 Tab 操作，不能在市场打开编辑弹框。
    try {
      const marketId = (svc as unknown as { __market_id?: string }).__market_id
      if (marketId) {
        const { fetchMarketManifest } = await import('@/api/marketplaceRaw')
        const manifest = await fetchMarketManifest('mcp', marketId)
        if (!manifest) {
          toast.error('拉取市场 manifest 失败，请稍后重试')
          return
        }
        const mapped = manifestToMcpService(manifest as MarketManifest)
        await (await import('@/@admin-port/api/mcp')).createMcpService({
          ...mapped,
          template: false,
          market_id: marketId,
          market_version: svc.version || '',
        })
      } else {
        await (await import('@/@admin-port/api/mcp')).createMcpService({
          name: svc.name,
          display_name: svc.display_name,
          description: svc.description,
          category: svc.category,
          transport: svc.transport,
          command: svc.command,
          args: svc.args,
          env_template: svc.env_template,
          url: svc.url,
          version: svc.version || undefined,
          author: svc.author || undefined,
          docs_url: svc.docs_url || undefined,
          source: svc.source || undefined,
          template: false,
        })
      }
      toast.success('已下载。请到「MCP」Tab 完成连接与权限管理。')
      await load()
    } catch (e: any) {
      toast.error(`下载失败: ${e?.message || '未知错误'}`)
    }
  }
  const handleEdit = (svc: McpService) => { setEditing(svc); setInstalling(null); setDialogOpen(true) }

  const handleSave = async (payload: CreateMcpPayload | UpdateMcpPayload, isEdit: boolean) => {
    if (isEdit && editing) {
      await (await import('@/@admin-port/api/mcp')).updateMcpService(editing.id, payload as UpdateMcpPayload)
    } else {
      await (await import('@/@admin-port/api/mcp')).createMcpService({
        ...(payload as CreateMcpPayload),
        ...(installing && (installing as unknown as { __market_id?: string }).__market_id
          ? { market_id: (installing as unknown as { __market_id: string }).__market_id, market_version: installing.version || "" }
          : {}),
        template: false,
      })
    }
    await load()
    if (!isEdit) setTab('installed')
  }

  const handleTest = async (id: number) => {
    setTesting(id)
    try {
      const result = await testMcpService(id)
      if (result.ok) toast.success(`配置与可达性检查成功: ${result.message || '目标可访问'}`)
      else toast.error(`配置与可达性检查失败: ${result.error}`)
    } catch (e: any) {
      toast.error(`测试失败: ${e?.message}`)
    }
    setTesting(null)
  }

  const handleRetry = async (id: number) => {
    try {
      const { retryMcpInstall } = await import('@/@admin-port/api/mcp')
      await retryMcpInstall(id)
      toast.success('已重新开始安装')
      // 轮询 effect 会接管步骤刷新；这里立即把状态切到 starting 让卡片即时反馈
      setServices(prev => prev.map(s => s.id === id ? { ...s, install_state: 'starting', install_step: '启动服务', install_error: '' } : s))
    } catch (e: any) {
      toast.error(`重试失败: ${e?.message}`)
    }
  }

  // ── 形态 C：部署 stdio 到执行节点 ──
  // 需要选一个在线的 execution 节点，所以先打开选择弹窗而不是直接部署。
  const handleDeployToNode = async (svc: McpService) => {
    setDeployTarget(svc)
    setDeployNodes([])
    setDeployNodeId('')
    try {
      const { listNodes } = await import('@/@admin-port/api/nodes')
      const nodes = await listNodes('approved')
      // 只有执行节点能跑托管进程；管理节点没有 session/host 能力
      const usable = nodes.filter((n: any) => n.node_role === 'execution' && n.connected)
      setDeployNodes(usable)
      if (usable.length === 1) setDeployNodeId(usable[0].node_id)
    } catch (e: any) {
      toast.error(`获取节点列表失败: ${e?.message}`)
    }
  }

  const confirmDeployToNode = async () => {
    if (!deployTarget || !deployNodeId) return
    setDeploying(true)
    try {
      const { deployMcpToNode } = await import('@/@admin-port/api/mcp')
      const r = await deployMcpToNode(deployTarget.id, deployNodeId)
      toast.success(`已部署到节点，端口 ${r.port}；正在验证隧道与工具`)
      setDeployTarget(null)
      await load()
    } catch (e: any) {
      toast.error(`部署失败: ${e?.message}`)
    } finally {
      setDeploying(false)
    }
  }

  const handleUndeployFromNode = (id: number) => {
    confirm({
      title: '取消节点托管？',
      description: '会杀掉节点上的常驻进程，该 MCP 将退回「随会话启动」形态，agent 不再能用它。',
      confirmText: '取消托管',
      destructive: true,
      onConfirm: async () => {
        const { undeployMcpFromNode } = await import('@/@admin-port/api/mcp')
        await undeployMcpFromNode(id)
        await load()
      },
    })
  }

  const handleManage = (svc: McpService, panel: string = '') => {
    setManage(svc)
    setManagePanel(panel)
  }

  const handleDelete = (id: number, removable: boolean) => {
    if (!removable) { toast.warning('该服务不可删除（内置默认安装）'); return }
    confirm({
      title: '删除 MCP 服务？',
      description: '删除后不可恢复，相关配置与授权关系也会清除。',
      confirmText: '删除',
      destructive: true,
      onConfirm: async () => { await deleteMcpService(id); await load() },
    })
  }

  const categorySegs = CATEGORIES.map(c => ({ label: categoryLabel(c), value: c }))
  const sourceSegs = sourceOptions.map(src => ({ label: src === '全部' ? '全部来源' : (SOURCE_LABELS[src]?.label || src), value: src }))

  const headerActions = (
    <>
      <ManagerRefreshButton loading={loading} onClick={() => void load()} />
      <Button variant="outline" onClick={handleCreate}>+ 注册自定义 MCP</Button>
      <Button variant="outline" onClick={() => setGithubOpen(true)}>GitHub 识别</Button>
      <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>⚙ MCP 设置</Button>
    </>
  )

  const body = (
    <>
      {/* Tab 切换 */}
      {!lockTab && <Tabs value={tab} onValueChange={(k) => setTab(k as TopTab)} className="mt-1">
        <TabsList>
          <TabsTrigger value="installed">{`已配置（${services.length}）`}</TabsTrigger>
          <TabsTrigger value="catalog">{`市场（${catalog.length}）`}</TabsTrigger>
        </TabsList>
      </Tabs>}

      {/* 分类筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={filter}
          onValueChange={(v) => { if (v) setFilter(v) }}
        >
          {categorySegs.map((s) => (
            <ToggleGroupItem key={s.value} value={s.value}>{s.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        {tab === 'catalog' && (
          <>
            <span className="inline-block h-[22px] w-px bg-border" />
            <ToggleGroup
              type="single"
              variant="outline"
              value={sourceFilter}
              onValueChange={(v) => { if (v) setSourceFilter(v) }}
            >
              {sourceSegs.map((s) => (
                <ToggleGroupItem key={s.value} value={s.value}>{s.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        )}
      </div>

      {loading ? (
        <Empty>加载中...</Empty>
      ) : tab === 'installed' ? (
        <InstalledGrid
          services={filteredInstalled}
          manifests={manifests}
          testing={testing}
          onTest={handleTest}
          onEdit={handleEdit}
          onManage={handleManage}
          onDelete={handleDelete}
          onRetry={handleRetry}
          onDeployToNode={handleDeployToNode}
          onUndeployFromNode={handleUndeployFromNode}
        />
      ) : (
        marketConfigured === false ? (
          <Empty>市场未配置：资源中心仅展示已验证的 GitHub marketplace 源；在「配置」中接入 marketplace 后才会显示可下载的 MCP。</Empty>
        ) : filteredCatalog.length === 0 ? (
          <Empty>该来源/分类下没有可选模板</Empty>
        ) : (
          <CatalogGrid
            items={filteredCatalog}
            installedNames={installedNames}
            onInstall={handleInstallFromCatalog}
          />
        )
      )}

      {/* 注册/编辑/安装 dialog */}
      <McpServiceDialog
        service={editing}
        template={installing}
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); setInstalling(null) }}
        onSave={handleSave}
      />

      {/* 从 GitHub 识别添加 MCP */}
      <McpGithubImportDialog
        open={githubOpen}
        onOpenChange={setGithubOpen}
        onConfirm={handleGithubCreate}
      />

      <McpMarketSettings open={settingsOpen} initialPrincipalId={settingsPrincipalId} onClose={() => { setSettingsOpen(false); setSettingsPrincipalId(null) }} onChanged={load} />

      {/* MCP 管理 dialog（manifest 驱动） */}
      <McpManageDialog
        service={manage}
        manifest={manage ? manifests[manage.name] : undefined}
        initialPanel={managePanel}
        onClose={() => { setManage(null); setManagePanel('') }}
        onChanged={load}
        onOpenUser={openUserDetail}
      />

      {/* 形态 C：选执行节点部署 stdio MCP */}
      <Dialog open={!!deployTarget} onOpenChange={(open) => { if (!open) setDeployTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>部署到执行节点 · {deployTarget?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            在节点上常驻启动该 stdio MCP 并代理成全局可用的 remote。成功后从「会话工具」移入「全局服务」，
            agent 与所有编辑器共用一份。节点需有 npx（用于拉取 mcp-proxy 包装器）。
          </p>
          <div className="flex flex-col gap-2 py-2">
            {deployNodes.length === 0 ? (
              <span className="text-sm text-muted-foreground">没有可用的在线执行节点。先在节点管理里批准并连接一个执行节点。</span>
            ) : (
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={deployNodeId}
                onChange={(e) => setDeployNodeId(e.target.value)}
              >
                <option value="">选择节点…</option>
                {deployNodes.map((n: any) => (
                  <option key={n.id} value={n.id}>
                    {n.name || n.id} {n.connected ? '· 在线' : '· 离线'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployTarget(null)}>取消</Button>
            <Button disabled={deploying || !deployNodeId || deployNodes.length === 0} onClick={() => void confirmDeployToNode()}>
              {deploying ? '部署中...' : '部署'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmNode}
    </>
  )

  if (bare) {
    return (
      <div className="flex flex-col gap-4">
      {bare && tab === 'installed' && (
        <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
      )}
      {body}
      </div>
    )
  }

  return (
    <AdminPage
      title="MCP 市场"
      description="浏览和管理 MCP（Model Context Protocol）服务。Agent 通过 MCP 接入外部能力：浏览器、文件系统、数据库、搜索、代码工具，自定义 MCP 也能一键接入。"
      primaryActions={headerActions}
    >
      {body}
    </AdminPage>
  )
}

// =============================================================================
// 子组件：MCP 设置弹层（Runtime 设置 + MCP 用户管理）
// =============================================================================

// 过渡 shim：管理端 authorization/options 尚未下发 param_kinds 目录（后端 TODO），
// 从 builtin_resource 实例的 resource_type 反查 param key/标签。与后端
// mcp_plugin_store 的 _PARAM_DETAIL_TYPE/_PARAM_LABEL 同源；管理端端点补齐后删除。
const ADMIN_PARAM_KEY_BY_TYPE: Record<string, string> = {
  cdp_client: 'cdp_client_id',
  mail_account: 'mail_account_id',
  device: 'device_id',
}
const ADMIN_PARAM_LABEL_BY_TYPE: Record<string, string> = {
  cdp_client: 'CDP 浏览器客户端',
  mail_account: '邮箱账户',
  device: '设备',
}

function McpMarketSettings({ open, initialPrincipalId, onClose, onChanged }: {
  open: boolean
  initialPrincipalId?: number | null
  onClose: () => void
  onChanged: () => void
}) {
  /**
   * 通用授权编辑器注入的管理端 API 适配器（平台级 principal 走 /mcp/users 契约）。
   *
   * TODO(管理端 grants 端点)：管理端 /mcp/users/{id}/grants 与 authorization-options
   * 的 param_kinds/stdio 扩展尚未落地（后端未加，本次只改用户侧链路）。过渡期沿用
   * 旧 /params 端点并保持与旧编辑器同等能力：service 行不出现在管理端（旧编辑器本就
   * 没有 services 区），实例绑定沿用单值语义（旧端点 UNIQUE param_key，多选会拒）。
   * param_kinds 目录在管理端 options 未下发前从 builtin_resource 实例的
   * resource_type 派生（key/label 映射为过渡 shim，端点补齐后删除）。
   */
  const permissionApi: PermissionEditorApi = {
    loadResources: async () => {
      const all = await listMcpUserAuthorizationOptions()
      // 过渡期：管理端旧 /params 端点写不进 service 行（写单行侥幸成功、多行/取消
      // 均坏），服务区整体不开放，等管理端 grants 端点落地后放开。
      const resources = all.filter((r) => r.resource_kind !== 'service')
      const paramKinds: Array<{ key: string; label: string; resource_type: string }> = []
      const seen = new Set<string>()
      for (const r of all) {
        if (r.resource_kind !== 'builtin_resource' || !r.resource_type || seen.has(r.resource_type)) continue
        seen.add(r.resource_type)
        paramKinds.push({
          key: ADMIN_PARAM_KEY_BY_TYPE[r.resource_type] || r.resource_type,
          label: ADMIN_PARAM_LABEL_BY_TYPE[r.resource_type] || r.resource_type,
          resource_type: r.resource_type,
        })
      }
      return { resources, param_kinds: paramKinds }
    },
    loadGrants: async (id: number) =>
      (await getMcpUserParams(id)).map((p) => ({ grant_key: p.param_key, grant_value: p.param_value })),
    saveGrants: async (id, grants) => {
      if (grants.some((g) => g.grant_key === 'service')) {
        throw new Error('管理端服务授权待 grants 端点上线后开放，请先在用户侧入口配置')
      }
      const byKey = new Map<string, string>()
      for (const g of grants) {
        if (byKey.has(g.grant_key)) {
          throw new Error(`管理端过渡期仅支持每种类型绑定一个实例（${g.grant_key} 多选待 grants 端点）`)
        }
        byKey.set(g.grant_key, g.grant_value)
      }
      const params = [...byKey].map(([param_key, param_value]) => ({ param_key, param_value }))
      const saved = await setMcpUserParams(id, params)
      return saved.map((p) => ({ grant_key: p.param_key, grant_value: p.param_value }))
    },
  }

  /** MCP 用户管理弹框注入的管理端 API 适配器。 */
  const userManagerApi: McpUserManagerApi = {
    list: async () => (await listMcpUsers()),
    create: async (payload) => {
      const created = await createMcpUser({ name: payload.name, description: payload.description, enabled: payload.enabled, usage_type: payload.usage_type })
      await onChanged()
      return created
    },
    update: async (id, payload) => {
      const updated = await updateMcpUser(id, payload)
      await onChanged()
      return updated
    },
    remove: async (id) => {
      await deleteMcpUser(id)
      await onChanged()
    },
    rotate: (id) => rotateMcpUserToken(id),
    permission: permissionApi,
  }

  return (
    <McpUserManagerDialog
      open={open}
      initialPrincipalId={initialPrincipalId}
      onClose={onClose}
      api={userManagerApi}
      onOpenAgent={(principalId) => {
        void getAgentByMcpUser(principalId).then((r) => {
          if (r.agent_id != null) window.location.href = `/console/agents?agentId=${r.agent_id}`
          else toast.error('该 principal 未绑定 Agent')
        }).catch((e: any) => toast.error(e?.message || '反查 Agent 失败'))
      }}
    />
  )
}

// =============================================================================
// 子组件：已安装卡片网格（manifest 驱动卡片按钮）
// =============================================================================

// 卡片右上角只读状态徽标：内置服务常驻运行，不可启停；仅展示运行态。
function CardStatusBadge({ service }: { service: McpService }) {
  const label = runtimeStatusLabel(service.runtime_status)
  const color = runtimeStatusColor(service.runtime_status)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: color }} />
            <span className="text-xs" style={{ color }}>{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{service.builtin ? `内置服务常驻运行 · ${label}` : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function InstalledGrid({
  services, manifests, testing,
  onTest, onEdit, onManage, onDelete, onRetry, onDeployToNode, onUndeployFromNode,
}: {
  services: McpService[]
  manifests: Record<string, McpServiceManifest>
  testing: number | null
  onTest: (id: number) => void
  onEdit: (svc: McpService) => void
  onManage: (svc: McpService, panel: string) => void
  onDelete: (id: number, removable: boolean) => void
  onRetry: (id: number) => void
  onDeployToNode: (svc: McpService) => void
  onUndeployFromNode: (id: number) => void
}) {
  if (services.length === 0) {
    return (
      <Card size="sm" className="shadow-none">
        <CardContent>
          <Empty>你还没有安装任何 MCP 服务。点右上角「+ 注册自定义 MCP」或在「市场可安装」里挑一个。</Empty>
        </CardContent>
      </Card>
    )
  }
  // 按 deploy_scope 分组：全局服务（server/node_hosted，有安装进度）vs 会话工具（session，随会话在节点启动）。
  // 两类只呈现各自真正拥有的能力，避免「装好了但连不上」的困惑。
  const globalServices = services.filter(s => (s.deploy_scope || 'server') !== 'session')
  const sessionServices = services.filter(s => s.deploy_scope === 'session')
  return (
    <div className="flex flex-col gap-6">
      {globalServices.length > 0 && (
        <InstalledGridGroup
          title="全局服务"
          hint="服务端部署，agent 与所有编辑器共用"
          services={globalServices}
          manifests={manifests}
          testing={testing}
          onTest={onTest}
          onEdit={onEdit}
          onManage={onManage}
          onDelete={onDelete}
          onRetry={onRetry}
          onUndeployFromNode={onUndeployFromNode}
        />
      )}
      {sessionServices.length > 0 && (
        <InstalledGridGroup
          title="会话工具"
          hint="随会话在节点启动，仅该会话可见"
          services={sessionServices}
          manifests={manifests}
          testing={testing}
          onEdit={onEdit}
          onManage={onManage}
          onDelete={onDelete}
          onRetry={onRetry}
          onDeployToNode={onDeployToNode}
        />
      )}
    </div>
  )
}

// 一组服务卡。公共渲染逻辑，按 deploy_scope 给卡片加形态徽章 + 安装状态。
function InstalledGridGroup({
  title, hint, services, manifests, testing,
  onTest, onEdit, onManage, onDelete, onRetry, onDeployToNode, onUndeployFromNode,
}: {
  title: string
  hint: string
  services: McpService[]
  manifests: Record<string, McpServiceManifest>
  testing: number | null
  onTest?: (id: number) => void
  onEdit: (svc: McpService) => void
  onManage: (svc: McpService, panel: string) => void
  onDelete: (id: number, removable: boolean) => void
  /** 仅全局服务分组传入：安装失败时就地重试编排。 */
  onRetry?: (id: number) => void
  /** 形态 C：把 stdio 会话工具部署到执行节点上常驻并代理成 remote。 */
  onDeployToNode?: (svc: McpService) => void
  /** 形态 C 的反向操作：停掉节点上的托管进程。 */
  onUndeployFromNode?: (id: number) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {services.map(svc => {
          const m = manifests[svc.name]
          const removable = m?.builtin_rules?.removable ?? true
          const editableFields = new Set(m?.builtin_rules?.editable_fields ?? [
            'display_name', 'description', 'enabled', 'command', 'args', 'transport', 'url', 'env_template',
          ])
          const canEdit = editableFields.size > 0
          // 会话工具（session）没有安装进度与「检查可达性」--进程由编辑器 CLI 自己在节点拉起，
          // 服务端无从探活。全局服务才显示 install_state 步骤。
          const isSession = svc.deploy_scope === 'session'
          return (
            <Card key={svc.id} size="sm" className="shadow-none">
              <CardContent className="flex h-full flex-col p-4">
                <div className="mb-3 flex items-start gap-3">
                  <div
                    className="flex size-10 items-center justify-center rounded-[10px] text-xl"
                    style={{ background: svc.builtin ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'var(--bg3)' }}
                  >
                    {m?.icon || categoryEmoji(svc.category)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{m?.display_name || svc.display_name || svc.name}</span>
                      {svc.builtin && <Badge variant="secondary">内置</Badge>}
                      {svc.source === 'system' && <Badge variant="outline">系统</Badge>}
                      <Badge variant="outline" className="text-[10px]">{deployScopeLabel(svc.deploy_scope)}</Badge>
                    </div>
                    <span className="block truncate text-xs text-muted-foreground">
                      {svc.version && <span>v{svc.version}</span>}
                      {svc.author && <span> · {svc.author}</span>}
                      {!svc.builtin && <span> · {svc.transport}</span>}
                    </span>
                  </div>
                  <CardStatusBadge service={svc} />
                </div>

                <p className="mb-3 overflow-hidden text-[13px] leading-snug text-muted-foreground" style={{ minHeight: 38, maxHeight: 56 }}>
                  {m?.description || svc.description || '暂无描述'}
                </p>

                <div className="mb-3 flex gap-3 text-xs" style={{ color: 'var(--text2)' }}>
                  {!svc.builtin && <span>传输: <span className="font-medium">{svc.transport}</span></span>}
                  <span>工具: <span className="font-medium">{svc.tools_cache?.length || 0}</span></span>
                  {isSession ? (
                    <span>状态: <span className="font-medium">随会话启动</span></span>
                  ) : (
                    <span>状态: <span className="font-medium" style={{ color: installStateColor(svc.install_state) }}>{installStateLabel(svc.install_state) || runtimeStatusLabel(svc.runtime_status)}</span></span>
                  )}
                </div>

                {/* 安装步骤：只有全局服务有安装过程；进行中显示当前步骤，失败显示原因。 */}
                {!isSession && svc.install_state && svc.install_state !== 'ready' && (
                  <div className="mb-2 text-[11px]" style={{ color: installStateColor(svc.install_state) }}>
                    {svc.install_state === 'error'
                      ? `安装失败：${svc.install_error || '未知原因'}`
                      : svc.install_step || installStateLabel(svc.install_state)}
                  </div>
                )}

                {/* 卡片底部按钮：来自 manifest.home_actions（无 manifest 走默认） */}
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {(m?.home_actions || DEFAULT_HOME_ACTIONS).map(action => (
                    <Button key={action.id} size="sm" variant="outline" onClick={() => onManage(svc, action.panel)} title={action.label}>
                      {action.icon ? `${action.icon} ` : ''}{action.label}
                    </Button>
                  ))}
                  {!svc.builtin && (
                    <>
                      {/* 安装重试：仅全局服务且安装未就绪时出现（会话工具没有安装过程）。 */}
                      {!isSession && onRetry && svc.install_state && svc.install_state !== 'ready' && (
                        <Button size="sm" onClick={() => onRetry(svc.id)}>重试安装</Button>
                      )}
                      {!isSession && onTest && (
                        <Button size="sm" disabled={testing === svc.id} onClick={() => onTest(svc.id)}>
                          {testing === svc.id ? '检查中' : '检查配置/可达性'}
                        </Button>
                      )}
                      {/* 部署到节点（形态 C）：只对 stdio 会话工具有意义——把它变成节点上
                          常驻进程并代理成 remote，agent 与所有编辑器就都能用。 */}
                      {isSession && svc.transport === 'stdio' && onDeployToNode && (
                        <Button size="sm" variant="outline" onClick={() => onDeployToNode(svc)} title="在执行节点上常驻并代理成全局可用">
                          部署到节点
                        </Button>
                      )}
                      {svc.deploy_scope === 'node_hosted' && onUndeployFromNode && (
                        <Button size="sm" variant="outline" onClick={() => onUndeployFromNode(svc.id)} title="停掉节点上的托管进程，打回会话形态">
                          取消托管
                        </Button>
                      )}
                      {canEdit && <Button size="sm" variant="outline" onClick={() => onEdit(svc)}>编辑</Button>}
                      {removable && <Button size="sm" variant="destructive" onClick={() => onDelete(svc.id, removable)}>删除</Button>}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// =============================================================================
// 子组件：市场可安装卡片网格
// =============================================================================

function CatalogGrid({ items, installedNames, onInstall }: {
  items: McpService[]
  installedNames: Set<string>
  onInstall: (svc: McpService) => void | Promise<void>
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, McpService[]>()
    items.forEach(s => {
      const src = s.source || 'catalog'
      if (!map.has(src)) map.set(src, [])
      map.get(src)!.push(s)
    })
    return Array.from(map.entries())
  }, [items])

  return (
    <div className="flex w-full flex-col gap-[22px]">
      {grouped.map(([src, list]) => {
        const meta = SOURCE_LABELS[src] || { label: src, color: 'var(--text2)' }
        return (
          <div key={src}>
            <div className="mb-2.5 flex items-center gap-2.5">
              <Badge variant="outline" className="font-semibold" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</Badge>
              <span className="text-xs text-muted-foreground">{list.length} 个服务</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {list.map(svc => {
                const installed = installedNames.has(svc.name)
                return (
                  <Card key={svc.id} size="sm" className="shadow-none" style={{ opacity: installed ? 0.7 : 1 }}>
                    <CardContent className="flex h-full flex-col p-4">
                      <div className="mb-2.5 flex items-start gap-3">
                        <div className="flex size-[38px] items-center justify-center rounded-[10px] text-lg" style={{ background: 'var(--bg3)' }}>
                          {categoryEmoji(svc.category)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{svc.display_name || svc.name}</span>
                            {installed && <Badge variant="default">已下载</Badge>}
                            {src === MARKET_SOURCE && <Badge variant="outline" className="text-[10px]" style={{ color: '#22c55e', borderColor: '#22c55e' }}>GitHub</Badge>}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{svc.version && <span>v{svc.version}</span>}{svc.author && <span> · {svc.author}</span>}</span>
                        </div>
                      </div>

                      <p className="mb-2.5 overflow-hidden text-xs leading-snug text-muted-foreground" style={{ minHeight: 50, maxHeight: 64 }}>
                        {svc.description || '暂无描述'}
                      </p>

                      {svc.docs_url && (
                        <a href={svc.docs_url} target="_blank" rel="noreferrer" className="mb-2.5 inline-block text-[11px] underline">
                          文档 ↗
                        </a>
                      )}

                      <div className="mt-auto">
                        <Button size="sm" disabled={installed} onClick={() => !installed && onInstall(svc)}>
                          {installed ? '已下载' : '下载'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// 子组件：MCP 管理弹层（manifest 驱动 panel + 使用说明/附件/SOP 通用 tab）
// =============================================================================

function notifyApply(meta: { apply?: McpApplyResult | null } | undefined, successText: string) {
  const apply = meta?.apply
  if (!apply || apply.state === 'applied' || apply.ok === true) toast.success(successText)
  else if (apply.state === 'failed') toast.error(`${successText}，但 Runtime 应用失败：${apply.error || apply.message || '未知错误'}`)
  else toast.warning(`${successText}，等待 Runtime 应用${apply.error || apply.message ? `：${apply.error || apply.message}` : ''}`)
}

function isRevisionConflict(error: any) {
  return error?.response?.status === 409
}

// 服务级「可操作用户」：用于没有专属实例配置（CDP 客户端 / 邮箱账号）的通用服务。
function ServiceUsersPanel({ service, onChanged }: { service: McpService; onChanged: () => void }) {
  const [users, setUsers] = useState<McpUser[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, current] = await Promise.all([listMcpUsers(), getServiceUsers(service.id)])
      setUsers(Array.isArray(all) ? all : [])
      setSelected(current.user_ids || [])
    } catch (e: any) { toast.error(e?.message || '加载可操作用户失败') }
    finally { setLoading(false) }
  }, [service.id])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await setServiceUsers(service.id, selected)
      toast.success('可操作用户已保存，服务已热重载')
      await load(); await onChanged()
    } catch (e: any) { toast.error(e?.message || '保存可操作用户失败') }
    finally { setSaving(false) }
  }

  return (
    <SectionCardLike title="可操作用户">
      <p className="mb-2 text-xs text-muted-foreground">
        勾选允许连接本服务的 MCP 用户。所有服务一律要求 token，未授权用户无法连接。
      </p>
      {loading ? <Empty>加载中...</Empty> : (
        <>
          <MultiSelect
            value={selected}
            onChange={(v) => setSelected(v.map((x) => Number(x)))}
            options={users.filter(u => u.enabled).map(u => ({ value: u.id, label: u.name }))}
            placeholder="选择可操作用户"
          />
          <Button size="sm" className="mt-3" disabled={saving} onClick={save}>保存</Button>
        </>
      )}
    </SectionCardLike>
  )
}

function McpManageDialog({ service, manifest, initialPanel, onClose, onChanged, onOpenUser }: {
  service: McpService | null
  manifest: McpServiceManifest | undefined
  initialPanel?: string
  onClose: () => void
  onChanged: () => void
  onOpenUser?: (principalId: number) => void
}) {
  const panels = manifest?.panels || DEFAULT_PANELS
  const actions = manifest?.home_actions || DEFAULT_HOME_ACTIONS
  const [activePanel, setActivePanel] = useState<string>('')
  const [contract, setContract] = useState<McpConfigurationContract | null>(null)
  const hasSop = !!service?.builtin && !!service?.name && BUILTIN_WITH_SOP.has(service.name)
  const hasAssets = !!(manifest?.assets && manifest.assets.length > 0)
  const hasHelp = !!manifest?.help
  const agentConfigFields = manifest?.agent_config?.fields ?? []
  const hasAgentConfig = agentConfigFields.length > 0
  const managesUsersPerInstance = service?.name === 'cdp-bridge' || service?.name === 'mail'
  const hasServiceUsers = !!service && !managesUsersPerInstance

  useEffect(() => {
    if (!service || Number(manifest?.schema || 1) < 2) { setContract(null); return }
    let cancelled = false
    getMcpServiceConfiguration(service.id)
      .then(value => { if (!cancelled) setContract(value) })
      .catch(e => { if (!cancelled) { setContract(null); toast.error(e?.message || '加载配置契约失败') } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id, manifest?.schema])

  useEffect(() => {
    const validPanels = buildPanelOrder(actions, { hasHelp, hasAssets, hasSop, hasAgentConfig })
    if (hasServiceUsers) validPanels.push('__service_users')
    if (initialPanel && validPanels.includes(initialPanel)) setActivePanel(initialPanel)
    else if (validPanels.length > 0) setActivePanel(validPanels[0])
    else setActivePanel('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id, initialPanel, actions, hasHelp, hasAssets, hasSop, hasAgentConfig, hasServiceUsers])

  if (!service) return null

  const tabItems: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }> = []
  if (hasHelp) {
    tabItems.push({ key: '__help', label: '📖 使用说明', children: <HelpContent help={manifest!.help!} assets={manifest?.assets} /> })
  }
  if (hasAssets) {
    tabItems.push({ key: '__assets', label: '📦 附件', children: <AssetsContent assets={manifest!.assets!} /> })
  }
  if (hasSop) {
    tabItems.push({ key: '__sop', label: '📝 SOP', children: <SopPanel serviceName={service.name} /> })
  }
  if (hasAgentConfig) {
    tabItems.push({ key: '__agent_config', label: '🤖 Agent 可配置项', children: <AgentConfigFieldsPanel fields={agentConfigFields} /> })
  }
  actions.forEach(action => {
    const def = panels?.[action.panel]
    if (!def) return
    tabItems.push({
      key: action.panel,
      label: `${action.icon ? `${action.icon} ` : ''}${action.label}`,
      children: (
        <ManifestPanel
          service={service}
          panelId={action.panel}
          panel={def}
          title={action.label || action.panel}
          contract={contract}
          onChanged={onChanged}
          onOpenUser={onOpenUser}
        />
      ),
    })
  })
  if (hasServiceUsers) {
    tabItems.push({ key: '__service_users', label: '👥 可操作用户', children: <ServiceUsersPanel service={service} onChanged={onChanged} /> })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="flex max-h-[85vh] w-[90vw] flex-col gap-4 overflow-hidden sm:max-w-[1400px]"
        style={{ maxWidth: 1400 }}
      >
        <DialogHeader>
          <DialogTitle>{manifest?.display_name || service.display_name || service.name}</DialogTitle>
        </DialogHeader>
        <Tabs value={activePanel} onValueChange={setActivePanel} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="flex flex-wrap">
            {tabItems.map(item => (
              <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto pt-2">
            {tabItems.map(item => (
              activePanel === item.key ? <div key={item.key}>{item.children}</div> : null
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// 把通用 tab 排在前面，得到完整 panel 顺序，供默认选中判断
function buildPanelOrder(actions: McpManifestAction[], opts: { hasHelp: boolean; hasAssets: boolean; hasSop: boolean; hasAgentConfig: boolean }): string[] {
  const order: string[] = []
  if (opts.hasHelp) order.push('__help')
  if (opts.hasAssets) order.push('__assets')
  if (opts.hasSop) order.push('__sop')
  if (opts.hasAgentConfig) order.push('__agent_config')
  actions.forEach(a => order.push(a.panel))
  return order
}

// =============================================================================
// 子组件：Agent 可配置项（只读，展示 manifest.agent_config.fields）
// =============================================================================

function AgentConfigFieldsPanel({ fields }: { fields: McpConfigField[] }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        下列字段是本服务在被 Agent 调用时可配置的参数。Agent 编辑器会按此 schema 渲染表单，
        填入的值会被注入到工具描述，供 LLM 在调用时参考。
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">字段 (key)</TableHead>
            <TableHead className="w-[160px]">展示名</TableHead>
            <TableHead className="w-[110px]">类型</TableHead>
            <TableHead className="w-[160px]">默认</TableHead>
            <TableHead className="w-[110px]">必填 / 密钥</TableHead>
            <TableHead>说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map(row => (
            <TableRow key={row.key}>
              <TableCell><code className="font-mono text-xs">{row.key}</code></TableCell>
              <TableCell>{row.label}</TableCell>
              <TableCell>{row.enum && row.enum.length > 0 ? `${row.type} (枚举)` : row.type}</TableCell>
              <TableCell>
                {row.default === null || row.default === undefined || row.default === ''
                  ? <span className="text-muted-foreground">-</span>
                  : <code className="font-mono text-xs">{String(row.default)}</code>}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {row.required ? <Badge variant="destructive">必填</Badge> : <Badge variant="outline">可选</Badge>}
                  {row.secret ? <Badge variant="secondary">secret</Badge> : null}
                </div>
              </TableCell>
              <TableCell>
                {row.description ? row.description : (row.enum && row.enum.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {row.enum.map((opt) => <Badge key={String(opt)} variant="outline">{String(opt)}</Badge>)}
                  </div>
                ) : '-')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// =============================================================================
// 子组件：按 panel.kind 渲染只读/可编辑面板
// =============================================================================

function ManifestPanel({ service, panelId, panel, title, contract, onChanged, onOpenUser }: {
  service: McpService
  panelId: string
  panel: NonNullable<McpServiceManifest['panels']>[string]
  title: string
  contract: McpConfigurationContract | null
  onChanged: () => void
  onOpenUser?: (principalId: number) => void
}) {
  if (panel.kind === 'info') return <InfoPanel service={service} />
  if (panel.kind === 'env') return <EnvPanel service={service} onChanged={onChanged} />
  if (panel.kind === 'tools') return <ToolsPanel service={service} />
  if (panel.kind === 'config') return <ConfigPanel service={service} copyable={panel.copyable} onOpenUser={onOpenUser} />
  if (panel.kind === 'resource') return <ResourcePanel service={service} resources={panel.resources || []} contract={contract} onChanged={onChanged} />
  if (panel.kind === 'view') return <ConfigurationViewPanel service={service} viewKey={panel.view || ''} definition={contract?.views[panel.view || '']} renderer={panel.ui?.renderer} />
  if (panel.kind === 'action') return <ConfigurationActionPanel service={service} actionKey={panel.action || ''} definition={contract?.actions[panel.action || '']} renderer={panel.ui?.renderer} />
  return <Empty>{`未知面板类型：${panel.kind}（${title} / ${panelId}）`}</Empty>
}

// =============================================================================
// ResourceFields：JSON-schema 驱动的受控字段渲染器（替代 antd Form + Form.Item）
// value/onChange 由父组件持有；required 校验在提交时由 validateResourceFields 完成。
// =============================================================================

function resourceFieldOrder(definition: McpResourceDefinition): string[] {
  return definition.ui?.order || Object.keys(definition.schema.properties || {})
}

// 依据 field.default 生成初始值（等价 antd initialValues 里 default 那部分）。
function resourceDefaults(definition: McpResourceDefinition): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definition.schema.properties)
      .filter(([, field]) => field.default !== undefined)
      .map(([key, field]) => [key, field.default]),
  )
}

// 提交前校验必填，返回首个缺失字段的提示（null 表示通过）。
// secret 字段：已有记录且当前已设置（state==='set'）时视为可留空。
function validateResourceFields(
  definition: McpResourceDefinition,
  value: Record<string, unknown>,
  record?: Record<string, any> | null,
): string | null {
  const required = new Set(definition.schema.required || [])
  for (const key of resourceFieldOrder(definition)) {
    const field = definition.schema.properties[key]
    if (!field || field.readOnly || field.type === 'boolean') continue
    if (!required.has(key)) continue
    const secretState = field['x-secret'] ? record?._secrets?.[key]?.state : undefined
    const secretSatisfied = !!record && !!field['x-secret'] && secretState === 'set'
    if (secretSatisfied) continue
    const v = value[key]
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
    if (empty) return `请填写${field.title || key}`
  }
  return null
}

function ResourceFields({ definition, value, onChange, record, referenceOptions, columns = 1, fullWidthKeys }: {
  definition: McpResourceDefinition
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  record?: Record<string, any> | null
  referenceOptions?: McpReferenceOptions
  columns?: number
  fullWidthKeys?: string[]
}) {
  const order = resourceFieldOrder(definition)
  const fullWidth = new Set(fullWidthKeys || [])
  const setField = (key: string, v: unknown) => onChange({ ...value, [key]: v })

  const items = order.map((key) => {
    const field = definition.schema.properties[key]
    if (!field || field.readOnly) return null
    const label = field.title || key
    const secretState = field['x-secret'] ? record?._secrets?.[key]?.state : undefined
    const labelNode = (
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {secretState ? (
          <Badge variant={secretState === 'set' ? 'secondary' : 'outline'}>
            {secretState === 'set' ? '已设置' : '未设置'}
          </Badge>
        ) : null}
      </div>
    )

    let control: ReactNode
    if (field.type === 'boolean') {
      control = <Switch checked={!!value[key]} onCheckedChange={(c) => setField(key, c)} />
    } else if (field.type === 'array' && field['x-reference']) {
      const opts = (referenceOptions?.[field['x-reference']] || []) as RefOption[]
      const current = Array.isArray(value[key]) ? (value[key] as OptionValue[]) : []
      control = <MultiSelect value={current} onChange={(v) => setField(key, v)} options={opts} placeholder={`请选择${label}`} />
    } else if (field['x-reference']) {
      const opts = (referenceOptions?.[field['x-reference']] || []) as RefOption[]
      control = <SearchSelect value={value[key] as OptionValue | undefined} onChange={(v) => setField(key, v)} options={opts} placeholder={`请选择${label}`} />
    } else if (Array.isArray(field.enum)) {
      const current = value[key]
      control = (
        <Select
          value={current == null ? undefined : String(current)}
          onValueChange={(sv) => {
            const match = (field.enum || []).find((e) => String(e) === sv)
            setField(key, match !== undefined ? match : sv)
          }}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.enum.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    } else if (field.type === 'integer' || field.type === 'number') {
      control = (
        <Input
          type="number"
          value={value[key] == null ? '' : String(value[key])}
          min={field.minimum}
          max={field.maximum}
          step={field.type === 'integer' ? 1 : undefined}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') { setField(key, undefined); return }
            const num = field.type === 'integer' ? parseInt(raw, 10) : Number(raw)
            setField(key, Number.isNaN(num) ? undefined : num)
          }}
        />
      )
    } else if (field['x-secret']) {
      control = (
        <PasswordInput
          value={(value[key] as string) || ''}
          onChange={(v) => setField(key, v)}
          placeholder={secretState === 'set' ? '已设置；留空保持不变' : undefined}
        />
      )
    } else {
      control = <Input value={(value[key] as string) ?? ''} onChange={(e) => setField(key, e.target.value)} />
    }

    const span = columns > 1 && fullWidth.has(key) ? { gridColumn: '1 / -1' } : undefined
    return (
      <div key={key} className="mb-3 flex flex-col gap-1.5" style={span}>
        {labelNode}
        {control}
      </div>
    )
  }).filter(Boolean)

  if (columns > 1) {
    return <div className="grid gap-x-3" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{items}</div>
  }
  return <>{items}</>
}

// =============================================================================
// CDP 客户端集合（内联编辑 + 会话/网页展示 + 一次性 token）
// =============================================================================

function CdpClientsCollection({ service, resourceKey, definition, sessionsViewKey, referenceOptions, onChanged }: {
  service: McpService; resourceKey: string; definition: McpResourceDefinition; sessionsViewKey?: string; referenceOptions?: McpReferenceOptions; onChanged: () => void
}) {
  const [rows, setRows] = useState<Record<string, any>[]>([])
  const users = (referenceOptions?.mcp_users || []).map(user => ({ user_id: Number(user.value), name: user.label }))
  const agents = (referenceOptions?.agents || []).map(agent => ({ agent_id: Number(agent.value), name: agent.label }))
  // 会话池按 client_id 隔离：live 视图按 client_id 聚合，不再依赖 user_id。
  const [sessions, setSessions] = useState<Array<{ clients?: Array<{ client_id: string; connected: boolean; pages: unknown[] }> }>>([])
  const [loading, setLoading] = useState(false)
  // editing: undefined=未编辑；null=新建；对象=编辑该行（内联展开在卡片下方）。
  const [editing, setEditing] = useState<Record<string, any> | null | undefined>(undefined)
  const [formValue, setFormValue] = useState<Record<string, unknown>>({})
  const [oneTimeToken, setOneTimeToken] = useState<{ name: string; token: string } | null>(null)
  const { confirm, confirmNode } = useConfirm()
  const idField = definition.ui?.idField || 'id'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [resource, view] = await Promise.all([
        listMcpResource(service.id, resourceKey),
        sessionsViewKey ? queryMcpView(service.id, sessionsViewKey).catch(() => null) : Promise.resolve(null),
      ])
      setRows(Array.isArray(resource.data) ? resource.data as Record<string, any>[] : [])
      const viewData = view?.data as { contexts?: typeof sessions } | undefined
      setSessions(viewData?.contexts || [])
    } catch (e: any) { toast.error(e?.message || '加载 CDP 客户端失败') }
    finally { setLoading(false) }
  }, [service.id, resourceKey, sessionsViewKey])
  useEffect(() => { load() }, [load])

  const openEdit = (row: Record<string, any> | null) => {
    setEditing(row)
    setFormValue(row ? { ...row } : { enabled: true, user_ids: [], agent_ids: [] })
  }
  const showToken = (row: Record<string, any>) => {
    if (typeof row.token === 'string' && row.token) setOneTimeToken({ name: String(row.name || 'CDP 客户端'), token: row.token })
  }
  const save = async () => {
    const err = validateResourceFields(definition, formValue, editing || null)
    if (err) { toast.error(err); return }
    const values = formValue
    try {
      const isCreate = !editing || editing[idField] == null
      let result
      if (!isCreate) result = await updateMcpResource(service.id, resourceKey, (editing as Record<string, any>)[idField], values, { expectedRevision: Number((editing as Record<string, any>).revision) || undefined })
      else result = await createMcpResource(service.id, resourceKey, values)
      if (isCreate) showToken(result.data as Record<string, any>)
      setEditing(undefined); await load(); await onChanged()
      notifyApply(result.meta, isCreate ? 'CDP 客户端已创建' : 'CDP 客户端已保存')
    } catch (e: any) { if (isRevisionConflict(e)) await load(); toast.error(isRevisionConflict(e) ? '配置已被其他操作修改，已刷新，请重试' : (e?.response?.data?.detail || e?.message || '保存 CDP 客户端失败')) }
  }
  const rotate = (row: Record<string, any>) => confirm({
    title: `轮换 ${row.name} 的 CDP token？`, description: '旧 token 会立即失效，已连接的扩展将断开。新 token 仅显示一次。', destructive: true,
    onConfirm: async () => { const result = await rotateMcpResourceToken(service.id, resourceKey, row[idField], Number(row.revision) || undefined); showToken(result.data as Record<string, any>); await load(); await onChanged(); notifyApply(result.meta, 'CDP token 已轮换') },
  })
  const remove = (row: Record<string, any>) => confirm({
    title: `删除 CDP 客户端 ${row.name}？`, description: '客户端 token 会立即失效，现有连接将断开。', destructive: true,
    onConfirm: async () => { const result = await deleteMcpResource(service.id, resourceKey, row[idField], { expectedRevision: Number(row.revision) || undefined }); if (editing && (editing as Record<string, any>)[idField] === row[idField]) setEditing(undefined); await load(); await onChanged(); notifyApply(result.meta, 'CDP 客户端已删除') },
  })
  const revoke = (row: Record<string, any>) => confirm({
    title: `停用 ${row.name}？`, description: '客户端 token 会被撤销，现有连接将断开；如需恢复请重新轮换 token。', destructive: true,
    onConfirm: async () => { const result = await revokeMcpResourceToken(service.id, resourceKey, row[idField], Number(row.revision) || undefined); await load(); await onChanged(); notifyApply(result.meta, 'CDP 客户端已撤销') },
  })
  const userName = (id: unknown) => users.find(user => user.user_id === Number(id))?.name || `用户 #${id}`
  const agentName = (id: unknown) => agents.find(agent => agent.agent_id === Number(id))?.name || `Agent #${id}`
  const userIdsOf = (row: Record<string, any>): number[] => Array.isArray(row.user_ids) ? row.user_ids.map((v: unknown) => Number(v)) : []
  const agentIdsOf = (row: Record<string, any>): number[] => Array.isArray(row.agent_ids) ? row.agent_ids.map((v: unknown) => Number(v)) : []
  // live 会话按 client_id join（会话池已按 client 隔离）。
  const runtimeClient = (row: Record<string, any>) => sessions.flatMap(ctx => ctx.clients || []).find(client => String(client.client_id) === String(row.client_id))
  const formUsers: RefOption[] = users.map(user => ({ value: user.user_id, label: user.name }))
  const formAgents: RefOption[] = agents.map(agent => ({ value: agent.agent_id, label: agent.name }))

  // 编辑态：直接内联在详情里，不再多套一层卡片。
  const editForm = (row: Record<string, any> | null) => (
    <div className="py-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{row ? `编辑 ${row.name}` : '创建 CDP 客户端'}</span>
        <Button size="sm" variant="outline" onClick={() => setEditing(undefined)}>退出编辑</Button>
      </div>
      <ResourceFields definition={definition} value={formValue} onChange={setFormValue} record={row} referenceOptions={{ mcp_users: formUsers, agents: formAgents }} />
      <Button onClick={save}>保存</Button>
    </div>
  )

  // 默认详情：突出显示该客户端当前的浏览器网页（会话池按 client 隔离）。
  const pagesView = (row: Record<string, any>) => {
    const live = runtimeClient(row)
    const pages = (live?.pages || []) as Record<string, any>[]
    const rowUserIds = userIdsOf(row); const rowAgentIds = agentIdsOf(row)
    return <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <InfoRow label="可操作用户">{rowUserIds.length ? <span className="flex flex-wrap gap-1">{rowUserIds.map(id => <Badge key={id} variant="outline">{userName(id)}</Badge>)}</span> : '-'}</InfoRow>
        <InfoRow label="可操作 agent">{rowAgentIds.length ? <span className="flex flex-wrap gap-1">{rowAgentIds.map(id => <Badge key={id} variant="outline">{agentName(id)}</Badge>)}</span> : <span className="text-yellow-600 dark:text-yellow-400">未选（不允许操作）</span>}</InfoRow>
        <InfoRow label="客户端 ID"><code className="text-xs">{String(row.client_id || '-')}</code></InfoRow>
        <InfoRow label="Token 状态"><code className="text-xs">{String(row.token_hint || '已撤销')}</code></InfoRow>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">浏览器网页（{pages.length}）</span>
        {pages.length === 0
          ? <Empty className="p-6">暂无网页。连接 Chrome 扩展后展示。</Empty>
          : <Table className="mt-1.5">
              <TableHeader>
                <TableRow>
                  <TableHead>页面标题</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={String(p.id)}>
                    <TableCell className="truncate">{String(p.title || '（无标题）')}</TableCell>
                    <TableCell><CopyableText text={String(p.url || '')} className="break-all">{String(p.url || '-')}</CopyableText></TableCell>
                    <TableCell><Badge variant={p.active ? 'secondary' : 'outline'}>{p.active ? '已连接' : '已断开'}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
      </div>
    </div>
  }

  return <SectionCardLike title={definition.title} extra={<Button size="sm" disabled={users.length === 0} onClick={() => openEdit(null)}>+ 创建客户端</Button>}>
    {users.length === 0 && <p className="text-yellow-600 dark:text-yellow-400">暂无可选的 MCP 用户。请先在右上角「MCP 设置」中创建用户。</p>}
    {editing === null && editForm(null)}
    {rows.length === 0 ? <Empty>{loading ? '加载中...' : '暂无 CDP 客户端'}</Empty> : (
      <Accordion type="multiple" className="w-full">
        {rows.map((row) => {
          const live = runtimeClient(row); const pageCount = (live?.pages?.length) || 0; const connected = !!live?.connected
          const isEditingRow = !!editing && (editing as Record<string, any>)[idField] === row[idField]
          return (
            <AccordionItem key={String(row[idField])} value={String(row[idField])}>
              <div className="flex items-center justify-between gap-2">
                <AccordionTrigger className="flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{String(row.name || row[idField])}</span>
                    <Badge variant={connected ? 'secondary' : 'outline'}>{connected ? '在线' : '离线'}</Badge>
                    <span className="text-muted-foreground">网页 {pageCount}</span>
                    <code className="text-xs text-muted-foreground">{String(row.token_hint || 'token 未设置')}</code>
                  </span>
                </AccordionTrigger>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>编辑</Button>
                  <Button size="sm" variant="outline" onClick={() => rotate(row)}>更新 token</Button>
                  {row.token_hint && <Button size="sm" variant="destructive" onClick={() => revoke(row)}>撤销 token</Button>}
                  <Button size="sm" variant="destructive" onClick={() => remove(row)}>删除</Button>
                </span>
              </div>
              <AccordionContent>{isEditingRow ? editForm(row) : pagesView(row)}</AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    )}
    <Dialog open={!!oneTimeToken} onOpenChange={(o) => { if (!o) setOneTimeToken(null) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{`${oneTimeToken?.name || ''} 的 CDP token`}</DialogTitle></DialogHeader>
        <p className="text-yellow-600 dark:text-yellow-400">完整 token 仅显示这一次。请立即复制并安全保存，关闭后无法再次查看。</p>
        <Textarea readOnly rows={4} value={oneTimeToken?.token || ''} />
        <DialogFooter>
          <Button onClick={async () => { if (oneTimeToken?.token) { if (await copyToClipboard(oneTimeToken.token)) toast.success('完整 CDP token 已复制'); else toast.error('复制失败，请手动选择') } }}>复制完整 token</Button>
          <Button variant="outline" onClick={() => setOneTimeToken(null)}>我已保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmNode}
  </SectionCardLike>
}

// =============================================================================
// 邮箱账号集合（内联编辑 + 详情 + 可查询邮箱子表）
// =============================================================================

function MailAccountsCollection({ service, resourceKey, definition, addressesResource, addressesDefinition, referenceOptions, onChanged }: {
  service: McpService; resourceKey: string; definition: McpResourceDefinition
  addressesResource?: string; addressesDefinition?: McpResourceDefinition
  referenceOptions?: McpReferenceOptions; onChanged: () => void
}) {
  const [rows, setRows] = useState<Record<string, any>[]>([])
  const users = (referenceOptions?.mcp_users || []).map(user => ({ user_id: Number(user.value), name: user.label }))
  const [loading, setLoading] = useState(false)
  // editing: undefined=未编辑；null=新建；对象=编辑该行（内联展开在卡片下方）。
  const [editing, setEditing] = useState<Record<string, any> | null | undefined>(undefined)
  const [formValue, setFormValue] = useState<Record<string, unknown>>({})
  const { confirm, confirmNode } = useConfirm()
  const idField = definition.ui?.idField || 'id'

  const load = useCallback(async () => {
    setLoading(true)
    try { const result = await listMcpResource(service.id, resourceKey); setRows(Array.isArray(result.data) ? result.data as Record<string, any>[] : []) }
    catch (e: any) { toast.error(e?.message || '加载邮箱服务失败') }
    finally { setLoading(false) }
  }, [service.id, resourceKey])
  useEffect(() => { load() }, [load])

  const openEdit = (row: Record<string, any> | null) => {
    setEditing(row)
    setFormValue(row ? { ...row } : { enabled: true, user_ids: [], mailbox_type: 'TempMail' })
  }
  const save = async () => {
    const err = validateResourceFields(definition, formValue, editing || null)
    if (err) { toast.error(err); return }
    const values = formValue
    try {
      const isCreate = !editing || editing[idField] == null
      let result
      if (!isCreate) result = await updateMcpResource(service.id, resourceKey, (editing as Record<string, any>)[idField], values, { expectedRevision: Number((editing as Record<string, any>).revision) || undefined })
      else result = await createMcpResource(service.id, resourceKey, values)
      // 新建后保留编辑态（切到已保存行），以便继续维护「可查询邮箱」子表。
      const saved = result.data as Record<string, any>
      setEditing(isCreate ? saved : undefined)
      if (isCreate) setFormValue({ ...saved })
      await load(); await onChanged()
      notifyApply(result.meta, isCreate ? '邮箱服务已创建' : '邮箱服务已保存')
    } catch (e: any) { if (isRevisionConflict(e)) await load(); toast.error(isRevisionConflict(e) ? '配置已被其他操作修改，已刷新，请重试' : (e?.response?.data?.detail || e?.message || '保存邮箱服务失败')) }
  }
  const remove = (row: Record<string, any>) => confirm({
    title: `删除邮箱服务 ${row.display_name}？`, description: '该服务下的可查询邮箱映射也会一并删除。', destructive: true,
    onConfirm: async () => { const result = await deleteMcpResource(service.id, resourceKey, row[idField], { expectedRevision: Number(row.revision) || undefined }); if (editing && (editing as Record<string, any>)[idField] === row[idField]) setEditing(undefined); await load(); await onChanged(); notifyApply(result.meta, '邮箱服务已删除') },
  })
  const userName = (id: unknown) => users.find(user => user.user_id === Number(id))?.name || `用户 #${id}`
  const userIdsOf = (row: Record<string, any>): number[] => Array.isArray(row.user_ids) ? row.user_ids.map((v: unknown) => Number(v)) : []
  const formUsers: RefOption[] = users.map(user => ({ value: user.user_id, label: user.name }))

  // 内联编辑态：直接放在详情内，不再套内层卡片。字段两列排布。
  const editForm = (row: Record<string, any> | null) => (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{row ? `编辑 ${row.display_name}` : '创建邮箱服务'}</span>
        <Button size="sm" variant="outline" onClick={() => setEditing(undefined)}>退出编辑</Button>
      </div>
      <ResourceFields definition={definition} value={formValue} onChange={setFormValue} record={row} referenceOptions={{ mcp_users: formUsers }} columns={2} fullWidthKeys={['user_ids']} />
      <Button size="sm" onClick={save}>保存</Button>
    </div>
  )

  return <SectionCardLike title={definition.title} extra={<Button size="sm" disabled={users.length === 0} onClick={() => openEdit(null)}>+ 创建邮箱服务</Button>}>
    {users.length === 0 && <p className="text-yellow-600 dark:text-yellow-400">暂无可选的 MCP 用户。请先在右上角「MCP 设置」中创建用户。</p>}
    {editing === null && <div className="mb-3">{editForm(null)}</div>}
    {rows.length === 0 ? <Empty>{loading ? '加载中...' : '暂无邮箱服务'}</Empty> : (
      <Accordion type="multiple" className="w-full">
        {rows.map((row) => {
          const isEditingRow = !!editing && (editing as Record<string, any>)[idField] === row[idField]
          const rowUserIds = userIdsOf(row)
          return (
            <AccordionItem key={String(row[idField])} value={String(row[idField])}>
              <div className="flex items-center justify-between gap-2">
                <AccordionTrigger className="flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{String(row.display_name || row[idField])}</span>
                    <Badge variant={row.enabled ? 'secondary' : 'outline'}>{row.enabled ? '启用' : '停用'}</Badge>
                    <span className="text-muted-foreground">{String(row.username || '-')}</span>
                  </span>
                </AccordionTrigger>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(row)}>删除</Button>
                </span>
              </div>
              <AccordionContent>
                {isEditingRow ? editForm(row) : (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <InfoRow label="服务名称">{String(row.display_name || '-')}</InfoRow>
                      <InfoRow label="邮箱服务类型">{String(row.mailbox_type || 'TempMail')}</InfoRow>
                      <InfoRow label="可操作用户">{rowUserIds.length ? <span className="flex flex-wrap gap-1">{rowUserIds.map(id => <Badge key={id} variant="outline">{userName(id)}</Badge>)}</span> : '-'}</InfoRow>
                      <InfoRow label="状态"><Badge variant={row.enabled ? 'secondary' : 'outline'}>{row.enabled ? '启用' : '停用'}</Badge></InfoRow>
                      <InfoRow label="服务器地址">{String(row.base_url || '-')}</InfoRow>
                      <InfoRow label="邮箱后缀">{String(row.mail_suffix || '-')}</InfoRow>
                      <InfoRow label="用户名">{String(row.username || '-')}</InfoRow>
                    </div>
                    {addressesResource && addressesDefinition && (
                      <ResourceCollection service={service} resourceKey={addressesResource} definition={addressesDefinition} parentId={Number(row[idField])} onChanged={onChanged} bare />
                    )}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    )}
    {confirmNode}
  </SectionCardLike>
}

// =============================================================================
// 通用资源集合（表格 + 编辑弹层）；bare 时不套卡片
// =============================================================================

function ResourceCollection({ service, resourceKey, definition, parentId, onChanged, bare }: {
  service: McpService; resourceKey: string; definition: McpResourceDefinition; parentId?: number; onChanged: () => void; bare?: boolean
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null | undefined>(undefined)
  const [formValue, setFormValue] = useState<Record<string, unknown>>({})
  const { confirm, confirmNode } = useConfirm()
  const idField = definition.ui?.idField || 'id'
  const columns = definition.ui?.columns || [definition.ui?.displayField || idField]
  const load = useCallback(async () => {
    setLoading(true)
    try { const result = await listMcpResource(service.id, resourceKey, parentId); setRows(Array.isArray(result.data) ? result.data : []) }
    catch (e: any) { toast.error(e?.message || `加载${definition.title}失败`) }
    finally { setLoading(false) }
  }, [service.id, resourceKey, parentId, definition.title])
  useEffect(() => { load() }, [load])
  const openEdit = (row: Record<string, unknown> | null) => {
    setEditing(row)
    setFormValue(row ? { ...row } : resourceDefaults(definition))
  }
  const save = async () => {
    const err = validateResourceFields(definition, formValue, editing || null)
    if (err) { toast.error(err); return }
    const values = formValue
    try {
      let result
      if (editing && editing[idField] != null) result = await updateMcpResource(service.id, resourceKey, editing[idField] as string | number, values, { parentId, expectedRevision: Number(editing.revision) || undefined })
      else result = await createMcpResource(service.id, resourceKey, values, parentId)
      setEditing(undefined); await load(); await onChanged()
      notifyApply(result.meta, `${definition.title}已保存`)
    } catch (e: any) { if (isRevisionConflict(e)) await load(); toast.error(isRevisionConflict(e) ? '配置已被其他操作修改，已刷新，请重试' : (e?.message || `保存${definition.title}失败`)) }
  }
  const remove = (row: Record<string, unknown>) => confirm({
    title: `删除${definition.title}？`, destructive: true,
    onConfirm: async () => { const result = await deleteMcpResource(service.id, resourceKey, row[idField] as string | number, { parentId, expectedRevision: Number(row.revision) || undefined }); await load(); await onChanged(); notifyApply(result.meta, `${definition.title}已删除`) },
  })
  const hasActions = definition.capabilities.some(capability => ['update', 'delete'].includes(capability))
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((key) => (
            <TableHead key={key}>{definition.schema.properties[key]?.title || key}</TableHead>
          ))}
          {hasActions && <TableHead className="w-[130px]">操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow><TableCell colSpan={columns.length + (hasActions ? 1 : 0)} className="h-16 text-center text-muted-foreground">{loading ? '加载中...' : '暂无数据'}</TableCell></TableRow>
        ) : rows.map((row) => (
          <TableRow key={String(row[idField])}>
            {columns.map((key) => {
              const value = row[key]
              return (
                <TableCell key={key} className="truncate">
                  {typeof value === 'boolean'
                    ? <Badge variant={value ? 'secondary' : 'outline'}>{value ? '是' : '否'}</Badge>
                    : String(value ?? '-')}
                </TableCell>
              )
            })}
            {hasActions && (
              <TableCell>
                <span className="flex gap-1">
                  {definition.capabilities.includes('update') && <Button size="sm" variant="outline" onClick={() => openEdit(row)}>编辑</Button>}
                  {definition.capabilities.includes('delete') && <Button size="sm" variant="destructive" onClick={() => remove(row)}>删除</Button>}
                </span>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
  const addButton = definition.capabilities.includes('create') && <Button size="sm" onClick={() => openEdit(null)}>+ 添加</Button>
  const editModal = (
    <Dialog open={editing !== undefined} onOpenChange={(o) => { if (!o) setEditing(undefined) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{`${editing ? '编辑' : '添加'}${definition.title}`}</DialogTitle></DialogHeader>
        <ResourceFields definition={definition} value={formValue} onChange={setFormValue} record={editing} />
        <DialogFooter>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  // bare：不套 Card（用于嵌进上级详情/编辑态），只渲染标题行 + 表格 + 编辑弹层。
  if (bare) return <div>
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[13px] font-medium">{definition.title}</span>
      {addButton}
    </div>
    {table}
    {editModal}
    {confirmNode}
  </div>
  return <SectionCardLike title={definition.title} extra={addButton}>
    {table}
    {editModal}
    {confirmNode}
  </SectionCardLike>
}

function resourceRenderer(definition: McpResourceDefinition) {
  return definition.ui?.renderer
}

function ResourcePanel({ service, resources, contract, onChanged }: { service: McpService; resources: string[]; contract: McpConfigurationContract | null; onChanged: () => void }) {
  const [parents, setParents] = useState<Record<string, unknown>[]>([])
  const [parentRevision, setParentRevision] = useState(0)
  const parentKey = resources.find(key => !contract?.resources[key]?.relation)
  useEffect(() => {
    if (!contract || !parentKey || contract.resources[parentKey]?.cardinality !== 'collection') return
    listMcpResource(service.id, parentKey).then(result => setParents(Array.isArray(result.data) ? result.data : [])).catch(() => setParents([]))
  }, [contract, parentKey, service.id, parentRevision])
  if (!contract) return <Empty>加载配置契约中...</Empty>
  return <div className="flex flex-col gap-3">{resources.map((key) => {
    const definition = contract.resources[key]
    if (!definition) return <Empty key={key}>{`配置资源不存在：${key}`}</Empty>
    if (definition.cardinality === 'singleton') return <SingletonResourceForm key={key} service={service} resourceKey={key} definition={definition} onChanged={onChanged} />
    if (resourceRenderer(definition) === 'cdp_clients') {
      const sessionsViewKey = Object.entries(contract.views).find(([, view]) => view.ui?.renderer === 'cdp_sessions')?.[0]
      return <CdpClientsCollection key={key} service={service} resourceKey={key} definition={definition} sessionsViewKey={sessionsViewKey} referenceOptions={contract.reference_options} onChanged={onChanged} />
    }
    if (resourceRenderer(definition) === 'mail_accounts') {
      const addressesEntry = Object.entries(contract.resources).find(([, def]) => def.relation?.parentResource === key)
      return <MailAccountsCollection key={key} service={service} resourceKey={key} definition={definition} addressesResource={addressesEntry?.[0]} addressesDefinition={addressesEntry?.[1]} referenceOptions={contract.reference_options} onChanged={onChanged} />
    }
    if (definition.relation?.parentResource) {
      const parentDefinition = contract.resources[definition.relation.parentResource]
      const parentIdField = parentDefinition?.ui?.idField || 'id'
      return parents.length === 0 ? <Empty key={key}>请先创建上级配置</Empty> : (
        <Accordion key={key} type="multiple" className="w-full">
          {parents.map((parent) => {
            const pid = Number(parent[parentIdField])
            const parentLabel = String(parent[parentDefinition?.ui?.displayField || parentIdField] || parent[parentIdField])
            return (
              <AccordionItem key={String(pid)} value={String(pid)}>
                <AccordionTrigger>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{parentLabel}</span>
                    <span className="text-muted-foreground">{definition.title}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ResourceCollection service={service} resourceKey={key} definition={definition} parentId={pid} onChanged={onChanged} />
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )
    }
    return <ResourceCollection key={key} service={service} resourceKey={key} definition={definition} onChanged={async () => { setParentRevision(revision => revision + 1); await onChanged() }} />
  })}</div>
}

function SingletonResourceForm({ service, resourceKey, definition, onChanged }: { service: McpService; resourceKey: string; definition: McpResourceDefinition; onChanged: () => void }) {
  const [value, setValue] = useState<Record<string, unknown>>({})
  const [formValue, setFormValue] = useState<Record<string, unknown>>({})
  const load = useCallback(async () => {
    const result = await listMcpResource(service.id, resourceKey)
    const next = ((!Array.isArray(result.data) && result.data) || {}) as Record<string, unknown>
    setValue(next); setFormValue({ ...next })
  }, [service.id, resourceKey])
  useEffect(() => { load().catch((e: any) => toast.error(e?.message || '加载配置失败')) }, [load])
  const save = async () => {
    const err = validateResourceFields(definition, formValue, value)
    if (err) { toast.error(err); return }
    const result = await updateMcpResource(service.id, resourceKey, 'singleton', formValue, { expectedRevision: Number(value.revision) || undefined })
    await load(); await onChanged(); notifyApply(result.meta, `${definition.title}已保存`)
  }
  return <SectionCardLike title={definition.title}>
    <ResourceFields definition={definition} value={formValue} onChange={setFormValue} record={value} />
    {definition.capabilities.includes('update') && <Button onClick={save}>保存</Button>}
  </SectionCardLike>
}

// =============================================================================
// 小型展示助手
// =============================================================================

// 描述项一行（替代 antd Descriptions item）：label + value 网格对齐。
function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  )
}

// 可复制文本（替代 antd Text copyable）：点击复制到剪贴板。
function CopyableText({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="min-w-0">{children}</span>
      <button
        type="button"
        aria-label="复制"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={async () => { if (await copyToClipboard(text)) toast.success('已复制'); else toast.error('复制失败，请手动选择') }}
      >
        <Copy className="size-3" />
      </button>
    </span>
  )
}

// =============================================================================
// 视图 / 动作面板（manifest schema>=2 的 view/action panel）
// =============================================================================

function ConfigurationViewPanel({ service, viewKey, definition, renderer }: { service: McpService; viewKey: string; definition?: McpViewDefinition; renderer?: string }) {
  return viewKey && renderer === 'cdp_sessions'
    ? <ClientsPanel service={service} viewKey={viewKey} />
    : viewKey
      ? <GenericViewPanel service={service} viewKey={viewKey} definition={definition} />
      : <Empty>视图配置缺少 view key</Empty>
}

function ConfigurationActionPanel({ service, actionKey, definition, renderer }: { service: McpService; actionKey: string; definition?: McpActionDefinition; renderer?: string }) {
  const resources = definition?.ui?.resources || {}
  return renderer === 'mail_messages'
    ? <MailMessagesPanel service={service} actionKey={actionKey} accountsResource={resources.accounts || 'upstream_accounts'} addressesResource={resources.addresses || 'address_mappings'} />
    : <GenericActionPanel service={service} actionKey={actionKey} definition={definition} />
}

function GenericViewPanel({ service, viewKey, definition }: { service: McpService; viewKey: string; definition?: McpViewDefinition }) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try { setData((await queryMcpView(service.id, viewKey)).data) }
    catch (e: any) { toast.error(e?.message || '加载视图失败') }
    finally { setLoading(false) }
  }, [service.id, viewKey])
  useEffect(() => { load() }, [load])
  return (
    <SectionCardLike title={definition?.title || viewKey} extra={<Button variant="outline" size="sm" disabled={loading} onClick={load}>刷新</Button>}>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(data, null, 2)}</pre>
    </SectionCardLike>
  )
}

function GenericActionPanel({ service, actionKey, definition }: { service: McpService; actionKey: string; definition?: McpActionDefinition }) {
  const [result, setResult] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const formDefinition: McpResourceDefinition = { title: definition?.title || actionKey, cardinality: 'singleton', binding: definition?.binding || '', capabilities: [], schema: definition?.inputSchema || { type: 'object', properties: {} } }
  const [formValue, setFormValue] = useState<Record<string, unknown>>(() => resourceDefaults(formDefinition))
  const run = async () => {
    const err = validateResourceFields(formDefinition, formValue, null)
    if (err) { toast.error(err); return }
    setLoading(true)
    try { setResult((await executeMcpAction(service.id, actionKey, formValue)).data) }
    catch (e: any) { toast.error(e?.message || '执行动作失败') }
    finally { setLoading(false) }
  }
  return (
    <SectionCardLike title={definition?.title || actionKey}>
      <ResourceFields definition={formDefinition} value={formValue} onChange={setFormValue} />
      <Button disabled={loading} onClick={run}>执行</Button>
      {result !== null && <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </SectionCardLike>
  )
}

// =============================================================================
// MIME 解析助手（纯逻辑，照搬）
// =============================================================================

// RFC 2047 encoded-word 解码，用于 MIME 头中的发件人名等显示值。
function decodeMimeEncodedWord(value: string): string {
  if (!value) return ''
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, encoding: string, text: string) => {
    try {
      const enc = encoding.toLowerCase()
      let ascii = ''
      if (enc === 'b') {
        ascii = atob(text)
      } else {
        ascii = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_h, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      }
      const bytes = new Uint8Array(ascii.length)
      for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i)
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return text
    }
  })
}

// 从原始 MIME 中读取单个头字段值（处理折行续接）。
function readMimeHeader(raw: string, name: string): string {
  if (!raw) return ''
  const headerSection = raw.split(/\r?\n\r?\n/, 1)[0] || ''
  const lines = headerSection.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${name}:\\s*(.*)$`, 'i'))
    if (!m) continue
    let value = m[1]
    let j = i + 1
    while (j < lines.length && /^\s/.test(lines[j])) {
      value += ' ' + lines[j].trim()
      j++
    }
    return decodeMimeEncodedWord(value.trim())
  }
  return ''
}

// 提取发件人信息，优先使用上游已提供的字段，缺失时回退到 MIME 头解析。
function mailSender(row: Record<string, any>): { name: string; email: string } {
  const direct = row.from || row.sender || row.from_address
  if (direct && typeof direct === 'string') {
    const bracket = direct.match(/<([^>]+)>/)
    const email = bracket ? bracket[1] : (direct.match(/[\w.+-]+@[\w.-]+/) || [''])[0]
    const name = direct.replace(/<[^>]+>/, '').replace(/^"|"$/g, '').trim() || email
    return { name, email }
  }
  const value = readMimeHeader(row.raw_content || row.raw || '', 'From')
  if (!value) return { name: '', email: '' }
  const bracket = value.match(/<([^>]+)>/)
  const email = bracket ? bracket[1] : (value.match(/[\w.+-]+@[\w.-]+/) || [''])[0]
  const name = value.replace(/<[^>]+>/, '').replace(/^"|"$/g, '').trim() || email
  return { name, email }
}

// 提取发送时间，优先使用上游已提供的字段，缺失时回退到 MIME Date 头。
function formatMailDate(row: Record<string, any>): string {
  const direct = row.date || row.created_at || row.received_at || row.time
  const candidate = typeof direct === 'string' && direct ? direct : readMimeHeader(row.raw_content || row.raw || '', 'Date')
  if (!candidate) return '-'
  const d = new Date(candidate)
  if (isNaN(d.getTime())) return candidate
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 给邮件 HTML 注入 <base target="_blank">，使正文中的链接在新标签页打开而非导航 iframe 自身。
function withBaseTargetBlank(html: string): string {
  if (!html) return html
  const cleaned = html
    .replace(/<meta[^>]*charset[^>]*>/gi, '')
    .replace(/<meta[^>]*http-equiv=["']?content-type["']?[^>]*>/gi, '')
  const inject = '<meta charset="utf-8"><base target="_blank">'
  if (/<head[^>]*>/i.test(cleaned)) return cleaned.replace(/<head[^>]*>/i, m => `${m}${inject}`)
  if (/<html[^>]*>/i.test(cleaned)) return cleaned.replace(/<html[^>]*>/i, m => `${m}<head>${inject}</head>`)
  return `${inject}${cleaned}`
}

function MailMessagesPanel({ service, actionKey, accountsResource, addressesResource }: { service: McpService; actionKey: string; accountsResource: string; addressesResource: string }) {
  const [configs, setConfigs] = useState<Record<string, any>[]>([])
  const [addresses, setAddresses] = useState<Record<string, any>[]>([])
  const [mailConfigId, setMailConfigId] = useState<number | undefined>()
  const [mailAddress, setMailAddress] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [messages, setMessages] = useState<Record<string, any>[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [viewing, setViewing] = useState<Record<string, any> | null>(null)
  const [bodyMode, setBodyMode] = useState<'raw' | 'html'>('html')
  const searchSequence = useRef(0)

  const loadConfigs = useCallback(async () => {
    try {
      const next = ((await listMcpResource(service.id, accountsResource)).data as unknown as Record<string, unknown>[])
      setConfigs(next)
      setMailConfigId(current => current || (typeof next[0]?.id === 'number' ? next[0].id : Number(next[0]?.id) || undefined))
    } catch (e: any) {
      toast.error(e?.message || '加载邮箱服务失败')
    }
  }, [service.id, accountsResource])

  const loadAddresses = useCallback(async () => {
    if (!mailConfigId) { setAddresses([]); return }
    try {
      const next = ((await listMcpResource(service.id, addressesResource, mailConfigId)).data as unknown as Record<string, unknown>[])
      setAddresses(next)
    } catch (e: any) {
      toast.error(e?.message || '加载邮箱地址失败')
    }
  }, [service.id, mailConfigId, addressesResource])

  const queryMessages = useCallback(async (nextPage = 1) => {
    if (!mailConfigId) { toast.warning('请先选择邮箱服务'); return }
    const sequence = ++searchSequence.current
    setLoading(true)
    try {
      const params = { config_id: mailConfigId, address: mailAddress || undefined, keyword: keyword || undefined, limit: 20, offset: (nextPage - 1) * 20 }
      // 实时查询要访问上游邮箱服务，耗时可能远超默认 15s，单独放宽到 90s。
      const data = (await executeMcpAction(service.id, actionKey, params, 90000)).data as unknown as { messages?: Record<string, unknown>[] }
      if (sequence !== searchSequence.current) return
      setMessages(data.messages || [])
      setPage(nextPage)
      setLoaded(true)
    } catch (e: any) {
      if (sequence !== searchSequence.current) return
      toast.error(e?.message || '加载当前邮件失败')
    } finally {
      if (sequence === searchSequence.current) setLoading(false)
    }
  }, [service.id, actionKey, mailConfigId, mailAddress, keyword])

  useEffect(() => { loadConfigs() }, [loadConfigs])
  useEffect(() => { loadAddresses() }, [loadAddresses])
  // 选定邮箱服务后自动拉取第一页当前邮件。
  useEffect(() => {
    if (!mailConfigId) return
    setMailAddress(''); setKeyword(''); setMessages([]); setPage(1); setLoaded(false); setViewing(null)
    queryMessages(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailConfigId])

  const viewingSender = viewing ? mailSender(viewing) : null
  const viewingDateLabel = viewing ? formatMailDate(viewing) : ''
  const viewingFromLabel = viewingSender
    ? viewingSender.email
      ? viewingSender.name && viewingSender.name !== viewingSender.email
        ? `${viewingSender.name} <${viewingSender.email}>`
        : viewingSender.email
      : '-'
    : '-'

  const addressMatches = addresses.filter(item => String(item.address ?? '').toLowerCase().includes(mailAddress.toLowerCase()))

  return (
    <div className="flex flex-col gap-3">
      {!viewing && (
        <SectionCardLike>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px]">
              <Select value={mailConfigId != null ? String(mailConfigId) : undefined} onValueChange={(v) => setMailConfigId(Number(v))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="选择邮箱服务" /></SelectTrigger>
                <SelectContent>
                  {configs.map(config => (
                    <SelectItem key={String(config.id)} value={String(config.id)}>{String(config.display_name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 邮箱地址输入 + 建议（替代 antd AutoComplete）：输入框直用，datalist 提供建议 */}
            <div className="min-w-[300px]">
              <Input
                value={mailAddress}
                onChange={e => setMailAddress(e.target.value)}
                placeholder="邮箱地址（留空查全部）"
                list="mail-address-suggestions"
                onKeyDown={e => { if (e.key === 'Enter') queryMessages(1) }}
              />
              <datalist id="mail-address-suggestions">
                {addressMatches.map(item => (
                  <option key={String(item.address)} value={String(item.address)}>
                    {item.address === item.source_address ? String(item.address) : `${item.address}（替换为 ${item.source_address}）`}
                  </option>
                ))}
              </datalist>
            </div>
            <Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="关键词（可选）" className="w-[200px]" onKeyDown={e => { if (e.key === 'Enter') queryMessages(1) }} />
            <Button disabled={loading} onClick={() => queryMessages(1)}>搜索</Button>
          </div>
        </SectionCardLike>
      )}
      {viewing ? (
        <SectionCardLike title={String(viewing.subject || viewing.title || '（无主题）')} bodyClassName="p-3">
          <div className="flex flex-col gap-2" style={{ height: 'calc(85vh - 130px)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={() => setViewing(null)}><ArrowLeft /></Button>
              <span className="flex flex-wrap gap-1">
                <Badge variant="secondary">发件人：{viewingFromLabel}</Badge>
                <Badge variant="outline">收件：{String(viewing.received_address || viewing.requested_address || mailAddress || '-')}</Badge>
                <Badge variant="outline">{viewingDateLabel}</Badge>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ToggleGroup type="single" variant="outline" size="sm" value={bodyMode} onValueChange={(v) => { if (v) setBodyMode(v as 'raw' | 'html') }}>
                <ToggleGroupItem value="html">渲染 HTML</ToggleGroupItem>
                <ToggleGroupItem value="raw">显示原文</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden border" style={{ borderColor: 'var(--admin-border)' }}>
              {bodyMode === 'html'
                ? (viewing.html_content
                    ? <iframe title="邮件 HTML 预览" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={withBaseTargetBlank(viewing.html_content)} style={{ width: '100%', height: '100%', border: 'none' }} />
                    : viewing.text_content
                      ? <pre className="m-0 h-full overflow-auto whitespace-pre-wrap break-words p-3 text-sm">{viewing.text_content}</pre>
                      : <Empty>邮件不含正文，可切换「显示原文」查看</Empty>)
                : <pre className="m-0 h-full overflow-auto whitespace-pre-wrap break-words p-3">{viewing.raw_content || viewing.raw || viewing.content || viewing.body || '（无原文内容）'}</pre>}
            </div>
          </div>
        </SectionCardLike>
      ) : (
        <SectionCardLike title="当前邮件">
          {messages.length === 0 ? <Empty>{loaded ? '没有邮件' : (loading ? '正在实时查询...' : '选择邮箱服务后自动加载当前邮件')}</Empty> : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">发送者</TableHead>
                    <TableHead className="w-[220px]">邮箱</TableHead>
                    <TableHead className="w-[300px]">主题</TableHead>
                    <TableHead className="w-[180px]">发送时间</TableHead>
                    <TableHead className="w-[80px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((row, index) => {
                    const s = mailSender(row)
                    const senderLabel = s.email ? (s.name && s.name !== s.email ? `${s.name} <${s.email}>` : s.email) : '-'
                    const address = String(row.received_address || row.requested_address || mailAddress || '-')
                    const subject = String(row.subject || row.title || '（无主题）')
                    const dateLabel = formatMailDate(row)
                    return (
                      <TableRow key={String(row.id || row.message_id || `${page}-${index}`)}>
                        <TableCell className="max-w-[220px] truncate"><Tooltip><TooltipTrigger asChild><span className="block truncate">{senderLabel}</span></TooltipTrigger><TooltipContent>{senderLabel}</TooltipContent></Tooltip></TableCell>
                        <TableCell className="max-w-[220px] truncate"><Tooltip><TooltipTrigger asChild><span className="block truncate">{address}</span></TooltipTrigger><TooltipContent>{address}</TooltipContent></Tooltip></TableCell>
                        <TableCell className="max-w-[300px] truncate"><Tooltip><TooltipTrigger asChild><span className="block truncate">{subject}</span></TooltipTrigger><TooltipContent>{subject}</TooltipContent></Tooltip></TableCell>
                        <TableCell className="max-w-[180px] truncate"><Tooltip><TooltipTrigger asChild><span className="block truncate">{dateLabel}</span></TooltipTrigger><TooltipContent>{dateLabel}</TooltipContent></Tooltip></TableCell>
                        <TableCell><Button variant="outline" size="sm" onClick={() => { setViewing(row); setBodyMode('html') }}>查看</Button></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
          {messages.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" disabled={page <= 1 || loading} onClick={() => queryMessages(page - 1)}>上一页</Button>
              <span className="text-sm text-muted-foreground">第 {page} 页</span>
              <Button variant="outline" disabled={messages.length < 20 || loading} onClick={() => queryMessages(page + 1)}>下一页</Button>
            </div>
          )}
        </SectionCardLike>
      )}
    </div>
  )
}

// =============================================================================
// 基础信息 / 环境变量 / 工具 / 连接配置面板
// =============================================================================

function InfoPanel({ service }: { service: McpService }) {
  const rows: Array<[string, ReactNode]> = [
    ['名称', service.name],
    ['显示名', service.display_name || '-'],
    ['描述', service.description || '-'],
    ['分类', service.category || '-'],
    ['传输方式', service.transport],
    ['命令', service.command || '-'],
    ['版本', service.version || '-'],
    ['作者', service.author || '-'],
    ['文档', service.docs_url || '-'],
    ['来源', service.source || '-'],
    ['内置', service.builtin ? '是' : '否'],
    ['启用', service.enabled ? '是' : '否'],
    ['运行状态', <span key="rs" className="font-medium" style={{ color: runtimeStatusColor(service.runtime_status) }}>{runtimeStatusLabel(service.runtime_status)}</span>],
  ]
  return (
    <Card className="shadow-none">
      <CardContent className="p-0">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="w-[120px] border-b px-2.5 py-[7px] align-top text-muted-foreground" style={{ borderColor: 'var(--admin-border)' }}>{k}</td>
                <td className="border-b px-2.5 py-[7px] break-all" style={{ borderColor: 'var(--admin-border)' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function EnvPanel({ service, onChanged }: { service: McpService; onChanged: () => void }) {
  const [envVars, setEnvVars] = useState<McpEnvVar[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listMcpEnvVars(service.id).then(setEnvVars).catch(() => setEnvVars([]))
  }, [service.id])

  const updateEnv = (idx: number, patch: Partial<McpEnvVar>) => {
    setEnvVars(vars => vars.map((v, i) => i === idx ? { ...v, ...patch } : v))
  }

  const saveEnv = async () => {
    setBusy(true)
    try {
      const saved = await saveMcpEnvVars(service.id, envVars.filter(v => v.key.trim()))
      setEnvVars(saved)
      await reloadMcpService(service.id).catch(() => {})
      await onChanged()
      toast.success('环境变量已保存，服务已热重载')
    } catch (e: any) {
      toast.error(e?.message || '保存环境变量失败')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex flex-col gap-2">
        {envVars.map((v, idx) => (
          <div key={idx} className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr 1.4fr 90px 1.2fr auto' }}>
            <Input value={v.key} placeholder="KEY" onChange={e => updateEnv(idx, { key: e.target.value })} />
            <Input value={v.value} placeholder={v.masked ? '已脱敏，留空保存会清空' : 'value'} type={v.secret ? 'password' : 'text'} onChange={e => updateEnv(idx, { value: e.target.value, masked: false })} />
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={v.secret} onCheckedChange={c => updateEnv(idx, { secret: !!c })} />
              secret
            </label>
            <Input value={v.description || ''} placeholder="说明" onChange={e => updateEnv(idx, { description: e.target.value })} />
            <Button variant="destructive" size="icon-sm" onClick={() => setEnvVars(vars => vars.filter((_, i) => i !== idx))}>×</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setEnvVars(vars => [...vars, { key: '', value: '', secret: false, description: '' }])}>+ 添加变量</Button>
        <Button size="sm" disabled={busy} onClick={saveEnv}>保存并热重载</Button>
      </div>
    </div>
  )
}

// 工具参数详情：把 JSON Schema 的 properties 平铺成可读的参数表。
function ToolParamsDetail({ schema }: { schema: Record<string, unknown> }) {
  const properties = (schema?.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, Record<string, unknown>>
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]).map(String) : [])
  const keys = Object.keys(properties)
  if (keys.length === 0) return <span className="text-xs text-muted-foreground">无参数</span>
  return (
    <div className="max-h-[360px] max-w-[360px] overflow-auto">
      <div className="flex flex-col gap-2">
        {keys.map(key => {
          const field = properties[key] || {}
          const type = field.type ? String(field.type) : (Array.isArray(field.enum) ? 'enum' : '')
          const desc = field.description ? String(field.description) : ''
          const enumValues = Array.isArray(field.enum) ? field.enum : null
          return (
            <div key={key} className="text-xs leading-relaxed">
              <span className="flex flex-wrap items-center gap-1.5">
                <code className="text-xs">{key}</code>
                {type && <Badge variant="outline">{type}</Badge>}
                {required.has(key) ? <Badge variant="destructive">必填</Badge> : <Badge variant="outline">可选</Badge>}
              </span>
              {desc && <div className="text-muted-foreground">{desc}</div>}
              {enumValues && <div className="mt-0.5 flex flex-wrap gap-1">{enumValues.map(v => <Badge key={String(v)} variant="outline">{String(v)}</Badge>)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ToolsPanel({ service }: { service: McpService }) {
  const [tools, setTools] = useState<McpTool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try { setTools(await getMcpServiceTools(service.id, refresh)) }
    catch (e: any) { setTools([]); setError(e?.message || '加载工具失败') }
    finally { setLoading(false) }
  }, [service.id])

  useEffect(() => { load() }, [load])
  if (loading) return <Empty>加载中...</Empty>
  return (
    <div>
      <div className="mb-2.5 flex justify-between">
        <span className="text-xs text-muted-foreground">工具来自 MCP Runtime；刷新会覆盖本地缓存。</span>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => load(true)}>刷新工具</Button>
      </div>
      {error && <span className="mb-2.5 block text-red-600 dark:text-red-400">{error}</span>}
      {tools.length === 0 ? <Empty>暂无工具数据。请确认 MCP Runtime 已启动后点击“刷新工具”。</Empty> : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {tools.map(t => (
            <Card key={t.name} className="relative shadow-none">
              <CardContent className="p-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="查看参数详情" className="absolute right-1 top-1 rounded-full">?</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto">
                    <div className="mb-2"><code className="text-xs">{t.name}</code></div>
                    <ToolParamsDetail schema={t.input_schema} />
                  </PopoverContent>
                </Popover>
                <code className="inline-block pr-5 text-xs">{t.name}</code>
                <div className="mt-1 text-xs text-muted-foreground">{t.description || '（无描述）'}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigPanel({ service, copyable, onOpenUser }: { service: McpService; copyable?: boolean; onOpenUser?: (principalId: number) => void }) {
  const [config, setConfig] = useState<McpClientConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMcpClientConfig(service.id).then(setConfig).catch(e => { setConfig(null); setError(e?.message || '加载配置失败') })
  }, [service.id])

  const copyText = async (text: string, ok = '已复制') => {
    if (await copyToClipboard(text)) {
      toast.success(ok)
    } else {
      toast.error('复制失败，请手动选择')
    }
  }

  const copyTemplate = async () => {
    if (!config) return
    await copyText(JSON.stringify(config.configs.claude_desktop || config.configs.generic, null, 2), '配置模板已复制（请在客户端安全地提供 MCP 用户凭据）')
  }

  return (
    <div>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}

      {config?.ws_session_url && (
        <>
          <div className="m-0 mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">浏览器扩展 WebSocket 地址（填入扩展 popup 的 Bridge 地址）</span>
            <Button variant="outline" size="sm" onClick={() => copyText(config.ws_session_url!, '扩展 WS 地址已复制')}>复制</Button>
          </div>
          <pre style={codeBlock}>{config.ws_session_url}</pre>
        </>
      )}

      <span className="text-xs text-muted-foreground">SSE URL（需带 token 参数）</span>
      <pre style={codeBlock}>{config?.sse_url || '加载中...'}</pre>

      {config?.token_template && (
        <>
          <div className="mx-0 mb-1 mt-2.5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">参数化模板（连接方需在本地安全注入 MCP 用户凭据）</span>
            <Button variant="outline" size="sm" onClick={() => copyText(config.token_template!, '模板 URL 已复制')}>复制模板</Button>
          </div>
          <pre style={codeBlock}>{config.token_template}</pre>
          <span className="block text-[11px] text-yellow-600 dark:text-yellow-400">
            鉴权已开启：此页面只提供占位模板，不展示或拼接任何完整 MCP 用户 token。请由连接方在本地安全注入凭据。Chrome 扩展使用独立的 CDP 客户端 token，不是 MCP 用户 token。
          </span>
        </>
      )}

      <div className="mx-0 mb-2 mt-3.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Claude Desktop / Cursor 配置片段（模板，含 &lt;TOKEN&gt; 占位）
        </span>
        {copyable && config && (
          <Button variant="outline" size="sm" onClick={copyTemplate}>复制配置</Button>
        )}
      </div>
      <pre style={codeBlock}>{config ? JSON.stringify(config.configs.claude_desktop, null, 2) : '加载中...'}</pre>

      <SectionCardLike title="已授权用户" className="mt-3.5">
        <p className="mb-2 text-muted-foreground">为避免管理页面泄露凭据，这里仅显示可连接用户身份；完整 MCP 用户 token 不会出现在连接配置中。</p>
        {(config?.users || []).length === 0 ? <Empty>暂无已授权用户。请到右上角「MCP 设置」分配服务。</Empty> : <span className="flex flex-wrap gap-1">{(config?.users || []).map(user => (
          onOpenUser ? (
            <button
              key={user.user_id}
              type="button"
              className="inline-flex"
              title="点击查看该 MCP 用户详情"
              onClick={() => onOpenUser(Number(user.user_id))}
            >
              <Badge variant="outline" className="cursor-pointer hover:bg-accent">{user.name}</Badge>
            </button>
          ) : <Badge key={user.user_id} variant="outline">{user.name}</Badge>
        ))}</span>}
      </SectionCardLike>
    </div>
  )
}

function ClientsPanel({ service, viewKey }: { service: McpService; viewKey: string }) {
  type Page = { id: string; session_key?: string; page_id?: string; title?: string; url?: string; active?: boolean; status?: string; connected_at?: number; connect_at?: number; disconnect_at?: number }
  type Client = { client_id: string; name?: string; connected?: boolean; pages?: Page[]; active_count?: number }
  type Context = { user_id: number; clients?: Client[]; active_count?: number }
  const [data, setData] = useState<{ contexts?: Context[]; note?: string } | null>(null)
  const [users, setUsers] = useState<McpUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true); setError(null)
    queryMcpView(service.id, viewKey)
      .then(result => setData(result.data as typeof data))
      .catch(e => setError(e?.message || '加载客户端列表失败'))
      .finally(() => setLoading(false))
  }, [service.id, viewKey])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { listMcpUsers().then(setUsers).catch(() => setUsers([])) }, [])

  const contexts = data?.contexts || []
  const clients = contexts.flatMap(context => (context.clients || []).map(client => ({ ...client, user_id: context.user_id })))
  const userName = (id: number) => users.find(user => user.id === Number(id))?.name || `用户 #${id}`
  const formatTime = (seconds?: number) => seconds ? new Date(seconds * 1000).toLocaleString() : '-'
  if (loading && !data) return <Empty>加载中...</Empty>
  if (error) return <span className="text-red-600 dark:text-red-400">{error}</span>

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">CDP 客户端 {clients.length} 个</span>
        <Button variant="outline" size="sm" disabled={loading} onClick={reload}>手动刷新</Button>
      </div>
      {clients.length === 0 ? <Empty>{data?.note || '当前没有已连接或历史客户端。请先创建客户端并连接 Chrome 扩展。'}</Empty> : (
        <Accordion type="multiple" className="w-full">
          {clients.map(client => {
            const pages = client.pages || []
            return (
              <AccordionItem key={`${client.user_id}:${client.client_id}`} value={`${client.user_id}:${client.client_id}`}>
                <AccordionTrigger>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{client.name || client.client_id}</span>
                    <span className="text-muted-foreground">{userName(client.user_id)}</span>
                    <Badge variant={client.connected ? 'secondary' : 'outline'}>{client.connected ? '在线' : '离线'}</Badge>
                    <span className="text-muted-foreground">网页 {pages.length}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  {pages.length === 0 ? <Empty>暂无网页</Empty> : (
                    <Accordion type="multiple" className="w-full">
                      {pages.map(page => (
                        <AccordionItem key={page.id} value={page.id}>
                          <AccordionTrigger>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="max-w-[360px] truncate font-medium">{page.title || '（无标题）'}</span>
                              <Badge variant={page.active ? 'secondary' : 'outline'}>{page.active ? '已连接' : '已断开'}</Badge>
                              <span className="text-muted-foreground">Tab {page.page_id || page.id.split(':').pop()}</span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="flex flex-col">
                              <InfoRow label="页面标题">{page.title || '（无标题）'}</InfoRow>
                              <InfoRow label="完整 URL"><CopyableText text={page.url || '-'} className="break-all"><code className="text-xs">{page.url || '-'}</code></CopyableText></InfoRow>
                              <InfoRow label="Tab ID"><code className="text-xs">{page.page_id || page.id.split(':').pop()}</code></InfoRow>
                              <InfoRow label="Session Key"><CopyableText text={page.session_key || page.id}><code className="text-xs">{page.session_key || page.id}</code></CopyableText></InfoRow>
                              <InfoRow label="状态"><Badge variant={page.active ? 'secondary' : 'outline'}>{page.status === 'connected' || page.active ? '已连接' : '已断开'}</Badge></InfoRow>
                              <InfoRow label="连接时间">{formatTime(page.connected_at || page.connect_at)}</InfoRow>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}

// =============================================================================
// 使用说明 / 附件 / SOP 通用 tab 内容
// =============================================================================

function HelpContent({ help, assets }: { help: NonNullable<McpServiceManifest['help']>; assets?: McpServiceManifest['assets'] }) {
  return (
    <div className="flex flex-col gap-3">
      <h5 className="m-0 text-base font-medium">{help.title || '使用说明'}</h5>
      {(help.sections || []).map((section, idx) => (
        <Card key={idx} className="shadow-none">
          <CardContent className="p-3">
            <span className="mb-2 block text-sm font-medium">{section.heading}</span>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {renderInlineLinks(section.body, assets)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// 解析 [text](target) 内联链接：
//   asset:<id>  → 该附件的下载地址（target=_blank 下载）
//   http(s)/ws(s):// / chrome:// 等 → 新标签打开
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function renderInlineLinks(body: string, assets?: McpServiceManifest['assets']): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index))
    out.push(<HelpLink key={`${m.index}-${m[1]}`} text={m[1]} target={m[2]} assets={assets} />)
    last = m.index + m[0].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out
}

function HelpLink({ text, target, assets }: { text: string; target: string; assets?: McpServiceManifest['assets'] }) {
  if (target.startsWith('asset:')) {
    const id = target.slice('asset:'.length)
    const asset = assets?.find(a => a.id === id)
    if (asset?.download_url) {
      return (
        <a href={asset.download_url} target="_blank" rel="noreferrer" download style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
          {text}
        </a>
      )
    }
    return <code className="text-xs">{text}</code>
  }
  return (
    <a href={target} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
      {text}
    </a>
  )
}

function AssetsContent({ assets }: { assets: NonNullable<McpServiceManifest['assets']> }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-medium">附件下载</span>
        <span className="text-[11px] text-muted-foreground">{assets.length} 个文件</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {assets.map(asset => (
          <a key={asset.id} href={asset.download_url || '#'} target="_blank" rel="noreferrer" className="no-underline">
            <Card className="min-w-[200px] shadow-none">
              <CardContent className="p-3">
                <span className="text-xs font-medium">{asset.label}</span>
                <div><code className="text-[11px] text-muted-foreground">{asset.file_name}</code></div>
                {asset.description && <span className="text-[11px] text-muted-foreground">{asset.description}</span>}
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  )
}

function SopPanel({ serviceName }: { serviceName: string }) {
  const [files, setFiles] = useState<McpSopFile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await getMcpServiceSop(serviceName)
      setFiles(data.files || [])
    } catch (e: any) {
      setError(e?.message || '加载 SOP 失败')
    } finally { setLoading(false) }
  }, [serviceName])

  useEffect(() => { load() }, [load])

  const update = (name: string, content: string) => {
    setFiles(list => list.map(f => f.name === name ? { ...f, content } : f))
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveMcpServiceSop(serviceName, files)
      toast.success('SOP 已保存')
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '保存 SOP 失败')
    } finally { setSaving(false) }
  }

  if (loading) return <Empty>加载中...</Empty>
  if (error) return <span className="text-red-600 dark:text-red-400">{error}</span>
  if (files.length === 0) return <Empty>该服务暂无 SOP 文件。</Empty>

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">直接编辑源文件，保存即写回磁盘（仅支持覆盖已存在的 .md）。</span>
        <Button size="sm" disabled={saving} onClick={save}>保存全部</Button>
      </div>
      <div className="flex flex-col gap-3">
        {files.map(f => (
          <SectionCardLike key={f.name} title={<code className="text-xs">{f.name}</code>}>
            <Textarea
              value={f.content}
              onChange={e => update(f.name, e.target.value)}
              rows={12}
              style={{ fontFamily: 'var(--fontM)' }}
            />
          </SectionCardLike>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// 小工具（纯逻辑，照搬）
// =============================================================================

function categoryEmoji(cat: string): string {
  const map: Record<string, string> = {
    browser: '🌐', search: '🔍', file: '📁', code: '💻', media: '🖼️', custom: '🧩',
  }
  return map[cat] || '🧩'
}

function categoryLabel(c: string): string {
  return ({
    '全部': '全部', browser: '浏览器', search: '搜索', file: '文件', code: '代码', media: '媒体', custom: '自定义',
  } as Record<string, string>)[c] || c
}

function runtimeStatusLabel(status?: string | null): string {
  return ({ loaded: '运行中', stopped: '已停止', error: '异常', restarting: '重启中' } as Record<string, string>)[status || ''] || '未启动'
}

function runtimeStatusColor(status?: string | null): string {
  return ({ loaded: 'var(--green)', stopped: 'var(--text2)', error: 'var(--red)', restarting: 'var(--yellow)' } as Record<string, string>)[status || ''] || 'var(--text2)'
}

// ── 部署形态与安装进度（Phase 2）──
//
// MCP 按 deploy_scope 分两类展示（不让使用者选，由 transport 客观推导）：
//   server  = 全局远程，agent + 所有编辑器共用，有安装进度
//   session = 会话内 stdio，编辑器 CLI 自己在节点拉起，无安装进度（直接 ready）
//   node_hosted = 节点托管 stdio 再代理成 remote，全局可用（形态 C，后续步骤实现）
function deployScopeLabel(scope?: string | null): string {
  return ({ server: '全局服务', session: '会话工具', node_hosted: '节点托管' } as Record<string, string>)[scope || ''] || '全局服务'
}

function installStateLabel(state?: string | null): string {
  return ({
    created: '待安装', configuring: '配置中', starting: '启动中', testing: '测试中', ready: '就绪', error: '异常',
  } as Record<string, string>)[state || ''] || ''
}

function installStateColor(state?: string | null): string {
  return ({
    ready: 'var(--green)', error: 'var(--red)', configuring: 'var(--yellow)', starting: 'var(--yellow)', testing: 'var(--yellow)', created: 'var(--text2)',
  } as Record<string, string>)[state || ''] || 'var(--text2)'
}

// 默认 home_actions（自定义 MCP 无 manifest 时使用）
const DEFAULT_HOME_ACTIONS: McpManifestAction[] = [
  { id: 'info', label: '基础信息', icon: '📋', panel: 'info' },
  { id: 'env', label: '环境变量', icon: '🔧', panel: 'env' },
  { id: 'config', label: '连接配置', icon: '🔗', panel: 'config' },
  { id: 'tools', label: '工具列表', icon: '🛠', panel: 'tools' },
]

const DEFAULT_PANELS: NonNullable<McpServiceManifest['panels']> = {
  info: { kind: 'info', read_only: false },
  env: { kind: 'env', read_only: false },
  config: { kind: 'config', read_only: true, copyable: true },
  tools: { kind: 'tools', read_only: true },
}

// CDP / 邮箱已从「MCP 市场」摘出，改为用户侧「内置工具」独立管理（用户拥有实例 +
// token 分享）。市场只保留外部第三方 MCP，故在服务列表加载时按名过滤掉这两个。
const BUILTIN_TOOLS_MOVED_OUT = new Set<string>(['cdp-bridge', 'mail'])

// 内置服务里拥有 sop/ 目录的名单（前端据此决定是否显示 SOP tab）。
// 与后端 _BUILTIN_MANIFEST_DIRS + sop 目录保持一致。
const BUILTIN_WITH_SOP = new Set<string>(['cdp-bridge'])

// 代码块样式（pre 保持与全局变量一致的配色）
const codeBlock: CSSProperties = {
  margin: 0, padding: 12, background: 'var(--bg2)', border: '1px solid var(--admin-border)', borderRadius: 8,
  color: 'var(--text)', fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--fontM)',
}
