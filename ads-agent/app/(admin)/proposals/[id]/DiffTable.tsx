import type { DiffField } from "@/lib/decision-engine/semantic-diff";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value.toLocaleString("en-IN");
  return String(value);
}

export function DiffTable({ diff }: { diff: DiffField[] }) {
  if (diff.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No structured changes for this proposal kind.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Before</TableHead>
          <TableHead>After</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {diff.map((row) => (
          <TableRow key={row.field}>
            <TableCell className="font-medium">{row.field}</TableCell>
            <TableCell className="text-muted-foreground">{formatValue(row.before)}</TableCell>
            <TableCell>{formatValue(row.after)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
