export type UploadProgressCallback = (percent: number) => void

function parseResponseBody(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const data = body as Record<string, any>
    const message = data.error?.message || data.detail || data.message
    if (typeof message === "string" && message) return message
  }
  if (typeof body === "string" && body) return body
  return `HTTP ${status}`
}

/** 使用 XHR 上传原始文件，以获得 fetch 不提供的浏览器上传进度事件。 */
export function uploadFileWithProgress<T>(
  url: string,
  file: File,
  onProgress?: UploadProgressCallback,
  method = "POST",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.withCredentials = true
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onerror = () => reject(new Error("文件上传失败，请检查网络连接"))
    xhr.onabort = () => reject(new Error("文件上传已取消"))
    xhr.onload = () => {
      const body = parseResponseBody(xhr.responseText)
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(errorMessage(xhr.status, body)))
        return
      }
      onProgress?.(100)
      resolve(body as T)
    }
    onProgress?.(0)
    xhr.send(file)
  })
}
