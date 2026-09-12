import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCw, Upload, Download, Trash2, MessageCircle, FileJson } from "lucide-react"
import { AdminPage } from "@/components/manager/platform-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmbeddedAgentChat } from "@/components/console/agent/embedded-agent-chat"
import { NodeVersionEditor } from "@/components/marketplace/NodeVersionEditor"
import { MobileVersionEditor } from "@/components/marketplace/MobileVersionEditor"
import { DeviceControlVersionEditor } from "@/components/marketplace/DeviceControlVersionEditor"
import { LeaderboardShell } from "@/components/marketplace/LeaderboardShell"
import { LeaderboardConfigPanel } from "@/components/marketplace/LeaderboardConfigPanel"
import { AgencyAgentsPanel } from "@/components/marketplace/AgencyAgentsPanel"
import { AgentscopePanel } from "@/components/marketplace/AgentscopePanel"
import { SkillhubPanel } from "@/components/marketplace/SkillhubPanel"
import { CommunityConfigPanel } from "@/components/marketplace/CommunityConfigPanel"
import { NodeIpBackupPanel } from "@/components/marketplace/NodeIpBackupPanel"
import { MarketplaceEditDialog, type EditMode } from "@/components/marketplace/MarketplaceEditDialog"
import { UnifiedProviderModal } from "./platform/Channels"
import { Progress } from "@/components/ui/progress"
import {
  batchDeleteChannelTemplates,
  deleteMarketplaceItem,
  exportMarketplace,
  fetchExportableChannels,
  fetchMarketplaceCatalog,
  fetchMarketplaceManifest,
  fetchMarketplaceStatus,
  getChannelImportJob,
  getMarketplacePublishJobs,
  importMarketplace,
  refreshMarketplaceCache,
  retryMarketplacePublish,
  startChannelImportJob,
  upsertMarketplaceItem,
  type ChannelImportJob,
  type ExportableChannel,
  type MarketplaceItem,
  type MarketplaceManifest,
  type MarketplaceModule,
  type MarketplacePublishJobs,
  type MarketplaceStatus,
  type PublishCounts,
} from "@/api/marketplaceAdmin"
import { toast } from "sonner"

/**
 * 父级 tab 的取值。除了六个 manifest 模块，还有两个不落目录的特殊 tab：
 * ``leaderboard``（外部榜单）与 ``community``（社区运营）。
 * 外部榜单内部再分二级「榜单 / 配置」——配置里是 Agent-Leaderboard 与
 * agency-agents 等导入面板，社区运营即技术交流群 + 社区通知配置。
 * 这两个父级 tab 不走 ``fetchMarketplaceCatalog``，各自组件自己拉数据。
 */
type ModuleTab = MarketplaceModule | "leaderboard" | "community" | "node-ip"

/** 目录类 tab 判定：特殊 tab 不拉目录、不吃新建/导出等工具栏动作。 */
function isCatalogModule(tab: ModuleTab): tab is MarketplaceModule {
  return tab !== "leaderboard" && tab !== "community" && tab !== "node-ip"
}

/**
 * 版本号降序比较。服务端只接受两种形态：``YYYYMMDD-HHMM``（可带 ``-N`` 后缀）和
 * semver。两者都能拆成数字段，按段逐个比大小即可；日期形态天然就是上传时间序。
 * 缺版本号的排最后，段数不等时短的补 0（``1.2`` 视作 ``1.2.0``）。
 */
function compareVersionDesc(a?: string, b?: string): number {
  const left = (a || "").trim()
  const right = (b || "").trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  const segs = (v: string) => v.split(/[.\-+]/).map((s) => Number.parseInt(s, 10))
  const ls = segs(left)
  const rs = segs(right)
  for (let i = 0; i < Math.max(ls.length, rs.length); i += 1) {
    const l = Number.isFinite(ls[i]) ? ls[i] : 0
    const r = Number.isFinite(rs[i]) ? rs[i] : 0
    if (l !== r) return r - l
  }
  // 数字段完全相同（含非数字后缀差异）时退回字符串降序，保证排序稳定可预期。
  return right.localeCompare(left)
}

