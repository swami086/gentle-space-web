export function ForbiddenNotice() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-lg font-semibold text-foreground">You don&apos;t have access to this page</p>
      <p className="text-sm text-muted-foreground">Ask an admin if you believe this is a mistake.</p>
    </div>
  );
}
