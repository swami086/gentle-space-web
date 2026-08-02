import type { Metadata } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@/components/Analytics";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SITE, SITE_URL } from "@/lib/site";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const SITE_DESCRIPTION =
  "Commercial real estate consultants in Bangalore. Office, retail and warehouse space matched to your brief — verified, negotiated, and handled through to signing.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "Gentle Space CRE | Commercial Real Estate Consultants in Bangalore",
    template: "%s | Gentle Space CRE",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_IN",
    url: "/",
    title:
      "Gentle Space CRE | Commercial Real Estate Consultants in Bangalore",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title:
      "Gentle Space CRE | Commercial Real Estate Consultants in Bangalore",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${sourceSerif.variable} h-full scroll-smooth`}
      suppressHydrationWarning
    >
      <body className="font-primary bg-[var(--bg)] text-[var(--ink)] h-full antialiased">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
