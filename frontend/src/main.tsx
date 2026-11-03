import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceProvider, applyAppearance, loadAppearance } from "./lib/appearance";
import { Workbench } from "./pages/Workbench";
import "./styles.css";

applyAppearance(loadAppearance());

const root = document.getElementById("root");
if (!root) throw new Error("缺少根节点");

createRoot(root).render(
  <StrictMode>
    <AppearanceProvider>
      <Workbench />
    </AppearanceProvider>
  </StrictMode>,
);
