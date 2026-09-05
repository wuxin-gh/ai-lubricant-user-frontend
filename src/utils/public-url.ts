/**
 * 把 public/ 目录下的静态资源路径加上构建期 base 前缀。
 *
 * 背景：Vite 在 `vite build` 时会把 index.html 里的 href/src 和 `import` 的资源
 * 前缀改成 base（这里是 `/admin-static/`），但源码里写成字符串字面量的根路径
 * （如 `"/logo-light.png"`）不会被重写，运行时仍请求根路径，被后端 SPA
 * fallback 吞成 index.html，导致图片/图标加载到 HTML 而失败。
 *
 * 用这个 helper 统一加 `import.meta.env.BASE_URL` 前缀：dev (base=`/`)和
 * prod (base=`/admin-static/`)都正确。public/ 下的资源请一律走这里。
 *
 * 例：`publicUrl("/logo-light.png")` → dev: `/logo-light.png`，prod: `/admin-static/logo-light.png`
 */
export function publicUrl(path: string): string {
  // import.meta.env.BASE_URL 末尾恒带斜杠："/" 或 "/admin-static/"
  const base = import.meta.env.BASE_URL
  return `${base}${path.replace(/^\//, "")}`
}
