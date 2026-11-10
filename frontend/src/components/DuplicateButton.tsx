import { useState } from "react";
import { Copy } from "lucide-react";
import { Alert, Button } from "./ui";

export function DuplicateButton({ action }: { action: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div>
    <Button type="button" variant="ghost" loading={busy} onClick={() => {
      setBusy(true); setError("");
      void action().catch((e: unknown) => setError(e instanceof Error ? e.message : "ทำสำเนาไม่สำเร็จ"))
        .finally(() => setBusy(false));
    }}><Copy className="size-4" aria-hidden="true" />ทำสำเนา</Button>
    {error ? <Alert>{error}</Alert> : null}
  </div>;
}
