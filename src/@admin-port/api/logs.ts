import request from "./client";
import type {
  RequestLog,
  RequestLogDetail,
} from "../types/admin";

// ==================== 类型定义 ====================

export interface RequestLogQuery {
  provider_name?: string;
  account_username?: string;
  api_key_name?: string;
  model?: string;
  success?: boolean;
  status?: string;
  stream?: boolean;
  client_type?: string;
  session_id?: string;
  editor_id?: string;
  editor_session_id?: string;
  start_time?: number;
  end_time?: number;
  // 数据源：live=实时日志(带 body) / archive=归档日志(无 body) / all=两表合并
  source?: "live" | "archive" | "all";
  limit?: number;
  offset?: number;
}

export interface PaginatedRequestLogs {
  total: number;
  rows: RequestLog[];
}

// ==================== 请求日志 API ====================

/**
 * 查询请求日志列表
 * GET /admin/request-logs
 * Query: provider_name, account_username, api_key_name, model, success, status,
 *        stream, start_time, end_time, limit, offset
 */
export async function getRequestLogs(
  params: RequestLogQuery = {},
  signal?: AbortSignal,
): Promise<PaginatedRequestLogs> {
  const response = await request.get<PaginatedRequestLogs>(
    "/admin/request-logs",
    { params, signal },
  );
  return response.data;
}

/**
 * 获取请求日志详情
 * GET /admin/request-logs/{logId}
 */
export async function getRequestLogDetail(
  logId: number,
  signal?: AbortSignal,
): Promise<RequestLogDetail> {
  const response = await request.get<RequestLogDetail>(
    `/admin/request-logs/${logId}`,
    { signal },
  );
  return response.data;
}