import { requireRole } from "@/lib/auth/dal";
import { listOrgMembers } from "@/lib/auth/internal-client";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignRoleForm } from "./AssignRoleForm";

export default async function UsersPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;

  const { members, pending } = await listOrgMembers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.name ?? m.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    <AssignRoleForm userId={m.userId} currentRole={m.role} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Pending approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No pending sign-ins.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.userId}>
                  <TableCell className="font-medium text-foreground">{p.name ?? p.email}</TableCell>
                  <TableCell>
                    <AssignRoleForm userId={p.userId} currentRole={null} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
