/**
 * 跨浏览器复制文本。
 *
 * navigator.clipboard 只在安全上下文（HTTPS/localhost）存在，纯 HTTP 私有化部署、
 * 部分套壳浏览器（360 等）或文档失焦时 writeText 会 undefined/reject。
 * 这里先试异步剪贴板 API，失败或不可用时退回 textarea + execCommand 同步路径。
 *
 * execCommand 路径的关键：不能依赖 textarea 的选区真的建立——Mac Chrome 上
 * execCommand('copy') 会返回 true 但选区没落在 textarea 上，copy 事件以空选区
 * 跑完、系统剪贴板原样保留旧内容（现象：提示成功、粘贴出来是上一次的内容）。
 * 所以触发 execCommand 前先挂 copy 事件监听，事件里 preventDefault +
 * clipboardData.setData 直接把我们的文本塞进剪贴板，选区是什么无所谓。
 *
 * @returns 是否复制成功（两条路径都失败时为 false）。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through 到 execCommand 退路
    }
  }
  return execCommandCopy(text)
}

/** textarea + copy 事件覆写 + execCommand 的同步退路。 */
function execCommandCopy(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)

  // 记录用户原有文本选区，复制完成后还原。
  const selection = document.getSelection()
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  // copy 事件覆写：execCommand 触发 copy 事件时，不靠默认的选区拷贝，
  // 直接把我们的文本写进 clipboardData。
  let copiedViaEvent = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) {
      // 老内核没有 clipboardData，只能依赖默认的选区拷贝。
      return
    }
    e.preventDefault()
    e.clipboardData.setData("text/plain", text)
    copiedViaEvent = true
  }
  document.addEventListener("copy", onCopy)

  let ok = false
  try {
    // iOS Safari 需要 setSelectionRange 才会选中；focus 防 Mac 上焦点不在 textarea。
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.removeEventListener("copy", onCopy)
    textarea.remove()
    if (selectedRange && selection) {
      selection.removeAllRanges()
      selection.addRange(selectedRange)
    }
  }

  return ok || copiedViaEvent
}
