import type { Metadata } from "next";
import "./globals.css";
import { Layout } from "@/components/Layout";

export const metadata: Metadata = {
  title: "LNZ — Portfolio Analytics",
  description:
    "Deterministic portfolio analytics and decision support. Not financial advice.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Layout>{children}</Layout>
      </body>
    </html>
  );
}
