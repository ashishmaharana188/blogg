import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { AuthProvider } from "../../frontend/src/context/authContext.tsx";

import "./App.css";
import "./mobile.css";
import "./healthWidgetsBootstrap.tsx";
import "./currentReadingBootstrap.tsx";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
);
