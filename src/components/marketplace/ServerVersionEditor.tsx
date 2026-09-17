import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { getServerReleaseTags, type ServerVersionManifest } from "@/api/marketplaceAdmin"
import { getProxies, type ProxyEntry } from "@/@admin-port/api/proxyPool"
import { RefreshCw } from "lucide-react"

/** 默认发行仓库：与 publish_github.sh 的 GH_BASE 一致（部署机 .env 可覆盖）。 */
const DEFAULT_REPO_URL = "https://github.com/wuxin-gh/ai-lubricant"

/**
 * 服务端版本登记弹框。
 *
 * 与另三条发行线（节点/移动端/设备控制）的差异：**没有文件要上传**。服务端的
 * 一版就是一个 git tag——部署机 clone 该 tag 即得全套代码（前端 dist 已随库
 * 发布，见 publish_github.sh 第 0.5 步）。所以这里只需要选 tag + 写备注。
 *
 * **登记即门槛**：publish 只把 tag 推上 GitHub 当源料，登记了用户才看得见，
 * 升级再要一次显式确认（升级入口在列表页的升级卡片，不在本弹框）。
 */
export function ServerVersionEditor({ open, onOpenChange, item, onSave }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  item: ServerVersionManifest | null
  onSave: (manifest: ServerVersionManifest) => Promise<void>
}) {
  const [releaseTag, setReleaseTag] = useState("")
  const [version, setVersion] = useState("")
  const [versionNotes, setVersionNotes] = useState("")
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO_URL)
  const [status, setStatus] = useState("published")
  const [tags, setTags] = useState<string[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [tagError, setTagError] = useState("")
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [proxyId, setProxyId] = useState("")
  const [saving, setSaving] = useState(false)

  // 打开时初始化：编辑态回填，新建态清空 + 拉 tag 列表
  useEffect(() => {
    if (!open) return
    if (item) {
      setReleaseTag(String(item.release_tag || ""))
      setVersion(String(item.version || ""))
      setVersionNotes(String(item.version_notes || ""))
      setRepoUrl(String(item.repo_url || DEFAULT_REPO_URL))
      setStatus(String(item.status || "published"))
    } else {
      setReleaseTag("")
      setVersion("")
      setVersionNotes("")
      setRepoUrl(DEFAULT_REPO_URL)
      setStatus("published")
    }
    setTagError("")
    void loadProxies()
    void loadTags()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])

  async function loadProxies() {
    try {
      const list = await getProxies()
      setProxies(list || [])
    } catch {
      setProxies([])
    }
  }

  async function loadTags(pid?: string) {
    setLoadingTags(true)
    setTagError("")
    try {
      const res = await getServerReleaseTags(pid ?? proxyId)
      setTags(res?.tags || [])
      if (res?.error) setTagError(res.error)
    } catch (err) {
      setTags([])
      setTagError(String(err))
    } finally {
      setLoadingTags(false)
    }
  }

  // 选 tag 时同步带出版本号（tag 即版本；部署机 updater 也按 tag 翻指针）
  function pickTag(tag: string) {
    setReleaseTag(tag)
    if (!version) setVersion(tag)
  }

  async function submit() {
    if (!releaseTag.trim()) {
      toast.error("请选择或填写版本标签")
      return
    }
    if (!versionNotes.trim()) {
      toast.error("请填写版本说明")
      return
    }
    setSaving(true)
    try {
      const manifest: ServerVersionManifest = {
        id: `server-suite-${releaseTag.trim()}`,
        kind: "server_app_version",
        schema: "ai-lubricant.server-version/v1",
        name: "server",
        display_name: `服务端 ${releaseTag.trim()}`,
        version: (version || releaseTag).trim(),
        status,
        version_notes: versionNotes.trim(),
        release_tag: releaseTag.trim(),
        repo_url: repoUrl.trim(),
      }
      await onSave(manifest)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "编辑服务端版本" : "登记服务端版本"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>版本标签（git tag）</Label>
              <Button
                type="button" size="sm" variant="ghost"
                onClick={() => void loadTags()}
                disabled={loadingTags}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loadingTags ? "animate-spin" : ""}`} />
                刷新标签
              </Button>
            </div>
            {tags.length > 0 ? (
              <NativeSelect value={releaseTag} onChange={(e) => pickTag(e.target.value)}>
                <NativeSelectOption value="">选择要登记的版本标签</NativeSelectOption>
                {tags.map((t) => (
                  <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input
                placeholder="v260912"
                value={releaseTag}
                onChange={(e) => setReleaseTag(e.target.value)}
              />
            )}
            {tagError && <p className="text-xs text-destructive">拉取标签失败：{tagError}</p>}
            <p className="text-xs text-muted-foreground">
              升级时部署机会 checkout 这个标签。标签来自发行仓库，可点「刷新标签」重拉。
            </p>
          </div>

          <div className="space-y-2">
            <Label>版本号</Label>
            <Input
              placeholder="留空则同标签"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>版本说明</Label>
            <Textarea
              rows={3}
              placeholder="本次发布包含哪些改动"
              value={versionNotes}
              onChange={(e) => setVersionNotes(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>发行仓库</Label>
            <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>状态</Label>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
              <NativeSelectOption value="published">发布（用户可见，可升级）</NativeSelectOption>
              <NativeSelectOption value="draft">草稿（不推送给用户）</NativeSelectOption>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              草稿只入库不推送——升级卡片不会推荐它。
            </p>
          </div>

          {proxies.length > 0 && (
            <div className="space-y-2">
              <Label>拉取标签所用代理</Label>
              <NativeSelect value={proxyId} onChange={(e) => { setProxyId(e.target.value); void loadTags(e.target.value) }}>
                <NativeSelectOption value="">直连</NativeSelectOption>
                {proxies.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>{p.name || p.id}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "保存中…" : item ? "保存" : "登记版本"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
