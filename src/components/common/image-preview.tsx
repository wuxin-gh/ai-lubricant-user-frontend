import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { isSafeDataImageUrl, isSafeImageSource } from "@/lib/media-url"

interface ImagePreviewProps {
  src: string
  alt?: string
  title?: string
  triggerClassName?: string
  imageClassName?: string
  loading?: "eager" | "lazy"
  disabled?: boolean
  /** 允许内联 data:image/…（非 SVG）源——仅供信任的管理端配置内容按调用点显式开启。 */
  allowDataImage?: boolean
}

/**
 * An accessible, dependency-free in-page image preview.
 * The caller must pass a URL accepted by isSafeImageSource; we check again here
 * because this component is also reusable outside Markdown and agent messages.
 */
export function ImagePreview({
  src,
  alt,
  title,
  triggerClassName,
  imageClassName,
  loading = "lazy",
  disabled = false,
  allowDataImage = false,
}: ImagePreviewProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const safeSrc = isSafeImageSource(src) || (allowDataImage && isSafeDataImageUrl(src)) ? src : ""
  const label = alt?.trim() || t("common.imagePreview.defaultAlt")
  const dialogTitle = title?.trim() || label

  useEffect(() => {
    if (!open) setPreviewError(false)
  }, [open])

  if (!safeSrc) return null

  return (
    <>
      <button
        type="button"
        className={cn("block max-w-full cursor-zoom-in text-left", triggerClassName)}
        onClick={() => {
          if (!disabled) setOpen(true)
        }}
        disabled={disabled}
        aria-label={t("common.imagePreview.open", { name: label })}
        title={title}
      >
        <img
          src={safeSrc}
          alt={label}
          title={title}
          className={cn("max-w-full", imageClassName)}
          loading={loading}
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* z-[70]：消息气泡里的图片预览可能从 z-[60] 悬浮浮窗（节点 AI 助手）里点开，
            要抬到浮窗之上。 */}
        <DialogContent
          className="z-[70] flex max-h-[95vh] max-w-[calc(100%-1rem)] items-center justify-center overflow-hidden bg-black/90 p-3 sm:max-w-[95vw]"
          overlayClassName="z-[70] bg-black/70"
        >
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          {previewError ? (
            <div className="p-8 text-center text-sm text-white">
              {t("common.imagePreview.loadFailed")}
            </div>
          ) : (
            <img
              src={safeSrc}
              alt={label}
              title={title}
              className="max-h-[85vh] max-w-[95vw] object-contain"
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setPreviewError(true)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
