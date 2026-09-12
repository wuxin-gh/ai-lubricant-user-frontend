// 「从 GitHub 识别」导入器：skill / 插件 共用。
//
// 类型**单选**（识别端点按优先级 plugin>skill>mcp>prompt 自动判定，返回
// result.type——plugin 是容器：marketplace.json 在场或 ≥2 个技能条目都算 plugin）。
// 弹框里类型可改，改完点「重新识别」按所选类型重派生（端点带 type 参数；证据
// 不足会明确报错）。
//
// - type=plugin：插件容器。带 entries（多技能仓库）时展示 skill 列表、按子技能
//   展开装；无 entries（单 zip 包）按 download_url 整包装。两种安装坐标都带。
// - type=skill：单条目，按 entryIndex 选。
// - type=mcp/prompt：本导入器不处理（MCP/提示词有各自入口），提示去对应页面。
//
// 引用：createReferenceFromGithub（kind=plugin 走容器 manifest，kind=skill 单条目）。
// 安装：父组件按 install_spec 拼 zip URL + importUrl。两条路都现成，本组件只做编排。

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useGithubRecognize } from "@/hooks/useGithubRecognize"
import type { GithubRecognizeResult, GithubRecognizeType } from "@/api/githubRecognition"

type Mode = "reference" | "install"

export interface GithubConfirmPayload {
  type: "skills" | "skill" | "plugin"
  mode: Mode
  name: string
  description: string
  /** type=skill 时选中的条目下标。 */
  entryIndex?: number
  /** 引用时是否钉到当前 commit（用 head_sha）。安装隐含钉 commit。 */
  pinCommit?: boolean
}

export interface GithubRecognizeImporterProps {
  /** 入口域：决定哪些 type 可在本入口落地。skill 入口=skills/skill；plugin 入口=plugin。 */
  domain: "skill" | "plugin"
  onConfirm: (result: GithubRecognizeResult, payload: GithubConfirmPayload) => Promise<void>
  onCancel: () => void
}

const TYPE_LABEL: Record<string, string> = {
  plugin: "插件（含技能集）",
  skill: "单个 skill",
  mcp: "MCP",
  prompt: "提示词",
}

