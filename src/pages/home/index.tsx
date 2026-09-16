/**
 * 首页（/home）—— 点侧栏顶部 logo 进入的独立页面，不属于任何模式。
 *
 * 它不挂在六模式壳里（没有侧栏模式导航的"当前模式"高亮），只承担一件事：
 * 用一组快捷导航卡片把用户带进他真正要做的事。首次进入还会先弹向导式引导
 * （带他做第一件事，见 HomeIntroDialog）。
 *
 * 顶部只放一个"回到控制台"的入口，避免用户进来后出不去。
 */
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { QuickActions } from "@/components/console/quick-actions/quick-actions"
import { DataProvider } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
// 平台页（供应商创建向导等）以内联样式直读 admin 主题变量（--bg/--surface…），
// 需要这份 .platform-scope 桥接样式；否则首页里弹出的供应商弹框背景与页面不一致。
import "@/styles/admin-scoped.css"

export default function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <DataProvider>
      {/* platform-scope：让平台页弹框（供应商向导）拿到 admin 主题变量。
          不给高度/滚动约束（首页自己滚），只做变量桥接。 */}
      <div className="platform-scope flex min-h-svh flex-col bg-background">
        {/* 顶栏：返回控制台 + 主题切换。首页不属于任何模式，故不渲染模式导航。 */}
        <header className="flex h-15 shrink-0 items-center justify-between px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/llm/chat")}>
            <ArrowLeft className="size-4" />
            {t("home.backToConsole", "进入控制台")}
          </Button>
          <ModeToggle />
        </header>

        <main className="flex flex-1 flex-col items-center px-4 pb-16">
          <h1 className="pt-16 pb-3 text-center text-4xl">{t("home.title", "快捷导航")}</h1>
          <p className="pb-10 text-center text-sm text-muted-foreground">
            {t("home.subtitle", "想做什么，点一下就行——每一步都会带着你走。")}
          </p>
          <div className="w-full max-w-[1040px]">
            <QuickActions />
          </div>
        </main>
      </div>
    </DataProvider>
  )
}
