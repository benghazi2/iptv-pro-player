/**
 * IPTV Pro Player - Deno Deploy Entry Point
 * خادم ثابت يخدم الملفات المبنية (dist/)
 */
import { serveDir } from "https://deno.land/std@0.208.0/http/file_server.ts";

const PORT = Number(Deno.env.get("PORT")) || 8000;

console.log(`🎬 IPTV Pro Player starting on port ${PORT}...`);

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);
  
  // API Routes - proxy to external if needed
  if (url.pathname.startsWith("/api/")) {
    return new Response("API not available on static deploy", { status: 501 });
  }

  // Serve static files from dist/
  return serveDir(req, {
    fsRoot: "dist",
    urlOverwrite: url.pathname,
    showIndex: true,
    showDotfiles: false,
  });
});

console.log(`✅ Server running at http://localhost:${PORT}`);
