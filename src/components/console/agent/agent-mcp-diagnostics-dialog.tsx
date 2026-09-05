/**
 * Agent 会话 MCP 诊断悬浮弹框。
 *
 * 在 AgentConversation 右上角「查看详情」点开：展示这个 Agent 当前会话到底挂了哪些
 * MCP 服务（及其工具列表）、以什么身份调用（绑定的 principal + token 类型）、principal
 * 的操作参数（cdp_client_id / mail_account_id 等）。只读、best-effort。
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { getAgentMcpDiagnostics, type AgentMcpDiagnostics } from "@/api/agentClient"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

/** param_key → 中文标签。 */
function paramLabel(key: string): string {
  switch (key) {
    case "cdp_client_id": return "CDP 浏览器客户端"
    case "mail_account_id": return "邮箱账户"
    case "term_id": return "终端"
    default: return key
  }
}

function usageLabel(t?: string): string {
  switch (t) {
    case "agent": return "Agent"
    case "task": return "任务"
    case "external": return "外部接入"
    default: return t || "-"
  }
}

export function AgentMcpDiagnosticsDialog({
  open,
  onOpenChange,
  agentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: number | null
}) {
  const [data, setData] = useState<AgentMcpDiagnostics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || agentId == null) { setData(null); return }
    setLoading(true)
    getAgentMcpDiagnostics(agentId)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载会话详情失败"))
      .finally(() => setLoading(false))
  }, [open, agentId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* z-[70]：从 z-[60] 悬浮浮窗（节点 AI 助手）里点开的弹框要抬到浮窗之上。 */}
      <DialogContent className="z-[70] max-h-[80vh] overflow-y-auto sm:max-w-lg" overlayClassName="z-[70]">
        <DialogHeader>
          <DialogTitle>会话详情</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3" /> 加载中...
          </div>
        ) : !data ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无数据。</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {/* Agent + 身份 */}
            <section className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Agent</div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{data.agent_name}</span>
                <Badge variant="outline" className="text-[10px]">#{data.agent_id}</Badge>
              </div>
            </section>

            {/* MCP 用户（principal） */}
            <section className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">MCP 用户（调用身份）</div>
              {data.principal ? (
                <div className="rounded-md border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{data.principal.name}</span>
                    <Badge variant="outline" className="text-[10px]">{usageLabel(data.principal.usage_type)}</Badge>
                    <Badge variant={data.token_kind === "identity" ? "secondary" : "outline"} className="text-[10px]">
                      {data.token_kind === "identity" ? "身份 token" : "服务 token"}
                    </Badge>
                    {data.principal.enabled === false && <Badge variant="destructive" className="text-[10px]">已停用</Badge>}
                  </div>
                  {data.principal.token_hint && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      token: <code className="font-mono">{data.principal.token_hint}</code>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">未绑定 MCP 用户（开启鉴权的 MCP 调用会被拒绝）。</p>
              )}
            </section>

            {/* 操作参数 */}
            <section className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">操作参数</div>
              {data.params.length === 0 ? (
                <p className="text-xs text-muted-foreground">无。CDP/邮箱等按参数定位资源，未配置则无法定位具体对象。</p>
              ) : (
                <div className="grid gap-1">
                  {data.params.map((p) => (
                    <div key={p.param_key} className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                      <span className="text-xs">{paramLabel(p.param_key)}</span>
                      <code className="font-mono text-[11px] text-muted-foreground">{p.param_key} = {p.param_value}</code>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 生效的 MCP + 各自能操控的资源 */}
            <section className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                MCP 与可操控资源（{data.effective_services.length}）
              </div>
              {data.effective_services.length === 0 ? (
                <p className="text-xs text-muted-foreground">该会话未挂载任何 MCP。</p>
              ) : (
                <div className="grid gap-2">
                  {data.effective_services.map((svc) => (
                    <div key={svc.name} className="rounded-md border p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{svc.display_name}</span>
                        {svc.builtin && <Badge variant="outline" className="text-[10px]">内置</Badge>}
                        {svc.auth_enabled && <Badge variant="secondary" className="text-[10px]">鉴权</Badge>}
                      </div>
                      {/* 能操控的资源：cdp→浏览器客户端、mail→邮箱账户。 */}
                      {svc.param_key ? (
                        svc.resources.length > 0 ? (
                          <div className="mt-1.5 grid gap-1">
                            <span className="text-[11px] text-muted-foreground">可操控</span>
                            {svc.resources.map((r) => (
                              <div key={r.id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1">
                                <span className="text-xs">{r.name}</span>
                                <code className="font-mono text-[10px] text-muted-foreground">
                                  {svc.param_key} = {r.id}
                                </code>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-destructive">
                            未绑定{svc.name === "cdp-bridge" ? "浏览器客户端" : "资源"}（参数 {svc.param_key} 未配置），调用将无法定位对象。
                          </p>
                        )
                      ) : (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          无需资源参数（调用按身份鉴权）。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
