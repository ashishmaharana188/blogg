import { BrowserRouter } from "react-router-dom";
import { useState } from "react";
import Router from "./components/router";

function App() {
  const [isHomePage, setHomePage] = useState();

  return (
    <>
      <BrowserRouter>
        <Router />
      </BrowserRouter>
    </>
  );
}

export default App;
