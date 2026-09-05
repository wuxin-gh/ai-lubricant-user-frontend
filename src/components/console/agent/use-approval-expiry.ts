/**
 * 审批卡到期翻牌：每秒把到期的 pending 审批翻成 expired。
 *
 * 用户侧 Agent 对话页与通用 AgentConversation 各自持有消息 state，但「什么时候算
 * 到期」必须同一套口径——早先两边各抄了一份逐字相同的 setInterval，改一处漏一处。
 *
 * expiresAt 是毫秒时间戳（agent-stream-events.ts 的归一层已把后端的 POSIX 秒换算
 * 过），0 表示不过期。
 */
import { useEffect } from "react"

import type { AgentDisplayMessage } from "./agent-message-list"

type MessagesSetter = React.Dispatch<React.SetStateAction<AgentDisplayMessage[]>>

const isExpired = (
  approval: { state: string; expiresAt: number },
  now: number,
): boolean => approval.state === "pending" && approval.expiresAt > 0 && approval.expiresAt <= now

export function useApprovalExpiry(setMessages: MessagesSetter): void {
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        let changed = false
        const next = prev.map((message) => {
          if (!message.approvals?.some((item) => isExpired(item, now))) return message
          changed = true
          return {
            ...message,
            approvals: message.approvals.map((item) => (
              isExpired(item, now) ? { ...item, state: "expired" as const } : item
            )),
          }
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [setMessages])
}
