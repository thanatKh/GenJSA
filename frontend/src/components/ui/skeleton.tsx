import { cn } from "@/lib/utils"

// animate-t-skel-pulse replaces the generated animate-pulse (index.css) — a
// finite pulse (transitions.dev #14) instead of Tailwind's infinite loop,
// since this skeleton is swapped for real content, never cross-faded.
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
