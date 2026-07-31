import { lazy, Suspense } from "react"
import { KpiRow } from "@/components/monitor/kpi-row"
import { MultiplierChanges } from "@/components/monitor/multiplier-changes"
import { ChannelCards } from "@/components/monitor/channel-cards"
import { ChannelRiskSummary } from "@/components/monitor/channel-risk-summary"

const BalanceOverview = lazy(() =>
  import("@/components/monitor/balance-overview").then((module) => ({ default: module.BalanceOverview })),
)

export default function Page({
  favoriteOnly = false,
  showOverviewSummary = true,
}: {
  favoriteOnly?: boolean
  showOverviewSummary?: boolean
}) {
  return (
    <>
      {showOverviewSummary ? (
        <>
          <KpiRow />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Suspense fallback={<div className="h-[22rem] animate-pulse rounded-md border border-border bg-muted/20" />}>
                <BalanceOverview />
              </Suspense>
            </div>
            <div className="lg:col-span-2">
              <MultiplierChanges />
            </div>
          </div>
        </>
      ) : null}

      {showOverviewSummary ? <ChannelRiskSummary /> : <ChannelCards favoriteOnly={favoriteOnly} />}
    </>
  )
}
