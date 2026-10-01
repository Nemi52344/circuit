import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Topbar from "@/components/Topbar";

export const metadata: Metadata = {
  title: "Circuit",
  description: "Local-first marketing workspace: inspiration to creation to calendar to evidence.",
};

// Applies the saved NEMI theme before first paint so the page never flashes the wrong ground.
const THEME_INIT = `(function(){try{var s=localStorage.getItem('nemi-theme');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',s||(d?'dark':'light'));}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <div className="shell">
          <Nav />
          <div className="main">
            <Topbar />
            <main className="workspace">
              <div className="workspace-inner">{children}</div>
              <footer className="foot">
                <span>Circuit · BNC Motors, a division of Nemi</span>
                <span>Saved on this Mac</span>
              </footer>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
