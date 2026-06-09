/**
 * api/index.js — Único entry point da Vercel
 *
 * A Vercel só conta este arquivo como serverless function.
 * Todo o código fica em api/_lib/ (pastas com _ são ignoradas pelo scanner).
 */
import handler from "./_lib/router.js";
export default handler;
