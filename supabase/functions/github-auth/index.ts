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

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const redirectUri = Deno.env.get("GITHUB_REDIRECT_URI") || `${supabaseUrl}/functions/v1/github-auth/callback`;

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
      const state = url.searchParams.get("state");

      const appUrl = (Deno.env.get("APP_URL") || "https://pr-review.com").trim().replace(/^`|`$/g, "");

      if (!code) {
        const errorUrl = `${appUrl}/#auth_error=${encodeURIComponent("No authorization code received")}`;
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        const errorUrl = `${appUrl}/#auth_error=${encodeURIComponent("GitHub OAuth not configured")}`;
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
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
        const errorUrl = `${appUrl}/#auth_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`;
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Accept": "application/vnd.github.v3+json",
        },
      });

      const userData = await userResponse.json();

      const user = {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        avatar_url: userData.avatar_url,
        email: userData.email,
      };

      const params = new URLSearchParams({
        access_token: tokenData.access_token,
        user: JSON.stringify(user),
        state: state || "",
      });

      const successUrl = `${appUrl}/#${params.toString()}`;

      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: successUrl },
      });
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
