import * as React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ShieldUser } from "lucide-react"

/**
 * A single user-facing avatar.
 *
 * 同一个用户在不同页面应显示成同一个头像：有 `avatar_url` 就用真实头像；没有就退回
 * 首字母兜底（name 优先、email 本地名其次），而不是把品牌图当成个人头像。紧急管理员
 * 仍保留盾牌图标这一特殊语义。复用 `components/ui/avatar` 的基础组件，保留外部
 * className/alt 以适配列表与导航的不同布局。
 */
export type UserAvatarEntity = {
  avatar_url?: string | null
  name?: string | null
  email?: string | null
}

export type UserAvatarProps = Omit<
  React.ComponentProps<typeof Avatar>,
  "children"
> & {
  /** 当前用户：DomainUser、团队成员或任意包含 name/email/avatar_url 的对象。 */
  user?: UserAvatarEntity | null
  /** 也可以直接传字段而非整个 user 对象。 */
  avatarUrl?: string | null
  name?: string | null
  email?: string | null
  /** 退回首字母兜底时显示的内容；不传则按 name/email 自动取首字母。 */
  fallback?: React.ReactNode
  /** 紧急超管：用盾牌图标取代首字母。 */
  emergencyAdmin?: boolean
  /** AvatarImage 的 alt 文本，缺省回退到显示名。 */
  alt?: string
  /** AvatarImage 的 className。 */
  imageClassName?: string
  /** AvatarFallback 的 className。 */
  fallbackClassName?: string
}

/** 取首字母兜底用：name 优先，其次 email 本地名，再回退「?」。 */
export function userAvatarInitial(
  user?: UserAvatarEntity | null,
  name?: string | null,
  email?: string | null,
): string {
  const resolvedName = name ?? user?.name
  const resolvedEmail = email ?? user?.email
  const seed = (resolvedName && resolvedName.trim()) || (resolvedEmail && resolvedEmail.split("@")[0]) || "?"
  return seed.charAt(0).toUpperCase() || "?"
}

export function userAvatarUrl(
  user?: UserAvatarEntity | null,
  avatarUrl?: string | null,
): string | null {
  const url = avatarUrl ?? user?.avatar_url
  return url && url.trim() ? url : null
}

export function userAvatarDisplayName(
  user?: UserAvatarEntity | null,
  name?: string | null,
  email?: string | null,
): string {
  const resolvedName = name ?? user?.name
  const resolvedEmail = email ?? user?.email
  if (resolvedName && resolvedName.trim()) return resolvedName
  if (resolvedEmail) return resolvedEmail.split("@")[0]
  return ""
}

export const UserAvatar = React.forwardRef<HTMLSpanElement, UserAvatarProps>(
  function UserAvatar(
    {
      user,
      avatarUrl,
      name,
      email,
      fallback,
      emergencyAdmin,
      alt,
      imageClassName,
      fallbackClassName,
      className,
      ...rest
    },
    ref,
  ) {
    const url = userAvatarUrl(user, avatarUrl)
    const displayName = userAvatarDisplayName(user, name, email)
    const resolvedAlt = alt ?? displayName
    const resolvedFallback =
      fallback ??
      (emergencyAdmin ? (
        <ShieldUser className="size-4" />
      ) : (
        userAvatarInitial(user, name, email)
      ))

    return (
      <Avatar ref={ref} className={className} {...rest}>
        {url ? (
          <AvatarImage src={url} alt={resolvedAlt} className={imageClassName} />
        ) : null}
        <AvatarFallback className={fallbackClassName}>{resolvedFallback}</AvatarFallback>
      </Avatar>
    )
  },
)
