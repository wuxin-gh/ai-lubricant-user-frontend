/**
 * 社区运营配置面板（市场管理 → 配置 → 社区运营）。
 *
 * 两段：技术交流群（群类型下拉 + 群名 + 二维码上传）与社区通知（开关 + 文本/图片
 * 混排条目）。图片走 Channels.tsx loadIconFile 同款管线：2MB 上限、512px 最大边、
 * canvas→WebP（失败回退 PNG），最终以 data URL 存 DB 的 community key。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Save, Trash2, ArrowUp, ArrowDown, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  getCommunityConfig,
  updateCommunityConfig,
  type CommunityGroup,
  type CommunityNoticeEntry,
} from "@/@admin-port/api/globalConfig"
import { toast } from "sonner"

const GROUP_TYPE_OPTIONS = [
  { value: "wechat", label: "微信" },
  { value: "feishu", label: "飞书" },
  { value: "dingtalk", label: "钉钉" },
  { value: "qq", label: "QQ" },
  { value: "other", label: "其他" },
] as const

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_EDGE = 512

/** 把图片文件压缩成 data URL（与 Channels.tsx loadIconFile 同款口径）。 */
function readImageDataUrl(file: File | undefined, apply: (url: string) => void) {
  if (!file) return
  if (!file.type.startsWith("image/")) {
    toast.error("图片文件必须是图片")
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("图片文件不能超过 2MB")
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const src = typeof reader.result === "string" ? reader.result : ""
    if (!src.startsWith("data:image/")) {
      toast.error("图片读取失败")
      return
    }
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
        const scale = Math.min(MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height)
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
      }
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        apply(src)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      try {
        const webp = canvas.toDataURL("image/webp", 0.9)
        apply(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png"))
      } catch {
        // SVG 等可能触发 canvas 污染，回退原图 data URL。
        apply(src)
      }
    }
    img.onerror = () => toast.error("图片解码失败")
    img.src = src
  }
  reader.onerror = () => toast.error("图片读取失败")
  reader.readAsDataURL(file)
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())
}

function emptyGroup(): CommunityGroup {
  return { id: newId(), type: "wechat", label: "", qr_image: "" }
}

function emptyEntry(): CommunityNoticeEntry {
  return { id: newId(), kind: "text", text: "" }
}

