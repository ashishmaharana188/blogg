import Router from "./router/Router";
import SiteThemeToggle from "./components/SiteThemeToggle";
import BackendStartupNotice from "./components/BackendStartupNotice";
import AdminWalletPanel from "./components/AdminWalletPanel";
import AdminWalletFeedWidget from "./components/AdminWalletFeedWidget";

function App() {
  return (
    <>
      <Router />
      <AdminWalletPanel />
      <AdminWalletFeedWidget />
      <BackendStartupNotice />
      <SiteThemeToggle />
    </>
  );
}

export default App;
