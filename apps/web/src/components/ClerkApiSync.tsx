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
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    setApiTokenGetter(async () => {
      if (!isSignedIn) return null;
      const token = await getToken({ skipCache: true, leewayInSeconds: 150 });
      if (token) return token;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return getToken({ skipCache: true, leewayInSeconds: 150 });
    });
  }, [getToken, isLoaded, isSignedIn]);

  return null;
}
