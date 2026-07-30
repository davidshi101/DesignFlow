import type { Metadata } from "next";
import localFont from "next/font/local";
import WelcomeGate from "@/components/WelcomeGate";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "DesignFlow AI",
  description:
    "Fashion-tech design pipeline: Garment → Line Sketch → CAD Fill → Minibody → Approval",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-navy text-cream antialiased`}
      >
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-navy-50 px-6 py-3">
            <a href="/" className="text-lg font-semibold tracking-tight text-cream">
              DesignFlow<span className="text-accent-blue"> AI</span>
            </a>
          </header>
          <main className="flex-1 px-6 py-5">
            <WelcomeGate>{children}</WelcomeGate>
          </main>
        </div>
      </body>
    </html>
  );
}
