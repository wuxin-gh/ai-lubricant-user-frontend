/**
 * 市场管理页悬浮 Agent 对话（薄壳）。
 *
 * 实际会话/SSE/审批/空状态都在通用 AgentConversation 里；这里只负责列出 Agent、
 * 持有当前选中 Agent 与会话开关，并以非模态 FloatingPanel 承载——打开后仍可操作
 * 底下的市场管理页。未传 messages/terminalContext/onApproval，走组件非受控模式。
 *
 * Agent 选择器右侧挂「配置」按钮，复用 AgentManagerDialog（与节点终端悬浮气泡
 * 同款入口），保存后回调 reloadAgents 刷新下拉。新建 Agent 统一走管理页
 * (/console/agent-manager?create=1)，气泡内不再放「新建」按钮。
 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { listAgents, type AgentInstance } from "@/api/agentClient"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { AgentConversation } from "@/components/console/agent/agent-conversation"
import { FloatingPanel } from "@/components/ui/floating-panel"
import AgentManagerDialog from "@/pages/console/user/agent-manager-dialog"

const MARKETPLACE_EMPTY_HINT = {
  title: "市场管理 Agent",
  desc: "描述想上架的资源，Agent 会用市场管理工具校验并写入 GitHub（调用时以你的管理员身份鉴权）。",
}

export function EmbeddedAgentChat({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { auth } = useAppRuntime()
  const isAdmin = auth.user?.role === "admin"
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  const reloadAgents = useCallback(() => {
    return listAgents()
      .then((list) => {
        const usable = isAdmin ? list : []
        setAgents(usable)
        setSelectedAgentId((current) => {
          if (current && usable.some((a) => a.id === current && a.enabled)) return current
          return null
        })
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
  }, [isAdmin])

  useEffect(() => {
    // 仅打开时拉一次；选中由用户改，后续由弹框 onChanged 回调刷新。
    if (open) void reloadAgents()
  }, [open, reloadAgents])

  return (
    <FloatingPanel open={open} onOpenChange={onOpenChange} title="市场 Agent" storageKey="mp-agent-panel">
      <AgentConversation
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectedAgentIdChange={setSelectedAgentId}
        onManageAgents={() => setManagerOpen(true)}
        getCreateConversationPayload={() => ({ context: "marketplace_admin", title: "市场管理" })}
        emptyHint={MARKETPLACE_EMPTY_HINT}
        className="h-full"
      />
      <AgentManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        initialAgentId={selectedAgentId}
        showAgentList
        onChanged={() => { void reloadAgents() }}
      />
    </FloatingPanel>
  )
}
