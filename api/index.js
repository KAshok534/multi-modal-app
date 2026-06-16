// Vercel serverless entry point.
// All /api/* requests are rewritten here (see vercel.json); the Express app
// in ../server.js handles the routing. Static files in /public are served by
// Vercel's CDN directly and never reach this function.
import app from "../server.js";

export default app;
