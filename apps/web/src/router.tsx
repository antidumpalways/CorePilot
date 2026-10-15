import { useRoutes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Overview } from "./pages/Overview";
import { Explorer } from "./pages/Explorer";
import { MyStrategies } from "./pages/MyStrategies";
import { Activity } from "./pages/Activity";
import { StrategyDetail } from "./pages/StrategyDetail";
import { CreateStrategy } from "./pages/CreateStrategy";
import { Monitor } from "./pages/Monitor";
import { NotFound } from "./pages/NotFound";

export function AppRoutes() {
  return useRoutes([
    { path: "/", element: <Landing /> },
    { path: "/app", element: <Overview /> },
    { path: "/strategies", element: <Explorer /> },
    { path: "/my-strategies", element: <MyStrategies /> },
    { path: "/activity", element: <Activity /> },
    { path: "/strategies/:id", element: <StrategyDetail /> },
    { path: "/create", element: <CreateStrategy /> },
    { path: "/monitor", element: <Monitor /> },
    { path: "/monitor/:id", element: <Monitor /> },
    { path: "*", element: <NotFound /> },
  ]);
}
