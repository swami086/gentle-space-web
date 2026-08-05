import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { ReportsChat } from "@/components/ReportsChat";

export default async function ReportsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Ask anything — the AI picks the right chart, table, or number for your question.
        </p>
      </div>
      <ReportsChat />
    </div>
  );
}
