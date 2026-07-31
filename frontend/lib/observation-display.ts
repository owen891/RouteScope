import type { Observation, ObservationKind, ObservationSource } from "@/lib/api-types"

const kindLabels: Record<ObservationKind, string> = {
  balance: "余额采集",
  rate: "模型倍率采集",
  cost: "账单消费采集",
  announcement: "公告采集",
  health: "健康探测",
}

const sourceLabels: Record<ObservationSource, string> = {
  schedule: "定时任务",
  manual: "手动刷新",
  probe: "健康探测",
}

const errorLabels: Record<string, string> = {
  network_error: "网络异常",
  credential_invalid: "凭据失效",
  unauthorized: "鉴权失败",
  timeout: "请求超时",
  parse_error: "响应解析失败",
  upstream_error: "上游返回错误",
  fail: "失败",
}

function compactNumber(value: number, minimumFractionDigits = 0) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits,
    maximumFractionDigits: 4,
  }).format(value)
}

function compactMoney(value: number) {
  return `$${compactNumber(value, 2)}`
}

export function observationKindLabel(kind: ObservationKind) {
  return kindLabels[kind] ?? kind
}

export function observationSourceLabel(source: ObservationSource) {
  return sourceLabels[source] ?? source
}

export function observationResultLabel(observation: Pick<Observation, "success" | "error_class">) {
  if (observation.success) return "成功"
  const errorClass = observation.error_class?.trim()
  if (!errorClass) return "失败"
  return errorLabels[errorClass] ?? `失败（${errorClass}）`
}

export function observationSummaryLabel(
  observation: Pick<Observation, "kind" | "summary" | "error_message" | "success">,
) {
  if (!observation.success) return observation.error_message?.trim() || "采集失败，未返回详细原因"

  const summary = observation.summary?.trim()
  if (!summary) return "采集成功"

  const balance = /^balance=(-?\d+(?:\.\d+)?)$/i.exec(summary)
  if (balance) return `当前余额 ${compactMoney(Number(balance[1]))}`

  const cost = /^today=(-?\d+(?:\.\d+)?)\s+total=(-?\d+(?:\.\d+)?)$/i.exec(summary)
  if (cost) return `今日消费 ${compactMoney(Number(cost[1]))} · 累计消费 ${compactMoney(Number(cost[2]))}`

  const groups = /^groups=(\d+)$/i.exec(summary)
  if (groups) return `获取到 ${Number(groups[1])} 个倍率分组`

  if (/^ok$/i.test(summary)) return observation.kind === "health" ? "站点访问正常" : "采集成功"
  if (/^fail$/i.test(summary)) return observation.error_message?.trim() || "采集失败"

  return summary
}
