"use client"

import { useSearchParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertFeed, UpstreamAnnouncements } from "@/components/monitor/bottom-panels"
import ObservationsPage from "@/app/observations-page"

export default function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get("view")
  const view = requestedView === "observations" ? "observations" : "events"

  function setView(nextView: string) {
    const next = new URLSearchParams(searchParams)
    if (nextView === "observations") next.set("view", "observations")
    else next.delete("view")
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="min-w-0 space-y-5">
      <Tabs
        value={view}
        onValueChange={setView}
        className="min-w-0 space-y-5"
      >
        <TabsList aria-label="告警动态视图">
          <TabsTrigger value="events">
            告警与公告
          </TabsTrigger>
          <TabsTrigger value="observations">
            采集与健康
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-0 min-w-0">
          <div className="grid min-h-0 min-w-0 items-start gap-4 xl:h-[calc(100dvh-12rem)] xl:min-h-[29rem] xl:items-stretch xl:grid-cols-2 xl:gap-5">
            <AlertFeed variant="activity" />
            <aside className="min-h-0 min-w-0" aria-label="上游公告">
              <UpstreamAnnouncements variant="activity" />
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="observations" className="mt-0 min-w-0">
          <ObservationsPage />
        </TabsContent>
      </Tabs>
    </section>
  )
}
