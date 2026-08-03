import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Ads Agent" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/proposals">Proposals</a>
          <a href="/settings">Settings</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
