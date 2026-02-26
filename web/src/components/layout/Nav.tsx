import { useState } from "react";
import { NavLink, Link } from "react-router";
import { useStatus } from "../../context/StatusContext.tsx";
import { useTelegram } from "../../context/TelegramContext.tsx";
import clawSvg from "../../assets/claw.svg";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/hunt", label: "Hunt" },
  { to: "/autopilot", label: "Autopilot" },
  { to: "/reputation", label: "Reputation" },
  { to: "/memory", label: "Memory" },
  { to: "/network", label: "Network" },
  { to: "/reports", label: "Reports" },
  { to: "/telegram", label: "Telegram" },
  { to: "/live", label: "Live" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const health = useStatus();
  const tg = useTelegram();

  const toggle = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  const badgeClass = health
    ? health.ok
      ? "badge badge-green"
      : health.onlineCount > 0
        ? "badge badge-yellow"
        : "badge badge-red"
    : "badge badge-green";
  const badgeText = health
    ? health.ok
      ? "LIVE"
      : health.onlineCount > 0
        ? "DEGRADED"
        : "OFFLINE"
    : "LIVE";

  return (
    <>
      <nav>
        <Link className="logo" to="/">
          <div className="logo-icon">
            <img src={clawSvg} alt="AlphaClaw" />
          </div>
          <div>
            AlphaClaw<div className="logo-sub">AI Alpha Network</div>
          </div>
        </Link>
        <button
          className={`hamburger${open ? " open" : ""}`}
          aria-label="Menu"
          onClick={toggle}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div className={`nav-links${open ? " open" : ""}`}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              onClick={close}
            >
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className="nav-right">
          <span
            className={tg?.enabled ? "tg-badge tg-on" : "tg-badge tg-off"}
            title={tg?.enabled ? `Telegram Bot \u00b7 Threshold: ${tg.alertThreshold}%` : "Telegram Bot (not configured)"}
          >
            {tg?.enabled ? "TG ON" : "TG OFF"}
          </span>
          <span className={badgeClass}>
            <span className="dot"></span> {badgeText}
          </span>
          <span className="badge badge-purple">Base Sepolia &middot; x402</span>
        </div>
      </nav>
      <div className={`nav-overlay${open ? " open" : ""}`} onClick={close} />
    </>
  );
}
