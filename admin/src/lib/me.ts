import { useQueryClient } from "@tanstack/react-query";
import type { Admin } from "./types";

/** The logged-in user (loaded by App before any page renders). */
export function useMe(): Admin | undefined {
  return useQueryClient().getQueryData<Admin>(["me"]);
}

export function useIsSuperAdmin(): boolean {
  return useMe()?.role === "super_admin";
}

/** Shown where customers would send: they need their own sender first (next phase). */
export const SENDER_REQUIRED_NOTE = "Sending starts once your own email/WhatsApp sender is connected. You can prepare templates and campaigns now.";
