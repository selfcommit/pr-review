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

      console.log("[login] SUPABASE_URL:", supabaseUrl);
      console.log("[login] GITHUB_REDIRECT_URI env:", Deno.env.get("GITHUB_REDIRECT_URI") || "(not set, using default)");
      console.log("[login] resolved redirectUri:", redirectUri);

      if (!redirectUri) {
        throw new Error("Could not determine redirect URI");
      }

      const redirectTo = url.searchParams.get("redirect_to") || "https://pr-review.com";
      console.log("[login] redirect_to param (raw):", url.searchParams.get("redirect_to"));
      console.log("[login] resolved redirectTo:", redirectTo);

      const nonce = crypto.randomUUID();
      const statePayload = btoa(JSON.stringify({ nonce, redirectTo }));
      console.log("[login] statePayload (btoa):", statePayload);
      console.log("[login] statePayload decoded back:", JSON.parse(atob(statePayload)));

      const scope = "read:user,read:org";

      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(statePayload)}`;
      console.log("[login] githubAuthUrl:", githubAuthUrl);

      return new Response(
        JSON.stringify({ url: githubAuthUrl, state: statePayload }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (path === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      console.log("[callback] code present:", !!code);
      console.log("[callback] state (raw from GitHub):", state);

      let appUrl = "https://pr-review.com";
      try {
        if (state) {
          const decoded = atob(state);
          console.log("[callback] state decoded (atob):", decoded);
          const parsed = JSON.parse(decoded);
          console.log("[callback] state parsed:", parsed);
          if (parsed.redirectTo) appUrl = parsed.redirectTo;
        } else {
          console.log("[callback] no state param received from GitHub");
        }
      } catch (e) {
        console.error("[callback] failed to parse state:", e);
      }

      console.log("[callback] resolved appUrl:", appUrl);

      if (!code) {
        const errorUrl = `${appUrl}/#auth_error=${encodeURIComponent("No authorization code received")}`;
        console.log("[callback] no code, redirecting to error:", errorUrl);
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
      console.log("[callback] token exchange response keys:", Object.keys(tokenData));
      console.log("[callback] token exchange error:", tokenData.error || "(none)");
      console.log("[callback] token exchange error_description:", tokenData.error_description || "(none)");
      console.log("[callback] access_token present:", !!tokenData.access_token);

      if (tokenData.error) {
        const errorUrl = `${appUrl}/#auth_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`;
        console.log("[callback] token error, redirecting to:", errorUrl);
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
      console.log("[callback] success redirect appUrl:", appUrl);
      console.log("[callback] success redirect (without token):", `${appUrl}/#user=...&state=${state}`);

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
