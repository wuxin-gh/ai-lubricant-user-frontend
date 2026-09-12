/**
 * 节点公网 IP 探测备份面板（市场管理 → 节点公网 IP tab）。
 *
 * 与「全局配置 → 节点网络」**互不关联**：全局配置仍是节点在用的唯一真相源，
 * 这里只存一份备份 URL 列表（DB blob，node_public_ip key）。本 tab 的保存只落
 * 备份 blob，**不下发**、**不动**全局配置。
 *
 * 唯一桥梁是「全局配置 → 节点网络」tab 内的「同步市场数据」按钮（本面板没有），
 * 那里拿节点在用配置与本备份比对，点击把备份 URL 追加进全局配置编辑器。
 */
import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  getNodeIpBackupConfig,
  updateNodeIpBackupConfig,
} from "@/api/marketplaceAdmin"
import { toast } from "sonner"

/** 文本框按行拆成 URL 列表：trim + 丢空 + 去重。 */
function splitLines(value: string): string[] {
  const seen = new Set<string>()
  return value.split("\n").map((l) => l.trim()).filter((l) => {
    if (!l || seen.has(l)) return false
    seen.add(l)
    return true
  })
}

export function NodeIpBackupPanel({ onSaved }: { onSaved?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ipv4Text, setIpv4Text] = useState("")
  const [ipv6Text, setIpv6Text] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cfg = await getNodeIpBackupConfig()
      // blob 为空时后端回落默认列表——编辑区直接显示默认值，管理员保存后落库。
      setIpv4Text((cfg.ipv4_urls.length ? cfg.ipv4_urls : cfg.default_ipv4_urls).join("\n"))
      setIpv6Text((cfg.ipv6_urls.length ? cfg.ipv6_urls : cfg.default_ipv6_urls).join("\n"))
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
      const cfg = await updateNodeIpBackupConfig({
        ipv4_urls: splitLines(ipv4Text),
        ipv6_urls: splitLines(ipv6Text),
      })
      setIpv4Text((cfg.ipv4_urls.length ? cfg.ipv4_urls : cfg.default_ipv4_urls).join("\n"))
      setIpv6Text((cfg.ipv6_urls.length ? cfg.ipv6_urls : cfg.default_ipv6_urls).join("\n"))
      toast.success("节点 IP 备份已保存（仅落备份，未下发）")
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          这里是节点公网 IP 探测地址的<b>备份数据</b>，与「全局配置 → 节点网络」互不关联——
          全局配置仍是节点在用的唯一真相源，本 tab 的保存<b>不会下发</b>。要把备份导入全局
          配置，请到「全局配置 → 节点网络」tab 点「同步市场数据」。
        </AlertDescription>
      </Alert>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">公网 IP 探测地址备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label>IPv4 获取地址（备份）</Label>
              <Textarea
                className="min-h-72 resize-y font-mono text-xs leading-5"
                value={ipv4Text}
                onChange={(e) => setIpv4Text(e.target.value)}
                placeholder="一行一个 URL"
              />
            </div>
            <div className="space-y-1.5">
              <Label>IPv6 获取地址（备份）</Label>
              <Textarea
                className="min-h-72 resize-y font-mono text-xs leading-5"
                value={ipv6Text}
                onChange={(e) => setIpv6Text(e.target.value)}
                placeholder="一行一个 URL"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 h-4 w-4" />}保存备份
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
