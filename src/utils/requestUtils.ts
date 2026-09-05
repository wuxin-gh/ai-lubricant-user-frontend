/**
 * Request layer (path 2): route the generated ``Api.ts`` method names to our
 * FastAPI backend via a native-fetch executor + an endpoint map, instead of
 * regenerating the swagger client. ``apiRequest`` keeps the exact signature the
 * 93 call sites already use, so no call site or ``Api.ts`` changes.
 *
 * Response contract preserved: ``onSuccess`` receives ``{code, message, data}``
 * with ``code === 0`` on success (matching the Go backend's ``web.Resp``). Our
 * REST endpoints return plain JSON/arrays; the executor wraps them into that
 * envelope and applies any per-endpoint ``transform`` (e.g. ``{rows}`` ->
 * ``{tasks}``) so the frontend's ``resp.data.*`` reads keep working.
 *
 * Unmapped methods (domains that depend on the agent-compose VM runtime, or not
 * yet ported) resolve to a clean ``{code: -1, message: "not implemented"}``
 * envelope routed through ``onError`` — the portal boots and implemented pages
 * work; dormant surfaces degrade gracefully instead of throwing.
 */
import { toast } from 'sonner';
import i18n from '@/i18n';
import { resolveEndpoint, type HttpVerb } from '@/api/endpointMap';
import { getSingleFlightKey, singleFlightGet } from '@/utils/request-single-flight';

function requestText(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`requestUtils.${key}`, options));
}

function getRequestErrorMessage(error: unknown): string {
  const errorLike = error as { error?: { message?: string }; message?: string };
  return errorLike.error?.message || errorLike.message || requestText('errors.network');
}

interface Envelope {
  code: number;
  message: string;
  data: any;
}

/** Build a query string from a params object, skipping null/undefined. */
function toQuery(params: Record<string, any>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    usp.append(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * Execute one mapped request with native fetch. Returns a normalized envelope.
 * Never throws for HTTP-level errors — those become ``{code!==0}`` envelopes so
 * the existing ``resp.code === 0`` checks at call sites handle them uniformly.
 * A 401 is re-thrown as the raw ``Response`` so ``apiRequest`` can redirect.
 */
async function executeMapped(
  method: HttpVerb,
  url: string,
  params: Record<string, any>,
  formData: Record<string, any> | null,
  signal?: AbortSignal,
): Promise<Envelope> {
  const hasBody = method === 'POST' || method === 'PUT';
  const finalUrl = hasBody ? url : `${url}${toQuery(params)}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // 应急管理员用 admin token（Bearer）进管理端，没有 C 端 session cookie。
  // 带上 token，让后端 deps 的兜底鉴权认它为管理员，避免 /api/v1/teams/* 401。
  const adminToken = localStorage.getItem('admin_access_token');
  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }
  const init: RequestInit = {
    method,
    credentials: 'include', // C-side session cookie
    headers,
  };
  if (signal) {
    init.signal = signal;
  }
  if (hasBody) {
    init.body = JSON.stringify(formData ?? params ?? {});
  }

  const response = await fetch(finalUrl, init);
  if (response.status === 401) {
    // Surface to apiRequest for the login redirect (mirrors prior behavior).
    throw response;
  }

  let body: any = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    // 后端 HTTPException 被全局 handler 包成 OpenAI 风格 envelope
    // {error: {message, type, code}}，真实文案在 error.message；与
    // @admin-port/api/auth.ts 的 extractApiErrorMessage 优先级保持一致：
    // error.message → detail → message → 网络错误。
    const errMessage =
      (body && (body.error?.message || body.detail || body.message)) ||
      requestText('errors.network');
    return { code: response.status || -1, message: String(errMessage), data: body ?? null };
  }
  return { code: 0, message: '', data: body };
}

export const apiRequest = async (
  apiMethodName: string,
  params: Record<string, any> = {},
  extrax: string[] = [],
  onSuccess?: (data: any) => void,
  onError?: (error: Error) => void,
  formData: Record<string, any> | null = null,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    const resolved = resolveEndpoint(apiMethodName, extrax);

    // Unmapped: domain not ported / depends on the external VM runtime. Emit a
    // clean envelope so callers' ``code !== 0`` branch handles it; do not throw.
    if (!resolved) {
      const message = requestText('errors.methodMissing', { method: apiMethodName });
      if (onError) {
        onError(new Error(message));
      } else if (onSuccess) {
        onSuccess({ code: -1, message, data: null });
      }
      console.warn(`[apiRequest] unmapped method: ${apiMethodName}`);
      return;
    }

    const envelope = await (resolved.spec.method === 'GET' && !signal
      ? singleFlightGet(
          getSingleFlightKey('GET', `${apiMethodName} ${resolved.url}`, params),
          () => executeMapped(resolved.spec.method, resolved.url, params, formData, signal),
        )
      : executeMapped(resolved.spec.method, resolved.url, params, formData, signal));

    if (envelope.code === 0 && resolved.spec.transform) {
      envelope.data = resolved.spec.transform(envelope.data);
    }

    if (onSuccess) {
      onSuccess(envelope);
    }
    return;
  } catch (e) {
    // 请求被 abort（StrictMode 卸载/依赖变更）：静默丢弃，不 toast、不重定向。
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      return;
    }
    if (e instanceof Response && e.status === 401) {
      // 登录接口自身的 401 = 凭据错误（邮箱或密码错误），不是"未登录需跳转"。
      // 读出后端错误文案，按普通失败 envelope 交给 onSuccess，让登录页能 toast。
      if (apiMethodName === 'v1UsersPasswordLoginCreate') {
        let message = requestText('errors.network');
        try {
          const body = await e.json();
          message = (body && (body.error?.message || body.detail || body.message)) || message;
        } catch {
          // body 不是 JSON 时退回默认文案
        }
        if (onSuccess) onSuccess({ code: 401, message, data: null });
        else if (onError) onError(new Error(message));
        return;
      }
      // 应急管理员用 admin token（Bearer）登录，没有 C 端 session cookie；
      // /api/v1/teams/* 这类 MonkeyCode 接口只认 C 端 session，对其必然 401。
      // 此时不能把人踢出去：admin token 对 ai-lubricant 的 /admin/*、/mcp/* 有效
      // （那些页走 @/@admin-port/api 的 axios，带 Bearer）。有 admin token 就让 401
      // 落到 onError 优雅降级，不重定向。
      const hasAdminToken = !!localStorage.getItem('admin_access_token');
      if (window.location.pathname.startsWith('/manager')) {
        if (!hasAdminToken) {
          window.location.href = '/manager/login';
          return;
        }
        // 应急管理员：不登出，把 401 交给调用方处理（降级为空/提示）。
        if (onError) onError(new Error('unauthorized'));
        return;
      }
      if (window.location.pathname.includes('/console')) {
        window.location.href = '/login';
      }
      return;
    }

    if (onError) {
      onError(e as Error);
    } else {
      toast.error(requestText('toast.requestFailed', {
        method: apiMethodName,
        message: getRequestErrorMessage(e),
      }));
    }

    console.log(`${apiMethodName} request failed:`, e);
  }
};
