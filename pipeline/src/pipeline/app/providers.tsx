import { ReactNode } from "react";
import { AuthProvider } from "../features/auth/auth-context";
import { ThemeProvider } from "../features/theme/theme-context";

export const AppProviders = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>
    <AuthProvider>{children}</AuthProvider>
  </ThemeProvider>
);

