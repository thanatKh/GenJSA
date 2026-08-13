import { cn } from "@/lib/utils"

// animate-t-skel-pulse replaces the generated animate-pulse (index.css) — same
// looping idea (transitions.dev #14) but on GenJSA's own motion tokens, so the
// pulse timing is tunable from styles/tokens.css alongside everything else.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-t-skel-pulse rounded-md bg-line-strong", className)}
      {...props}
    />
  )
}

export { Skeleton }
