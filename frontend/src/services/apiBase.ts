/**
 * API origin for local development and hosted deployments.
 * Set VITE_API_BASE_URL to the deployed backend origin in the frontend host.
 */
const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredApiBase || "http://localhost:3000"
).replace(/\/+$/, "");
