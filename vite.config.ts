import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appEdition = process.env.VITE_APP_EDITION ?? env.VITE_APP_EDITION
  const electronBuild = process.env.ELECTRON === 'true'
  const devPort = 11180
  // 生产构建的资源前缀。后端 main.py 把 dist 挂在 ``/admin-static``，且用
  // catch-all 把所有未命中路径回退成 index.html——若 base 保持 ``/``，根路径
  // 的 ``/assets/*.js``、``/iconfont.js`` 会被回退成 HTML，浏览器按 MIME 拒绝
  // 执行。因此正式构建时把 base 指向 ``/admin-static/``，与挂载点对齐。
  // ``vite dev``(command === 'serve') 不受影响：base 仍是 ``/``，静态资源由
  // Vite dev server 直接伺服，pnpm dev 照常调试。electron 打包仍用相对路径。
  const buildBase = electronBuild
    ? './'
    : command === 'build'
      ? '/admin-static/'
      : '/'
  const proxyBasicAuthUsername = env.PROXY_BASIC_AUTH_USERNAME?.trim()
  const proxyBasicAuthPassword = env.PROXY_BASIC_AUTH_PASSWORD?.trim()
  const proxyHeaders: Record<string, string> = {}

  if (appEdition !== 'online' && appEdition !== 'offline') {
    throw new Error(
      `Invalid VITE_APP_EDITION: ${appEdition ?? '(missing)'}. Expected "online" or "offline".`,
    )
  }

  if (proxyBasicAuthUsername && proxyBasicAuthPassword) {
    proxyHeaders.Authorization = `Basic ${Buffer.from(`${proxyBasicAuthUsername}:${proxyBasicAuthPassword}`).toString('base64')}`
  }

  return {
    base: buildBase,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // dedupe forces a single copy of these packages across the tree so
      // hooks don't crash with "Invalid hook call" (two React instances). We
      // use dedupe (not hard path aliases) so package.json ``exports`` still
      // resolve correctly — a directory alias breaks named exports like
      // zustand's ``create``.
      dedupe: ["react", "react-dom", "react-router-dom", "zustand"],
    },
    define: {
      "global": "globalThis",
    },
    optimizeDeps: {
      include: ["buffer"],
      esbuildOptions: {
        define: {
          global: "globalThis",
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: devPort,
      allowedHosts: ['.21497624.xyz'],
      proxy: {
        '/api': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
          ws: true,
          ...(Object.keys(proxyHeaders).length > 0
            ? {
                headers: proxyHeaders,
              }
            : {}),
        },
        // Admin-console (ai-lubricant) endpoints: management pages, chat, agent, mcp.
        // Same backend (env.TARGET) — one npm run dev serves the whole portal.
        // ``/admin/*`` is a dual-purpose prefix: it's both a frontend SPA route
        // (browser navigation → must serve index.html) and the backend API
        // (axios XHR → must reach the backend). ``bypass`` splits them: browser
        // HTML navigations fall through to Vite's SPA; XHR/fetch API calls proxy.
        '/admin': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
          bypass: (req: { headers: Record<string, string | string[] | undefined>; method?: string }) => {
            const accept = String(req.headers['accept'] || '')
            const isNavigation = req.method === 'GET' && accept.includes('text/html')
            if (isNavigation) {
              // Let the SPA handle client-side routes like /admin/login.
              return '/index.html'
            }
            // API request: proceed with the proxy to the backend.
            return undefined
          },
        },
        '/v1': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
        },
        '/agent': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
        },
        // MCP market/runtime endpoints (ai-lubricant's own MCP, not MonkeyCode's).
        // The admin ``mcp.ts`` client hits ``/mcp/*`` directly; without this the
        // requests fall through to the SPA and the market shows nothing.
        // ``ws: true`` 让 device-control 的 WebSocket 升级也透传到后端——否则手机
        // 拨 ws://<vite>/mcp/device-control/ws/device 永远等不到 101、卡「连接中」
        // （配对走 HTTP 能转发，WS 升级被吞，所以「配对成功但永远连接中」）。
        '/mcp': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        // 桌面上游型 OAuth 的本机回调（127.0.0.1:{port}/oauth/callback，codearts 等）。
        // portal 登录后把浏览器打到这个 origin 的 /oauth/callback——dev 下 origin 是
        // vite 端口，不加这条会落到 SPA 兜底（跳首页），回调链断、授权一直 pending。
        '/oauth': {
          target: env.TARGET,
          changeOrigin: true,
          secure: false,
        },
      }
    }
  }
})
