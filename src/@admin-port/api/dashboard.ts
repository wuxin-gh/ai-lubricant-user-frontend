import request from "./client";
import type {
  MainConfig,
  ProviderStatItem,
  TokenStatsEntry,
  RecentLog,
  DashboardStats,
} from "../types/admin";

// ==================== 类型定义 ====================

export interface StatsResponse {
  providers: ProviderStatItem[];
  models_count: number;
  total_requests: number;
  token_stats?: TokenStatsEntry;
}

export interface DashboardStatsParams {
  start: number;
  end: number;
  grain?: "hour" | "day" | "week";
  section?: "all" | "summary" | "by_provider" | "by_model" | "series";
  provider?: string;
  model?: string;
  api_key?: string;
  account?: string;
}

// ==================== 仪表盘 API ====================

/**
 * 获取概览统计
 * GET /admin/stats?include_token_stats=<bool>
 */
export async function getStats(
  includeTokenStats = false,
): Promise<StatsResponse> {
  const response = await request.get<StatsResponse>("/admin/stats", {
    params: { include_token_stats: includeTokenStats },
  });
  return response.data;
}

/**
 * 获取主配置（config.json）
 * GET /admin/config/main
 */
export async function getMainConfig(): Promise<MainConfig> {
  const response = await request.get<MainConfig>("/admin/config/main");
  return response.data;
}

/**
 * 更新主配置（config.json）
 * PUT /admin/config/main — 接受完整 config 对象
 */
export async function updateMainConfig(
  data: Record<string, unknown>,
): Promise<MainConfig> {
  const response = await request.put<MainConfig>("/admin/config/main", data);
  return response.data;
}

// ==================== 主配置分段接口 ====================
// 每个接口只改自己那一段（后端 _read_json → 改本段 → _write_json），
// 段与段之间互不覆盖，避免整份 PUT /config/main 的并发覆盖风险。

/** 模型刷新间隔（定时任务）。PUT /admin/config/main/model-refresh?interval_minutes= */
export async function updateModelRefreshConfig(intervalMinutes: number): Promise<void> {
  await request.put("/admin/config/main/model-refresh", null, {
    params: { interval_minutes: intervalMinutes },
  });
}

/** 消息删除（定时任务）。PUT /admin/config/main/message-delete?enabled=&interval_minutes= */
export async function updateMessageDeleteConfig(
  enabled: boolean,
  intervalMinutes: number,
): Promise<void> {
  await request.put("/admin/config/main/message-delete", null, {
    params: { enabled, interval_minutes: intervalMinutes },
  });
}

/** 重试策略。PUT /admin/config/main/retry — body 收 max_retries / context_overflow_not_retryable_enabled 等 */
export async function updateRetryConfig(data: Record<string, unknown>): Promise<void> {
  await request.put("/admin/config/main/retry", data);
}

/** 限流策略。PUT /admin/config/main/rate-limit — body 收 status_codes / cooldown_seconds / exception_cooldown_seconds */
export async function updateRateLimitConfig(data: Record<string, unknown>): Promise<void> {
  await request.put("/admin/config/main/rate-limit", data);
}

/** 流式响应。PUT /admin/config/main/stream — body 收 incomplete_error_enabled */
export async function updateStreamConfig(data: Record<string, unknown>): Promise<void> {
  await request.put("/admin/config/main/stream", data);
}

/** 日志保留条数。PUT /admin/config/main/log-retention?max_entries= */
export async function updateLogRetentionConfig(maxEntries: number): Promise<void> {
  await request.put("/admin/config/main/log-retention", null, {
    params: { max_entries: maxEntries },
  });
}

/** 数据保留天数 + 清理时刻。PUT /admin/config/main/data-retention?log_days=&cleanup_hour= */
export async function updateDataRetentionConfig(
  logDays: number,
  cleanupHour?: number,
): Promise<void> {
  await request.put("/admin/config/main/data-retention", null, {
    params: { log_days: logDays, ...(cleanupHour != null ? { cleanup_hour: cleanupHour } : {}) },
  });
}

export interface CleanupLogsResponse {
  ok: boolean;
  /** false = 已有清理任务在跑，本次未新起；detail 说明原因。 */
  started: boolean;
  keep_days: number;
  max_entries: number;
  detail?: string;
}

/**
 * 立即按当前保留配置清理请求日志。POST /admin/config/main/cleanup-logs
 * 服务端后台异步执行、立即返回；删除行数与失败原因见通知中心。
 */
