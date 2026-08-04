"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { assignRole, type MemberRole } from "@/lib/auth/internal-client";

const VALID_ROLES: MemberRole[] = ["admin", "operator", "viewer"];

export async function assignRoleAction(userId: string, role: string): Promise<void> {
  const access = await requireRole("admin");
  if (!access.ok) throw new Error("Forbidden");
  if (!VALID_ROLES.includes(role as MemberRole)) throw new Error("Invalid role");

  await assignRole(userId, role as MemberRole);
  revalidatePath("/users");
}
