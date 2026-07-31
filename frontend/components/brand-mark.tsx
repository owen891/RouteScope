import type { ImgHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src">

/** RouteScope monogram: a decision node sits inside the route-shaped R. */
export function BrandMark({ className, ...props }: BrandMarkProps) {
  return (
    <img
      src="/routescope.svg"
      alt=""
      width={64}
      height={64}
      draggable={false}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    />
  )
}