export async function cleanupLogsNow(): Promise<CleanupLogsResponse> {
  const response = await request.post<CleanupLogsResponse>(
    "/admin/config/main/cleanup-logs",
  );
  return response.data;
}

/** 账号测试类型列表。PUT /admin/config/main/account-test — body { types } */
export async function updateAccountTestConfig(
  types: Record<string, unknown>[],
): Promise<void> {
  await request.put("/admin/config/main/account-test", { types });
}

export interface ArchiveLogsResponse {
  ok: boolean;
  keep_entries: number;
  started: boolean;
  detail?: string;
}

/**
 * 立即归档日志（全局保留最新 N 条完整日志，超出的元数据搬入归档表 + 主表删整行）
 * POST /admin/config/main/archive-logs
 * 后台异步执行，立即返回；完成结果见控制台日志 / 通知中心。
 */
export async function archiveLogsNow(): Promise<ArchiveLogsResponse> {
  const response = await request.post<ArchiveLogsResponse>(
    "/admin/config/main/archive-logs",
  );
  return response.data;
}

// 兼容旧命名
export type TrimLogsResponse = ArchiveLogsResponse;
export const trimLogsNow = archiveLogsNow;

/**
 * 获取仪表盘统计
 * GET /admin/dashboard-stats?start=<unix>&end=<unix>&section=<section>
 */
export async function getDashboardStats(
  params: DashboardStatsParams,
): Promise<DashboardStats> {
  const response = await request.get<DashboardStats>("/admin/dashboard-stats", {
    params: {
      start: params.start,
      end: params.end,
      grain: params.grain,
      section: params.section ?? "all",
      provider: params.provider || undefined,
      model: params.model || undefined,
      api_key: params.api_key || undefined,
      account: params.account || undefined,
    },
  });
  return response.data;
}

/**
 * 获取最近请求日志
 * GET /admin/recent-logs?limit=<limit>
 */
export async function getRecentLogs(limit = 50): Promise<RecentLog[]> {
  const response = await request.get<RecentLog[]>("/admin/recent-logs", {
    params: { limit },
  });
  return response.data;
}

// ==================== 通知中心 API ====================

