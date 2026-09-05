import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const chatMessageSource = readFileSync(
  new URL("../src/components/console/chat/chat-message-list.tsx", import.meta.url),
  "utf8",
)

test("聊天模型消息复用公共 Markdown 渲染", () => {
  assert.match(chatMessageSource, /import \{ Markdown \} from "@\/components\/common\/markdown"/)
  assert.match(chatMessageSource, /isUser \? \([\s\S]*whitespace-pre-wrap break-words[\s\S]*\) : \([\s\S]*<Markdown allowHtml/)
})

test("聊天空响应继续显示流式占位", () => {
  assert.match(chatMessageSource, /message\.status === "pending" \|\| message\.status === "streaming"/)
  assert.match(chatMessageSource, /等待响应…/)
})
