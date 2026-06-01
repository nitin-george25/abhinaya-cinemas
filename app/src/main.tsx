import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {/* basename matches Vite's `base`. Updated for the C7 cutover —
        React app is now the primary console at /admin/dcr/. */}
    <BrowserRouter basename="/admin/dcr">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
