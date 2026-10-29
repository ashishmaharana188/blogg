import Router from "./router/Router";
import SiteThemeToggle from "./components/SiteThemeToggle";
import BackendStartupNotice from "./components/BackendStartupNotice";

function App() {
  return (
    <>
      <Router />
      <BackendStartupNotice />
      <SiteThemeToggle />
    </>
  );
}

export default App;
