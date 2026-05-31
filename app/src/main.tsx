import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {/* basename matches Vite's `base` — keep these in sync during /v2/ phase */}
    <BrowserRouter basename="/v2">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
