import { BrowserRouter } from "react-router-dom";
import Router from "./router/Router";

function App() {
  const pingBackend = async () => {
    const response = await fetch("http://localhost:3000/");
    await response.json();
  };

  return (
    <>
      <button onClick={pingBackend}>Ping Backend</button>
      <BrowserRouter>
        <Router />
      </BrowserRouter>
    </>
  );
}

export default App;
