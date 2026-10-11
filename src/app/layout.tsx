import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/auth/AuthProvider";
import QueryProvider from "@/components/providers/QueryProvider";
import SonnerProvider from "@/components/providers/SonnerProvider";
import I18nProvider from "@/i18n/I18nProvider";
import ThemeProvider from "@/theme/ThemeProvider";
import { TableColumnResizer } from "@/components/ui/TableColumnResizer";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/theme/types";
import {
  getTenantConfig,
  publicConfigScript,
  toPublicTenantConfig,
} from "@/lib/tenant/config";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/brand";
import { getPublicCompanyInfo } from "@/lib/company/server";
import { CompanyInfoProvider } from "@/hooks/useCompanyProfile";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_THEME}";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","${DEFAULT_THEME}");}})();`;

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  appleWebApp: {
    capable: true,
    title: PRODUCT_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read per request (not at build), so the browser gets this tenant's
  // Supabase config before any client code runs.
  const requestHeaders = await headers();
  const supabaseConfigScript = publicConfigScript(
    toPublicTenantConfig(getTenantConfig(requestHeaders))
  );
  // Company name for the first paint and the login page (cached per tenant).
  const companyInfo = await getPublicCompanyInfo(requestHeaders);

  return (
    <html lang="az" dir="ltr" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: supabaseConfigScript }} />
      </head>
      <body className={`${inter.variable} min-h-screen bg-app font-sans text-app antialiased`}>
        <ThemeProvider>
          <CompanyInfoProvider value={companyInfo}>
            <AuthProvider>
              <QueryProvider>
                <I18nProvider>
                  {children}
                  <SonnerProvider />
                  <TableColumnResizer />
                </I18nProvider>
              </QueryProvider>
            </AuthProvider>
          </CompanyInfoProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
