import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AppProvider } from "./app/AppContext";
import { createBackend } from "./lib/backend";
import "./styles.css";

const backend = createBackend();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider backend={backend}>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
