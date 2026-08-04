import { getCronSettings } from "@/lib/db/settings";
import { getConnectorStatus } from "@/lib/env-status";
import { requireRole } from "@/lib/auth/dal";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./SettingsForm";

const CONNECTOR_LABELS = {
  meta: "Meta Marketing API",
  googleAds: "Google Ads API",
  twenty: "Twenty CRM",
  bifrost: "Bifrost",
} as const;

export default async function SettingsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;

  const settings = await getCronSettings();
  const connectorStatus = getConnectorStatus();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Decision cycle</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Connector status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(Object.keys(CONNECTOR_LABELS) as Array<keyof typeof CONNECTOR_LABELS>).map((key) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span>{CONNECTOR_LABELS[key]}</span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    connectorStatus[key] ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-destructive"
                  }
                  aria-hidden
                />
                {connectorStatus[key] ? "Configured" : "Not configured"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
