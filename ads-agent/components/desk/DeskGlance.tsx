import { cn } from "@/lib/utils";

export type DeskGlanceMetrics = {
  activeCampaigns: number;
  hotLeads: number | null;
  pendingApprovals: number;
};

export function DeskGlance({ metrics }: { metrics: DeskGlanceMetrics }) {
  const chips: { label: string; value: string }[] = [
    { label: "Active campaigns", value: String(metrics.activeCampaigns) },
    ...(metrics.hotLeads !== null
      ? [{ label: "Hot leads", value: String(metrics.hotLeads) }]
      : []),
    { label: "Pending", value: String(metrics.pendingApprovals) },
  ].slice(0, 3);

  return (
    <div className="flex flex-wrap gap-3 border-b border-border pb-4" aria-label="Desk glance">
      {chips.map((chip) => (
        <div
          key={chip.label}
          className={cn(
            "flex items-baseline gap-2 rounded-md bg-surface px-3 py-1.5 text-sm",
          )}
        >
          <span className="font-semibold tabular-nums text-foreground">{chip.value}</span>
          <span className="text-muted-foreground">{chip.label}</span>
        </div>
      ))}
    </div>
  );
}
