import { useCallback, useEffect, useRef, useState } from "react"

import { loadAllTaskRoundMessages } from "@/components/console/task/task-rounds"
import { TaskMessageVirtualList } from "@/components/console/task/task-message-virtual-list"
import type { MessageType } from "@/components/console/task/message"
import { Spinner } from "@/components/ui/spinner"

export default function ReadonlyTaskConversation({ taskId }: { taskId: string }) {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const getScrollContainer = useCallback(() => scrollRef.current, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setMessages([])
    loadAllTaskRoundMessages(taskId)
      .then((history) => {
        if (active) setMessages(history)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "加载对话失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId])

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center"><Spinner /></div>
  }
  if (error) {
    return <div className="flex min-h-64 items-center justify-center text-sm text-destructive">{error}</div>
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded-lg bg-background px-4 py-3">
      <TaskMessageVirtualList
        messages={messages}
        getScrollContainer={getScrollContainer}
        showHistoryLoadButton={false}
        historyLoading={false}
        historyLoaded
        onLoadHistory={() => undefined}
      />
    </div>
  )
}
