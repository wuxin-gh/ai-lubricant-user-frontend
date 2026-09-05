import { useCallback, useEffect, useState } from "react"
import { Markdown } from "@/components/common/markdown"
import { RepoEntryPreviewDialog } from "@/components/console/project/repo-entry-preview"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { IconFileText, IconLoader, IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import type { ProjectReadmeState } from "./use-project-readme"

interface ProjectReadmeProps {
  readme: ProjectReadmeState
  /** 仓库地址，给卡片标题区右侧的「访问原仓库」按钮用，与目录页同款。 */
  repoUrl?: string
}

export default function ProjectReadme({ readme, repoUrl }: ProjectReadmeProps) {
  const { t } = useTranslation()
  const [document, setDocument] = useState({ content: readme.content, path: readme.path })
  const [loadingDocument, setLoadingDocument] = useState(false)
  // Non-Markdown repository links open in the shared entry preview instead of
  // replacing this panel: a directory / image / source file is not Markdown.
  const [previewPath, setPreviewPath] = useState("")

  useEffect(() => {
    setDocument({ content: readme.content, path: readme.path })
  }, [readme.content, readme.path])

  const openRepositoryDocument = useCallback((path: string) => {
    if (!readme.projectId) return
    setLoadingDocument(true)
    apiRequest(
      "v1UsersProjectsTreeBlobDetail",
      { path, ref: readme.ref || undefined },
      [readme.projectId],
      (resp) => {
        if (resp.code === 0 && resp.data?.content) {
          setDocument({ content: b64decode(resp.data.content), path })
        } else {
          toast.error(resp.message || t("projectOverview.readme.openFailed"))
        }
        setLoadingDocument(false)
      },
      () => {
        toast.error(t("projectOverview.readme.openFailed"))
        setLoadingDocument(false)
      },
    )
  }, [readme.projectId, readme.ref, t])

  const handleRepositoryLink = useCallback((path: string) => {
    if (!path) return
    if (/\.(?:md|markdown)$/i.test(path)) {
      openRepositoryDocument(path)
    } else {
      setPreviewPath(path)
    }
  }, [openRepositoryDocument])

  const header = (
    <div className="px-4 py-2 flex items-center justify-between border-b bg-muted/50">
      <Label className="flex items-center h-6">
        <IconFileText className="size-4" />
        {document.path || readme.path || "README"}
        {loadingDocument ? <IconLoader className="ml-2 size-4 animate-spin" /> : null}
      </Label>
      {/* 与目录页 header 同款：标题居左，「访问原仓库」按钮居右。 */}
      {repoUrl && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer"
          onClick={() => window.open(repoUrl, '_blank')}
        >
          <IconExternalLink className="size-4" />
          {t("consoleProject.files.openRepository")}
        </Button>
      )}
    </div>
  )

  if (!readme.loaded) {
    return (
      <div className="flex flex-col border rounded-md w-full max-w-full">
        {header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>{t("projectOverview.readme.loading")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!document.content) {
    return (
      <div className="flex flex-col border rounded-md w-full max-w-full">
        {header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileText />
            </EmptyMedia>
            <EmptyDescription>{t("projectOverview.readme.noDocs")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col border rounded-md w-full max-w-full">
      {header}
      <div className="p-4">
        <Markdown
          allowHtml
          imageBaseUrl={readme.imageBaseUrl}
          linkBaseUrl={readme.linkBaseUrl}
          sourcePath={document.path}
          onRepositoryLink={handleRepositoryLink}
        >
          {document.content}
        </Markdown>
      </div>

      <RepoEntryPreviewDialog
        projectId={readme.projectId}
        branch={readme.ref}
        open={!!previewPath}
        onOpenChange={(open) => { if (!open) setPreviewPath("") }}
        path={previewPath}
      />
    </div>
  )
}