export interface Notification {
  id: number;
  severity: string;
  kind: string;
  event_type?: string | null;
  owner_type?: string;
  user_id?: string | null;
  source?: string;
  title: string;
  /** 列表页摘要文本（后端字段 message） */
  message?: string;
  /** 长文本明细，仅详情接口返回 */
  detail?: string;
  status: string;
  created_at: string;
  first_seen_at?: number;
  last_seen_at?: number;
  read_at?: number;
  occurrence_count?: number;
  request_log_id?: number | null;
  provider_name?: string | null;
  account_username?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NotificationSummary {
  total: number;
  /** 未读总数（后端字段名为 unread_count） */
  unread_count: number;
  critical_count?: number;
  error_count?: number;
  latest?: Notification[];
}

export interface NotificationsResponse {
  items: Notification[];
  total: number;
  page: number;
  page_size: number;
  unread_count: number;
}

/**
 * 查询通知列表
 * GET /admin/notifications
 */
export async function getNotifications(params: {
  page?: number;
  page_size?: number;
  status?: string;
  severity?: string;
  kind?: string;
  /** 规范化事件类型（account.frozen / channel.created / …），通知的内部类型划分。 */
  event_type?: string;
  q?: string;
} = {}): Promise<NotificationsResponse> {
  const response = await request.get<NotificationsResponse>("/admin/notifications", {
    params: {
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      status: params.status || undefined,
      severity: params.severity || undefined,
      kind: params.kind || undefined,
      event_type: params.event_type || undefined,
      q: params.q || undefined,
    },
  });
  return response.data;
}

/**
 * 获取通知统计摘要
 * GET /admin/notifications/summary
 */
export async function getNotificationSummary(): Promise<NotificationSummary> {
  const response = await request.get<NotificationSummary>("/admin/notifications/summary");
  return response.data;
}

/**
 * 标记所有通知为已读
 * PUT /admin/notifications/read-all
 */
export async function markAllNotificationsRead(): Promise<void> {
  await request.put("/admin/notifications/read-all");
}

/**
 * 标记单条通知为已读
 * PUT /admin/notifications/:id/read
 */
export async function markNotificationRead(id: number): Promise<void> {
  await request.put(`/admin/notifications/${id}/read`);
}

/**
 * 获取单条通知详情（含 detail 长文本、metadata 等完整字段）
 * GET /admin/notifications/:id
 */
export async function getNotificationDetail(id: number): Promise<Notification> {
  const response = await request.get<Notification>(`/admin/notifications/${id}`);
  return response.data;
}

/**
 * 删除单条通知
 * DELETE /admin/notifications/:id
 */
export async function deleteNotification(id: number): Promise<void> {
  await request.delete(`/admin/notifications/${id}`);
}

/**
 * 批量删除通知
 * POST /admin/notifications/batch-delete
 */
export async function batchDeleteNotifications(ids: number[]): Promise<{ deleted: number }> {
  const res = await request.post<{ ok: boolean; deleted: number }>(
    "/admin/notifications/batch-delete",
    { ids },
  );
  return { deleted: res.data.deleted ?? 0 };
}

/**
 * 清空已读通知（未读保留）
 * POST /admin/notifications/clear-read
 */
export async function clearReadNotifications(): Promise<{ deleted: number }> {
  const res = await request.post<{ ok: boolean; deleted: number }>(
    "/admin/notifications/clear-read",
  );
  return { deleted: res.data.deleted ?? 0 };
}

/**
 * 清空全部通知（含未读）
 * POST /admin/notifications/clear-all
 */
export async function clearAllNotifications(): Promise<{ deleted: number }> {
  const res = await request.post<{ ok: boolean; deleted: number }>(
    "/admin/notifications/clear-all",
  );
  return { deleted: res.data.deleted ?? 0 };
}

// ==================== 通知订阅（平台级，带参数过滤） ====================

export interface NotifyEventType {
  type: string;
  name: string;
  category: string;
  owner_scope: "platform" | "user";
}

export interface NotifySubscriptionRule {
  id: string;
  owner_type: string;
  owner_id: string;
  channel_id: string;
  event_type: string;
  filters: Record<string, unknown>;
  enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NotifyChannelLite {
  id: string;
  name: string;
  kind: string;
  webhook_url?: string;
  enabled?: boolean;
  event_types?: string[];
}

/** 事件目录（含一级分类 category 与可配范围 owner_scope）。 */
export async function getNotifyEventTypes(): Promise<NotifyEventType[]> {
  const res = await request.get<{ items: NotifyEventType[] }>("/admin/notifications/event-types");
  return res.data.items ?? [];
}

export async function getNotifySubscriptionRules(): Promise<NotifySubscriptionRule[]> {
  const res = await request.get<{ items: NotifySubscriptionRule[] }>("/admin/notifications/subscription-rules");
  return res.data.items ?? [];
}

export async function createNotifySubscriptionRule(body: {
  channel_id: string;
  event_type: string;
  filters?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<NotifySubscriptionRule> {
  const res = await request.post<{ rule: NotifySubscriptionRule }>("/admin/notifications/subscription-rules", body);
  return res.data.rule;
}

export async function updateNotifySubscriptionRule(
  id: string,
  body: Partial<{ channel_id: string; event_type: string; filters: Record<string, unknown>; enabled: boolean }>,
): Promise<void> {
  await request.put(`/admin/notifications/subscription-rules/${id}`, body);
}

export async function deleteNotifySubscriptionRule(id: string): Promise<void> {
  await request.delete(`/admin/notifications/subscription-rules/${id}`);
}

/** 平台级出站渠道（订阅配置里选择推送目标）。 */
export async function getNotifyChannels(): Promise<NotifyChannelLite[]> {
  const res = await request.get<{ items: NotifyChannelLite[] }>("/admin/notifications/channels");
  return res.data.items ?? [];
}

export interface NotifyEventDefinition {
  id: string;
  owner_type: string;
  owner_id?: string | null;
  name: string;
  event_type: string;
  category: string;
  status: "active" | "disabled";
  effective_from?: string | null;
  effective_to?: string | null;
  daily_start?: string | null;
  daily_end?: string | null;
  trigger_condition: Record<string, unknown>;
  event_params: Record<string, unknown>;
  channel_ids: string[];
}

export async function getNotifyEvents(): Promise<NotifyEventDefinition[]> {
  const res = await request.get<{ items: NotifyEventDefinition[] }>("/admin/notifications/events");
  return res.data.items ?? [];
}

export async function createNotifyEvent(body: Partial<NotifyEventDefinition>): Promise<NotifyEventDefinition> {
  const res = await request.post<{ event: NotifyEventDefinition }>("/admin/notifications/events", body);
  return res.data.event;
}

export async function updateNotifyEvent(id: string, body: Partial<NotifyEventDefinition>): Promise<void> {
  await request.put(`/admin/notifications/events/${id}`, body);
}

export async function deleteNotifyEvent(id: string): Promise<void> {
  await request.delete(`/admin/notifications/events/${id}`);
}