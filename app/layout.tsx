import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const origin = host ? `${protocol}://${host}` : undefined;
  const image = origin ? `${origin}/og.png` : undefined;
  return {
    title: "OneWork — Employee Onboarding & Knowledge Platform",
    description: "Interactive management prototype for employee training, knowledge, ownership and controlled procedures.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "OneWork Employee OS", description: "Employee learning. Trusted knowledge. Clear ownership.", type: "website", images: image ? [{ url: image, width: 1200, height: 630 }] : undefined },
    twitter: { card: "summary_large_image", title: "OneWork Employee OS", description: "Employee learning. Trusted knowledge. Clear ownership.", images: image ? [image] : undefined },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
