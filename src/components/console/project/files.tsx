import { useState, useCallback, useRef, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { type DomainProject, type DomainBranch } from "@/api/Api"
import { cn } from "@/lib/utils"
import { IconFolder, IconFolderOpen, IconLoader, IconExternalLink } from "@tabler/icons-react"
import { Label } from "@/components/ui/label"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "react-i18next"
import {
  TreeNode,
  type TreeEntry,
  sortEntries,
} from "./repo-tree"
import { RepoEntryPreviewDialog } from "./repo-entry-preview"

interface ProjectFileManagerProps {
  project?: DomainProject
  onFileSelect?: (entry: TreeEntry) => void
  onLoaded?: () => void
  className?: string
}

export const ProjectFileManager = ({ project, onFileSelect, onLoaded, className }: ProjectFileManagerProps) => {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState<DomainBranch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [branchResolved, setBranchResolved] = useState(false)
  const [branchProjectId, setBranchProjectId] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<TreeEntry | null>(null)
  const projectIdRef = useRef(project?.id)
  projectIdRef.current = project?.id

  const handleFileClick = useCallback((entry: TreeEntry) => {
    setSelectedFile(entry)
    setDialogOpen(true)
    if (onFileSelect) {
      onFileSelect(entry)
    }
  }, [onFileSelect])
  const selectedBranchRef = useRef(selectedBranch)
  selectedBranchRef.current = selectedBranch
  const isMountedRef = useRef(true)

  const fetchRootEntries = useCallback(async () => {
    if (!project?.id) {
      setEntries([])
      setLoading(false)
      return
    }
    if (!branchResolved) return
    if (branchProjectId !== project.id) return

    const requestedProjectId = project.id
    const requestedBranch = selectedBranch
    setLoading(true)
    await apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: '',
      ref: selectedBranch || undefined
    }, [project?.id], (resp) => {
      if (!isMountedRef.current || projectIdRef.current !== requestedProjectId) return
      if (selectedBranchRef.current !== requestedBranch) return
      if (resp.code === 0) {
        setEntries(sortEntries(resp.data || []))
      } else {
        setEntries([])
      }
    })
    if (!isMountedRef.current || projectIdRef.current !== requestedProjectId) return
    if (selectedBranchRef.current !== requestedBranch) return
    setLoading(false)
    onLoaded?.()
  }, [project?.id, onLoaded, selectedBranch, branchProjectId, branchResolved])

  useEffect(() => {
    const fetchBranches = async () => {
      if (!project?.id || !project?.git_identity_id || !project?.full_name) {
        setBranches([])
        setSelectedBranch('')
        setBranchProjectId(project?.id || '')
        setBranchResolved(true)
        return
      }

      const requestedProjectId = project.id
      const encodedRepoName = encodeURIComponent(project.full_name)
      setBranches([])
      setSelectedBranch('')
      setEntries([])
      setLoading(true)
      setBranchProjectId('')
      setBranchResolved(false)

      await apiRequest('v1UsersGitIdentitiesBranchesDetail', {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (resp.code === 0 && resp.data) {
          setBranches(resp.data)
          if (resp.data.length > 0) {
            const branchNames = resp.data.map((b: DomainBranch) => b.name || '').filter(Boolean)
            let defaultBranch = ''
            if (branchNames.includes('main')) {
              defaultBranch = 'main'
            } else if (branchNames.includes('master')) {
              defaultBranch = 'master'
            } else {
              defaultBranch = branchNames.sort()[0] || ''
            }
            setSelectedBranch(defaultBranch)
          }
        }
        setBranchProjectId(requestedProjectId)
        setBranchResolved(true)
      }, () => {
        if (projectIdRef.current !== requestedProjectId) return
        setBranchProjectId(requestedProjectId)
        setBranchResolved(true)
      })
    }

    fetchBranches()
  }, [project?.id, project?.git_identity_id, project?.full_name])

  useEffect(() => {
    isMountedRef.current = true
    fetchRootEntries()
    return () => {
      isMountedRef.current = false
    }
  }, [project?.id, fetchRootEntries])

  const Header = (
    <div className="px-4 py-2 flex items-center justify-between border-b bg-muted/50">
      <div className="flex items-center gap-2">
        <Label className="flex items-center">
          <IconFolderOpen className="size-4" />
          {t("consoleProject.files.title")}
        </Label>
        {branches.length > 0 && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[140px] text-xs" style={{ height: '28px' }}>
              <SelectValue placeholder={t("consoleProject.files.selectBranch")} />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name || ''} className="text-xs">
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 cursor-pointer"
        disabled={!project?.repo_url}
        onClick={() => project?.repo_url && window.open(project.repo_url, '_blank')}
      >
        <IconExternalLink className="size-4" />
        {t("consoleProject.files.openRepository")}
      </Button>
    </div>
  )

  if (!project?.id) {
    return null
  }

  if (loading) {
    return (
      <div className={cn("flex flex-col border rounded-md", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>{t("consoleProject.common.loading")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className={cn("flex flex-col border rounded-md", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>{t("consoleProject.files.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col border rounded-md", className)}>
      {Header}
      <div className="flex-1">
        <div className="p-1">
          {entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              projectId={project?.id || ''}
              depth={0}
              branch={selectedBranch}
              onFileClick={handleFileClick}
            />
          ))}
        </div>
      </div>
      <RepoEntryPreviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={project?.id || ''}
        entry={selectedFile}
        branch={selectedBranch}
      />
    </div>
  )
}

export default ProjectFileManager
