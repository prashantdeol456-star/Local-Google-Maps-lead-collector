import { useQueryClient } from "@tanstack/react-query";
import type { Admin } from "./types";

/** The logged-in user (loaded by App before any page renders). */
export function useMe(): Admin | undefined {
  return useQueryClient().getQueryData<Admin>(["me"]);
}

export function useIsSuperAdmin(): boolean {
  return useMe()?.role === "super_admin";
}

/** Shown where customers would send without a sender connected. */
export const SENDER_REQUIRED_NOTE = "Connect your own sender on the My sender page to start sending. You can prepare templates and campaigns now.";
