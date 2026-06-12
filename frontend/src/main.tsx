import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// 1. Tailwind global resets MUST load first
import "./App.css"; // or "./App.css" depending on your setup
createRoot(document.getElementById("root")!).render(<App />);
