import Router from "./router/Router";
import SiteThemeToggle from "./components/SiteThemeToggle";
import BackendStartupNotice from "./components/BackendStartupNotice";
import AdminWalletPanel from "./components/AdminWalletPanel";
import AdminWalletFeedWidget from "./components/AdminWalletFeedWidget";
import AdminWalletAutoEmiPanel from "./components/AdminWalletAutoEmiPanel";
import AdminWalletLayoutControls from "./components/AdminWalletLayoutControls";
import PrivacyPolicyCloseControl from "./components/PrivacyPolicyCloseControl";

function App() {
  return (
    <>
      <Router />
      <AdminWalletPanel />
      <AdminWalletAutoEmiPanel />
      <AdminWalletLayoutControls />
      <AdminWalletFeedWidget />
      <PrivacyPolicyCloseControl />
      <BackendStartupNotice />
      <SiteThemeToggle />
    </>
  );
}

export default App;
