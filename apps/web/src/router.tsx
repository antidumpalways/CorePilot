import { useRoutes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Explorer } from "./pages/Explorer";
import { StrategyDetail } from "./pages/StrategyDetail";
import { CreateStrategy } from "./pages/CreateStrategy";
import { Monitor } from "./pages/Monitor";
import { NotFound } from "./pages/NotFound";

export function AppRoutes() {
  return useRoutes([
    { path: "/", element: <Landing /> },
    { path: "/strategies", element: <Explorer /> },
    { path: "/strategies/:id", element: <StrategyDetail /> },
    { path: "/create", element: <CreateStrategy /> },
    { path: "/monitor", element: <Monitor /> },
    { path: "/monitor/:id", element: <Monitor /> },
    { path: "*", element: <NotFound /> },
  ]);
}
