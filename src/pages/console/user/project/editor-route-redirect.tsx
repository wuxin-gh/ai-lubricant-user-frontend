import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { resolveLegacyTaskSession } from "@/api/userTaskClient"
import { Spinner } from "@/components/ui/spinner"
import { CODING_SECTIONS, codingSectionPath } from "@/config/coding-sections"

/** 编辑器旧入口的落点：任务页（编辑器管理已并入任务/项目工作区）。 */
const TASKS_SECTION = CODING_SECTIONS.find((s) => s.path === "tasks") ?? CODING_SECTIONS[0]

export function ProjectEditorRedirect() {
  const { projectId = "" } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  useEffect(() => {
    navigate(projectId ? codingSectionPath(projectId, TASKS_SECTION) : "/home", { replace: true })
  }, [navigate, projectId])
  return null
}

export function ProjectEditorSessionRedirect() {
  const { sessionId = "" } = useParams<{ sessionId: string }>()
  return <LegacySessionRedirect sessionId={sessionId} />
}

export function EditorRedirect() {
  const navigate = useNavigate()
  useEffect(() => { navigate("/home", { replace: true }) }, [navigate])
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
      .then((result) => { if (active) navigate(`/coding/task/${result.task_id}`, { replace: true }) })
      .catch(() => {
        if (!active) return
        toast.info("该旧会话尚未迁移为开发任务")
        // 留在 Coding：旧会话解不出任务时给项目选择页，别把人踢出控制台。
        navigate("/coding", { replace: true })
      })
    return () => { active = false }
  }, [navigate, sessionId])
  return <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
}
