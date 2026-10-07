// Entry point for Frontend/Radio/radio.html.
// Mounts the radio into #root. Built into ../radio.js (see vite.config.ts).
import { createRoot } from "react-dom/client";
import Home from "./Home";

createRoot(document.getElementById("root")!).render(<Home />);
