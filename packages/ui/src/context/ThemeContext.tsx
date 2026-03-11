import { createContext, useContext } from "react";

export type AppTheme = "dark" | "light";

export const ThemeContext = createContext<AppTheme>("dark");

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}

export function monacoThemeName(theme: AppTheme): string {
  return theme === "light" ? "cursor-light" : "cursor-dark";
}
