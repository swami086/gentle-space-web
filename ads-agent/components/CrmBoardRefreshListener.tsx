"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CRM_STAGE_ADVANCED_EVENT } from "@/lib/openui/crm-library";

/** Listens for StageChangeConfirm success and refreshes the CRM board RSC payload. */
export function CrmBoardRefreshListener() {
  const router = useRouter();
  useEffect(() => {
    function onAdvanced() {
      router.refresh();
    }
    window.addEventListener(CRM_STAGE_ADVANCED_EVENT, onAdvanced);
    return () => window.removeEventListener(CRM_STAGE_ADVANCED_EVENT, onAdvanced);
  }, [router]);
  return null;
}
