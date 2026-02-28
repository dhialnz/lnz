"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setApiTokenGetter } from "@/lib/api";

/**
 * Bridges Clerk's getToken() into the plain api.ts module so every
 * request automatically gets an Authorization: Bearer <jwt> header.
 *
 * Waits until Clerk has finished initializing (isLoaded) before
 * registering the getter — this prevents API calls from firing before
 * the session is validated, which would produce transient 401s.
 */
export function ClerkApiSync() {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (isLoaded) {
      setApiTokenGetter(() => getToken());
    }
  }, [getToken, isLoaded]);

  return null;
}
