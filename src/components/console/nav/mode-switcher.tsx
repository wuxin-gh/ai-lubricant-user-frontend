/**
 * 侧栏顶部的模式切换器：六模式之间切换。
 *
 * 点某个模式 → 跳该模式的首个导航项（modeEntryPath）。当前模式由 URL 前缀
 * 反推（useActiveMode），不额外存 state，刷新后保持一致。
 */
import { ChevronsUpDown } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MODES, modeEntryPath } from "@/config/modes"
import { useActiveMode } from "@/hooks/use-active-mode"
import { cn } from "@/lib/utils"

export function ModeSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeMode = useActiveMode()

  const ActiveIcon = activeMode?.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-10 w-full justify-between gap-2 px-2.5", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {ActiveIcon ? <ActiveIcon className="size-4 shrink-0" /> : null}
            <span className="truncate text-sm font-medium">
              {activeMode
                ? t(activeMode.labelKey, activeMode.fallback)
                : t("modes.select", "选择模式")}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-52">
        {MODES.map((mode) => {
          const Icon = mode.icon
          const isActive = mode.id === activeMode?.id
          return (
            <DropdownMenuItem
              key={mode.id}
              onSelect={() => {
                if (!isActive) navigate(modeEntryPath(mode))
              }}
              className={cn(isActive && "text-primary")}
            >
              <Icon className="size-4" />
              <span className="flex-1 truncate">{t(mode.labelKey, mode.fallback)}</span>
              {isActive ? <span className="text-xs text-primary">✓</span> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ModeSwitcher
