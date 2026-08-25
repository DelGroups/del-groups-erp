import "./globals.css";
import AuthProvider from "@/components/auth/AuthProvider";
import I18nProvider from "@/i18n/I18nProvider";
import ThemeProvider from "@/theme/ThemeProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/theme/types";

export const dynamic = "force-dynamic";

const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_THEME}";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","${DEFAULT_THEME}");}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" dir="ltr" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-app text-app antialiased">
        <ThemeProvider>
          <AuthProvider>
            <I18nProvider>{children}</I18nProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
