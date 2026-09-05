/**
 * Repository entry preview — dialog and inline panel forms sharing one body.
 *
 * One place that answers "show me whatever is at this repository path": a
 * directory renders as a lazy tree, an image through the raw blob endpoint, a
 * text file in AceEditor, and binary/oversize payloads as an explanatory empty
 * state.
 *
 * Two shells:
 * - ``RepoEntryPreviewDialog`` — a modal, used by README links (only a path is
 *   known, so the entry is resolved first).
 * - ``RepoEntryPreviewPanel`` — inline, used by the project file manager: the
 *   tree stays on the left and the preview opens beside it instead of in a
 *   popup, so browsing keeps its context.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import { isPreviewableImageExtension } from "@/lib/media-url"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { IconArrowLeft, IconFile, IconFileOff, IconLoader, IconPhoto, IconX } from "@tabler/icons-react"
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
  TreeNode,
  buildRawBlobUrl,
  formatSize,
  getLanguageMode,
  isDirectory,
  sortEntries,
  type SubmoduleInfo,
  type TreeEntry,
} from "./repo-tree"

type PreviewKind = 'directory' | 'image' | 'binary' | 'tooLarge' | 'text' | 'notFound'

/** Parent directory of a repository path ("" for a root-level entry). */
const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

const kindForEntry = (entry: TreeEntry): PreviewKind => {
  if (isDirectory(entry)) return 'directory'
  if (isPreviewableImageExtension(entry.name)) return 'image'
  return 'text'
}

interface PreviewStateProps {
  projectId?: string
  branch?: string
  /** Known tree entry; when absent the mode/size are resolved from the tree. */
  entry?: TreeEntry
  /** Repository path to preview. Required when ``entry`` is not supplied. */
  path?: string
  /** false suspends resolution (the dialog passes ``open``; the panel passes true). */
  active: boolean
}

/**
 * All preview state + actions, shared by both shells. ``active`` gates the
 * resolve effect: the dialog only resolves while open, the panel is always
 * live and re-shows whenever ``entry`` changes.
 */
function useRepoEntryPreviewState({ projectId, branch, entry, path, active }: PreviewStateProps) {
  const requestedPath = entry?.path || path || ""
  // Entry currently shown. Starts at the requested one and moves as the user
  // drills into a directory listing, so one view can walk a subtree.
  const [current, setCurrent] = useState<TreeEntry | null>(entry ?? null)
  // The requested entry, kept so the back button can return to it after a drill-down.
  const [root, setRoot] = useState<TreeEntry | null>(entry ?? null)
  const [resolving, setResolving] = useState(false)
  const [kind, setKind] = useState<PreviewKind>('text')
  const [content, setContent] = useState("")
  const [contentLoading, setContentLoading] = useState(false)
  const [imageError, setImageError] = useState(false)

  const languageMode = useMemo(
    () => (current?.name ? getLanguageMode(current.name) : 'text'),
    [current],
  )

  const imageUrl = useMemo(() => {
    if (kind !== 'image' || !projectId || !current) return ""
    return buildRawBlobUrl(projectId, current.path || "", branch || "")
  }, [kind, projectId, current, branch])

  const fetchContent = useCallback(async (target: TreeEntry) => {
    if (!projectId) return
    setContentLoading(true)
    setContent("")
    await apiRequest('v1UsersProjectsTreeBlobDetail', {
      path: target.path || "",
      ref: branch || undefined,
    }, [projectId], (resp) => {
      if (resp.code === 0 && resp.data?.content) {
        setContent(b64decode(resp.data.content))
        // The backend blob carries is_binary/size: fall back when text decoding
        // fails or the payload exceeds the threshold, so binary bytes never
        // reach AceEditor as mojibake.
        if (resp.data.is_binary) {
          setKind('binary')
        } else if (typeof resp.data.size === 'number' && resp.data.size > MAX_TEXT_PREVIEW_SIZE) {
          setKind('tooLarge')
        } else {
          setKind('text')
        }
      } else {
        setKind('text')
      }
    })
    setContentLoading(false)
  }, [projectId, branch])

  /** Show ``target``, applying the size thresholds before loading anything. */
  const show = useCallback((target: TreeEntry) => {
    setCurrent(target)
    setImageError(false)
    const nextKind = kindForEntry(target)
    const limit = nextKind === 'image' ? MAX_IMAGE_PREVIEW_SIZE : MAX_TEXT_PREVIEW_SIZE
    if (nextKind !== 'directory' && typeof target.size === 'number' && target.size > limit) {
      setKind('tooLarge')
      setContent("")
      return
    }
    setKind(nextKind)
    if (nextKind === 'text') {
      void fetchContent(target)
    } else {
      setContentLoading(false)
    }
  }, [fetchContent])

  // Resolve the requested path when only a path is known (README links): list
  // its parent directory and match by exact path to learn the real mode/size.
  useEffect(() => {
    if (!active || !projectId || !requestedPath) return
    if (entry) {
      setRoot(entry)
      show(entry)
      return
    }

    let cancelled = false
    setResolving(true)
    void apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: parentPath(requestedPath),
      ref: branch || undefined,
    }, [projectId], (resp) => {
      if (cancelled) return
      const entries: TreeEntry[] = resp.code === 0 ? (resp.data || []) : []
      const found = entries.find((item) => item.path === requestedPath)
      if (found) {
        setRoot(found)
        show(found)
      } else {
        setRoot(null)
        setCurrent(null)
        setKind('notFound')
      }
      setResolving(false)
    }, () => {
      if (cancelled) return
      setRoot(null)
      setCurrent(null)
      setKind('notFound')
      setResolving(false)
    })

    return () => {
      cancelled = true
    }
  }, [active, projectId, requestedPath, entry, branch])

  return {
    current,
    root,
    resolving,
    kind,
    content,
    contentLoading,
    imageError,
    setImageError,
    languageMode,
    imageUrl,
    show,
  }
}

