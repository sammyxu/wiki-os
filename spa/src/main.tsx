import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./spa.css";
import { App } from "./app";

const container = document.getElementById("root");

if (!(container instanceof HTMLElement)) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
