import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CertForge",
  description: "Local-first certification exam practice",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="shell flex h-16 items-center justify-between">
            <Link href="/" className="text-xl font-extrabold tracking-tight">CertForge</Link>
            <nav className="flex gap-5 text-sm font-semibold">
              <Link href="/import">Import</Link>
              <Link href="/simulations">Simulations</Link>
            </nav>
          </div>
        </header>
        <main className="shell py-8">{children}</main>
      </body>
    </html>
  );
}
