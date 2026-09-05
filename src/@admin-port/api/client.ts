import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

import { getSingleFlightKey, singleFlightGet } from "@/utils/request-single-flight";

/** Token 在 localStorage 中的 key（避免与 Zustand persist 'auth_token' 冲突） */
const TOKEN_KEY = "admin_access_token";

/**
 * 从 localStorage 读取 token
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 保存 token 到 localStorage
 */
export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * 清除 token
 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 创建 Axios 实例
 */
const request: AxiosInstance = axios.create({
  baseURL: "", // 开发环境通过 Vite proxy 转发
  timeout: 15000,
  // withCredentials：带上 C 端 session cookie（ai_lubricant_session），
  // 后端 _require_admin 主路径认「session + role==admin」；localStorage 里
  // 若还有 admin token，请求拦截也会带 Bearer 作应急兜底。
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// GET 在途合并：同一时刻的相同 GET（StrictMode 双跑、轮询与父页刷新叠发、
// 多组件并发拉同一份 binaries）共享一次网络请求；完成即释放，不持久缓存。
// 只对没有独立取消信号的 GET 生效；写请求与带 signal 的请求各调各的。
export function attachInflightGetAdapter(base: AxiosInstance): void {
  const adapter = axios.getAdapter(base.defaults.adapter);
  base.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method || "get").toLowerCase();
    const hasOwnSignal = Boolean(config.signal);
    if (method !== "get" || hasOwnSignal || config.url == null) {
      return adapter(config);
    }
    const params = config.params ?? {};
    const key = getSingleFlightKey("GET", `${config.baseURL || ""}${config.url}`, params);
    return singleFlightGet(key, () => adapter(config));
  };
}

attachInflightGetAdapter(request);

/**
 * agent 服务 baseURL：
 * - 构建期通过 VITE_AGENT_BASE_URL 指定（生产/拆机部署）。
 * - 缺省为空（同源）；开发期由 Vite proxy 把 /agent 转发到 agent 服务端口。
 */
export function getAgentBaseURL(): string {
  const url = import.meta.env.VITE_AGENT_BASE_URL as string | undefined;
  return (url || "").replace(/\/$/, "");
}

/**
 * 指向 agent 服务的 Axios 实例（与主系统共享同一 admin token）。
 * agent 对话、LLM 管理等 /agent/* 请求走此实例。
 */
const agentRequest: AxiosInstance = axios.create({
  baseURL: getAgentBaseURL(),
  timeout: 60000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

/** 为 axios 实例装配 token 请求拦截 + 401 响应拦截 */
function attachInterceptors(instance: AxiosInstance): void {
  instance.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        clearToken();
        // 主路径：跳 C 端统一登录（session + role==admin）。应急管理员可手动
        // 访问 /manager/login 用单密码换 token。只在非登录页时跳转，避免循环重定向。
        if (!window.location.pathname.includes("/login")) {
          window.location.href = "/login";
        }
      }
      // 把后端返回的错误详情提到 error.message 上：调用方普遍用 err.message 展示，
      // 否则只会看到 axios 通用的 "Request failed with status code 5xx"，
      // 后端 detail（网络错误 / 代理提示 / 上游状态码）就被吞掉了。
      const data = error.response?.data;
      if (data && typeof data === "object") {
        // 优先 OpenAI 风格 envelope（main.py 全局异常处理把 HTTPException
        // 包装成 {error:{message,type,code}}），其次 detail / message 兜底。
        const envelope = (data as { error?: unknown }).error;
        const envelopeMessage =
          typeof envelope === "object" && envelope !== null
            ? (envelope as { message?: unknown }).message
            : undefined;
        const detail = (data as { detail?: unknown }).detail;
        const message = (data as { message?: unknown }).message;
        if (typeof envelopeMessage === "string" && envelopeMessage.trim()) {
          error.message = envelopeMessage;
        } else if (typeof detail === "string" && detail.trim()) {
          error.message = detail;
        } else if (typeof message === "string" && message.trim()) {
          error.message = message;
        }
      }
      return Promise.reject(error);
    },
  );
}

attachInterceptors(request);
attachInterceptors(agentRequest);

export { agentRequest };
export default request;
