"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/theme/ThemeProvider";

export default function SonnerProvider() {
  const { theme } = useTheme();
  const sonnerTheme = theme === "light" ? "light" : "dark";

  return (
    <Toaster
      theme={sonnerTheme}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "border border-app bg-app-card text-app shadow-lg",
        },
      }}
    />
  );
}