export default function MarketplaceAdmin() {
  // status 三态：undefined=探测中，null=不可管理/探测失败，对象=可管理。
  // 管理页要求 writable（服务端配了 github_token）；只配仓库地址时市场可看但不可管。
  const [status, setStatus] = useState<MarketplaceStatus | null | undefined>(undefined)
  // 内容模块（MCP/插件/Skill/提示词）的 CRUD 已收口到资源中心，这里只管渠道模板/
  // 节点版本/移动端版本/外部榜单。默认落在榜单——它是这页的主工作区。
  const [module, setModule] = useState<ModuleTab>("leaderboard")
  // 外部榜单父级 tab 内部的二级视图：「榜单」列表 vs「配置」面板。
  const [leaderboardSub, setLeaderboardSub] = useState<"list" | "config">("list")
  const [items, setItems] = useState<MarketplaceItem[]>([])
  const [moduleCounts, setModuleCounts] = useState<Partial<Record<MarketplaceModule, number>>>({})
  // PG 保存后 GitHub 异步发布：工具栏实时显示全局 pending/pushing/failed，失败可手动重试。
  const [publish, setPublish] = useState<PublishCounts>({ pending: 0, pushing: 0, failed: 0 })
  const [publishJobs, setPublishJobs] = useState<MarketplacePublishJobs | null>(null)
  const [retryingPublish, setRetryingPublish] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")

  const [editOpen, setEditOpen] = useState(false)
  const [editItem, setEditItem] = useState<MarketplaceManifest | null>(null)
  const [editMode, setEditMode] = useState<EditMode>("mcp-remote")

  // 渠道模板与节点版本用专用编辑器，不走通用 EditDialog。
  const [channelEditOpen, setChannelEditOpen] = useState(false)
  const [channelEditItem, setChannelEditItem] = useState<MarketplaceManifest | null>(null)
  const [nodeEditOpen, setNodeEditOpen] = useState(false)
  const [nodeEditItem, setNodeEditItem] = useState<MarketplaceManifest | null>(null)
  const [mobileEditOpen, setMobileEditOpen] = useState(false)
  const [mobileEditItem, setMobileEditItem] = useState<MarketplaceManifest | null>(null)
  const [deviceControlEditOpen, setDeviceControlEditOpen] = useState(false)
  const [deviceControlEditItem, setDeviceControlEditItem] = useState<MarketplaceManifest | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const importFileRef = useRef<HTMLInputElement>(null)
  const [draggingImportFile, setDraggingImportFile] = useState(false)

  const [assistantOpen, setAssistantOpen] = useState(false)

  // 「从当前平台导入」多选弹框：拉当前渠道清单、勾选、只发布选中项到 GitHub。
  const [importChannelsOpen, setImportChannelsOpen] = useState(false)
  // 渠道模板批量硬删除仅在 channels Tab 开启。
  const [channelBatchMode, setChannelBatchMode] = useState(false)
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)

  const readImportFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error("导入文件不能超过 10MB")
      return
    }
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error("文件为空")
      setImportText(text)
      toast.success(`已读取 ${file.name}`)
    } catch (err) {
      toast.error(`读取文件失败：${String(err)}`)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchMarketplaceStatus()
      .then((st) => { if (!cancelled) setStatus(st.writable ? st : null) })
      .catch(() => { if (!cancelled) setStatus(null) })
    return () => { cancelled = true }
  }, [])

  const applyPublish = useCallback((next?: PublishCounts) => {
    if (next) setPublish(next)
  }, [])

  const load = useCallback(async () => {
    // 榜单/社区运营走独立的 store/接口，不读 GitHub 目录——这里的 fetchMarketplaceCatalog
    // 对 "leaderboard" / "community" 无意义。各自面板自己拉数据。
    if (!isCatalogModule(module)) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // 只拉当前 tab 的目录：刷新就是刷新眼前这页。tab 角标计数在切到对应 tab 时
      // 各自更新——之前每次刷新并发拉全部七个模块，是「点一下刷新慢半拍」的主因。
      const cat = await fetchMarketplaceCatalog(module, query)
      setItems(cat.items || [])
      if (cat.publish) setPublish(cat.publish)
      setModuleCounts((prev) => ({ ...prev, [module]: (cat.items || []).length }))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [module, query])

  // 只有启用后才拉目录，避免未配置时刷一片 404 错误提示。
  useEffect(() => { if (status) void load() }, [status, load])

  // 发布队列轮询：有 pending/pushing 时每 5s 拉一次队列（含明细，供失败徽标 tooltip），
  // 全部落定后停止——发布是秒级动作，常态零轮询流量。
  const pendingPublish = publish.pending + publish.pushing
  useEffect(() => {
    if (!status || (pendingPublish === 0 && publish.failed === 0)) return
    let cancelled = false
    const tick = async () => {
      try {
        const jobs = await getMarketplacePublishJobs()
        if (!cancelled) {
          setPublish(jobs.counts)
          setPublishJobs(jobs)
        }
      } catch { /* 面板性数据，失败静默等下一轮 */ }
    }
    void tick()
    if (pendingPublish > 0) {
      const timer = setInterval(() => { void tick() }, 5000)
      return () => { cancelled = true; clearInterval(timer) }
    }
    return () => { cancelled = true }
  }, [status, pendingPublish, publish.failed])

  const handleRetryPublish = async () => {
    setRetryingPublish(true)
    try {
      const res = await retryMarketplacePublish()
      setPublish(res.publish)
      toast.success(res.retried > 0 ? `已重新入队 ${res.retried} 个发布任务` : "没有可重试的失败任务")
    } catch (err) {
      toast.error(`重试失败：${String(err)}`)
    } finally {
      setRetryingPublish(false)
    }
  }

  // 节点版本 / 移动端版本 / 设备控制 App 版本 tab：按版本（≈上传时间）降序，最新的排最前。
  // 版本号是 YYYYMMDD-HHMM 日期形态、数字串或 semver，都按数字分段比较——避免
  // "1.10.0" < "1.9.0" 这类字符串误排。其它 tab 保持服务端返回的原顺序（index 按 id 升序）。
  const displayItems = useMemo(() => {
    if (module !== "node-versions" && module !== "mobile-versions" && module !== "device-control-versions") return items
    return [...items].sort((a, b) => compareVersionDesc(a.latest_version, b.latest_version))
  }, [items, module])

  const handleCreate = () => {
    if (module === "channels") {
      setChannelEditItem(null)
      setChannelEditOpen(true)
      return
    }
    if (module === "node-versions") {
      setNodeEditItem(null)
      setNodeEditOpen(true)
      return
    }
    if (module === "mobile-versions") {
      setMobileEditItem(null)
      setMobileEditOpen(true)
      return
    }
    if (module === "device-control-versions") {
      setDeviceControlEditItem(null)
      setDeviceControlEditOpen(true)
      return
    }
    setEditItem(null)
    setEditMode(module === "mcp" ? "mcp-remote" : module === "plugins" ? "plugin" : module === "prompts" ? "prompt" : "skill")
    setEditOpen(true)
  }

  const handleEdit = async (item: MarketplaceItem) => {
    // 候选池卡片不经过这里（leaderboard 渲染独立面板）；收到说明是误调用。
    if (!isCatalogModule(module)) return
    const activeModule = module
    try {
      const manifest = await fetchMarketplaceManifest(activeModule, item.id!)
      if (activeModule === "channels") {
        setChannelEditItem(manifest)
        setChannelEditOpen(true)
        return
      }
      if (activeModule === "node-versions") {
        setNodeEditItem(manifest)
        setNodeEditOpen(true)
        return
      }
      if (activeModule === "mobile-versions") {
        setMobileEditItem(manifest)
        setMobileEditOpen(true)
        return
      }
      if (activeModule === "device-control-versions") {
        setDeviceControlEditItem(manifest)
        setDeviceControlEditOpen(true)
        return
      }
      setEditItem(manifest)
      const resType = manifest.resource?.type as string
      if (activeModule === "mcp") {
        setEditMode(resType === "stdio_mcp" ? "mcp-stdio" : "mcp-remote")
      } else {
        setEditMode(activeModule === "plugins" ? "plugin" : activeModule === "prompts" ? "prompt" : "skill")
      }
      setEditOpen(true)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const handleSave = async (manifest: MarketplaceManifest) => {
    if (!isCatalogModule(module)) return
    try {
      const res = await upsertMarketplaceItem(module, manifest)
      applyPublish(res?.publish)
      toast.success(res?.publish?.pending ? "已保存，正在发布到仓库" : "已保存")
      setEditOpen(false)
      void load()
    } catch (err: any) {
      const detail = err?.message || String(err)
      if (detail.includes("errors")) {
        toast.error("校验失败，请检查字段", { description: detail })
      } else {
        toast.error(String(err))
      }
    }
  }

  const handleChannelSave = async (manifest: MarketplaceManifest) => {
    try {
      const res = await upsertMarketplaceItem("channels", manifest)
      applyPublish(res?.publish)
      toast.success(res?.publish?.pending ? "渠道模板已保存，正在发布到仓库" : "渠道模板已保存")
      setChannelEditOpen(false)
      void load()
    } catch (err: any) {
      toast.error("渠道模板校验失败，请检查完整配置", { description: err?.message || String(err) })
    }
  }

  const handleNodeVersionSave = async (manifest: MarketplaceManifest) => {
    try {
      const res = await upsertMarketplaceItem("node-versions", manifest)
      applyPublish(res?.publish)
      toast.success(res?.publish?.pending ? "节点版本已保存，正在发布到仓库" : "节点版本已发布")
      setNodeEditOpen(false)
      void load()
    } catch (err: any) {
      toast.error("节点版本校验失败，请检查发行信息", { description: err?.message || String(err) })
    }
  }

  const handleMobileVersionSave = async (manifest: MarketplaceManifest) => {
    try {
      const res = await upsertMarketplaceItem("mobile-versions", manifest)
      applyPublish(res?.publish)
      toast.success(res?.publish?.pending ? "移动端版本已保存，正在发布到仓库" : "移动端版本已发布")
      setMobileEditOpen(false)
      void load()
    } catch (err: any) {
      toast.error("移动端版本校验失败，请检查发行信息", { description: err?.message || String(err) })
    }
  }

  const handleDeviceControlVersionSave = async (manifest: MarketplaceManifest) => {
    try {
      const res = await upsertMarketplaceItem("device-control-versions", manifest)
      applyPublish(res?.publish)
      toast.success(res?.publish?.pending ? "设备控制 App 版本已保存，正在发布到仓库" : "设备控制 App 版本已发布")
      setDeviceControlEditOpen(false)
      void load()
    } catch (err: any) {
      toast.error("设备控制 App 版本校验失败，请检查发行信息", { description: err?.message || String(err) })
    }
  }


  const handleDelete = async (item: MarketplaceItem, hard: boolean) => {
    if (!isCatalogModule(module)) return
    if (!confirm(`确认${hard ? "硬删除" : "隐藏"}「${item.display_name || item.name}」？`)) return
    try {
      const res = await deleteMarketplaceItem(module, item.id!, hard)
      applyPublish(res?.publish)
      toast.success(hard ? "已删除" : "已隐藏")
      void load()
    } catch (err) {
      toast.error(String(err))
    }
  }

  // 取消隐藏：读回完整 manifest，把 status 改成 published 再 upsert。
  // 隐藏只改索引行的 status，manifest 本身不动，所以这里能原样恢复。
  const handleUnhide = async (item: MarketplaceItem) => {
    if (!isCatalogModule(module)) return
    try {
      const manifest = await fetchMarketplaceManifest(module, item.id!)
      const res = await upsertMarketplaceItem(module, { ...manifest, status: "published" })
      applyPublish(res?.publish)
      toast.success("已恢复显示")
      void load()
    } catch (err) {
      toast.error(String(err))
    }
  }

  const handleImportCurrentChannels = () => {
    setImportChannelsOpen(true)
  }

  const toggleChannelSelection = (id: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBatchDeleteChannels = async () => {
    const ids = Array.from(selectedChannelIds)
    if (!ids.length) return
    setBatchDeleting(true)
    try {
      const result = await batchDeleteChannelTemplates(ids)
      setSelectedChannelIds((prev) => {
        const next = new Set(prev)
        result.deleted.forEach((id) => next.delete(id))
        return next
      })
      refreshMarketplaceCache()
      await load()
      if (result.failed.length || result.warnings.length) {
        toast.error(`已删除 ${result.deleted.length}/${result.requested} 个模板`, {
          description: [...result.failed.map((item) => `${item.id}：${item.error}`), ...result.warnings].join(" | "),
        })
      } else {
        toast.success(`已删除 ${result.deleted.length} 个渠道模板`)
        setChannelBatchMode(false)
      }
      setBatchDeleteOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量删除失败")
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleExport = async () => {
    // 导出按钮在榜单 tab 下隐藏，但类型上 module 可能不是目录模块——窄化。
    const exportModule = isCatalogModule(module) ? module : undefined
    try {
      const data = await exportMarketplace(exportModule)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `marketplace-${exportModule || "all"}-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const handleImport = async (mode: "merge" | "replace") => {
    try {
      const body = JSON.parse(importText)
      const res = await importMarketplace(body, mode)
      toast.success(`导入完成：写入 ${res.count} 条，删除 ${res.deleted.length} 条，失败 ${res.failed.length} 条`, {
        description: res.failed.length ? `失败：${res.failed.map(f => f.id).join(", ")}` : undefined,
      })
      setImportOpen(false)
      setImportText("")
      void load()
    } catch (err) {
      toast.error(String(err))
    }
  }

  if (status === undefined) return <Spinner />

  if (status === null) {
    return (
      <AdminPage title="市场管理" description="管理渠道模板 / 节点版本 / 外部榜单资源（内容资源在资源中心统一管理）">
        <Empty>
          <div className="text-base font-medium">市场管理未启用</div>
          <div className="text-sm text-muted-foreground">
            浏览市场只需在服务端 <code className="font-mono">env.ini</code> 的{" "}
            <code className="font-mono">[marketplace]</code> 段填一行仓库地址（
            <code className="font-mono">repo_url = https://github.com/owner/repo</code>）；
            要在这里新建/导入/删除资源，还需补上 <code className="font-mono">github_token</code>
            （Contents 读写权限）后重启服务。
          </div>
        </Empty>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title="市场管理"
      description={
        <span>
          管理渠道模板 / 节点版本 / 移动端版本 / 设备控制 App / 外部榜单（MCP / 插件 / Skill / 提示词内容资源在资源中心统一管理）。当前仓库：
          {status.repo_url ? (
            <a href={status.repo_url} target="_blank" rel="noopener noreferrer" className="font-mono underline">
              {status.owner}/{status.repo}
            </a>
          ) : (
            <span className="font-mono">-</span>
          )}
          <span className="text-muted-foreground"> @ {status.branch}</span>
        </span>
      }
    >
      <div className="space-y-4">
        <Tabs value={module} onValueChange={(v) => { setModule(v as ModuleTab); setChannelBatchMode(false); setSelectedChannelIds(new Set()) }}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="channels">渠道模板 ({moduleCounts.channels ?? 0})</TabsTrigger>
              <TabsTrigger value="node-versions">节点版本 ({moduleCounts["node-versions"] ?? 0})</TabsTrigger>
              <TabsTrigger value="mobile-versions">移动端 ({moduleCounts["mobile-versions"] ?? 0})</TabsTrigger>
              <TabsTrigger value="device-control-versions">设备控制 App ({moduleCounts["device-control-versions"] ?? 0})</TabsTrigger>
              <TabsTrigger value="leaderboard">外部榜单</TabsTrigger>
              <TabsTrigger value="node-ip">节点公网 IP</TabsTrigger>
              <TabsTrigger value="community">社区运营</TabsTrigger>
            </TabsList>
            {/* 候选池/配置自带工具条，公共工具条（搜索/导入/导出/新建）对它无意义。 */}
            <div className={`flex gap-2 ${isCatalogModule(module) ? "" : "hidden"}`}>
              <Input placeholder="搜索..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-48" />
              {module === "channels" && <Button size="sm" variant="outline" onClick={() => void handleImportCurrentChannels()}>从当前平台导入</Button>}
              {module === "channels" && (
                <Button size="sm" variant={channelBatchMode ? "secondary" : "outline"} onClick={() => { setChannelBatchMode((v) => !v); setSelectedChannelIds(new Set()) }}>
                  {channelBatchMode ? "取消批量" : "批量删除"}
                </Button>
              )}
              {channelBatchMode && module === "channels" && <Button size="sm" variant="outline" onClick={() => {
                const ids = items.map((item) => item.id).filter(Boolean)
                setSelectedChannelIds((prev) => prev.size === ids.length ? new Set() : new Set(ids))
              }}>
                {items.length > 0 && selectedChannelIds.size === items.length ? "取消全选" : "全部勾选"}
              </Button>}
              {channelBatchMode && module === "channels" && <Button size="sm" variant="destructive" disabled={!selectedChannelIds.size || batchDeleting} onClick={() => setBatchDeleteOpen(true)}>永久删除（{selectedChannelIds.size}）</Button>}
              {publish.failed > 0 && (
                <Button size="sm" variant="outline" className="text-destructive border-destructive/40" disabled={retryingPublish} onClick={() => void handleRetryPublish()} title={publishJobs?.failed?.[0]?.last_error || "GitHub 发布失败"}>
                  发布失败 {publish.failed}（重试）
                </Button>
              )}
              {publish.pending + publish.pushing > 0 && (
                <Badge variant="secondary" className="self-center whitespace-nowrap">发布中 {publish.pending + publish.pushing}</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => void load()} title="刷新当前 tab"><RefreshCw className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4" /></Button>
              <Button size="sm" onClick={handleCreate}><Plus className="h-4 w-4 mr-1" />{module === "node-versions" || module === "mobile-versions" || module === "device-control-versions" ? "上传新版本" : "新建"}</Button>
            </div>
          </div>
        </Tabs>

        {module === "leaderboard" ? (
          <div className="space-y-4">
            {/* 外部榜单的二级视图：榜单列表 / 同步与导入配置。 */}
            <Tabs value={leaderboardSub} onValueChange={(v) => setLeaderboardSub(v as "list" | "config")}>
              <TabsList>
                <TabsTrigger value="list">榜单</TabsTrigger>
                <TabsTrigger value="config">配置</TabsTrigger>
              </TabsList>
            </Tabs>
            {leaderboardSub === "config" ? (
              <Tabs defaultValue="agent-leaderboard" className="w-full">
                <TabsList>
                  <TabsTrigger value="agent-leaderboard">Agent-Leaderboard</TabsTrigger>
                  <TabsTrigger value="agency-agents">agency-agents</TabsTrigger>
                  <TabsTrigger value="agency-agents-zh">agency-agents-zh</TabsTrigger>
                  <TabsTrigger value="agentscope">agentscope</TabsTrigger>
                  <TabsTrigger value="skillhub">skillhub</TabsTrigger>
                </TabsList>
                <TabsContent value="agent-leaderboard"><LeaderboardConfigPanel /></TabsContent>
                <TabsContent value="agency-agents">
                  <AgencyAgentsPanel source={{ key: "agency_agents", title: "agency-agents", repo: "msitarzewski/agency-agents", description: "270+ 个角色扮演型 agent 提示词合集，自带 frontmatter + divisions.json，确定性转换直连 merge 进 prompts 模块。" }} />
                </TabsContent>
                <TabsContent value="agency-agents-zh">
                  <AgencyAgentsPanel source={{ key: "agency_agents_zh", title: "agency-agents-zh", repo: "jnMetaCode/agency-agents-zh", description: "agency-agents 中文社区版，同款结构化清单，转换口径与英文版一致。", chinese: true }} />
                </TabsContent>
                <TabsContent value="agentscope">
                  <AgentscopePanel />
                </TabsContent>
                <TabsContent value="skillhub">
                  <SkillhubPanel />
                </TabsContent>
              </Tabs>
            ) : (
              <LeaderboardShell onGoConfig={() => setLeaderboardSub("config")} />
            )}
          </div>
        ) : module === "node-ip" ? (
          <NodeIpBackupPanel />
        ) : module === "community" ? (
          <CommunityConfigPanel />
        ) : (
          <>
            {loading && <Spinner />}
            {!loading && items.length === 0 && (
              <Empty>
                <div className="text-base font-medium">暂无资源</div>
                <div className="text-sm text-muted-foreground">点击「新建」添加第一条市场资源，或用「导入」批量写入</div>
              </Empty>
            )}
            {!loading && items.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {displayItems.map((item) => {
              const tags = item.tags || []
              const version = item.latest_version || item.version
              return (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      {channelBatchMode && module === "channels" ? <Checkbox checked={selectedChannelIds.has(item.id)} onCheckedChange={() => toggleChannelSelection(item.id)} className="mt-1" /> : null}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{item.display_name || item.name}</span>
                          {item.category ? <Badge variant="outline" className="shrink-0 text-[10px]">{item.category}</Badge> : null}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {item.publisher || "-"}{version ? ` · v${version}` : ""}
                        </div>
                      </div>
                      <Badge variant={item.status === "published" ? "default" : "secondary"} className="shrink-0">{item.status || "published"}</Badge>
                    </div>
                    {item.summary ? <div className="text-sm text-muted-foreground truncate">{item.summary}</div> : null}
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                        ))}
                        {tags.length > 2 ? <Badge variant="outline" className="text-[10px]">+{tags.length - 2}</Badge> : null}
                      </div>
                    ) : null}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => void handleEdit(item)}>编辑</Button>
                      {item.status === "hidden" ? (
                        <Button size="sm" variant="outline" onClick={() => void handleUnhide(item)}>恢复</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void handleDelete(item, false)}>隐藏</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleDelete(item, true)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
          </>
        )}
      </div>

      {editOpen && (
        <MarketplaceEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode={editMode}
          item={editItem}
          onSave={handleSave}
        />
      )}

      {channelEditOpen && (
        <UnifiedProviderModal
          open={channelEditOpen}
          mode="create"
          templateMode
          templateManifest={channelEditItem as never}
          onClose={() => setChannelEditOpen(false)}
          onSaveTemplate={async (manifest) => { await handleChannelSave(manifest as MarketplaceManifest) }}
        />
      )}

      {nodeEditOpen && (
        <NodeVersionEditor
          open={nodeEditOpen}
          onOpenChange={setNodeEditOpen}
          item={nodeEditItem as never}
          onSave={handleNodeVersionSave as (manifest: Record<string, any>) => Promise<void>}
        />
      )}

      {mobileEditOpen && (
        <MobileVersionEditor
          open={mobileEditOpen}
          onOpenChange={setMobileEditOpen}
          item={mobileEditItem as never}
          onSave={handleMobileVersionSave as (manifest: Record<string, any>) => Promise<void>}
        />
      )}

      {deviceControlEditOpen && (
        <DeviceControlVersionEditor
          open={deviceControlEditOpen}
          onOpenChange={setDeviceControlEditOpen}
          item={deviceControlEditItem as never}
          onSave={handleDeviceControlVersionSave as (manifest: Record<string, any>) => Promise<void>}
        />
      )}

      {importOpen && (
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>导入市场资源</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Textarea placeholder="粘贴 JSON（单条 manifest / 数组 / 完整 export 包）" value={importText} onChange={(e) => setImportText(e.target.value)} rows={12} className="font-mono text-sm" />
              <input ref={importFileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void readImportFile(e.target.files?.[0]); e.currentTarget.value = "" }} />
              <button type="button" className={`flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed p-5 text-sm ${draggingImportFile ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} onClick={() => importFileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDraggingImportFile(true) }} onDragLeave={() => setDraggingImportFile(false)} onDrop={(e) => { e.preventDefault(); setDraggingImportFile(false); void readImportFile(e.dataTransfer.files?.[0]) }}>
                <FileJson className="h-5 w-5 text-muted-foreground" />
                <span>点击选择 JSON 文件，或拖拽文件到这里</span>
                <span className="text-xs text-muted-foreground">最大 10MB；读取后仍可编辑内容</span>
              </button>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => void handleImport("merge")}>Merge 导入</Button>
                <Button variant="destructive" onClick={() => void handleImport("replace")}>Replace 替换</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {batchDeleteOpen && (
        <Dialog open={batchDeleteOpen} onOpenChange={(next) => { if (!batchDeleting) setBatchDeleteOpen(next) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>永久删除渠道模板</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-destructive">将永久删除以下 {selectedChannelIds.size} 个模板及其 GitHub manifest，无法通过“恢复”找回：</p>
              <div className="max-h-64 overflow-y-auto rounded-md border p-2 text-sm">
                {items.filter((item) => selectedChannelIds.has(item.id)).map((item) => <div key={item.id} className="border-b px-2 py-2 last:border-b-0"><div className="font-medium">{item.display_name || item.name || item.id}</div><div className="text-xs text-muted-foreground">{item.id}</div></div>)}
              </div>
            </div>
            <DialogFooter><Button variant="outline" disabled={batchDeleting} onClick={() => setBatchDeleteOpen(false)}>取消</Button><Button variant="destructive" disabled={batchDeleting} onClick={() => void handleBatchDeleteChannels()}>{batchDeleting ? "删除中..." : `永久删除 ${selectedChannelIds.size} 项`}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {importChannelsOpen && (
        <ImportCurrentChannelsDialog
          open={importChannelsOpen}
          onOpenChange={setImportChannelsOpen}
          onDone={() => void load()}
        />
      )}

      <EmbeddedAgentChat open={assistantOpen} onOpenChange={setAssistantOpen} />
      <Button type="button" size="icon" className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg" onClick={() => setAssistantOpen((value) => !value)} aria-label="打开市场 Agent 助手"><MessageCircle className="h-5 w-5" /></Button>
    </AdminPage>
  )
}

/**
 * 「从当前平台导入」多选弹框：拉当前平台可导出渠道、勾选、只发布选中项到市场仓库。
 * 默认勾选「未在市场发布过」的渠道；已发布的默认不勾选，避免误覆盖。
 */
function ImportCurrentChannelsDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [channels, setChannels] = useState<ExportableChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [job, setJob] = useState<ChannelImportJob | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetchExportableChannels()
      const items = resp.items || []
      setChannels(items)
      // 保留用户明确选择，只剔除已不存在的项；首次进入保持空选择，默认不全选。
      setSelected((prev) => new Set(items.filter((item) => prev.has(item.provider)).map((item) => item.provider)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载渠道清单失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && channels.length === 0 && !job) void load()
  }, [open, channels.length, job, load])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    if (!job || job.status === "done" || job.status === "failed") return
    const poll = async () => {
      try {
        const next = await getChannelImportJob(job.job_id)
        setJob(next)
        if (next.status === "done" || next.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          if (next.status === "done") onDone()
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setJob((prev) => prev ? { ...prev, status: "failed", error: err instanceof Error ? err.message : "任务状态已过期" } : prev)
      }
    }
    pollRef.current = setInterval(() => void poll(), 2000)
    void poll()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [job?.job_id, job?.status, onDone])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter((item) => !q || JSON.stringify(item).toLowerCase().includes(q))
  }, [channels, query])
  const selectable = filtered
  const visibleSelected = selectable.filter((item) => selected.has(item.provider)).length
  const allVisibleSelected = selectable.length > 0 && visibleSelected === selectable.length
  const selectedChannels = channels.filter((item) => selected.has(item.provider))
  const overwriteCount = selectedChannels.filter((item) => item.published).length

  const toggle = (item: ExportableChannel) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(item.provider)) next.delete(item.provider)
      else next.add(item.provider)
      return next
    })
  }
  const toggleAllVisible = () => setSelected((prev) => {
    const next = new Set(prev)
    selectable.forEach((item) => allVisibleSelected ? next.delete(item.provider) : next.add(item.provider))
    return next
  })

  const start = async () => {
    if (!selectedChannels.length) return
    setStarting(true)
    try {
      const created = await startChannelImportJob(selectedChannels.map((item) => item.provider), true)
      setConfirming(false)
      setJob({
        job_id: created.job_id, status: "queued", phase: "queued", overwrite: true,
        total: created.total, completed: 0, current_provider: "", written: [], skipped: [], failed: [],
        items: selectedChannels.map((item) => ({ provider: item.provider, state: "pending", template_id: item.template_id, error: "" })),
        error: "", warning: "",
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "启动导入任务失败")
    } finally {
      setStarting(false)
    }
  }

  const running = !!job && job.status !== "done" && job.status !== "failed"
  const progress = job?.total ? Math.round((job.completed / job.total) * 100) : 0
  const phaseLabels: Record<string, string> = {
    queued: "等待执行", importing: "正在导入", finalizing_index: "正在更新目录索引",
    finalizing_marker: "正在更新市场标记", refreshing_catalog: "正在刷新渠道模板缓存",
    done: "已完成", failed: "失败",
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next) }}>
      <DialogContent className="flex h-[92vh] w-[98vw] sm:max-w-6xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>从当前平台导入渠道模板</DialogTitle>
          <p className="text-xs text-muted-foreground">只导出渠道基础配置，不含账号、密钥、Token、Cookie。所有导入项必须由你明确勾选。</p>
        </DialogHeader>

        {job ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{phaseLabels[job.status] || job.status}</span>
                <span>{job.completed}/{job.total}（{progress}%）</span>
              </div>
              <Progress value={progress} />
              {job.current_provider ? <div className="mt-2 text-xs text-muted-foreground">当前：{job.current_provider}</div> : null}
              {job.error ? <div className="mt-3 text-sm text-destructive">{job.error}</div> : null}
              {job.warning ? <div className="mt-3 text-sm text-amber-600">{job.warning}</div> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              {job.items.map((item) => (
                <div key={item.provider} className="flex items-start justify-between gap-3 border-b px-4 py-3 last:border-b-0">
                  <div className="min-w-0"><div className="font-medium">{channels.find((row) => row.provider === item.provider)?.display_name || item.provider}</div><div className="text-xs text-muted-foreground">{item.provider}</div>{item.error ? <div className="mt-1 text-xs text-destructive">{item.error}</div> : null}</div>
                  <Badge variant={item.state === "failed" ? "destructive" : item.state === "written" ? "default" : "outline"}>{({ pending: "等待", importing: "处理中", written: "已导入", skipped: "已跳过", failed: "失败" } as Record<string, string>)[item.state]}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : confirming ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">请确认本次共导入 {selectedChannels.length} 个渠道模板{overwriteCount ? `，其中覆盖 ${overwriteCount} 个已发布模板` : ""}。</div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              {selectedChannels.map((item) => <div key={item.provider} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.provider}</div></div>{item.published ? <Badge variant="destructive">覆盖</Badge> : <Badge variant="outline">新增</Badge>}</div>)}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Input placeholder="搜索渠道名称/类型/地址" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
              <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>重新加载</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>清空选择</Button>
              <span className="ml-auto text-xs text-muted-foreground">当前视图 {filtered.length} 项 · 已选 {selected.size} 项</span>
            </div>
            <div className="flex items-center gap-2 px-1 text-sm"><Checkbox checked={visibleSelected > 0 && !allVisibleSelected ? "indeterminate" : allVisibleSelected} onCheckedChange={toggleAllVisible} /><span>全选当前可选项（{visibleSelected}/{selectable.length}）</span></div>
            {loading ? <div className="flex justify-center py-10"><Spinner /></div> : filtered.length === 0 ? <Empty><div className="text-sm">没有匹配的渠道</div></Empty> : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                {filtered.map((item) => {
                  const checked = selected.has(item.provider)
                  return (
                    <label key={item.provider} className={`flex cursor-pointer items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0 ${checked ? "bg-primary/5" : "hover:bg-muted/50"}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggle(item)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{item.display_name || item.provider}</span>
                          {item.builtin_type ? <Badge variant="outline" className="shrink-0 text-[10px]">{item.builtin_type}</Badge> : null}
                          {!item.enabled ? <Badge variant="outline" className="shrink-0 text-[10px]">停用</Badge> : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{item.provider}{item.base_url ? ` · ${item.base_url}` : ""}</div>
                      </div>
                      {item.published ? <Badge variant={checked ? "destructive" : "secondary"} className="shrink-0">{checked ? "将覆盖" : "已发布"}</Badge> : <Badge variant="outline" className="shrink-0">未发布</Badge>}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {job ? <Button onClick={() => onOpenChange(false)} disabled={running}>{running ? "任务执行中" : "关闭"}</Button> : confirming ? <><Button variant="outline" onClick={() => setConfirming(false)} disabled={starting}>返回选择</Button><Button onClick={() => void start()} disabled={starting}>{starting ? "启动中..." : overwriteCount ? `确认导入并覆盖 ${overwriteCount} 项` : `确认导入 ${selectedChannels.length} 项`}</Button></> : <><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => setConfirming(true)} disabled={!selected.size}>确认所选 {selected.size} 项</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

