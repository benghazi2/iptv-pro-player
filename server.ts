/**
 * IPTV Pro Player - Deno Deploy Server
 * خادم متكامل مع دعم SPA Routing + API Proxy
 */
import { serveDir } from "https://deno.land/std@0.208.0/http/file_server.ts";

const PORT = Number(Deno.env.get("PORT")) || 8000;

// CORS headers for API proxy
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  console.log(`[Request] ${req.method} ${pathname}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // API Proxy - forward requests to bypass CORS
  if (pathname.startsWith("/api/proxy")) {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return json({ error: "Missing url parameter" }, 400, corsHeaders);
    }

    try {
      console.log(`[Proxy] Fetching: ${targetUrl.substring(0, 100)}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const fetchRes = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!fetchRes.ok) {
        return json({ error: `HTTP ${fetchRes.status}` }, fetchRes.status, corsHeaders);
      }

      const contentType = fetchRes.headers.get("content-type") || "";
      
      // For M3U/M3U8 text content
      if (contentType.includes("text") || contentType.includes("mpegurl") || contentType.includes("m3u")) {
        const text = await fetchRes.text();
        return new Response(text, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }

      // Video/audio streams
      const buffer = await fetchRes.arrayBuffer();
      return new Response(buffer, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType || "video/mp2t",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err: any) {
      console.error("[Proxy] Error:", err.message);
      return json({ error: err.message || "Proxy error" }, 500, corsHeaders);
    }
  }

  // API routes placeholder (saved-connections, favorites)
  if (pathname.startsWith("/api/")) {
    return json(
      { error: "API route not available on static deploy - use Vercel for full features" },
      501,
      corsHeaders
    );
  }

  // Static files from dist/
  try {
    // Try to serve the file directly
    const response = await serveDir(req, {
      fsRoot: "dist",
      urlOverwrite: pathname,
      showIndex: false,
      showDotfiles: false,
    });

    // If it's a 404 and looks like an SPA route, serve index.html
    if (response.status === 404 && !pathname.includes(".")) {
      const indexResponse = await serveDir(
        new Request(new URL("/", url), { method: "GET" }),
        { fsRoot: "dist", urlOverwrite: "/index.html", showIndex: false }
      );
      return indexResponse;
    }

    return response;
  } catch (err) {
    console.error("[Serve] Error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}

function json(data: any, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

console.log(`🎬 IPTV Pro Player starting on port ${PORT}...`);
console.log(`✅ Server ready at http://localhost:${PORT}`);

Deno.serve({ port: PORT }, handleRequest);
