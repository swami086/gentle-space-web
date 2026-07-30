export function slugifyTitle(title: string, sourceId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = sourceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 12);
  return `${base}-${suffix}`.replace(/-+/g, "-");
}
