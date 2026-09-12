/**
 * 「立即同步」覆盖策略弹框（所有内容源共用：agent-leaderboard / agency-agents /
 * agency-agents-zh / agentscope / skillhub）。
 *
 * 同步对已存在条目默认**不覆盖**——只刷新上游元数据（stars/描述投影等），管理员
 * 改过的名称、描述、版本、分类、安装/启动配置一律保留。勾选覆盖后，对应状态的行
 * 资源字段被上游最新识别值重写（管理员手改让位）；hidden 行永不覆盖；发布状态
 * 永不翻（覆盖是刷新数据，不是隐式发布/撤回）。
 *
 * 勾选状态由本组件持有，关闭即复位（每次打开都从默认不覆盖开始）。
 */
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export interface SyncOverwriteDialogProps {
  open: boolean
  /** 关闭请求（busy=true 时内部挡掉——同步已发起的窗口期不许关）。 */
  onOpenChange: (open: boolean) => void
  /** 确认开始同步，回传两个覆盖勾选。 */
  onConfirm: (opts: { overwriteDraft: boolean; overwritePublished: boolean }) => void
  /** 同步已发起（确认/取消按钮禁用，防止窗口期重复触发）。 */
  busy?: boolean
  /** 弹框标题，默认「立即同步」。 */
  title?: string
}

export function SyncOverwriteDialog({ open, onOpenChange, onConfirm, busy = false, title = "立即同步" }: SyncOverwriteDialogProps) {
  const [overwriteDraft, setOverwriteDraft] = useState(false)
  const [overwritePublished, setOverwritePublished] = useState(false)

  // 关闭即复位：下次打开从默认（不覆盖）重新勾选
  useEffect(() => {
    if (!open) {
      setOverwriteDraft(false)
      setOverwritePublished(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">
            新条目一律入草稿池。对已存在的条目，默认<strong className="text-foreground">不覆盖</strong>
            ——只刷新上游元数据（stars/描述投影等），管理员改过的名称、描述、版本、分类、安装配置一律保留。
            勾选覆盖后，对应条目的资源字段会被本轮上游最新识别值重写（重新识别的默认值，管理员手改会被冲掉）；
            发布状态不受影响。
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={overwriteDraft} onCheckedChange={(v) => setOverwriteDraft(v === true)} />
            <span>
              覆盖未发布条目（草稿）
              <span className="block text-xs text-muted-foreground">
                草稿的名称、描述、版本跟随上游刷新；本轮带最新识别结果的行，分类与安装/启动配置一并重写。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={overwritePublished} onCheckedChange={(v) => setOverwritePublished(v === true)} />
            <span>
              覆盖已发布条目
              <span className="block text-xs text-muted-foreground">
                已发布条目同样刷新资源字段，用户侧市场随之更新；仍不会自动撤回或改动发布状态。
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button onClick={() => onConfirm({ overwriteDraft, overwritePublished })} disabled={busy}>
            {overwritePublished || overwriteDraft ? "开始同步（覆盖）" : "开始同步（不覆盖）"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
