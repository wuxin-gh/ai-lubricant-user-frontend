// MCP 的「从 GitHub 识别添加」对话框：粘仓库地址 → 识别（force_type=mcp）→
// 预览 launch_spec（.mcp.json 或 README npx/uvx 提示）→ 编辑名称/描述 + 团队私有
// 连接凭证（token/headers/env）→ 确认即建 v2 引用（resources + resource_references）。
// MCP 本身是连接配置（无归档字节），识别只做预填 + 直创建，不区分引用/安装。
// v2：启动配置落 resource_data，团队凭证落 reference.params；节点直连 MCP URL。
// 用户侧仅 SSE/HTTP：识别到 stdio 时禁用确认并提示去管理端。

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useGithubRecognize } from "@/hooks/useGithubRecognize"
import { createReferenceFromGithubV2 } from "@/api/resourceReferences"
import type { GithubRecognizeResult } from "@/api/githubRecognition"

export interface McpGithubImportPayload {
  name: string
  display_name: string
  description: string
  transport: "stdio" | "streamable-http"
  /** stdio 启动命令（command + args 拼一行）。 */
  command: string
  /** remote 服务 URL。 */
  url: string
  docs_url: string
  /** 识别来源（probe:.mcp.json / probe:readme）。 */
  source: string
}

export interface McpGithubImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** true = 用户侧：仅 SSE/HTTP，识别到 stdio 时禁用确认。 */
  userMode?: boolean
  /** 旧回调：父级做 createMcpService。v2 改由本弹框直建引用（kind=mcp 落
   *  resources + resource_references），不再调用此回调——避免双写 mcp_services。
   *  保留以维持父级 props 兼容；父级刷新逻辑待列表迁 v2 后再接。 */
  onConfirm?: (payload: McpGithubImportPayload) => Promise<void> | void
}

interface Prefill {
  kind: "stdio" | "remote"
  command: string
  url: string
  source: string
}

function prefillFromResult(result: GithubRecognizeResult): Prefill | null {
  const launch = (result.launch_spec || {}) as Record<string, unknown>
  if (launch.kind === "stdio") {
    const args = Array.isArray(launch.args) ? (launch.args as string[]) : []
    return {
      kind: "stdio",
      command: [String(launch.command || ""), ...args].filter(Boolean).join(" "),
      url: "",
      source: String(launch.source || "probe"),
    }
  }
  if (launch.kind === "remote" && launch.url) {
    return {
      kind: "remote",
      command: "",
      url: String(launch.url),
      source: String(launch.source || "probe"),
    }
  }
  return null
}

/** 解析 headers/env JSON 文本；空串 → 空对象。解析失败抛 Error 由调用方 Toast。 */
function parseJsonObject(text: string, field: string): Record<string, string> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${field} 不是合法 JSON`)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field} 必须是 JSON 对象`)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[String(k)] = String(v ?? "")
  }
  return out
}

