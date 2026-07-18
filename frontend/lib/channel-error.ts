/**
 * Classify channel last_error for display and recovery actions.
 */

export type ChannelErrorKind =
  | "fingerprint"
  | "token_expired"
  | "turnstile"
  | "bad_password"
  | "network"
  | "other"
  | "none"

export interface ChannelErrorInfo {
  kind: ChannelErrorKind
  /** Short Chinese label for badge */
  label: string
  /** Suggested recovery hint */
  hint: string
  /** Prefer opening form in password mode */
  suggestPasswordMode: boolean
  /** Suggest re-paste token */
  suggestRepasteToken: boolean
  /** Suggest captcha / turnstile setup */
  suggestCaptcha: boolean
}

const KIND_META: Record<Exclude<ChannelErrorKind, "none">, Omit<ChannelErrorInfo, "kind">> = {
  fingerprint: {
    label: "会话绑定",
    hint: "上游把 token 绑到浏览器指纹，请改用账号密码登录",
    suggestPasswordMode: true,
    suggestRepasteToken: false,
    suggestCaptcha: false,
  },
  token_expired: {
    label: "Token 过期",
    hint: "请重新粘贴 token，或改用账号密码模式",
    suggestPasswordMode: true,
    suggestRepasteToken: true,
    suggestCaptcha: false,
  },
  turnstile: {
    label: "需验证码",
    hint: "配置打码服务并在渠道上启用 Turnstile",
    suggestPasswordMode: true,
    suggestRepasteToken: false,
    suggestCaptcha: true,
  },
  bad_password: {
    label: "账号密码错误",
    hint: "检查邮箱/用户名与密码是否正确",
    suggestPasswordMode: true,
    suggestRepasteToken: false,
    suggestCaptcha: false,
  },
  network: {
    label: "网络异常",
    hint: "检查代理、上游可达性后重试",
    suggestPasswordMode: false,
    suggestRepasteToken: false,
    suggestCaptcha: false,
  },
  other: {
    label: "登录失败",
    hint: "查看完整错误并重试测试登录",
    suggestPasswordMode: false,
    suggestRepasteToken: false,
    suggestCaptcha: false,
  },
}

export function classifyChannelError(lastError?: string | null): ChannelErrorInfo {
  const raw = (lastError || "").trim()
  if (!raw) {
    return {
      kind: "none",
      label: "",
      hint: "",
      suggestPasswordMode: false,
      suggestRepasteToken: false,
      suggestCaptcha: false,
    }
  }

  const text = raw.toLowerCase()

  if (
    text.includes("fingerprint") ||
    text.includes("session_binding") ||
    text.includes("session network fingerprint") ||
    text.includes("network fingerprint") ||
    raw.includes("会话绑定") ||
    raw.includes("指纹")
  ) {
    return { kind: "fingerprint", ...KIND_META.fingerprint }
  }

  if (
    text.includes("turnstile") ||
    raw.includes("验证码") ||
    text.includes("captcha")
  ) {
    return { kind: "turnstile", ...KIND_META.turnstile }
  }

  if (
    text.includes("invalid email or password") ||
    text.includes("invalid username or password") ||
    text.includes("wrong password") ||
    raw.includes("邮箱或密码") ||
    raw.includes("账号或密码")
  ) {
    return { kind: "bad_password", ...KIND_META.bad_password }
  }

  if (
    text.includes("token has expired") ||
    text.includes("token 已失效") ||
    text.includes("invalid access token") ||
    text.includes("unauthorized, invalid access token") ||
    text.includes("token expired") ||
    raw.includes("请重新粘贴凭据")
  ) {
    return { kind: "token_expired", ...KIND_META.token_expired }
  }

  if (
    text.includes("eof") ||
    text.includes("timeout") ||
    text.includes("connection") ||
    text.includes("i/o timeout") ||
    text.includes("no such host") ||
    text.includes("connection refused") ||
    raw.includes("网络")
  ) {
    return { kind: "network", ...KIND_META.network }
  }

  return { kind: "other", ...KIND_META.other }
}

export const CHANNEL_ERROR_FILTERS: { value: ChannelErrorKind | "failed"; label: string }[] = [
  { value: "failed", label: "全部失败" },
  { value: "fingerprint", label: "会话绑定" },
  { value: "token_expired", label: "Token 过期" },
  { value: "turnstile", label: "需验证码" },
  { value: "bad_password", label: "密码错误" },
  { value: "network", label: "网络异常" },
  { value: "other", label: "其他失败" },
]
