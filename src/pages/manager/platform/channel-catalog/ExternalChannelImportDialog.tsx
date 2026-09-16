// 「导入外部渠道」弹框：把其它 LLM 网关/中转框架（New API 等）的渠道整体导进来。
//
// 三步流程（与 ChannelCreateWizard 同形）：
//   0 来源（框架 + API 拉取 / 粘贴文本）→ 1 预览勾选（可改展示名/地址、标出冲突）
//   → 2 导入（按冲突模式建/并渠道）→ 结果汇总。
//
// 两个关键事实体现在 UI 上：
// 1. New API 的列表接口不回传渠道密钥，所以 API 拉取路径导入的渠道账号必然为空——
//    弹框里明确提示，避免用户以为导入失败。
// 2. 地址已存在的候选会标出冲突，用户按需选「跳过 / 覆盖 / 合并账号」。覆盖是本弹框
//    对「这个渠道已存在怎么办」的正面回答。
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

import {
  commitChannelImport,
  getChannelImporters,
  previewChannelImport,
} from "@/@admin-port/api/providers"
import { getProxies } from "@/@admin-port/api/proxyPool"
import type { ProxyEntry } from "@/@admin-port/api/proxyPool"
import type {
  ChannelImportCommitResponse,
  ChannelImporterInfo,
  ExternalChannelCandidate,
} from "@/@admin-port/types/admin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

type Mode = "fetch" | "paste"
type ConflictMode = "skip" | "overwrite" | "merge_accounts"

const CONFLICT_LABEL: Record<ConflictMode, string> = {
  skip: "跳过（保留本地已有渠道）",
  overwrite: "覆盖（用导入数据更新本地渠道配置）",
  merge_accounts: "合并账号（只把导入的账号追加到本地渠道）",
}

