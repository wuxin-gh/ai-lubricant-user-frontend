/**
 * Frontend guards for media URLs and inline image types.
 * Backend attachment ownership checks remain the authorization boundary.
 */

const ABSOLUTE_URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Allow http(s) and same-origin relative paths; reject protocol-relative and other schemes. */
export function isSafeImageSource(value: string | undefined | null): value is string {
  if (!value || typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed || trimmed !== value) return false
  if (trimmed.startsWith("//") || trimmed.startsWith("\\") || trimmed.startsWith("#")) return false
  if (ABSOLUTE_URL_SCHEME.test(trimmed)) return /^https?:\/\//i.test(trimmed)
  return !hasControlChars(trimmed)
}

/**
 * Inline ``data:image/…`` sources: only non-SVG raster types. Same posture as the
 * SVG exclusion above — ``svg+xml`` can carry active content, the rest is inert
 * pixel data. Meant for trusted admin-configured content (community QR codes),
 * opted in per call site, not folded into {@link isSafeImageSource}.
 */
export function isSafeDataImageUrl(value: string | undefined | null): value is string {
  if (!value || typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed || trimmed !== value || hasControlChars(trimmed)) return false
  return trimmed.toLowerCase().startsWith("data:image/") && !trimmed.toLowerCase().startsWith("data:image/svg")
}

const PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/x-icon",
])

/** SVG is intentionally excluded because same-origin inline SVG can execute active content. */
export function isPreviewableImageMime(mime: string | undefined | null): boolean {
  if (!mime || typeof mime !== "string") return false
  return PREVIEWABLE_IMAGE_MIMES.has(mime.trim().toLowerCase())
}

const PREVIEWABLE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"])

export function isPreviewableImageExtension(name: string | undefined | null): boolean {
  if (!name || typeof name !== "string") return false
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf(".")
  return dot >= 0 && PREVIEWABLE_IMAGE_EXTS.has(lower.slice(dot + 1))
}

/** MIME takes precedence; extension is only used when MIME metadata is absent. */
export function isPreviewableImage(opts: {
  mime?: string | undefined | null
  name?: string | undefined | null
}): boolean {
  const mime = opts.mime
  return mime && mime.trim()
    ? isPreviewableImageMime(mime)
    : isPreviewableImageExtension(opts.name)
}

/** Reject SVG even when Markdown has no MIME metadata. */
export function isSvgImageSource(value: string | undefined | null): boolean {
  if (!value || typeof value !== "string") return false
  try {
    const url = new URL(value, window.location.origin)
    return url.pathname.toLowerCase().endsWith(".svg")
  } catch {
    return /\.svg(?:$|[?#])/i.test(value)
  }
}
