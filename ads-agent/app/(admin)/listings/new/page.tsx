import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { ListingCreateForm } from "./ListingCreateForm";

export default async function NewListingPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Create a listing campaign</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Set the daily spend limit and the goal. Create schedules the campaign. A sandbox account stays paused.
      </p>
      <ListingCreateForm />
    </div>
  );
}
