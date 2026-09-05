import request, { saveToken, clearToken } from "./client";
import { isAxiosError } from "axios";

// ==================== 类型定义 ====================

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
  expires_in: number;
}

export interface LogoutResponse {
  ok: boolean;
}

export interface ChangePasswordResponse {
  ok: boolean;
}

export interface AxiosErrorPayload {
  // 全局异常处理（main.py openai_http_exception_handler）把 HTTPException 包成
  // OpenAI 风格 envelope：{error: {message, type, code}}。真实文案在 error.message。
  error?: { message?: string };
  detail?: string;
  message?: string;
}

// ==================== 认证 API ====================

/**
 * 管理员登录
 * POST /admin/login
 * Body: { password: string }
 * Returns: { token: string, expires_in: number }
 */
export async function login(password: string): Promise<LoginResponse> {
  const response = await request.post<LoginResponse>("/admin/login", {
    password,
  });
  const { token } = response.data;
  saveToken(token);
  return response.data;
}

/**
 * 退出登录
 * POST /admin/logout
 * Headers: Authorization: Bearer <token>
 * Returns: { ok: true }
 */
export async function logout(): Promise<LogoutResponse> {
  try {
    const response = await request.post<LogoutResponse>("/admin/logout");
    return response.data;
  } finally {
    clearToken();
  }
}

/**
 * 修改管理员密码
 * POST /admin/change-password
 * Headers: Authorization: Bearer <token>
 * Body: { old_password, new_password }
 * Returns: { ok: true }
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  const response = await request.post<ChangePasswordResponse>(
    "/admin/change-password",
    {
      old_password: oldPassword,
      new_password: newPassword,
    },
  );
  return response.data;
}

export function extractApiErrorMessage(
  err: unknown,
  fallback: string,
): string {
  if (isAxiosError<AxiosErrorPayload>(err)) {
    const data = err.response?.data;
    if (data && typeof data === "object") {
      // 优先 OpenAI envelope 的 error.message（后端 HTTPException 的真实文案在此），
      // 与 client.ts 拦截器的优先级保持一致：error.message → detail → message。
      const envelopeMessage = data.error?.message;
      if (typeof envelopeMessage === "string" && envelopeMessage.trim()) {
        return envelopeMessage;
      }
      if (typeof data.detail === "string" && data.detail.trim()) {
        return data.detail;
      }
      if (typeof data.message === "string" && data.message.trim()) {
        return data.message;
      }
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