interface ShellProps {
  projectId?: string
  branch?: string
  entry?: TreeEntry
  path?: string
  submodules?: Map<string, SubmoduleInfo>
  onSubmoduleOpen?: (info: SubmoduleInfo) => void
}

export function RepoEntryPreviewDialog({
  projectId,
  branch,
  open,
  onOpenChange,
  path,
  entry,
  submodules,
  onSubmoduleOpen,
}: ShellProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const state = useRepoEntryPreviewState({ projectId, branch, entry, path, active: open })
  const canGoBack = !!state.current && !!state.root && state.current.path !== state.root.path

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[80vw] xl:max-w-[60vw] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {canGoBack ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1"
                onClick={() => state.root && state.show(state.root)}
                title={t("consoleProject.files.previewBack")}
              >
                <IconArrowLeft className="size-4" />
              </Button>
            ) : null}
            <IconFile className="h-5 w-5" />
            <span className="truncate">{state.current?.path || path}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto rounded-md border">
          <PreviewBody
            kind={state.kind}
            loading={state.resolving || state.contentLoading}
            entry={state.current}
            content={state.content}
            languageMode={state.languageMode}
            imageUrl={state.imageUrl}
            imageError={state.imageError}
            onImageError={() => state.setImageError(true)}
            projectId={projectId}
            branch={branch}
            submodules={submodules}
            onSubmoduleOpen={onSubmoduleOpen}
            onSelect={state.show}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Inline preview panel for the project file manager: sits beside the tree so a
 * click previews in place instead of opening a popup. Header mirrors the
 * dialog's (back + path) and adds the close affordance the dialog got for free.
 */
export function RepoEntryPreviewPanel({
  projectId,
  branch,
  entry,
  onClose,
  submodules,
  onSubmoduleOpen,
}: ShellProps & { onClose: () => void }) {
  const { t } = useTranslation()
  const state = useRepoEntryPreviewState({ projectId, branch, entry, active: true })
  const canGoBack = !!state.current && !!state.root && state.current.path !== state.root.path

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2 py-1.5">
        {canGoBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1"
            onClick={() => state.root && state.show(state.root)}
            title={t("consoleProject.files.previewBack")}
          >
            <IconArrowLeft className="size-4" />
          </Button>
        ) : null}
        <IconFile className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{state.current?.path || ""}</span>
        <Button variant="ghost" size="icon" className="size-6 shrink-0" title="关闭预览" onClick={onClose}>
          <IconX className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PreviewBody
          kind={state.kind}
          loading={state.resolving || state.contentLoading}
          entry={state.current}
          content={state.content}
          languageMode={state.languageMode}
          imageUrl={state.imageUrl}
          imageError={state.imageError}
          onImageError={() => state.setImageError(true)}
          projectId={projectId}
          branch={branch}
          submodules={submodules}
          onSubmoduleOpen={onSubmoduleOpen}
          onSelect={state.show}
        />
      </div>
    </div>
  )
}

