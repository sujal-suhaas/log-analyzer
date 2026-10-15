import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "dark" | "light" | "system";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

export function useColorTheme(preference: ThemePreference) {
  const systemDark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => true,
  );
  const dark = preference === "dark" || (preference === "system" && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#101212" : "#ffffff");
  }, [dark]);
  return dark;
}
