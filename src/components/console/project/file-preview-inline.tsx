/**
 * Inline file preview, rendered beneath a file row in the project tree.
 *
 * The project file manager's tree stays the source of truth: clicking a file
 * expands this preview under its row (a leaf on the tree) instead of opening a
 * dialog or a side panel, so the browsing context is never lost. Owned here
 * rather than in repo-tree so the tree primitive stays free of the AceEditor
 * dependency; the tree just calls the ``renderFilePreview`` it is given.
 */
import { useEffect, useMemo, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import { isPreviewableImageExtension } from "@/lib/media-url"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconFile, IconFileOff, IconLoader, IconPhoto } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import AceEditor from "react-ace"
import "ace-builds/src-noconflict/mode-text"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/mode-typescript"
import "ace-builds/src-noconflict/mode-python"
import "ace-builds/src-noconflict/mode-json"
import "ace-builds/src-noconflict/mode-yaml"
import "ace-builds/src-noconflict/mode-markdown"
import "ace-builds/src-noconflict/mode-html"
import "ace-builds/src-noconflict/mode-css"
import "ace-builds/src-noconflict/mode-sql"
import "ace-builds/src-noconflict/mode-sh"
import "ace-builds/src-noconflict/mode-dockerfile"
import "@/utils/ace-theme"
import {
  MAX_IMAGE_PREVIEW_SIZE,
  MAX_TEXT_PREVIEW_SIZE,
  buildRawBlobUrl,
  formatSize,
  getLanguageMode,
  type TreeEntry,
} from "./repo-tree"

type PreviewKind = "text" | "image" | "binary" | "tooLarge" | "notFound"

function kindForEntry(entry: TreeEntry): PreviewKind {
  if (isPreviewableImageExtension(entry.name)) return "image"
  return "text"
}

export function FilePreviewInline({
  entry,
  projectId,
  branch,
}: {
  entry: TreeEntry
  projectId?: string
  branch?: string
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState("")
  const [kind, setKind] = useState<PreviewKind>(kindForEntry(entry))
  const [loading, setLoading] = useState(true)
  const [imageError, setImageError] = useState(false)

  const languageMode = useMemo(
    () => (entry.name ? getLanguageMode(entry.name) : "text"),
    [entry.name],
  )
  const imageUrl = useMemo(() => {
    if (kind !== "image" || !projectId) return ""
    return buildRawBlobUrl(projectId, entry.path || "", branch || "")
  }, [kind, projectId, entry.path, branch])

  useEffect(() => {
    if (!projectId || !entry.path) return
    let cancelled = false
    setLoading(true)
    setImageError(false)
    const initialKind = kindForEntry(entry)
    const limit = initialKind === "image" ? MAX_IMAGE_PREVIEW_SIZE : MAX_TEXT_PREVIEW_SIZE
    if (typeof entry.size === "number" && entry.size > limit) {
      setKind("tooLarge")
      setContent("")
      setLoading(false)
      return
    }
    if (initialKind === "image") {
      setKind("image")
      setLoading(false)
      return
    }
    setKind("text")
    void apiRequest(
      "v1UsersProjectsTreeBlobDetail",
      { path: entry.path || "", ref: branch || undefined },
      [projectId],
      (resp) => {
        if (cancelled) return
        if (resp.code === 0 && resp.data?.content) {
          setContent(b64decode(resp.data.content))
          if (resp.data.is_binary) {
            setKind("binary")
          } else if (typeof resp.data.size === "number" && resp.data.size > MAX_TEXT_PREVIEW_SIZE) {
            setKind("tooLarge")
          } else {
            setKind("text")
          }
        } else {
          setKind("notFound")
        }
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setKind("notFound")
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [entry.path, entry.size, entry.name, projectId, branch])

  if (loading) {
    return (
      <Empty className="opacity-50 py-4">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLoader className="animate-spin" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  }

  if (kind === "notFound") {
    return (
      <Empty className="py-4">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileOff className="size-5" />
          </EmptyMedia>
          <EmptyDescription>{t("consoleProject.files.previewNotFound")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (kind === "image") {
    return (
      <div className="flex items-center justify-center overflow-auto bg-muted/25 p-2">
        {imageError ? (
          <Empty className="opacity-70">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconPhoto className="size-5" />
              </EmptyMedia>
              <EmptyDescription>{t("consoleProject.files.imageLoadFailed")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <img
            src={imageUrl}
            alt={entry.name}
            className="max-h-[60vh] max-w-full object-contain"
            onError={() => setImageError(true)}
          />
        )}
      </div>
    )
  }

  if (kind === "binary" || kind === "tooLarge") {
    return (
      <Empty className="py-4">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFile className="size-5" />
          </EmptyMedia>
          <EmptyDescription>
            {kind === "binary"
              ? t("consoleProject.files.binaryUnsupported")
              : t("consoleProject.files.tooLargeNoPreview")}
          </EmptyDescription>
          {typeof entry.size === "number" && (
            <div className="text-xs text-muted-foreground">{formatSize(entry.size)}</div>
          )}
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <AceEditor
      mode={languageMode}
      theme="ai_lubricant"
      width="100%"
      height="420px"
      readOnly
      value={content}
      showPrintMargin={false}
      showGutter
      setOptions={{ fontFamily: "var(--font-code)", fontSize: 12 }}
    />
  )
}

export default FilePreviewInline
