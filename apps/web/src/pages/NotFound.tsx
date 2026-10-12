import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="cp-label">404</p>
      <h1 className="text-xl font-semibold text-paper">Route not found</h1>
      <p className="max-w-md text-sm text-muted">
        The page you requested does not exist in the CorePilot dashboard.
      </p>
      <Link to="/" className="cp-btn-primary mt-2">
        Back to Landing
      </Link>
    </div>
  );
}
