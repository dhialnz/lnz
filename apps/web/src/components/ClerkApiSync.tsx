"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setApiTokenGetter } from "@/lib/api";

/**
 * Bridges Clerk's getToken() into the plain api.ts module so every
 * request automatically gets an Authorization: Bearer <jwt> header.
 * Renders nothing — mount this once inside ClerkProvider.
 */
export function ClerkApiSync() {
  const { getToken } = useAuth();

  useEffect(() => {
    setApiTokenGetter(() => getToken());
  }, [getToken]);

  return null;
}
