/**
 * Human-friendly hints for notification channel test failures.
 */
export function formatNotifyTestError(
  channelType: string | undefined,
  raw: string | undefined,
): string {
  const msg = (raw || "").trim() || "未知错误"
  const lower = msg.toLowerCase()

  if (channelType === "qqbot") {
    if (
      lower.includes("connection refused") ||
      lower.includes("connectex") ||
      lower.includes("no connection") ||
      lower.includes("dial tcp") ||
      lower.includes("actively refused")
    ) {
      return `${msg} — 连不上机器人 HTTP API。Docker 内请用 host.docker.internal 或宿主机 IP，不要用 127.0.0.1`
    }
    if (lower.includes("no such host") || lower.includes("lookup")) {
      return `${msg} — 主机名解析失败，检查 base_url 是否写错`
    }
    if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
      return `${msg} — 请求超时，确认机器人 HTTP 端口已开启且网络可达`
    }
    if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("token")) {
      return `${msg} — 鉴权失败，检查 Access Token 是否与机器人配置一致`
    }
    if (lower.includes("retcode")) {
      return `${msg} — OneBot 返回业务错误，检查群号/QQ 号及机器人是否已登录`
    }
    if (lower.includes("group_id") || lower.includes("user_id")) {
      return `${msg} — 目标未配置完整，请填写群号或用户 QQ`
    }
  }

  if (lower.includes("connection refused") || lower.includes("dial tcp")) {
    return `${msg} — 目标服务拒绝连接，检查地址/端口`
  }
  return msg
}
