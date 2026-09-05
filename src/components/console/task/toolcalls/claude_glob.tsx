import type { MessageType } from "../message"
import { taskDetailT } from "../task-i18n"

export const renderTitle = (message: MessageType) => {
  const pattern = (message.data.rawInput?.pattern ?? "") as string
  return `${taskDetailT("toolcall.searchContent")}${pattern ? ` "${pattern}"` : ""}`
}

export const renderDetail = (message: MessageType) => {
  const output = String(
    message.data.rawOutput?.[0]?.text
    ?? (typeof message.data.rawOutput === "string" ? message.data.rawOutput : "")
    ?? "",
  )
  const lines = output.split(/\r?\n/).filter(Boolean)
  return (
    <pre className="whitespace-pre-wrap break-words p-3 text-xs">
      {lines.length ? lines.join("\n") : taskDetailT("toolcall.noContent")}
    </pre>
  )
}
