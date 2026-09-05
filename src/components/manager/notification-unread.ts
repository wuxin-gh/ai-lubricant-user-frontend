import { getNotificationSummary } from "@/@admin-port/api/dashboard"

export const NOTIFICATION_UNREAD_EVENT = "ai-lubricant:notification-unread"

export function publishNotificationUnread(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(NOTIFICATION_UNREAD_EVENT, {
    detail: Math.max(0, Math.floor(count || 0)),
  }))
}

export function subscribeNotificationUnread(listener: (count: number) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<number>).detail || 0)
  window.addEventListener(NOTIFICATION_UNREAD_EVENT, handler)
  return () => window.removeEventListener(NOTIFICATION_UNREAD_EVENT, handler)
}

/** Throws on failure so callers can preserve the last known badge value. */
export async function fetchNotificationUnread(): Promise<number> {
  const summary = await getNotificationSummary()
  return Math.max(0, Number(summary.unread_count) || 0)
}
