import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, WalletCards } from "lucide-react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { money } from "@/lib/format"
import { useDashboardSummary } from "@/lib/queries"

export function ChannelRiskSummary() {
  const summary = useDashboardSummary()
  const data = summary.data
  const failed = (data?.channels ?? []).filter((channel) => Boolean(channel.last_error))
  const monitored = (data?.channels ?? []).filter((channel) => channel.monitor_enabled)

  return (
    <Card className="gap-0 border border-border shadow-none" data-testid="overview-channel-summary">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border py-4">
        <div>
          <CardTitle className="text-base">渠道风险与操作</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">总览只保留异常信号；新增、同步和编辑集中在渠道页。</p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/ops/channels">管理渠道<ArrowRight /></Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1.4fr]">
        <div className="surface-panel flex items-center gap-3 p-3">
          {summary.loading ? <CircleDashed className="size-5 animate-pulse text-muted-foreground" /> : failed.length > 0 ? <AlertTriangle className="size-5 text-destructive" /> : <CheckCircle2 className="size-5 text-success" />}
          <div>
            <p className="text-xs text-muted-foreground">当前异常</p>
            <p className="mt-0.5 text-lg font-semibold">{summary.loading ? "-" : failed.length}</p>
          </div>
        </div>
        <div className="surface-panel flex items-center gap-3 p-3">
          <WalletCards className="size-5 text-brand" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">最低余额</p>
            <p className="mt-0.5 truncate text-sm font-semibold">
              {data?.lowest_balance ? `${data.lowest_balance.name} · ${money(data.lowest_balance.balance)}` : "暂无余额数据"}
            </p>
          </div>
        </div>
        <div className="surface-panel min-w-0 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">需要处理</p>
            <Badge variant="outline">监控 {monitored.length}/{data?.total_channels ?? 0}</Badge>
          </div>
          {summary.error ? (
            <p className="mt-2 text-xs text-destructive">{summary.error}</p>
          ) : failed.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {failed.slice(0, 3).map((channel) => (
                <li key={channel.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                  <span className="truncate font-medium">{channel.name}</span>
                  <span className="truncate text-muted-foreground">{channel.last_error}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">当前没有渠道上报错误。</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
