/**
 * 聊天失败态与手动重试的源码契约：失败必须能落到 error，且重试不能走错模式。
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync(new URL("../src/pages/console/user/chat-page-v2.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const bubble = readFileSync(new URL("../src/components/console/chat/chat-message-list.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const client = readFileSync(new URL("../src/api/agentClient.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("上游 error 帧不会被 JSON 解析 catch 静默吞掉", () => {
  assert.match(page, /try \{\n\s*chunk = JSON\.parse\(data\)\n\s*\} catch \{\n\s*continue\n\s*\}\n\s*if \(chunk\.error\)/)
  assert.match(page, /if \(chunk\.error\) \{[\s\S]*?throw new Error/)
  assert.doesNotMatch(page, /if \(err instanceof Error && err\.message !== "Unexpected end of JSON input"\)/)
})

test("主动停止使用 stopped 状态且气泡展示已停止", () => {
  assert.match(page, /status: stopped \? "stopped" : "error"/)
  assert.match(page, /cancelled \|\| \(e instanceof DOMException && e\.name === "AbortError"\)/)
  assert.match(bubble, /message\.status === "stopped" && !hasMedia/)
  assert.match(client, /status: "pending" \| "streaming" \| "done" \| "error" \| "stopped"/)
})

test("媒体错误重试按原模式分发", () => {
  assert.match(page, /const mode = msg\.mode \?\? settingsRef\.current\.mode/)
  assert.match(page, /if \(mode === "chat"\) \{[\s\S]*?sendChat\(convId, lastUser\.content, undefined, \{ resendLastUser: true \}\)/)
  assert.match(page, /sendMediaMessage\(convId, lastUser\.content, mode, \{ resendLastUser: true \}\)/)
  assert.match(page, /options\?: \{ resendLastUser\?: boolean \}/)
})

test("缺少会话 ID 时重试给出反馈", () => {
  assert.match(page, /if \(!convId\) \{\n\s*toast\.error\("会话未就绪，无法重试"\)/)
})
