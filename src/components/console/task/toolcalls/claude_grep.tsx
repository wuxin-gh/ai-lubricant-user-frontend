import type { MessageType } from "../message"
import { taskDetailT } from "../task-i18n"

export const renderTitle = (message: MessageType) => {
  const pattern = (message.data.rawInput?.pattern ?? "") as string
  const path = (message.data.rawInput?.path ?? "") as string
  const label = pattern ? `"${pattern}"` : ""
  const where = path ? ` in ${path}` : ""
  return `${taskDetailT("toolcall.searchContent")}${label ? ` ${label}` : ""}${where}`
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
