import { useSearchParams } from "react-router-dom"
import AgentManagerWorkspace from "@/pages/console/user/agent-manager"

export default function AgentManagerPage() {
  const [searchParams] = useSearchParams()
  const initialAgentId = Number(searchParams.get("agentId") || 0) || null
  const initialCreate = searchParams.get("create") === "1"

  return (
    <div className="h-full min-h-[560px]">
      <AgentManagerWorkspace
        key={`${initialAgentId ?? "all"}-${initialCreate ? "create" : "manage"}`}
        initialAgentId={initialAgentId}
        initialCreate={initialCreate}
      />
    </div>
  )
}
