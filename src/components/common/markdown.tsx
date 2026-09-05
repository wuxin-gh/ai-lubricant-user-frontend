import { memo, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"
import mermaid from "mermaid"
import { Link, useLocation } from "react-router-dom"
import { IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import "@/utils/markdown.css"
import { cn } from "@/lib/utils"
import { isSafeImageSource, isSvgImageSource } from "@/lib/media-url"
import { ImagePreview } from "@/components/common/image-preview"
import { useTheme } from "@/components/theme-context"
import { useTranslation } from "react-i18next"

// Initialize Mermaid configuration.
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  suppressErrorRendering: true,
})

interface MermaidProps {
  chart: string
  isDark: boolean
}

const Mermaid = memo(function Mermaid({ chart, isDark }: MermaidProps) {
  const [svg, setSvg] = useState<string>("")
  const [hasError, setHasError] = useState(false)
  const renderVersionRef = useRef(0)

  useEffect(() => {
    const currentRenderVersion = ++renderVersionRef.current

    const renderChart = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
          suppressErrorRendering: true,
        })
        // Use a unique ID to avoid collisions.
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
        const { svg } = await mermaid.render(id, chart)
        if (renderVersionRef.current !== currentRenderVersion) return
        setSvg(svg)
        setHasError(false)
      } catch (err) {
        if (renderVersionRef.current !== currentRenderVersion) return
        console.error("Mermaid render error:", err)
        setSvg("")
        setHasError(true)
      }
    }

    renderChart()
  }, [chart, isDark])

  if (hasError) {
    return (
      <CodeBlock code={chart} language="mermaid" isDark={isDark} />
    )
  }

  return (
    <div 
      className="mermaid-container flex justify-center my-4"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  )
})

const MarkdownParagraph: NonNullable<Components["p"]> = ({ children, node, ...props }) => {
  void node
  if (typeof children === "string") {
    return (children as string).split("\n").map((line: string, index: number) => (
      <p key={index} {...props}>{line}</p>
    ))
  }

  return <p {...props}>{children}</p>
}

interface CodeBlockProps {
  code: string
  language: string
  isDark: boolean
}

const CodeBlock = ({ code, language, isDark }: CodeBlockProps) => {
  const { t } = useTranslation()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t("common.markdown.copySuccess"))
    } catch (error) {
      toast.error(t("common.markdown.copyFailed"))
      console.error("Copy code failed:", error)
    }
  }

  return (
    <div className="group/code relative">
      <button
        type="button"
        className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md border bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover/code:opacity-100"
        onClick={handleCopy}
        aria-label={t("common.markdown.copyCode")}
      >
        <IconCopy className="size-4" />
      </button>
      <SyntaxHighlighter
        language={language}
        PreTag="pre"
        wrapLines={true}
        style={isDark ? oneDark : oneLight}
        customStyle={{ textShadow: "none", background: "var(--muted)" }}
        codeTagProps={{ style: { wordBreak: "break-all", whiteSpace: "pre-wrap", textShadow: "none" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function MarkdownCodeBlock({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const childElement = children as React.ReactElement | undefined
  const props = childElement?.props as { children?: string; className?: string } | undefined
  const code = props?.children ?? ""
  const language = props?.className?.replace("language-", "").trim() || "text"

  if (language === "mermaid") {
    return <Mermaid chart={String(code).trim()} isDark={isDark} />
  }

  return <CodeBlock code={String(code)} language={language} isDark={isDark} />
}

interface MarkdownProps {
  children: string
  /** Whether raw HTML rendering is allowed. Content is still sanitized. */
  allowHtml?: boolean
  /** Whether internal links should navigate in-app. */
  allowInternalLink?: boolean
  /** URL template for relative repository images; use __README_ASSET_PATH__ as the encoded path placeholder. */
  imageBaseUrl?: string
  /** Base URL for relative links embedded in repository Markdown. */
  linkBaseUrl?: string
  /** Path of the Markdown file inside its repository, used to resolve ./ and ../ assets. */
  sourcePath?: string
  /** Handle links to files inside the same repository without leaving the app. */
  onRepositoryLink?: (path: string) => void
  className?: string
}

// The package default intentionally mirrors GitHub's conservative allowlist.
// Extend it only with inert, document-oriented elements that models commonly
// use in rich Markdown. Scripts, event handlers, inline styles, embedded pages,
// forms, and executable URL protocols remain disallowed by the base schema.
const safeHtmlSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "caption",
    "col",
    "colgroup",
    "figure",
    "figcaption",
    "mark",
    "small",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a || []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img || []), "alt", "title", "width", "height", "loading"],
    p: ["align"],
    div: [...(defaultSchema.attributes?.div || []), "align"],
    table: [...(defaultSchema.attributes?.table || []), "align", "border", "cellPadding", "cellSpacing", "width"],
    tr: ["align", "vAlign"],
    td: ["align", "vAlign", "colSpan", "rowSpan", "headers", "width", "height"],
    th: ["align", "vAlign", "colSpan", "rowSpan", "headers", "scope", "width", "height"],
    col: ["span", "width"],
    colgroup: ["span", "width"],
  },
}

/**
 * Determine whether the link points inside the current site.
 * Internal links include relative paths, absolute paths starting with /, and same-origin full URLs.
 */
function isInternalLink(href: string | undefined): boolean {
  if (!href) return false
  
  try {
    const url = new URL(href, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    // Treat parse failures as internal links.
    return true
  }
}

/**
 * Resolve a relative path to an absolute path.
 * @param href Original link.
 * @param currentPath Current page path.
 */
function resolveRelativePath(href: string, currentPath: string): string {
  // Already absolute.
  if (href.startsWith('/')) {
    return href
  }
  
  // Resolve relative to the current directory.
  const basePath = currentPath.endsWith('/') 
    ? currentPath.slice(0, -1) 
    : currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
  
  try {
    const resolved = new URL(href, `http://dummy${basePath}/`).pathname
    return resolved
  } catch {
    // Preserve the original href if URL parsing fails.
    return href
  }
}

function resolveRepositoryPath(relativePath: string, sourcePath?: string): string {
  const directory = sourcePath?.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : ""
  const segments = `${directory}${relativePath}`.split("/")
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === ".") continue
    if (segment === "..") normalized.pop()
    else normalized.push(segment)
  }
  return normalized.join("/")
}

