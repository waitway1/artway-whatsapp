import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDarkTheme,
  createLightTheme,
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { App } from "./App";
import "./styles.css";

const brandRamp = {
  10: "#090403",
  20: "#25100d",
  30: "#3d1713",
  40: "#541d18",
  50: "#6c231d",
  60: "#842a22",
  70: "#9d3228",
  80: "#b63b2f",
  90: "#cf4637",
  100: "#df5949",
  110: "#e87162",
  120: "#ef897c",
  130: "#f4a298",
  140: "#f8bbb3",
  150: "#fbd5d0",
  160: "#fdeeed",
} as const;

const lightTheme = { ...webLightTheme, ...createLightTheme(brandRamp) };
const darkTheme = { ...webDarkTheme, ...createDarkTheme(brandRamp) };

function Root() {
  const [isDark, setIsDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <FluentProvider theme={isDark ? darkTheme : lightTheme} className="app-provider">
      <App />
    </FluentProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

