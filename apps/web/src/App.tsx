import { Layout } from "./components/Layout";
import { AppRoutes } from "./router";
import { useLocation } from "react-router-dom";

export function App() {
  const { pathname } = useLocation();
  if (pathname === "/") return <AppRoutes />;
  return (
    <Layout>
      <AppRoutes />
    </Layout>
  );
}
