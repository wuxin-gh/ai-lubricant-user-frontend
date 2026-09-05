import request from "./client";
import type {
  SecurityConfig,
  SecurityEventsResponse,
  SecurityStats,
  Notification,
  SensitiveRule,
  RuleTestResponse,
} from "../types/admin";

// ==================== 安全配置 API ====================

/** 获取安全配置 */
export async function getSecurityConfig(): Promise<SecurityConfig> {
  const response = await request.get<SecurityConfig>("/admin/security/config");
  return response.data;
}

/** 更新安全配置 */
export async function updateSecurityConfig(
  data: Partial<SecurityConfig>,
): Promise<{ ok: boolean; security: SecurityConfig }> {
  const response = await request.put("/admin/security/config", data);
  return response.data;
}

// ==================== 敏感数据规则 API ====================

/** 获取敏感数据规则 */
export async function getSecurityRules(): Promise<{ rules: SensitiveRule[] }> {
  const response = await request.get<{ rules: SensitiveRule[] }>("/admin/security/rules");
  return response.data;
}

/** 全量更新敏感数据规则 */
export async function updateSecurityRules(
  rules: SensitiveRule[],
): Promise<{ ok: boolean; rules: SensitiveRule[] }> {
  const response = await request.put("/admin/security/rules", { rules });
  return response.data;
}

/** 测试敏感数据规则 */
export async function testSecurityRules(
  text: string,
  rule?: Partial<SensitiveRule>,
): Promise<RuleTestResponse> {
  const response = await request.post<RuleTestResponse>("/admin/security/rules/test", {
    text,
    rule,
  });
  return response.data;
}

// ==================== 安全事件 API ====================

export interface SecurityEventsParams {
  page?: number;
  page_size?: number;
  severity?: string;
  tag?: string;
  start_time?: string;
  end_time?: string;
}

/** 查询安全事件日志 */
export async function getSecurityEvents(
  params: SecurityEventsParams = {},
): Promise<SecurityEventsResponse> {
  const response = await request.get<SecurityEventsResponse>(
    "/admin/security/events",
    { params },
  );
  return response.data;
}

/** 获取安全事件统计 */
export async function getSecurityStats(
  hours = 24,
): Promise<SecurityStats> {
  const response = await request.get<SecurityStats>("/admin/security/stats", {
    params: { hours },
  });
  return response.data;
}

// ==================== 安全通知 API ====================

export interface NotificationsResponse {
  total: number;
  rows: Notification[];
  unread_count: number;
}

/** 获取安全相关通知（kind=security） */
export async function getSecurityNotifications(
  page = 1,
  pageSize = 10,
): Promise<NotificationsResponse> {
  const response = await request.get<NotificationsResponse>("/admin/notifications", {
    params: { page, page_size: pageSize, kind: "security" },
  });
  return response.data;
}

/** 标记通知已读 */
export async function markNotificationRead(
  id: number,
): Promise<{ ok: boolean }> {
  const response = await request.put(`/admin/notifications/${id}/read`);
  return response.data;
}

/** 全部标记已读 */
export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const response = await request.put("/admin/notifications/read-all");
  return response.data;
}