export function McpGithubImportDialog({ open, onOpenChange, userMode }: McpGithubImportDialogProps) {
  // onConfirm 保留在 Props 上仅作父级兼容；v2 由本弹框直建引用，不再回调旧创建逻辑。
  const { input, setInput, loading, result, error, recognize, reset } = useGithubRecognize()
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [description, setDescription] = useState("")
  const [docsUrl, setDocsUrl] = useState("")
  const [token, setToken] = useState("")
  const [headersText, setHeadersText] = useState("")
  const [envText, setEnvText] = useState("")
  const [busy, setBusy] = useState(false)

  const prefill = result ? prefillFromResult(result) : null
  const stdioBlocked = !!userMode && prefill?.kind === "stdio"

  const handleRecognize = async () => {
    const data = await recognize(undefined, "mcp")
    if (!data) return
    const pf = prefillFromResult(data)
    setName(data.repo_full_name.split("/").pop() || "")
    setDisplayName("")
    setDescription(data.repo_meta?.description || "")
    setDocsUrl(data.repo_meta?.homepage || `https://github.com/${data.repo_full_name}`)
    if (userMode && pf?.kind === "stdio") {
      toast.info("识别到 stdio 启动命令；用户侧仅支持 SSE/HTTP MCP，请到管理端注册")
    }
  }

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      reset()
      setName(""); setDisplayName(""); setDescription(""); setDocsUrl("")
      setToken(""); setHeadersText(""); setEnvText("")
    }
    onOpenChange(o)
  }

  const confirm = async () => {
    if (!result || !prefill || stdioBlocked) return
    if (!name.trim()) {
      toast.error("请填写名称")
      return
    }
    let headers: Record<string, string> = {}
    let env: Record<string, string> = {}
    try {
      headers = parseJsonObject(headersText, "请求头")
      env = parseJsonObject(envText, "环境变量")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "参数解析失败")
      return
    }
    setBusy(true)
    try {
      await createReferenceFromGithubV2({
        repo: result.repo_full_name,
        ref: result.ref,
        kind: "mcp",
        name: name.trim(),
        display_name: displayName.trim() || name.trim(),
        description,
        params: {
          token: token.trim(),
          headers,
          env,
        },
      })
      // v2 引用已落 resource_references；不调用旧 onConfirm，避免双写 mcp_services。
      toast.success(`已从 GitHub 识别并创建 MCP 引用「${name.trim()}」`)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>从 GitHub 识别添加 MCP</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>GitHub 仓库地址</Label>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="owner/repo 或 https://github.com/owner/repo"
                onKeyDown={(e) => { if (e.key === "Enter") void handleRecognize() }}
              />
              <Button variant="outline" disabled={loading} onClick={() => void handleRecognize()}>
                {loading ? "识别中..." : "识别"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              探测 .mcp.json 或 README 的 npx/uvx 启动命令，自动生成连接配置。
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {result ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium">{result.repo_full_name}</div>
                <div className="text-muted-foreground">
                  分支/引用：<span className="text-foreground">{result.ref}</span>
                  {result.head_sha ? ` · HEAD ${result.head_sha.slice(0, 7)}` : ""}
                  {result.repo_meta?.stars ? ` · ★ ${result.repo_meta.stars}` : ""}
                </div>
                {result.repo_meta?.description ? (
                  <div className="mt-1 line-clamp-2 text-muted-foreground">
                    {result.repo_meta.description}
                  </div>
                ) : null}
              </div>
              {prefill ? (
                <div className="rounded-md border p-3 text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary">
                      {prefill.kind === "stdio" ? "stdio" : "remote · SSE/HTTP"}
                    </Badge>
                    <span className="text-muted-foreground">来源：{prefill.source}</span>
                  </div>
                  <div className="font-mono break-all text-foreground">
                    {prefill.kind === "stdio" ? prefill.command : prefill.url}
                  </div>
                  {stdioBlocked ? (
                    <p className="mt-2 text-destructive">
                      用户侧仅支持 SSE/HTTP MCP，stdio 需到管理端注册。
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  未识别到可用的 MCP 启动配置（.mcp.json / README npx·uvx 提示）。
                </p>
              )}

              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-mcp" />
              </div>
              <div className="space-y-1.5">
                <Label>显示名（可选）</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="缺省同名称" />
              </div>
              <div className="space-y-1.5">
                <Label>描述（可选）</Label>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>文档 URL</Label>
                <Input value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} placeholder="https://..." />
              </div>

              {prefill && !stdioBlocked ? (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                  <div className="text-xs font-medium">团队连接凭证（仅本团队可见，落引用 params）</div>
                  {prefill.kind === "remote" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Token（可选）</Label>
                        <Input
                          type="password"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder="组装成 Authorization: Bearer"
                          autoComplete="off"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>自定义请求头 JSON（可选）</Label>
                        <Textarea
                          rows={2}
                          value={headersText}
                          onChange={(e) => setHeadersText(e.target.value)}
                          placeholder='{"X-Foo": "bar"}'
                          className="font-mono"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label>环境变量 JSON（可选）</Label>
                        <Textarea
                          rows={3}
                          value={envText}
                          onChange={(e) => setEnvText(e.target.value)}
                          placeholder='{"API_KEY": "sk-..."}'
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          占位变量名来自 .mcp.json，值由团队在此填实。
                        </p>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button disabled={busy || !prefill || stdioBlocked} onClick={() => void confirm()}>
            {busy ? "创建中..." : "创建 MCP 引用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
