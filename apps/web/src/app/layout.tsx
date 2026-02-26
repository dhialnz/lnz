import type { Metadata } from "next";
import "./globals.css";
import { Layout } from "@/components/Layout";
import { CurrencyProvider } from "@/lib/currency";

export const metadata: Metadata = {
  title: "Alphenzi - Portfolio Intelligence",
  description:
    "Deterministic portfolio analytics and decision support. Not financial advice.",
  icons: {
    icon: "/branding/alphenzi-logo-v3.svg",
    shortcut: "/branding/alphenzi-logo-v3.svg",
    apple: "/branding/alphenzi-logo-v3.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <CurrencyProvider>
          <Layout>{children}</Layout>
        </CurrencyProvider>
      </body>
    </html>
  );
}