export function CommunityConfigPanel({ onSaved }: { onSaved?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groups, setGroups] = useState<CommunityGroup[]>([])
  const [noticeEnabled, setNoticeEnabled] = useState(false)
  const [entries, setEntries] = useState<CommunityNoticeEntry[]>([])

  // 单个隐藏 file input 复用：先记录「本次上传目标」，再触发选择。
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<{ kind: "group" | "entry"; index: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const config = await getCommunityConfig()
      setGroups(config.groups)
      setNoticeEnabled(config.notice.enabled)
      setEntries(config.notice.entries)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载配置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await updateCommunityConfig({ groups, notice: { enabled: noticeEnabled, entries } })
      toast.success("社区运营配置已保存")
      await load()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const patchGroup = (index: number, patch: Partial<CommunityGroup>) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  }

  const patchEntry = (index: number, patch: Partial<CommunityNoticeEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  const move = <T,>(list: T[], index: number, dir: -1 | 1): T[] => {
    const j = index + dir
    if (j < 0 || j >= list.length) return list
    const next = [...list]
    ;[next[index], next[j]] = [next[j], next[index]]
    return next
  }

  const pickImage = (kind: "group" | "entry", index: number) => {
    uploadTargetRef.current = { kind, index }
    fileInputRef.current?.click()
  }

  const onFileChosen = (file: File | undefined) => {
    const target = uploadTargetRef.current
    uploadTargetRef.current = null
    if (!file || !target) return
    readImageDataUrl(file, (url) => {
      if (target.kind === "group") patchGroup(target.index, { qr_image: url })
      else patchEntry(target.index, { image: url, kind: "image" })
    })
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">技术交流群</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              尚未配置任何群。点击「添加群」上传群二维码。
            </div>
          ) : (
            groups.map((group, index) => (
              <div key={group.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28">
                    <Label>群类型</Label>
                    <NativeSelect
                      className="mt-1 w-full"
                      value={group.type}
                      onChange={(e) => patchGroup(index, { type: e.target.value })}
                    >
                      {GROUP_TYPE_OPTIONS.map((o) => (
                        <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="min-w-40 flex-1">
                    <Label>群名称（留空则按群类型显示）</Label>
                    <Input
                      className="mt-1"
                      value={group.label}
                      placeholder="如：微信群①"
                      onChange={(e) => patchGroup(index, { label: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => pickImage("group", index)}
                  >
                    <Upload className="mr-1 h-4 w-4" />{group.qr_image ? "更换二维码" : "上传二维码"}
                  </Button>
                </div>
                {group.qr_image ? (
                  <div className="mt-3 flex items-start gap-3">
                    <img src={group.qr_image} alt="群二维码预览" className="size-24 rounded-md border object-contain" />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => patchGroup(index, { qr_image: "" })}
                    >
                      移除图片
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">未上传二维码——该群不会展示给用户。</div>
                )}
                <div className="mt-2 flex justify-end gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => setGroups((prev) => move(prev, index, -1))}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={index === groups.length - 1} onClick={() => setGroups((prev) => move(prev, index, 1))}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setGroups((prev) => prev.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setGroups((prev) => [...prev, emptyGroup()])}>
            <Plus className="mr-1 h-4 w-4" />添加群
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">社区通知</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={noticeEnabled} onCheckedChange={(v) => setNoticeEnabled(v === true)} />
            启用社区通知
            <span className="text-xs font-normal text-muted-foreground">
              （社区信息区在用户端「技术交流群」弹窗内展示，与系统站内通知无关）
            </span>
          </label>

          {entries.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              尚未添加通知内容。点击「添加条目」写一段文本或上传一张图片。
            </div>
          ) : (
            entries.map((entry, index) => (
              <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <NativeSelect
                    value={entry.kind}
                    onChange={(e) => {
                      const kind = e.target.value as "text" | "image"
                      patchEntry(index, kind === "image" ? { kind, image: entry.image ?? "" } : { kind, text: entry.text ?? "" })
                    }}
                  >
                    <NativeSelectOption value="text">文本</NativeSelectOption>
                    <NativeSelectOption value="image">图片</NativeSelectOption>
                  </NativeSelect>
                  <div className="ml-auto flex gap-1">
                    <Button type="button" size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => setEntries((prev) => move(prev, index, -1))}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" disabled={index === entries.length - 1} onClick={() => setEntries((prev) => move(prev, index, 1))}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setEntries((prev) => prev.filter((_, i) => i !== index))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {entry.kind === "image" ? (
                  <div className="mt-3 flex items-start gap-3">
                    {entry.image ? (
                      <img src={entry.image} alt="通知图片预览" className="size-24 rounded-md border object-contain" />
                    ) : (
                      <div className="flex size-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">无图片</div>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={() => pickImage("entry", index)}>
                      <Upload className="mr-1 h-4 w-4" />{entry.image ? "更换图片" : "上传图片"}
                    </Button>
                  </div>
                ) : (
                  <Textarea
                    className="mt-3"
                    rows={3}
                    value={entry.text ?? ""}
                    placeholder="通知文本内容"
                    onChange={(e) => patchEntry(index, { text: e.target.value })}
                  />
                )}
              </div>
            ))
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setEntries((prev) => [...prev, emptyEntry()])}>
            <Plus className="mr-1 h-4 w-4" />添加条目
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 h-4 w-4" />}保存配置
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { onFileChosen(e.target.files?.[0]); e.currentTarget.value = "" }}
      />
    </div>
  )
}
