/**
 * 批量识别仓库信息弹框：agent 逐条读仓库 README，产出中文介绍/适用场景/关键词，
 * 分类含 MCP 的条目顺带识别启动方式。产出全部是草稿，需人工核对再发布。
 *
 * 顶部提供分类/榜单/状态/搜索过滤，勾选后一次提交给专用 agent 逐条串行识别，
 * 单条失败不影响其余。
 */
import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import {
  batchRecognizeLeaderboardRepoInfo,
  fetchLeaderboardItems,
  type LeaderboardItem,
  type LeaderboardModule,
} from "@/api/marketplaceAdmin"
import { listAgents, listLlmModels, type AgentInstance, type LlmModelOption } from "@/api/agentClient"
import { ALL_BOARDS, ALL_MODULES, BOARD_LABELS, MODULE_LABELS, normalizeModules } from "./leaderboard-labels"
import { toast } from "sonner"

type ModuleFilter = "all" | LeaderboardModule
type LaunchFilter = "unfilled" | "all"

export function LeaderboardLaunchSpecDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 批量跑完后通知列表刷新（结果还是草稿，主列表要显示新描述与徽标）。 */
  onDone: () => void
}) {
  const [items, setItems] = useState<LeaderboardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState("")
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all")
  const [boardFilter, setBoardFilter] = useState<string>("all")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [launchFilter, setLaunchFilter] = useState<LaunchFilter>("unfilled")
  // agent 与模型：本次批量识别用哪个 agent 跑、用哪个模型。默认「未指定」（用市场
  // 配置的专用 agent 及其绑定模型）；选了 agent 后可再挑该 key 下的任意模型。
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [models, setModels] = useState<LlmModelOption[]>([])
  const [agentId, setAgentId] = useState("0")
  const [model, setModel] = useState("")
  // 批量识别进度：逐条串行时实时显示「第 N/总数」+ 当前仓库名。
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      // 待识别清单：默认「分类含 MCP 且启动方式未补」；可切到全部条目（非 MCP 只
      // 补描述/场景/关键词），也可按分类/榜单/来源过滤。
      const list = await fetchLeaderboardItems({
        target_module: moduleFilter === "all" ? undefined : moduleFilter,
        board: boardFilter === "all" ? undefined : boardFilter,
        source: sourceFilter === "all" ? undefined : sourceFilter,
        launch_status: launchFilter === "unfilled" ? "unfilled" : undefined,
        limit: 500,
      })
      setItems(list.items || [])
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清单加载失败")
    } finally {
      setLoading(false)
    }
  }, [open, moduleFilter, boardFilter, sourceFilter, launchFilter])

  useEffect(() => { void load() }, [load])

  // agent/模型下拉数据：打开时拉一次（agent 列表 + 模型列表）。
  useEffect(() => {
    if (!open) return
    listAgents().then((rows) => setAgents(rows.filter((a) => a.enabled))).catch(() => setAgents([]))
    listLlmModels(true).then((rows) => setModels(rows)).catch(() => setModels([]))
  }, [open])

  // 选中 agent 时，默认模型切到该 agent 当前绑定的模型。
  const selectedAgent = agents.find((a) => String(a.id) === agentId)
  const handleAgentChange = (value: string) => {
    setAgentId(value)
    const agent = agents.find((a) => String(a.id) === value)
    setModel(agent?.model || "")
  }

  const filtered = items.filter((it) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${it.repo_full_name} ${it.description}`.toLowerCase().includes(q)
  })
  const allSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.id))

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = filtered.every((it) => next.has(it.id))
      for (const it of filtered) allIn ? next.delete(it.id) : next.add(it.id)
      return next
    })
  }

  const run = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setRunning(true)
    // 逐条串行调后端：一条一个请求，进度实时可见（后端 batch 接口是一次性返回，
    // 拿不到中间进度；这里改成前端串行驱动，每条完成即更新进度条）。
    setProgress({ done: 0, total: ids.length, current: "" })
    const results: Array<{ id: number; repo_full_name?: string; ok: boolean; error?: string }> = []
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]
        const row = items.find((it) => it.id === id)
        setProgress({ done: i, total: ids.length, current: row?.repo_full_name || `#${id}` })
        try {
          const result = await batchRecognizeLeaderboardRepoInfo([id], {
            agentId: agentId !== "0" ? Number(agentId) : undefined,
            model: model || undefined,
          })
          results.push(...(result.results || []))
        } catch (err) {
          results.push({ id, repo_full_name: row?.repo_full_name, ok: false, error: err instanceof Error ? err.message : "识别失败" })
        }
      }
      setProgress({ done: ids.length, total: ids.length, current: "" })
      const okCount = results.filter((r) => r.ok).length
      const failedRows = results.filter((r) => !r.ok)
      if (failedRows.length > 0) {
        toast.warning(`识别完成：${okCount} 条成功，${failedRows.length} 条失败`, {
          description: failedRows.map((r) => `${r.repo_full_name || `#${r.id}`}：${r.error || "未识别出可用信息"}`).join("\n"),
        })
      } else {
        toast.success(`识别完成：${okCount} 条成功。结果仍是草稿，核对后再发布`)
      }
      setSelected(new Set())
      onDone()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量识别失败")
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) onOpenChange(v) }}>
      <DialogContent className="flex h-[86vh] w-[95vw] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            批量识别仓库信息
            <Badge variant="outline" className="text-[10px]">产出为草稿</Badge>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            agent 读仓库 README，改写中文介绍、补适用场景与关键词；分类含 MCP 的条目顺带识别启动方式。
            结果仍是草稿，需要人工核对后再发布。
          </p>
        </DialogHeader>

        <div className="space-y-2 rounded-md border bg-muted/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">识别 agent</span>
              <NativeSelect value={agentId} onChange={(e) => handleAgentChange(e.target.value)} disabled={running}>
                <NativeSelectOption value="0">默认（市场配置的专用 agent）</NativeSelectOption>
                {agents.map((a) => (
                  <NativeSelectOption key={a.id} value={String(a.id)}>
                    {a.display_name || a.name}（#{a.id}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">模型</span>
              <NativeSelect value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
                <NativeSelectOption value="">默认（agent 绑定的模型）</NativeSelectOption>
                {models.map((m) => (
                  <NativeSelectOption key={m.id} value={m.model_name}>
                    {m.display_name || m.model_name}
                    {m.config_name ? `（${m.config_name}）` : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {selectedAgent ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  默认模型：{selectedAgent.model || "未绑定"}（网关 key 沿用 agent 绑定，只换模型）
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value as ModuleFilter)}
            className="h-9 w-28 text-sm"
          >
            <NativeSelectOption value="all">全部分类</NativeSelectOption>
            {ALL_MODULES.map((m) => (
              <NativeSelectOption key={m} value={m}>{MODULE_LABELS[m]}</NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            className="h-9 w-32 text-sm"
          >
            <NativeSelectOption value="all">全部榜单</NativeSelectOption>
            {ALL_BOARDS.map((b) => (
              <NativeSelectOption key={b} value={b}>{BOARD_LABELS[b] || b}</NativeSelectOption>
            ))}
            <NativeSelectOption value="manual">手动添加</NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 w-36 text-sm"
          >
            <NativeSelectOption value="all">全部来源</NativeSelectOption>
            <NativeSelectOption value="agent-leaderboard">Agent-Leaderboard</NativeSelectOption>
            <NativeSelectOption value="agency-agents">agency-agents</NativeSelectOption>
            <NativeSelectOption value="agency-agents-zh">agency-agents-zh</NativeSelectOption>
            <NativeSelectOption value="agentscope">agentscope</NativeSelectOption>
            <NativeSelectOption value="manual">手动添加</NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            value={launchFilter}
            onChange={(e) => setLaunchFilter(e.target.value as LaunchFilter)}
            className="h-9 w-36 text-sm"
          >
            <NativeSelectOption value="unfilled">待补启动方式</NativeSelectOption>
            <NativeSelectOption value="all">全部条目</NativeSelectOption>
          </NativeSelect>
          <Input placeholder="搜索仓库/描述..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-44" />
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || running}>刷新</Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length} 条 · 已选 {selected.size} 条
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              没有符合条件的条目——调整上方过滤（默认只列「分类含 MCP 且启动方式未补」）
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 border-b px-4 py-2.5 text-sm">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span className="text-muted-foreground">全选当前视图（{filtered.length}）</span>
              </label>
              {filtered.map((it) => {
                const checked = selected.has(it.id)
                const modules = normalizeModules(it.target_modules, it.target_module)
                const isMcp = modules.includes("mcp")
                return (
                  <label key={it.id} className={`flex cursor-pointer items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0 ${checked ? "bg-primary/5" : "hover:bg-muted/50"}`}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(it.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{it.repo_full_name}</span>
                        {modules.length > 0 ? (
                          modules.map((m) => (
                            <Badge key={m} variant="outline" className="shrink-0 text-[10px]">{MODULE_LABELS[m]}</Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">未分类</Badge>
                        )}
                        {isMcp && it.launch_spec_status === "failed" ? (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-destructive">启动识别失败</Badge>
                        ) : null}
                        <a href={it.repo_url} target="_blank" rel="noreferrer noopener" aria-label={`在 GitHub 打开 ${it.repo_full_name}`}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{it.description || "（无描述）"}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                      <Star className="h-3 w-3" />{it.stars.toLocaleString()}
                    </span>
                  </label>
                )
              })}
            </>
          )}
        </div>

        {/* 进度条：逐条串行时实时显示第 N/总数 + 当前仓库 */}
        {progress ? (
          <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                识别进度 {progress.done}/{progress.total}
                {progress.current ? <span className="ml-2 font-mono text-foreground">{progress.current}</span> : null}
              </span>
              <span className="font-medium">{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex-row justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {running ? "agent 正在逐条识别，请勿关闭弹框……" : "逐条串行识别，单条失败不影响其余"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>关闭</Button>
            <Button onClick={() => void run()} disabled={running || selected.size === 0}>
              {running && progress ? `识别中（${progress.done}/${progress.total}）...` : `批量识别（${selected.size}）`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