function resolveRelativeImageSource(src: string | undefined, imageBaseUrl?: string, sourcePath?: string): string | undefined {
  if (!src || !imageBaseUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/|data:|\/)/i.test(src)) return src
  const [pathAndQuery, hash = ""] = src.split("#", 2)
  const [pathOnly, query = ""] = pathAndQuery.split("?", 2)
  const repositoryPath = resolveRepositoryPath(pathOnly, sourcePath)
  if (!repositoryPath) return src
  if (imageBaseUrl.includes("__README_ASSET_PATH__")) {
    const encodedPath = repositoryPath.split("/").map(encodeURIComponent).join("%2F")
    return imageBaseUrl.replace("__README_ASSET_PATH__", encodedPath)
  }
  try {
    const resolved = new URL(repositoryPath, imageBaseUrl.endsWith("/") ? imageBaseUrl : `${imageBaseUrl}/`).toString()
    return `${resolved}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`
  } catch {
    return src
  }
}

function resolveRepositoryLinkPath(href: string, sourcePath?: string): string {
  const path = href.split("#", 1)[0].split("?", 1)[0]
  return path.startsWith("/")
    ? resolveRepositoryPath(path.replace(/^\/+/, ""))
    : resolveRepositoryPath(path, sourcePath)
}

function resolveRelativeLink(href: string | undefined, linkBaseUrl?: string): string | undefined {
  if (!href || !linkBaseUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href
  try {
    // README links may use a leading slash for a repository-root path. Do not
    // let URL resolve that against the GitHub origin instead of the repository.
    const repositoryRelativeHref = href.replace(/^\/+/, "")
    return new URL(repositoryRelativeHref, linkBaseUrl.endsWith("/") ? linkBaseUrl : `${linkBaseUrl}/`).toString()
  } catch {
    return href
  }
}

export const Markdown = memo(function Markdown({ children, allowHtml = false, allowInternalLink = true, imageBaseUrl, linkBaseUrl, sourcePath, onRepositoryLink, className }: MarkdownProps) {
  const location = useLocation()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const markdownSource = typeof children === "string" ? children : ""
  const components = useMemo<Components>(() => ({
    a({ href, children, node, ...props }) {
      void node
      // Any relative link in repository Markdown points inside that repository,
      // not at a site route. Hand it to the owner so it can preview the entry
      // (file / image / directory) instead of navigating nowhere.
      if (href && onRepositoryLink && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) {
        const repositoryPath = resolveRepositoryLinkPath(href, sourcePath)
        return (
          <a
            href={href}
            {...props}
            onClick={(event) => {
              event.preventDefault()
              if (repositoryPath) onRepositoryLink(repositoryPath)
            }}
          >
            {children}
          </a>
        )
      }

      const resolvedHref = resolveRelativeLink(href, linkBaseUrl)
      if (!linkBaseUrl && isInternalLink(resolvedHref)) {
        const absolutePath = resolveRelativePath(resolvedHref as string, location.pathname)
        return <Link to={allowInternalLink ? absolutePath : ""} {...props}>{children}</Link>
      }

      return (
        <a href={resolvedHref} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      )
    },
    p: MarkdownParagraph,
    img({ src, alt, title, node, ...props }) {
      void node
      // Resolve relative repo images first, then enforce a safe source. SVG is
      // never previewed inline (same-origin inline SVG can execute script/loads).
      const resolved = resolveRelativeImageSource(src, imageBaseUrl, sourcePath)
      if (!isSafeImageSource(resolved) || isSvgImageSource(resolved)) {
        // Fall back to inert text so malicious/unsupported sources don't reach <img>.
        return <span className="text-muted-foreground">{alt || title || "[image]"}</span>
      }
      const { className } = props as { className?: string }
      return (
        <ImagePreview
          src={resolved}
          alt={alt}
          title={title}
          imageClassName={cn("rounded-md border border-border/60", className)}
        />
      )
    },
    pre: ({ children }) => <MarkdownCodeBlock isDark={isDark}>{children}</MarkdownCodeBlock>,
  }), [allowInternalLink, imageBaseUrl, isDark, linkBaseUrl, location.pathname, onRepositoryLink, sourcePath])

  return (
    <div className={cn("markdown-body pb-2", isDark ? "markdown-body-dark" : "markdown-body-light", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw, [rehypeSanitize, safeHtmlSchema]] : []}
        components={components}
      >
        {markdownSource}
      </ReactMarkdown>
    </div>
  )
})