export function ExternalChannelImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 导入完成：父层刷新渠道列表。 */
  onImported: () => void
}) {
  const [step, setStep] = useState(0)
  const [importers, setImporters] = useState<ChannelImporterInfo[]>([])
  const [source, setSource] = useState("new-api")
  const [mode, setMode] = useState<Mode>("paste")
  const [proxies, setProxies] = useState<ProxyEntry[]>([])

  // 来源参数
  const [baseUrl, setBaseUrl] = useState("")
  const [token, setToken] = useState("")
  const [userId, setUserId] = useState("")
  const [proxyId, setProxyId] = useState("")
  const [includeDisabled, setIncludeDisabled] = useState(true)
  const [text, setText] = useState("")
  const [addSourceTag, setAddSourceTag] = useState(false)

  // 预览结果
  const [candidates, setCandidates] = useState<ExternalChannelCandidate[]>([])
  const [dropped, setDropped] = useState<Array<{ source_id: string; remark: string; reason: string }>>([])
  const [batchWarnings, setBatchWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, Partial<ExternalChannelCandidate>>>({})
  const [conflictMode, setConflictMode] = useState<ConflictMode>("merge_accounts")
  const [query, setQuery] = useState("")

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ChannelImportCommitResponse | null>(null)

  const importer = importers.find((item) => item.id === source)

  const reset = useCallback(() => {
    setStep(0)
    setBaseUrl("")
    setToken("")
    setUserId("")
    setProxyId("")
    setIncludeDisabled(true)
    setText("")
    setAddSourceTag(false)
    setCandidates([])
    setDropped([])
    setBatchWarnings([])
    setSelected(new Set())
    setOverrides({})
    setConflictMode("merge_accounts")
    setQuery("")
    setError("")
    setResult(null)
    setBusy(false)
  }, [])

  // 关闭即重置：一次用完就丢的流程，不留上一轮残留（对齐 ChannelCreateWizard）。
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    getChannelImporters()
      .then((data) => {
        setImporters(data.items || [])
        if (data.items?.length) setSource((current) => current || data.items[0].id)
      })
      .catch(() => setImporters([]))
    getProxies().then(setProxies).catch(() => setProxies([]))
  }, [open])

  const requestBase = useCallback(
    () => ({
      source,
      mode,
      base_url: baseUrl.trim(),
      token: token.trim(),
      user_id: userId.trim(),
      proxy_config_id: proxyId,
      include_disabled: includeDisabled,
      text,
      format: "auto",
      add_source_tag: addSourceTag,
    }),
    [source, mode, baseUrl, token, userId, proxyId, includeDisabled, text, addSourceTag],
  )

  const runPreview = async () => {
    setBusy(true)
    setError("")
    try {
      const data = await previewChannelImport(requestBase())
      setCandidates(data.candidates || [])
      setDropped(data.dropped || [])
      setBatchWarnings(data.warnings || [])
      setSelected(new Set(
        (data.candidates || [])
          // 不可导入的、已停用的、媒体生成类默认不勾选，避免用户一路回车导进一堆垃圾。
          .filter((item) => item.importable && item.enabled && !isMediaCandidate(item))
          .map((item) => item.candidate_id),
      ))
      setOverrides({})
      setStep(1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉取失败")
    } finally {
      setBusy(false)
    }
  }

  const runCommit = async () => {
    const selection = candidates
      .filter((item) => selected.has(item.candidate_id))
      .map((item) => ({
        candidate_id: item.candidate_id,
        // 只回传白名单字段；服务端也只认这些。
        remark: overrides[item.candidate_id]?.remark ?? item.remark,
        base_url: overrides[item.candidate_id]?.base_url ?? item.base_url,
        enabled: item.enabled,
        tags: item.tags,
        models: item.models,
        account_weight: item.account_weight,
        chat_protocols: item.chat_protocols,
      }))
    if (!selection.length) {
      setError("请至少勾选一个渠道")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await commitChannelImport({
        ...requestBase(),
        selection,
        on_conflict: conflictMode,
      })
      setResult(data)
      setStep(2)
      onImported()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败")
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return candidates
    return candidates.filter((item) =>
      [item.remark, item.base_url, item.source_id, item.protocol]
        .some((value) => String(value || "").toLowerCase().includes(needle)),
    )
  }, [candidates, query])

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const conflictCount = candidates.filter((item) => item.conflict).length
  const selectableCount = candidates.filter((item) => item.importable).length
  const missingKeys = candidates.length > 0 && candidates.every((item) => !item.has_keys)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-none flex-col gap-4 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="text-lg">导入外部渠道</DialogTitle>
          <DialogDescription>
            从其它 LLM 网关（New API / One API 等）把渠道列表和渠道信息整体导进来，直接创建为本地渠道。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {error && (
            <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* ── 第 1 步：来源 ─────────────────────────────────────────── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>外部框架</Label>
                <div className="flex flex-wrap gap-2">
                  {importers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSource(item.id)}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        source === item.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent/40"
                      }`}
                    >
                      {item.display_name}
                    </button>
                  ))}
                  {importers.length === 0 && (
                    <span className="text-sm text-muted-foreground">未找到可用的外部框架适配器</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={mode === "paste" ? "default" : "outline"}
                  onClick={() => setMode("paste")}
                  disabled={importer ? !importer.supports_paste : false}
                >
                  粘贴文本
                </Button>
                <Button
                  variant={mode === "fetch" ? "default" : "outline"}
                  onClick={() => setMode("fetch")}
                  disabled={importer ? !importer.supports_api_fetch : false}
                >
                  从对方 API 拉取
                </Button>
              </div>

              {mode === "fetch" ? (
                <div className="flex flex-col gap-3 rounded-xl border p-4">
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    New API 的渠道列表接口不回传密钥，所以这条路径导入的渠道账号为空，
                    导入后需要在渠道详情的「账号管理」里补填密钥。要连密钥一起导入，请改用「粘贴文本」。
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>New API 地址</Label>
                    <Input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://newapi.example.com"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>管理员令牌</Label>
                    <Input
                      type="password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="需要管理员角色的令牌"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>用户 ID（可选）</Label>
                      <Input
                        value={userId}
                        onChange={(event) => setUserId(event.target.value)}
                        placeholder="部分部署需要 New-Api-User 头"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>出网代理（可选）</Label>
                      <select
                        value={proxyId}
                        onChange={(event) => setProxyId(event.target.value)}
                        className="h-9 rounded-md border bg-transparent px-2 text-sm"
                      >
                        <option value="">直连</option>
                        {proxies.map((proxy) => (
                          <option key={proxy.id} value={proxy.id}>
                            {proxy.name || proxy.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={includeDisabled} onCheckedChange={setIncludeDisabled} />
                    <Label>包含已停用的渠道</Label>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border p-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>粘贴渠道数据</Label>
                    <Textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      rows={12}
                      placeholder='粘贴 New API 渠道接口的 JSON 响应（{"success":true,"data":{"items":[...]}}），或每行一个渠道对象。带 key 字段即可连同密钥一起导入。'
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Switch checked={addSourceTag} onCheckedChange={setAddSourceTag} />
                <Label>给导入的渠道打上来源标签（{source}）</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button onClick={() => void runPreview()} disabled={busy || !source}>
                  {busy && <Loader2 className="animate-spin" />}
                  {mode === "fetch" ? "拉取并预览" : "解析并预览"}
                </Button>
              </div>
            </div>
          )}

          {/* ── 第 2 步：预览勾选 ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              {missingKeys && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  本次数据里没有渠道密钥，导入后账号为空，需要在渠道详情里补填。
                </div>
              )}
              {batchWarnings.map((warning) => (
                <div key={warning} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  {warning}
                </div>
              ))}
              {dropped.length > 0 && (
                <details className="rounded-lg border px-3 py-2 text-sm">
                  <summary className="cursor-pointer">
                    已过滤 {dropped.length} 个渠道（无渠道地址）
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {dropped.slice(0, 20).map((item) => (
                      <li key={item.source_id}>#{item.source_id} {item.remark} — {item.reason}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="筛选名称 / 地址 / 协议"
                  className="w-60"
                />
                <Button
                  variant="outline"
                  onClick={() => setSelected(new Set(filtered.filter((i) => i.importable).map((i) => i.candidate_id)))}
                >
                  全选
                </Button>
                <Button variant="outline" onClick={() => setSelected(new Set())}>全不选</Button>
                <span className="text-sm text-muted-foreground">
                  已选 {selected.size} / 可导入 {selectableCount}
                  {conflictCount > 0 ? ` · ${conflictCount} 个地址已存在` : ""}
                </span>
              </div>

              {conflictCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <AlertTriangle className="size-4 text-amber-500" />
                  <span>本地已有同地址渠道，遇到冲突时：</span>
                  <select
                    value={conflictMode}
                    onChange={(event) => setConflictMode(event.target.value as ConflictMode)}
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  >
                    {(Object.keys(CONFLICT_LABEL) as ConflictMode[]).map((key) => (
                      <option key={key} value={key}>{CONFLICT_LABEL[key]}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2">上游 ID</th>
                      <th className="px-3 py-2">展示名</th>
                      <th className="px-3 py-2">渠道地址</th>
                      <th className="px-3 py-2">协议</th>
                      <th className="px-3 py-2">模型</th>
                      <th className="px-3 py-2">账号</th>
                      <th className="px-3 py-2">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const override = overrides[item.candidate_id] || {}
                      const blocked = !item.importable
                      return (
                        <tr key={item.candidate_id} className="border-t align-top">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(item.candidate_id)}
                              disabled={blocked}
                              onChange={() => toggle(item.candidate_id)}
                              title={blocked ? item.errors.join("；") : ""}
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">#{item.source_id}</td>
                          <td className="px-3 py-2">
                            <Input
                              value={override.remark ?? item.remark}
                              onChange={(event) => setOverrides((current) => ({
                                ...current,
                                [item.candidate_id]: { ...current[item.candidate_id], remark: event.target.value },
                              }))}
                              className="h-8"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={override.base_url ?? item.base_url}
                              onChange={(event) => setOverrides((current) => ({
                                ...current,
                                [item.candidate_id]: { ...current[item.candidate_id], base_url: event.target.value },
                              }))}
                              className="h-8"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline">{item.protocol || "—"}</Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{item.models.length}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {item.account_count > 0 ? item.account_count : "无（待补填）"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {item.conflict && (
                                <Badge variant="outline" className="border-amber-500/60 text-amber-600">
                                  已存在：{item.conflict.remark || item.conflict.provider_name}
                                </Badge>
                              )}
                              {!item.enabled && <Badge variant="outline">上游已停用</Badge>}
                              {blocked && (
                                <Badge variant="outline" className="border-destructive/60 text-destructive">
                                  {item.errors[0] || "不可导入"}
                                </Badge>
                              )}
                              {item.warnings.map((warning) => (
                                <Badge key={warning} variant="outline" title={warning} className="max-w-[14rem] truncate">
                                  {warning}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>上一步</Button>
                <Button onClick={() => void runCommit()} disabled={busy || selected.size === 0}>
                  {busy && <Loader2 className="animate-spin" />}
                  导入 {selected.size} 个渠道
                </Button>
              </div>
            </div>
          )}

          {/* ── 第 3 步：结果 ─────────────────────────────────────────── */}
          {step === 2 && result && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border px-4 py-3">
                新建 {result.summary.created} · 覆盖 {result.summary.overwritten} ·
                合并 {result.summary.merged} · 跳过 {result.summary.skipped} ·
                失败 {result.summary.failed}
              </div>
              {result.warnings.map((warning) => (
                <div key={warning} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  {warning}
                </div>
              ))}
              {([
                ["新建", result.created],
                ["覆盖", result.overwritten],
                ["合并账号", result.merged],
                ["跳过", result.skipped],
                ["失败", result.failed],
              ] as const).map(([label, rows]) => rows.length > 0 && (
                <div key={label} className="rounded-lg border px-3 py-2 text-sm">
                  <div className="font-medium">{label}（{rows.length}）</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {rows.map((row) => (
                      <li key={row.candidate_id}>
                        {row.provider_name || row.candidate_id}
                        {row.reason ? ` — ${row.reason}` : ""}
                        {row.error ? ` — ${row.error}` : ""}
                        {row.existing ? `（既有：${row.existing}）` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset}>再导一批</Button>
                <Button onClick={() => onOpenChange(false)}>完成</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 媒体生成类（图像/视频/音乐）渠道不是对话渠道，默认不勾选。 */
function isMediaCandidate(item: ExternalChannelCandidate): boolean {
  return item.source_meta?.media === true
    || item.warnings.some((warning) => warning.includes("媒体生成"))
}
