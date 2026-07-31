import DashboardPage from "@/app/page"
import { useSearchParams } from "react-router-dom"

export default function OpsChannelsPage() {
  const [searchParams] = useSearchParams()
  return <DashboardPage favoriteOnly={searchParams.get("scope") === "favorites"} showOverviewSummary={false} />
}
