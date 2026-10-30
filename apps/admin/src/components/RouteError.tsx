import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

/** Shown instead of react-router's developer stack trace when a page fails to render. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  console.error(error);
  return (
    <main className="admin-centered">
      <div className="admin-card">
        <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
        <p className="admin-muted">
          {notFound ? "That page doesn't exist." : "This page hit an unexpected error. Try again, or return to merchants."}
        </p>
        <div className="admin-actions">
          <button type="button" className="admin-button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <Link to="/merchants">Go to merchants</Link>
        </div>
      </div>
    </main>
  );
}
