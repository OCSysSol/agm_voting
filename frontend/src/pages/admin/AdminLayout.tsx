import { NavLink, Outlet, Link } from "react-router-dom";

export default function AdminLayout() {
  return (
    <div className="admin-layout">
      <nav className="admin-sidebar">
        <div className="admin-sidebar__header">
          <img src="/logo.png" alt="AGM Vote" className="admin-sidebar__logo" />
          <span className="admin-sidebar__role">Admin Portal</span>
        </div>
        <ul className="admin-nav">
          <li className="admin-nav__item">
            <NavLink
              to="/admin/buildings"
              className={({ isActive }) =>
                `admin-nav__link${isActive ? " admin-nav__link--active" : ""}`
              }
            >
              Buildings
            </NavLink>
          </li>
          <li className="admin-nav__item">
            <NavLink
              to="/admin/agms"
              className={({ isActive }) =>
                `admin-nav__link${isActive ? " admin-nav__link--active" : ""}`
              }
            >
              AGMs
            </NavLink>
          </li>
        </ul>
        <div style={{ marginTop: "auto", padding: "12px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
          <Link to="/" className="admin-nav__link" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            ← Voter portal
          </Link>
        </div>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