export function GithubRecognizeImporter({ domain, onConfirm, onCancel }: GithubRecognizeImporterProps) {
  const { input, setInput, loading, result, error, recognize } = useGithubRecognize()
  const [mode, setMode] = useState<Mode>("reference")
  const [entryIndex, setEntryIndex] = useState(0)
  const [pinCommit, setPinCommit] = useState(false)
  const [busy, setBusy] = useState(false)
  // 识别结果进入可编辑表单：名称/描述预填（条目名 + 仓库描述），用户可改。
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  // 用户手动改选的类型（覆盖 auto_type）；空 = 用 result.type。
  const [forcedType, setForcedType] = useState<GithubRecognizeType | "">("")

  const resultType: GithubRecognizeType | "" = forcedType || result?.type || ""
  const entries = result?.skill_entries ?? []
  // 当前入口能否落地该类型；不能则提示去对应页面。plugin 容器（含原技能集）
  // 在两个入口都可落地：技能入口按 entries 展开装，插件入口整包 zip。
  const actionable =
    (domain === "skill" && (resultType === "skills" || resultType === "skill" || resultType === "plugin")) ||
    (domain === "plugin" && (resultType === "plugin" || resultType === "skills"))

  // 识别成功 → 预填编辑表单。
  useEffect(() => {
    if (!result) return
    setForcedType("") // 重新识别后以服务端返回 type 为准
    if (result.type === "skill") {
      const entry = entries[0]
      setName(entry?.name || result.repo_full_name.split("/").pop() || "")
    } else {
      setName(result.repo_full_name || "")
    }
    setDescription(result.repo_meta?.description || "")
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换 skill 条目时联动名称（用户手动改过则不动）。
  const onEntryChange = (index: number) => {
    const prev = entries[entryIndex]
    const next = entries[index]
    if (name === (prev?.name || "") && next?.name) setName(next.name)
    setEntryIndex(index)
  }

  const reRecognize = async () => {
    if (!input.trim()) {
      toast.error("请先输入仓库地址")
      return
    }
    await recognize(undefined, forcedType || undefined)
  }

  const confirm = async () => {
    if (!result || !actionable) return
    if (!name.trim()) {
      toast.error("请填写名称")
      return
    }
    if (resultType !== "skills" && resultType !== "skill" && resultType !== "plugin") return
    setBusy(true)
    try {
      await onConfirm(result, {
        type: resultType as "skills" | "skill" | "plugin",
        mode,
        name: name.trim(),
        description,
        entryIndex: resultType === "skill" ? entryIndex : undefined,
        pinCommit: mode === "reference" ? pinCommit : true,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${mode === "reference" ? "引用" : "安装"}失败`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>GitHub 仓库地址</Label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="owner/repo 或 https://github.com/owner/repo"
            onKeyDown={(e) => { if (e.key === "Enter") void recognize() }}
          />
          <Button disabled={loading} onClick={() => void recognize()}>
            {loading ? "识别中..." : "识别"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          支持仓库地址、<code>tree/&lt;分支&gt;</code>、<code>blob/&lt;tag&gt;</code>。公开仓库即可识别。
        </p>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      {result ? (
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">{result.repo_full_name}</span>
              <Badge variant="secondary">{TYPE_LABEL[result.type] || result.type || "未识别"}</Badge>
              {result.auto_type && result.auto_type !== result.type ? (
                <span className="text-muted-foreground">（自动判定：{TYPE_LABEL[result.auto_type] || result.auto_type}）</span>
              ) : null}
            </div>
            <div className="text-muted-foreground">
              分支/引用：<span className="text-foreground">{result.ref}</span>
              {result.head_sha ? <span className="ml-2">HEAD：<span className="font-mono text-foreground">{result.head_sha.slice(0, 7)}</span></span> : null}
              {result.repo_meta?.stars ? <span className="ml-2">★ {result.repo_meta.stars}</span> : null}
            </div>
            {result.repo_meta?.description ? (
              <div className="mt-1 line-clamp-2 text-muted-foreground">{result.repo_meta.description}</div>
            ) : null}
          </div>

          {/* 类型可改 + 重新识别 */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">按类型重新识别（可选）</Label>
              <select
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                value={forcedType}
                onChange={(e) => setForcedType(e.target.value as GithubRecognizeType | "")}
              >
                <option value="">自动（{TYPE_LABEL[result.type] || result.type || "—"}）</option>
                <option value="plugin">插件 plugin（含技能集）</option>
                <option value="skill">单个 skill</option>
                <option value="mcp">MCP</option>
                <option value="prompt">提示词</option>
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void reRecognize()}>
              {loading ? "识别中..." : "重新识别"}
            </Button>
          </div>

          {/* 插件容器（多技能）预览：skill 列表（只读，整包引用/安装，任务期再勾子技能） */}
          {(resultType === "plugin" || resultType === "skills") && entries.length > 0 ? (
            <div className="rounded-md border p-3 text-xs">
              <div className="mb-1 font-medium">包含 {entries.length} 个 skill（整包引用/安装，任务期再勾子技能）</div>
              <div className="max-h-40 overflow-y-auto space-y-0.5 text-muted-foreground">
                {entries.map((entry, i) => (
                  <div key={i} className="truncate">
                    <span className="text-foreground">{entry.name}</span>
                    <span className="ml-2 font-mono">{entry.path}/{entry.entry}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* skill 单条目选择 */}
          {resultType === "skill" && entries.length > 0 ? (
            <div className="space-y-1.5">
              <Label>选择 skill 条目</Label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={entryIndex}
                onChange={(e) => onEntryChange(Number(e.target.value))}
              >
                {entries.map((entry, i) => (
                  <option key={i} value={i}>
                    {entry.name}{entry.path ? `（${entry.path}/${entry.entry}）` : `（${entry.entry}）`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* 插件预览 */}
          {resultType === "plugin" && result.install_spec?.plugin ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-medium text-foreground">插件</div>
              <div className="break-all text-muted-foreground">下载地址：<span className="font-mono text-foreground">{String(result.install_spec.plugin.download_url || "—")}</span></div>
            </div>
          ) : null}

          {/* 非本入口可落地的类型 */}
          {!actionable ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              识别为「{TYPE_LABEL[resultType] || resultType}」，本入口（{domain === "skill" ? "技能" : "插件"}页）不处理该类型——
              {resultType === "mcp" ? "请到 MCP 页用「GitHub 识别」添加" : resultType === "prompt" ? "请到项目提示词页用「从 GitHub 识别」抓取" : resultType === "skills" || resultType === "skill" ? "请到技能页添加" : "请到对应页面添加"}。
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>名称（识别结果，可修改）</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={result.repo_full_name.split("/").pop() || ""} />
              </div>
              <div className="space-y-1.5">
                <Label>描述（可修改，默认取仓库描述）</Label>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={result.repo_meta?.description || ""} />
              </div>

              <div className="space-y-2">
                <Label>落地方式</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant={mode === "reference" ? "default" : "outline"} onClick={() => setMode("reference")}>
                    引用（GitHub 直连，不拷贝）
                  </Button>
                  <Button size="sm" variant={mode === "install" ? "default" : "outline"} onClick={() => setMode("install")}>
                    安装（下载 zip 入库，钉死版本）
                  </Button>
                </div>
                {mode === "reference" ? (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Switch checked={pinCommit} onCheckedChange={setPinCommit} size="sm" />
                    钉到当前 commit（{result.head_sha ? result.head_sha.slice(0, 7) : "—"}）；关则跟分支浮动
                  </label>
                ) : null}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onCancel}>取消</Button>
                <Button disabled={busy} onClick={() => void confirm()}>
                  {busy ? "处理中..." : mode === "reference" ? "确认引用" : "确认安装"}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 探测仓库文件树中…
        </div>
      ) : null}
    </div>
  )
}
