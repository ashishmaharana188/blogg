import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { AuthProvider } from "../../frontend/src/context/authContext.tsx";
import FrontendErrorBoundary from "./components/FrontendErrorBoundary";
import { installUiConsoleDiagnostics } from "./utils/uiDiagnostics";

import "./App.css";
import "./mobile.css";
import "./exerciseMetricVisibilityBootstrap.ts";
import "./healthWidgetsBootstrap.tsx";
import "./currentReadingBootstrap.tsx";
import "./widgetVisibilityBootstrap.ts";
import "./newsletterBootstrap.tsx";
import "./responsiveHealthDashboard.css";
import "./responsiveFeedWidgetFlow.css";
import "./newsletter.css";

installUiConsoleDiagnostics();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <FrontendErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </FrontendErrorBoundary>
  </BrowserRouter>,
);
