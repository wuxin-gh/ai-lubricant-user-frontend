import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  isPreviewableImage,
  isPreviewableImageMime,
  isSafeImageSource,
  isSvgImageSource,
} from "../src/lib/media-url.ts"

const markdownSource = readFileSync(
  new URL("../src/components/common/markdown.tsx", import.meta.url),
  "utf8",
)
const agentMessageSource = readFileSync(
  new URL("../src/components/console/agent/agent-message-list.tsx", import.meta.url),
  "utf8",
)
const previewSource = readFileSync(
  new URL("../src/components/common/image-preview.tsx", import.meta.url),
  "utf8",
)

test("图片 URL 只允许 http(s) 和站内相对路径", () => {
  assert.equal(isSafeImageSource("/agent/attachments/12/content"), true)
  assert.equal(isSafeImageSource("images/result.png"), true)
  assert.equal(isSafeImageSource("https://cdn.example.com/result.png"), true)
  assert.equal(isSafeImageSource("http://cdn.example.com/result.png"), true)

  for (const value of [
    "",
    " javascript:alert(1)",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://example.com/id",
    "file:///tmp/a.png",
    "//cdn.example.com/a.png",
    "\\\\cdn.example.com\\a.png",
    "#fragment",
  ]) {
    assert.equal(isSafeImageSource(value), false, value)
  }
})

test("inline 预览只接受 raster 图片并拒绝 SVG", () => {
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
    assert.equal(isPreviewableImageMime(mime), true, mime)
  }
  assert.equal(isPreviewableImageMime("image/svg+xml"), false)
  assert.equal(isPreviewableImageMime("text/html"), false)
  assert.equal(isPreviewableImage({ mime: "image/svg+xml", name: "safe.png" }), false)
  assert.equal(isPreviewableImage({ name: "safe.webp" }), true)
  assert.equal(isPreviewableImage({ name: "active.svg" }), false)
  assert.equal(isSvgImageSource("https://example.com/active.svg?x=1"), true)
  assert.equal(isSvgImageSource("/images/photo.png"), false)
})

test("Markdown 和 Agent media 复用页内图片预览", () => {
  assert.match(markdownSource, /import \{ ImagePreview \}/)
  assert.match(markdownSource, /<ImagePreview[\s\S]*src=\{resolved\}/)
  assert.match(agentMessageSource, /import \{ ImagePreview \}/)
  assert.match(agentMessageSource, /<ImagePreview[\s\S]*src=\{safeImgSrc\}/)
  assert.match(previewSource, /<Dialog open=\{open\}/)
  assert.match(previewSource, /referrerPolicy="no-referrer"/)
  assert.doesNotMatch(
    agentMessageSource,
    /<a href=\{imgSrc\} target="_blank"/,
  )
})

test("AttachmentMediaPart 携带服务端签名字段且 MediaPartView 优先消费", () => {
  const agentClientSource = readFileSync(
    new URL("../src/api/agentClient.ts", import.meta.url),
    "utf8",
  )
  assert.match(agentClientSource, /content_url\?: string/)
  assert.match(agentClientSource, /thumbnail_url\?: string/)
  // Agent media 优先用签名 content_url，再回退公网 url 与裸 id 端点
  assert.match(agentMessageSource, /safeSignedContent/)
  assert.match(agentMessageSource, /part\.content_url/)
})
