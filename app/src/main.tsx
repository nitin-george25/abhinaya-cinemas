import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {/* basename matches Vite's `base`. App now lives at the root of its
        own subdomain (admin.abhinayacinemas.com). See the subdomain-split
        commit for the move off the /admin/dcr/ prefix. */}
    <BrowserRouter basename="/">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