interface PreviewBodyProps {
  kind: PreviewKind
  loading: boolean
  entry: TreeEntry | null
  content: string
  languageMode: string
  imageUrl: string
  imageError: boolean
  onImageError: () => void
  projectId?: string
  branch?: string
  submodules?: Map<string, SubmoduleInfo>
  onSubmoduleOpen?: (info: SubmoduleInfo) => void
  onSelect: (entry: TreeEntry) => void
}

function PreviewBody({
  kind,
  loading,
  entry,
  content,
  languageMode,
  imageUrl,
  imageError,
  onImageError,
  projectId,
  branch,
  submodules,
  onSubmoduleOpen,
  onSelect,
}: PreviewBodyProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <Empty className="opacity-50 h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLoader className="animate-spin" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  }

  if (kind === 'notFound') {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileOff className="size-6" />
          </EmptyMedia>
          <EmptyDescription>{t("consoleProject.files.previewNotFound")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (kind === 'directory') {
    return (
      <DirectoryListing
        entry={entry}
        projectId={projectId}
        branch={branch}
        submodules={submodules}
        onSubmoduleOpen={onSubmoduleOpen}
        onSelect={onSelect}
      />
    )
  }

  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/25 p-4">
        {imageError ? (
          <Empty className="opacity-70">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconPhoto className="size-6" />
              </EmptyMedia>
              <EmptyDescription>{t("consoleProject.files.imageLoadFailed")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <img
            src={imageUrl}
            alt={entry?.name}
            className="max-h-[68vh] max-w-full object-contain"
            onError={onImageError}
          />
        )}
      </div>
    )
  }

  if (kind === 'binary' || kind === 'tooLarge') {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFile className="size-6" />
          </EmptyMedia>
          <EmptyDescription>
            {kind === 'binary'
              ? t("consoleProject.files.binaryUnsupported")
              : t("consoleProject.files.tooLargeNoPreview")}
          </EmptyDescription>
          {entry && typeof entry.size === 'number' && (
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
      height="100%"
      readOnly={true}
      value={content}
      showPrintMargin={false}
      showGutter={true}
      setOptions={{
        fontFamily: "var(--font-code)",
        fontSize: 12,
      }}
    />
  )
}

interface DirectoryListingProps {
  entry: TreeEntry | null
  projectId?: string
  branch?: string
  submodules?: Map<string, SubmoduleInfo>
  onSubmoduleOpen?: (info: SubmoduleInfo) => void
  onSelect: (entry: TreeEntry) => void
}

/** One level of a directory, with TreeNode handling deeper lazy expansion. */
function DirectoryListing({ entry, projectId, branch, submodules, onSubmoduleOpen, onSelect }: DirectoryListingProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId || !entry) return
    let active = true
    setLoading(true)
    void apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: entry.path || "",
      ref: branch || undefined,
    }, [projectId], (resp) => {
      if (!active) return
      setEntries(resp.code === 0 ? sortEntries(resp.data || []) : [])
      setLoading(false)
    }, () => {
      if (!active) return
      setEntries([])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [projectId, entry, branch])

  if (loading) {
    return (
      <Empty className="opacity-50 h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLoader className="animate-spin" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  }

  if (entries.length === 0) {
    return (
      <Empty className="opacity-50 h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFile />
          </EmptyMedia>
          <EmptyDescription>{t("consoleProject.files.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="p-1">
      {entries.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          projectId={projectId || ""}
          depth={0}
          branch={branch}
          onFileSelect={onSelect}
          submodules={submodules}
          onSubmoduleOpen={onSubmoduleOpen}
        />
      ))}
    </div>
  )
}

export default RepoEntryPreviewDialog
