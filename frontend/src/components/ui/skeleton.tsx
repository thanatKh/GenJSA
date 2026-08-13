import { cn } from "@/lib/utils"

// t-skel-shimmer replaces the generated animate-pulse (index.css) — a
// band-sweep (transitions.dev #14/#15) on GenJSA's own motion tokens, so the
// sweep timing/color is tunable from styles/tokens.css alongside everything
// else, instead of a plain opacity pulse.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("t-skel-shimmer rounded-md bg-line-strong", className)}
      {...props}
    />
  )
}

export { Skeleton }
