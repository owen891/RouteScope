import { NotificationStatus } from "@/components/monitor/bottom-panels"
import { FeishuBindingCard } from "@/components/settings/feishu-binding-card"
import { Activity, Bell, Bot, Settings } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function NotificationsPage() {
  return (
    <section className="min-w-0 space-y-4">
      <Tabs defaultValue="channels" className="min-w-0 space-y-4">
        <div className="section-toolbar flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="通知中心视图" className="w-full sm:w-fit">
            <TabsTrigger value="channels">
              <Bell />
              通知渠道
            </TabsTrigger>
            <TabsTrigger value="feishu-control">
              <Bot />
              飞书控制
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button asChild size="sm" variant="outline">
              <Link to="/activity">
                <Activity />
                发送记录
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">
                <Settings />
                告警策略
              </Link>
            </Button>
          </div>
        </div>
        <TabsContent value="channels" className="mt-0 min-w-0">
          <NotificationStatus />
        </TabsContent>
        <TabsContent value="feishu-control" className="mt-0 min-w-0">
          <FeishuBindingCard />
        </TabsContent>
      </Tabs>
    </section>
  )
}
