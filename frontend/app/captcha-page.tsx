import { CaptchaStatus } from "@/components/monitor/bottom-panels"
import { Link } from "react-router-dom"
import { Network } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function CaptchaPage() {
  return (
    <section className="space-y-4">
      <div className="section-toolbar ml-auto w-fit max-w-full">
        <Button asChild size="sm" variant="outline"><Link to="/ops/channels"><Network />查看渠道引用</Link></Button>
      </div>
      <CaptchaStatus />
    </section>
  )
}
