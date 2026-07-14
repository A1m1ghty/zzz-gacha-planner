import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Planner from "./app/Planner";
import "./app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("找不到页面根节点。 ");

createRoot(root).render(
  <StrictMode>
    <Planner />
  </StrictMode>,
);
