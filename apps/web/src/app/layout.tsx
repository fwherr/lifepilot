import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "LifePilot",
  description: "Personal-life automation — runnable full-stack skeleton (architecture slice 1)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-dot" /> LifePilot
          </Link>
          <Nav />
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          LifePilot — Next.js 14 · Fastify · PostgreSQL · BullMQ · MinIO (architecture slice 1)
        </footer>
      </body>
    </html>
  );
}
