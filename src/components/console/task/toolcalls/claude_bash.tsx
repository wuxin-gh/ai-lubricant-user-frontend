import type { MessageType } from "../message"
import { taskDetailT } from "../task-i18n"

export const renderTitle = (message: MessageType) => {
  const command = (message.data.rawInput?.command ?? "") as string
  const desc = (message.data.rawInput?.description ?? "") as string
  const action = message.data.status === "failed"
    ? taskDetailT("toolcall.editFailed")
    : message.data.status === "in_progress"
      ? taskDetailT("toolcall.executeCommand")
      : taskDetailT("toolcall.executeCommand")
  const label = command || desc
  return `${action}${label ? ` "${label}"` : ""}`
}

export const renderDetail = (message: MessageType) => {
  const output = String(
    message.data.rawOutput?.[0]?.text
    ?? (typeof message.data.rawOutput === "string" ? message.data.rawOutput : "")
    ?? "",
  )
  return (
    <pre className="whitespace-pre-wrap break-words p-3 text-xs">
      {output || taskDetailT("toolcall.noContent")}
    </pre>
  )
}
