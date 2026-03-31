const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    if (path === "login") {
      const clientId = Deno.env.get("GITHUB_CLIENT_ID");

      if (!clientId) {
        throw new Error("GitHub OAuth not configured");
      }

      const redirectUri = url.searchParams.get("redirect_uri") || Deno.env.get("GITHUB_REDIRECT_URI") || "";

      if (!redirectUri) {
        throw new Error("Could not determine redirect URI");
      }

      const state = crypto.randomUUID();
      const scope = "read:user,read:org";

      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;

      return new Response(
        JSON.stringify({ url: githubAuthUrl, state }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (path === "callback") {
      const code = url.searchParams.get("code");

      if (!code) {
        throw new Error("No code provided");
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        throw new Error("GitHub OAuth not configured");
      }

      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Accept": "application/vnd.github.v3+json",
        },
      });

      const userData = await userResponse.json();

      return new Response(
        JSON.stringify({
          user: {
            id: userData.id,
            login: userData.login,
            name: userData.name,
            avatar_url: userData.avatar_url,
            email: userData.email,
          },
          access_token: tokenData.access_token,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid path" }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Auth error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
