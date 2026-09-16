/**
 * 当前模式：从 URL 前缀反推，供壳（面包屑）与模式切换器共用。
 */
import { useMemo } from "react"
import { useLocation } from "react-router-dom"

import { resolveModeFromPath, type ModeDef } from "@/config/modes"

export function useActiveMode(): ModeDef | null {
  const { pathname } = useLocation()
  return useMemo(() => resolveModeFromPath(pathname), [pathname])
}
