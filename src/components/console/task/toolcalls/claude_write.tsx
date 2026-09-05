import type { MessageType } from "../message"
import { taskDetailT } from "../task-i18n"

export const renderTitle = (message: MessageType) => {
  const filePath = (message.data.rawInput?.file_path ?? "") as string
  const action = message.data.status === "failed"
    ? taskDetailT("toolcall.editFailed")
    : message.data.status === "in_progress"
      ? taskDetailT("toolcall.editingFile")
      : taskDetailT("toolcall.editFile")
  return `${action}${filePath ? ` "${filePath}"` : ""}`
}

export const renderDetail = (message: MessageType) => {
  const content = String(
    message.data.rawInput?.content
    ?? message.data.rawInput?.file_text
    ?? (typeof message.data.rawOutput === "string" ? message.data.rawOutput : "")
    ?? "",
  )
  return (
    <pre className="whitespace-pre-wrap break-words p-3 text-xs">
      {content || taskDetailT("toolcall.noContent")}
    </pre>
  )
}
