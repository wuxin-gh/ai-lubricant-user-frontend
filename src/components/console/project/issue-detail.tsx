import { ConstsProjectIssuePriority, type DomainProjectIssue, type DomainProjectIssueComment } from "@/api/Api"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiRequest } from "@/utils/requestUtils"
import { IconCircleChevronDown, IconCircleChevronsUp, IconCircleChevronUp, IconLoader, IconBug, IconSparkles, IconX } from "@tabler/icons-react"
import dayjs from "dayjs"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import MarkdownEditor from "@/components/common/markdown-editor"
import { Input } from "@/components/ui/input"
import IssueMenu from "./issue-menu"
import { Markdown } from "@/components/common/markdown"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"
import { issueStatusMeta, issueTypeLabel, statusOptionsForType, isPendingConfirmation } from "./issue-meta"

/**
 * 生成的契约还没声明 tags（后端 mc_project_issues.tags 是新增列，swagger 未回灌）。
 * 与 manager/projects.tsx 的 editor_count 同款处理：本地扩展，不改生成文件。
 */
type IssueWithTags = DomainProjectIssue & { tags?: string[] }

interface ViewIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: DomainProjectIssue
  projectId: string
  onSuccess?: () => void
  onTaskCreated?: () => void
}

export default function ViewIssueDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  onSuccess,
  onTaskCreated,
}: ViewIssueDialogProps) {
  const [loading, setLoading] = useState(false)
  const [issueData, setIssueData] = useState<IssueWithTags | undefined>(issue)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitle, setEditingTitle] = useState("")
  const [isEditingRequirementDocument, setIsEditingRequirementDocument] = useState(false)
  const [editingRequirementDocument, setEditingRequirementDocument] = useState("")
  const [isEditingDesignDocument, setIsEditingDesignDocument] = useState(false)
  const [editingDesignDocument, setEditingDesignDocument] = useState("")
  // 标签：后端存 mc_project_issues.tags(JSONB 自由字符串列表)，这里就地增删并 PUT 回。
  const [tagDraft, setTagDraft] = useState("")
  // 评论：后端 API 早就有（list/create），此前前端未接。树形结构，这里只渲染一层回复。
  const [comments, setComments] = useState<DomainProjectIssueComment[]>([])
  const [commentDraft, setCommentDraft] = useState("")
  const [commentLoading, setCommentLoading] = useState(false)
  const { t } = useTranslation()

  const getIssueStatusName = (status?: string) => issueStatusMeta(status).label

  const tags = (issueData?.tags || []) as string[]

  const fetchComments = useCallback(async () => {
    if (!projectId || !issueData?.id) return
    await apiRequest("v1UsersProjectsIssuesCommentsDetail", {}, [projectId, issueData.id], (resp) => {
      if (resp.code === 0) setComments(resp.data?.comments || [])
    })
  }, [projectId, issueData?.id])

  useEffect(() => {
    if (!open) {
      setIsEditingTitle(false)
      setEditingTitle("")
      setIsEditingRequirementDocument(false)
      setEditingRequirementDocument("")
      setIsEditingDesignDocument(false)
      setEditingDesignDocument("")
      setTagDraft("")
      setCommentDraft("")
      setComments([])
      return
    }
    void fetchComments()
  }, [open, fetchComments])

  /** 标签增删都走 update_issue 的 tags 字段整体覆盖。 */
  const saveTags = async (next: string[]) => {
    if (!issueData?.id) return
    setLoading(true)
    await apiRequest("v1UsersProjectsIssuesUpdate", { tags: next }, [projectId, issueData.id], (resp) => {
      if (resp.code === 0) {
        setIssueData((prev) => (prev ? { ...prev, tags: next } : prev))
        onSuccess?.()
      } else {
        toast.error(resp.message || "保存标签失败")
      }
    })
    setLoading(false)
  }

  const addTag = () => {
    const value = tagDraft.trim()
    setTagDraft("")
    if (!value || tags.includes(value)) return
    void saveTags([...tags, value])
  }

  const removeTag = (value: string) => {
    void saveTags(tags.filter((item) => item !== value))
  }

  const submitComment = async () => {
    const text = commentDraft.trim()
    if (!text || !issueData?.id) return
    setCommentLoading(true)
    await apiRequest(
      "v1UsersProjectsIssuesCommentsCreate",
      { comment: text },
      [projectId, issueData.id],
      (resp) => {
        if (resp.code === 0) {
          setCommentDraft("")
          void fetchComments()
        } else {
          toast.error(resp.message || "评论失败")
        }
      },
    )
    setCommentLoading(false)
  }

  useEffect(() => {
    if (issue) {
      setIssueData(issue)
      setIsEditingTitle(false)
    }
  }, [issue])

  const handleTitleClick = () => {
    setEditingTitle(issueData?.title || "")
    setIsEditingTitle(true)
  }

  const handleTitleSave = async () => {
    if (!issueData?.id || loading) return
    
    const newTitle = editingTitle.trim()
    if (!newTitle || newTitle === issueData.title) {
      setIsEditingTitle(false)
      return
    }

    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { title: newTitle }, [projectId, issueData.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issue.detail.toast.titleUpdated"))
        setIssueData({ ...issueData, title: newTitle })
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
      }
    })
    setLoading(false)
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTitleSave()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }


  const saveIssueData = async () => {
    if (!issueData?.id || loading) return

    if (editingRequirementDocument) {
      issueData.requirement_document = editingRequirementDocument
    }
    if (editingDesignDocument) {
      issueData.design_document = editingDesignDocument
    }
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', issueData, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        setIsEditingRequirementDocument(false)
        setEditingRequirementDocument("")
        setIsEditingDesignDocument(false)
        setEditingDesignDocument("")
        toast.success(t("consoleProject.issue.detail.toast.saved"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.saveFailed"))
      }
    })
    setLoading(false)
  }

  const handleStatusChange = async (status: string) => {
    if (!issueData?.id || loading) return

    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { status }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issue.detail.toast.statusUpdated"))
        setIssueData({ ...issueData, status })
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
      }
    })
    setLoading(false)
  }

  const handleConfirm = async (approve: boolean) => {
    if (!issueData?.id || loading) return
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesConfirm', { approve }, [projectId, issueData.id], (resp) => {
      if (resp.code === 0) {
        toast.success(approve ? "已确认" : "已退回修改")
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
      }
    })
    setLoading(false)
  }

  const handlePriorityChange = async (priority: ConstsProjectIssuePriority) => {
    if (!issueData?.id || loading) return
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { priority }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issue.detail.toast.priorityUpdated"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
      }
    })
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[80vw] max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <Badge variant={issueData?.type === "bug" ? "destructive" : "outline"}>
              {issueData?.type === "bug" ? <IconBug /> : <IconSparkles />}
              {issueTypeLabel(issueData?.type)}
            </Badge>
            <Badge variant="secondary">{getIssueStatusName(issueData?.status)}</Badge>
            {!isEditingTitle && (
              <Button variant="outline" size="sm" className="ml-auto h-7" onClick={handleTitleClick}>
                {t("consoleProject.issue.detail.edit")}
              </Button>
            )}
          </div>
          <DialogTitle className="text-xl break-all pr-6">
            {isEditingTitle ? (
              <Input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                className="text-xl"
                disabled={loading}
              />
            ) : (
              <span
                onClick={handleTitleClick}
                className="cursor-pointer hover:bg-muted py-1 -my-1 rounded transition-colors"
              >
                {issueData?.title || t("consoleProject.issue.untitled")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-row gap-6 max-h-[calc(90vh-120px)]">
          <div className="flex flex-col gap-6 flex-4 overflow-x-auto p-1 -m-1">
            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">{issueData?.type === "bug" ? "问题描述 / 复现方式" : t("consoleProject.issue.detail.requirement")}</Label>
                {isEditingRequirementDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                      setIsEditingRequirementDocument(false) 
                      setEditingRequirementDocument("")
                    }}>{t("consoleProject.common.cancel")}</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>{t("consoleProject.common.save")}</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                    setEditingRequirementDocument(issueData?.requirement_document || ""); 
                    setIsEditingRequirementDocument(true) 
                  }}>{t("consoleProject.issue.detail.edit")}</Button>
                )}
              </div>
              {isEditingRequirementDocument ? (
                <div className="min-h-100">
                  <MarkdownEditor 
                    value={editingRequirementDocument} 
                    onChange={(value) => { 
                      setEditingRequirementDocument(value)
                    }} />
                </div>
              ) : (
                <div className="border rounded-md p-2 min-h-10 bg-muted/40">
                  <Markdown>{issueData?.requirement_document || t("consoleProject.issue.detail.emptyContent")}</Markdown>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">{t("consoleProject.issue.detail.design")}</Label>
                {isEditingDesignDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => {
                      setIsEditingDesignDocument(false)
                      setEditingDesignDocument("")
                    }}>{t("consoleProject.common.cancel")}</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>{t("consoleProject.common.save")}</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => {
                    setEditingDesignDocument(issueData?.design_document || "");
                    setIsEditingDesignDocument(true)
                  }}>{t("consoleProject.issue.detail.edit")}</Button>
                )}
              </div>
              {isEditingDesignDocument ? (
                <div className="min-h-100">
                  <MarkdownEditor
                    value={editingDesignDocument}
                    onChange={(value) => {
                      setEditingDesignDocument(value)
                    }} />
                </div>
              ) : (
                <div className="border rounded-md p-2 min-h-10 bg-muted/40">
                  <Markdown>{issueData?.design_document || t("consoleProject.issue.detail.emptyContent")}</Markdown>
                </div>
              )}
            </div>

            {isPendingConfirmation(issueData?.status) && (
              <div className="flex flex-row gap-2">
                <Button variant="outline" size="sm" className="flex-1" disabled={loading} onClick={() => handleConfirm(false)}>
                  退回修改
                </Button>
                <Button variant="default" size="sm" className="flex-1" disabled={loading} onClick={() => handleConfirm(true)}>
                  确认通过
                </Button>
              </div>
            )}

            {issueData?.type === "bug" && issueData.bug_reason && (
              <div className="flex flex-col gap-2">
                <Label>Bug 根因</Label>
                <div className="border rounded-md p-2 min-h-10 bg-muted/40 text-sm">
                  <Markdown>{issueData.bug_reason}</Markdown>
                </div>
              </div>
            )}

            {issueData?.resolution_note && (
              <div className="flex flex-col gap-2">
                <Label>完成说明</Label>
                <div className="border rounded-md p-2 min-h-10 bg-muted/40 text-sm">
                  <Markdown>{issueData.resolution_note}</Markdown>
                </div>
              </div>
            )}

            {issueData?.pending_items && issueData.pending_items.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label>待确认项</Label>
                <div className="flex flex-col gap-1">
                  {issueData.pending_items.map((item, i) => (
                    <div key={item.id || i} className="flex flex-row gap-2 items-start text-sm border rounded px-2 py-1">
                      <span className={item.status === "resolved" ? "line-through text-muted-foreground flex-1" : "flex-1"}>{item.content}</span>
                      <Badge variant={item.status === "resolved" ? "secondary" : "outline"} className="text-xs shrink-0">
                        {item.status === "resolved" ? "已解决" : "待确认"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-2">
            <div className="flex flex-col gap-2">
              <Label>{t("consoleProject.issue.detail.status")}</Label>
              <Select value={issueData?.status} onValueChange={handleStatusChange} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder={t("consoleProject.issue.detail.selectStatus")} />}
                </SelectTrigger>
                <SelectContent>
                  {statusOptionsForType(issueData?.type).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("consoleProject.issue.detail.priority")}</Label>
              <Select value={issueData?.priority?.toString()} onValueChange={(value) => { handlePriorityChange(parseInt(value, 10) as ConstsProjectIssuePriority)}} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder={t("consoleProject.issue.detail.selectPriority")} />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityThree.toString()}>
                    <IconCircleChevronsUp className="text-primary" />
                    {t("consoleProject.issue.priority.highShort")}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityTwo.toString()}>
                    <IconCircleChevronUp className="text-primary" />
                    {t("consoleProject.issue.priority.mediumShort")}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityOne.toString()}>
                    <IconCircleChevronDown />
                    {t("consoleProject.issue.priority.lowShort")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>标签</Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        disabled={loading}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <IconX className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
                placeholder="输入后回车添加"
                disabled={loading}
                className="h-8 text-sm"
              />
            </div>

            <div className="flex flex-col gap-3 text-sm">
              <Label>{t("consoleProject.issue.detail.creator")}</Label>
              <div className="flex flex-row gap-2 items-center">
                <UserAvatar className="size-5" user={issueData?.user} alt={issueData?.user?.name || undefined} />
                <span>{issueData?.user?.name || t("consoleProject.issue.detail.unknownUser")}</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-3 text-sm">
              <Label>{t("consoleProject.issue.detail.createdTime")}</Label>
              <span>{issueData?.created_at ? dayjs(issueData?.created_at * 1000).format("YYYY-MM-DD HH:mm") : "-"}</span>
            </div>

            <div className="flex flex-row gap-2 border rounded-md px-2 py-1 bg-muted/30">
              <Label className="flex-1">{t("consoleProject.issue.detail.moreActions")}</Label>
              <IssueMenu issue={issueData} projectId={projectId} onTaskCreated={onTaskCreated} />
            </div>

          </div>
        </div>

        {/* 评论区：API 早就有（list/create），此前未接。跨项目 IDOR 已在后端堵住。 */}
        <div className="flex flex-col gap-2 border-t pt-3 shrink-0">
          <Label>评论</Label>
          {comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无评论</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2 text-sm">
                  <UserAvatar className="size-5 shrink-0" user={c.creator} alt={c.creator?.name || undefined} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.creator?.name || "未知"}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.created_at ? dayjs(c.created_at * 1000).format("MM-DD HH:mm") : ""}
                      </span>
                    </div>
                    <div className="text-muted-foreground whitespace-pre-wrap break-words">{c.comment}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void submitComment()
                }
              }}
              placeholder="写评论，回车发送"
              disabled={commentLoading}
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={submitComment} disabled={commentLoading || !commentDraft.trim()}>
              {commentLoading && <IconLoader className="size-4 animate-spin" />}
              发送
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
