/**
 * 生成版 ``Api`` 的共享实例（不要在各页面再 ``new Api()``）。
 *
 * 生成文件 ``src/api/Api.ts`` 由 swagger-typescript-api 产出，不能手改——
 * 下次 ``npm run api`` 会整文件覆盖。这里用生成代码自带的注入点
 * ``ApiConfig.customFetch`` 包一层 GET single-flight：同一时刻的相同 GET
 * （StrictMode 双跑、多个组件并发拉同一份 server-config / status /
 * unread-count）只发一次网络请求，完成即释放，不持久缓存。
 *
 * 只合并「无取消信号」的 GET：
 * - 写请求（POST/PUT/PATCH/DELETE）各调各的，语义不变；
 * - ``request()`` 传入 ``cancelToken``/``signal`` 的调用不进合并——一个
 *   调用者 abort 不能误伤其他共享者。
 *
 * 共享的是字节而不是 Response 对象：生成代码的每个调用方都会对返回的
 * Response 调 ``.json()``，同一个 Response 只能读一次 body，所以每个共享者
 * 拿到一个用相同字节新造的 Response，各自独立读取。
 */
import { getSingleFlightKey, singleFlightGet } from "@/utils/request-single-flight";

import { Api } from "./Api";

interface SharedGetResult {
  /** 原始 Response（body 读取失败时的兜底，只能被一个调用方消费）。 */
  response: Response;
  status: number;
  statusText: string;
  headers: Headers;
  /** 读出的响应体；null 表示读取失败，退回共享原始 Response。 */
  body: ArrayBuffer | null;
}

async function singleFlightFetch(...fetchParams: Parameters<typeof fetch>): Promise<Response> {
  const [input, init] = fetchParams;
  const method = ((init && init.method) || "GET").toUpperCase();
  const url = typeof input === "string" ? input : String(input);
  const hasOwnSignal = Boolean(init && init.signal);

  if (method !== "GET" || hasOwnSignal) {
    return fetch(...fetchParams);
  }

  const shared = await singleFlightGet(getSingleFlightKey("GET", url), async (): Promise<SharedGetResult> => {
    const response = await fetch(...fetchParams);
    const body = await response.clone().arrayBuffer().catch(() => null);
    return {
      response,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body,
    };
  });

  if (shared.body === null) {
    return shared.response;
  }
  return new Response(shared.body, {
    status: shared.status,
    statusText: shared.statusText,
    headers: shared.headers,
  });
}

/** 全局共享的生成版客户端。所有 ``new Api()`` 调用点都应改用它。 */
export const sharedApi = new Api({ customFetch: singleFlightFetch });
