/**
 * 「资源浏览」弹框：就地展示市场数据，不必离开首页。
 *
 * 顶部一个「查看我的资源」按钮：点它关闭弹框并跳到资源模式（/resources）——
 * 那里是「自己的资源」的完整管理面（MCP / Skill / 插件 / 项目提示词）。
 *
 * 市场数据直接复用 ResourceMarketBoard（与 /resources?tab=market 同一组件，
 * 自带分类筛选、详情、安装），保证两处行为一致、不产生第二套实现。
 */
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowRight, Package } from "lucide-react"

import { ResourceMarketBoard } from "@/pages/manager/platform/ResourceMarketBoard"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ResourcesBrowseDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const goMine = () => {
    onOpenChange(false)
    // 资源模式首页 = 自己的资源（MCP 为默认 Tab）。
    navigate("/resources")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1500px]">
        <DialogHeader className="shrink-0 gap-1 border-b px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Package className="size-5 text-primary" />
                {t("quickActions.resourcesDialog.title", "资源市场")}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {t(
                  "quickActions.resourcesDialog.desc",
                  "逛逛 MCP / Skill / 插件 / 项目提示词，看中哪个直接装上就能用。",
                )}
              </DialogDescription>
            </div>
            {/* 查看自己的资源：关闭弹框并跳到资源模式。 */}
            <Button variant="outline" size="sm" className="shrink-0" onClick={goMine}>
              {t("quickActions.resourcesDialog.viewMine", "查看我的资源")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ResourceMarketBoard userMode />
        </div>
      </DialogContent>
    </Dialog>
  )
}
