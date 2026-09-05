import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { resolveLegacyTaskSession } from "@/api/userTaskClient"
import { Spinner } from "@/components/ui/spinner"

export function ProjectEditorRedirect() {
  const { projectId = "" } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  useEffect(() => {
    navigate(projectId ? `/console/project/${projectId}?tab=tasks` : "/console/tasks?legacy=editor", { replace: true })
  }, [navigate, projectId])
  return null
}

export function ProjectEditorSessionRedirect() {
  const { sessionId = "" } = useParams<{ sessionId: string }>()
  return <LegacySessionRedirect sessionId={sessionId} />
}

export function EditorRedirect() {
  const navigate = useNavigate()
  useEffect(() => { navigate("/console/tasks?legacy=editor", { replace: true }) }, [navigate])
  return null
}

export function EditorSessionRedirect() {
  const { sessionId = "" } = useParams<{ sessionId: string }>()
  return <LegacySessionRedirect sessionId={sessionId} />
}

function LegacySessionRedirect({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    void resolveLegacyTaskSession(sessionId)
      .then((result) => { if (active) navigate(`/console/task/${result.task_id}`, { replace: true }) })
      .catch(() => {
        if (!active) return
        toast.info("该旧会话尚未迁移为开发任务")
        navigate("/console/tasks?legacy=session", { replace: true })
      })
    return () => { active = false }
  }, [navigate, sessionId])
  return <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
}
