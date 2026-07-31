import { lazy, Suspense } from "react"
import { useSearchParams } from "react-router-dom"
import { HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const RelayManagement = lazy(() =>
  import("@/components/settings/upstream-sync-settings").then((module) => ({
    default: module.UpstreamSyncSettings,
  })),
)
const AdjustmentsPage = lazy(() => import("@/app/adjustments-page"))

function WorkspaceFallback() {
  return (
    <div className="surface-empty flex min-h-32 items-center justify-center text-sm text-muted-foreground" aria-busy="true">
      加载工作区...
    </div>
  )
}

export default function UpstreamSyncPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get("view") === "adjustments" ? "adjustments" : "relay"

  return (
    <section className="min-w-0 space-y-5">
      <Tabs
        value={view}
        onValueChange={(nextView) =>
          setSearchParams(nextView === "adjustments" ? { view: nextView } : {})
        }
        className="min-w-0 space-y-4"
      >
        <div className="section-toolbar w-fit max-w-full flex-nowrap items-center justify-between gap-2 max-sm:w-full">
          <TabsList aria-label="上游同步视图" className="min-w-0 max-sm:flex-1">
            <TabsTrigger value="relay">同步配置</TabsTrigger>
            <TabsTrigger value="adjustments">倍率调整</TabsTrigger>
          </TabsList>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                aria-label="上游同步操作说明"
                title="操作说明"
              >
                <HelpCircle className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(22rem,calc(100vw-2rem))] p-4"
            >
              <p className="text-sm font-semibold text-foreground">同步配置怎么用</p>
              <ol className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  添加 Sub2API 上游并检测连接。
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">2.</span>
                  点击目标卡片的“同步分组”，读取全部远端分组和账号。
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">3.</span>
                  展开目标卡片，查看分组倍率和账号归属。
                </li>
              </ol>
              <p className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
                同步分组仅刷新本地展示，不会新增或覆盖远端账号。
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <Suspense fallback={<WorkspaceFallback />}>
          <TabsContent value="relay" className="mt-0 min-w-0">
            <RelayManagement />
          </TabsContent>
          <TabsContent value="adjustments" className="mt-0 min-w-0">
            <AdjustmentsPage />
          </TabsContent>
        </Suspense>
      </Tabs>
    </section>
  )
}
