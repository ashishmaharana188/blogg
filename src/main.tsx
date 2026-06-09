import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// 1. Tailwind global resets MUST load first
import "./App.css"; // or "./App.css" depending on your setup

// 2. BlockNote styles MUST load second
import "@blocknote/core/fonts/inter.css";
import "@blocknote/core/style.css";
import "@blocknote/mantine/style.css";

createRoot(document.getElementById("root")!).render(<App />);
