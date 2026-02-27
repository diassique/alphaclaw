import { Outlet } from "react-router";
import { Nav } from "./Nav.tsx";
import { StatusStrip } from "./StatusStrip.tsx";
import { Footer } from "./Footer.tsx";

export function AppLayout() {
  return (
    <div className="app-shell">
      <div className="orb orb1" />
      <div className="orb orb2" />
      <Nav />
      <main>
        <Outlet />
      </main>
      <StatusStrip />
      <Footer />
    </div>
  );
}
