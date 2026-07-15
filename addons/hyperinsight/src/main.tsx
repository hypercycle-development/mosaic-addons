import React from "react";
import { createRoot } from "react-dom/client";
import { HyperInsightView } from "./HyperInsightView";
import "./index.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <HyperInsightView />
    </React.StrictMode>,
  );
}
