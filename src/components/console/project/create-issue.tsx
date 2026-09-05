import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader, IconX } from "@tabler/icons-react"
import MarkdownEditor from "@/components/common/markdown-editor"

interface CreateIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onSuccess?: () => void
}

type IssueType = "requirement" | "bug"

/** 可指派的成员（团队内）。后端 /teams/users/all 已按团队收窄。 */
interface MemberOption {
  id: string
  name: string
}

export default function CreateIssueDialog({ open, onOpenChange, projectId, onSuccess }: CreateIssueDialogProps) {
  const [type, setType] = useState<IssueType>("requirement")
  const [priority, setPriority] = useState("2")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [loading, setLoading] = useState(false)
  // 分配者是必填项：后端 create_issue 要求 assignee_id，否则非 owner 看不见这条需求。
  const [assigneeId, setAssigneeId] = useState("")
  const [members, setMembers] = useState<MemberOption[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")

  useEffect(() => {
    if (!open) {
      setType("requirement")
      setPriority("2")
      setTitle("")
      setBody("")
      setAssigneeId("")
      setTags([])
      setTagDraft("")
      return
    }
    // 打开时拉一次团队成员，用于分配者下拉。
    void apiRequest("v1TeamsUsersAllList", {}, [], (resp) => {
      if (resp.code !== 0) return
      const rows = (resp.data?.users || []) as Array<{ user?: { id?: string; name?: string; email?: string } }>
      setMembers(
        rows
          .map((row) => ({
            id: row.user?.id || "",
            name: row.user?.name || row.user?.email || "未命名",
          }))
          .filter((m) => m.id),
      )
    })
  }, [open])

  const addTag = () => {
    const value = tagDraft.trim()
    if (!value || tags.includes(value)) {
      setTagDraft("")
      return
    }
    setTags((prev) => [...prev, value])
    setTagDraft("")
  }

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("请输入标题")
      return
    }
    if (!assigneeId) {
      toast.error("请选择分配者")
      return
    }
    if (!body.trim()) {
      toast.error(type === "bug" ? "请描述问题现象和复现方式" : "请输入需求描述")
      return
    }
    setLoading(true)
    await apiRequest("v1UsersProjectsIssuesCreate", {
      type,
      title: title.trim(),
      requirement_document: body.trim(),
      priority: Number(priority),
      assignee_id: assigneeId,
      tags,
    }, [projectId], (resp) => {
      if (resp.code === 0) {
        toast.success(type === "bug" ? "bug 已创建" : "需求已创建")
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(resp.message || "创建失败")
      }
    })
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[92vw] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0"><DialogTitle>添加需求或 bug</DialogTitle></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as IssueType)} disabled={loading}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="requirement">需求</SelectItem>
                  <SelectItem value="bug">bug</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>优先级</Label>
              <Select value={priority} onValueChange={setPriority} disabled={loading}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">高</SelectItem>
                  <SelectItem value="2">中</SelectItem>
                  <SelectItem value="1">低</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>分配者</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={members.length ? "选择分配者" : "无可选成员"} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              只有分配者本人与项目负责人能看到这条需求。
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="issue-title">标题</Label>
            <Input id="issue-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={type === "bug" ? "简述问题" : "简述需求"} disabled={loading} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="issue-tags">标签</Label>
            <Input
              id="issue-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
              placeholder="输入标签后回车添加，可选"
              disabled={loading}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                      disabled={loading}
                      aria-label={`移除标签 ${tag}`}
                    >
                      <IconX className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label>{type === "bug" ? "问题描述 / 复现方式" : "需求描述"}</Label>
            <MarkdownEditor value={body} onChange={setBody} disabled={loading} className="min-h-96 max-h-[58vh]" />
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>取消</Button>
          <Button onClick={handleSave} disabled={loading || !title.trim() || !body.trim() || !assigneeId}>
            {loading && <IconLoader className="size-4 animate-spin" />}创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
