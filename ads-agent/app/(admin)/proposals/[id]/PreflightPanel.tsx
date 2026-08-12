import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { PreflightResult } from "@/lib/decision-engine/preflight";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

function CheckIcon({ ok, severity }: { ok: boolean; severity: "block" | "warn" }) {
  if (ok) return <CheckCircle2 className="size-4 text-green-600" />;
  if (severity === "block") return <XCircle className="size-4 text-destructive" />;
  return <AlertTriangle className="size-4 text-amber-600" />;
}

export function PreflightPanel({ preflight }: { preflight: PreflightResult }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground">Pre-flight checks</p>
        <Badge variant={preflight.ok ? "secondary" : "destructive"}>
          {preflight.ok ? "Pass" : "Blocked"}
        </Badge>
      </div>
      {!preflight.ok && (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Approval blocked</AlertTitle>
          <AlertDescription>
            One or more blocking checks failed. Resolve issues before approving.
          </AlertDescription>
        </Alert>
      )}
      <ul className="flex flex-col gap-2 rounded-md border border-border p-3">
        {preflight.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-sm">
            <CheckIcon ok={check.ok} severity={check.severity} />
            <div className="min-w-0 flex-1">
              <p className={check.ok ? "text-foreground" : "text-destructive"}>{check.message}</p>
              {check.detail && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {JSON.stringify(check.detail)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
