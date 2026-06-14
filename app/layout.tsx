import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentDex — ERC-8004 Agent Economy Explorer",
  description:
    "Rank ERC-8004 agents by on-chain reputation, surface activity trends, and flag x402-payable agents. Powered by BigQuery over Ethereum mainnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono antialiased">{children}</body>
    </html>
  );
}
