/*
  RESOURCE_cloudflare-worker.js

  Lightweight Cloudflare Worker to proxy requests from the browser to
  the OpenAI Chat Completions API without exposing your API key client-side.

  Usage notes:
  - Deploy this as a Cloudflare Worker and bind a secret named `OPENAI_API_KEY`
    (Workers > Your Worker > Settings > Variables > Add secret).
  - Configure a route (e.g. `https://your-domain.example/_api/openai`) pointing to this worker.
  - From the frontend, POST the same JSON you would send to OpenAI to the worker route.

  Security / safety suggestions (not enforced here):
  - Add authentication (JWT, session cookie) if your site has user accounts.
  - Add rate-limiting or request quotas per client IP / user.
  - Optionally enforce allowed models, temperature, token limits in the worker.


*/

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    // Basic origin check (optional): uncomment and set allowed origins if desired
    // const origin = request.headers.get('Origin');
    // if (origin && !['https://your-site.example'].includes(origin)) {
    //   return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
    // }

    // Ensure API key is bound to worker environment
    const OPENAI_API_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return new Response("Server error: API key not configured", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response("Invalid JSON body", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Optional: enforce or sanitize some payload fields to avoid abuse
    // e.g. force a maximum token limit, disallow dangerous system prompts, or limit models.
    // Example enforcement (uncomment to use):
    // payload.max_tokens = Math.min(payload.max_tokens || 512, 1000);

    // If the client asked to include live web search results and a BING API key is bound,
    // run a Bing Web Search for each query in payload.web_queries and attach a summary
    // to the messages array so the model can use up-to-date information.
    if (
      payload &&
      payload.include_web_results &&
      Array.isArray(payload.web_queries) &&
      env.BING_API_KEY
    ) {
      try {
        const bingKey = env.BING_API_KEY;
        const webSummaries = [];
        for (const q of payload.web_queries) {
          const qstr = String(q).slice(0, 500);
          const bingRes = await fetch(
            `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(
              qstr
            )}`,
            {
              method: "GET",
              headers: { "Ocp-Apim-Subscription-Key": bingKey },
            }
          );
          if (!bingRes.ok) continue;
          const bingJson = await bingRes.json();

          // Collect the top web results (name, snippet, url)
          const items = [];
          if (Array.isArray(bingJson.webPages?.value)) {
            for (
              let i = 0;
              i < Math.min(3, bingJson.webPages.value.length);
              i++
            ) {
              const it = bingJson.webPages.value[i];
              items.push({ name: it.name, snippet: it.snippet, url: it.url });
            }
          }

          webSummaries.push({ query: qstr, results: items });
        }

        if (webSummaries.length) {
          // Create a system message summarizing web findings
          const summaryLines = webSummaries.map((s) => {
            const top = s.results
              .map((r) => `- ${r.name}: ${r.snippet} (${r.url})`)
              .join("\n");
            return `Web search for "${s.query}":\n${top}`;
          });

          const webSystem = {
            role: "system",
            content: `Included web search results (top matches):\n${summaryLines.join(
              "\n\n"
            )}\n\nUse these findings to inform your reply when relevant.`,
          };

          // Prepend webSystem to messages so the model sees recent web info
          payload.messages = Array.isArray(payload.messages)
            ? [webSystem, ...payload.messages]
            : [webSystem];
        }
      } catch (e) {
        // If web search fails, continue without it
        console.warn("Web search failed in worker:", e);
      }
    }

    // Forward the (possibly augmented) request to OpenAI
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    // Prepare response headers
    const headers = new Headers(openaiRes.headers);
    // Remove hop-by-hop or sensitive headers that shouldn't be forwarded
    headers.delete("connection");
    headers.set(
      "Access-Control-Allow-Origin",
      CORS_HEADERS["Access-Control-Allow-Origin"]
    );
    headers.set(
      "Access-Control-Allow-Methods",
      CORS_HEADERS["Access-Control-Allow-Methods"]
    );

    const body = await openaiRes.arrayBuffer();
    return new Response(body, { status: openaiRes.status, headers });
  },
};
