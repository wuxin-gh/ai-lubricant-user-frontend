const POINTS_ACTIVITY_HIDE_DURATION_MS = 7 * 24 * 60 * 60 * 1000

// 2026-08 品牌改名前旧 key 为 monkeycode.pointsActivity.*；读取时一次性迁移，
// 否则老用户「7 天内不再提示」的偏好会丢。
const LEGACY_KEY_SUFFIXES = ["invite", "essay"] as const

function migrateLegacyKeys(): void {
  if (typeof window === "undefined") {
    return
  }
  for (const suffix of LEGACY_KEY_SUFFIXES) {
    const legacyKey = `monkeycode.pointsActivity.${suffix}.openedAt`
    const legacyValue = window.localStorage.getItem(legacyKey)
    if (legacyValue !== null) {
      window.localStorage.setItem(`ai-lubricant.pointsActivity.${suffix}.openedAt`, legacyValue)
      window.localStorage.removeItem(legacyKey)
    }
  }
}

export const POINTS_ACTIVITY_STORAGE_KEYS = {
  invite: "ai-lubricant.pointsActivity.invite.openedAt",
  essay: "ai-lubricant.pointsActivity.essay.openedAt",
} as const

migrateLegacyKeys()

export function shouldHidePointsActivity(storageKey: string, now = Date.now()): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const openedAt = Number(window.localStorage.getItem(storageKey))
  return Number.isFinite(openedAt) && now - openedAt < POINTS_ACTIVITY_HIDE_DURATION_MS
}

export function markPointsActivityOpened(storageKey: string, now = Date.now()) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(storageKey, String(now))
}
