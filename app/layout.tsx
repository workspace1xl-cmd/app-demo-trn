import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Display face for headline-level text (dashboard hero, readiness score,
// graph view) — Geist Sans stays for body/UI everywhere else. Chosen
// deliberately over a generic sans-only headline: almost no B2B SaaS uses
// a serif/slab display face, which is the point of the design-direction
// pass — break the sameness rather than default to it.
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["600", "700"] });

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
  // data-scroll-behavior tells Next's router this smooth-scroll CSS is
  // intentional, so it still resets scroll position correctly on route
  // changes instead of smooth-scrolling awkwardly between unrelated pages.
  // Only became relevant once /platform got real client-side route
  // transitions (previously the whole app was one URL, so the router
  // never had a "route change" to reconcile this with).
  return <html lang="en" data-scroll-behavior="smooth"><body className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}>{children}</body></html>;
}
