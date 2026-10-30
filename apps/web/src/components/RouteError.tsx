import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

/** Shown instead of react-router's developer stack trace when a page fails to render. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  console.error(error);
  return (
    <main className="dash-centered">
      <div className="dash-card">
        <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
        <p className="dash-muted">
          {notFound
            ? "That page doesn't exist."
            : "This page hit an unexpected error. Your data is safe; try again, or go back to your transactions."}
        </p>
        <div className="dash-actions">
          <button type="button" className="dash-button dash-button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <Link className="dash-button" to="/dashboard/transactions">
            Go to transactions
          </Link>
        </div>
      </div>
    </main>
  );
}
