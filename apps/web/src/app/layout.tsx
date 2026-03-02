import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Layout } from "@/components/Layout";
import { ClerkApiSync } from "@/components/ClerkApiSync";
import { CurrencyProvider } from "@/lib/currency";

export const metadata: Metadata = {
  title: "Alphenzi - Portfolio Intelligence",
  description:
    "Deterministic portfolio analytics and decision support. Not financial advice.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={signInUrl}
      signUpUrl="/sign-up"
    >
      <html lang="en" className="dark">
        <body>
          <ClerkApiSync />
          <CurrencyProvider>
            <Layout>{children}</Layout>
          </CurrencyProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

