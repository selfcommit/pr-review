const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function buildErrorUrl(appUrl: string, code: string, message: string): string {
  return `${appUrl}/#auth_error=${encodeURIComponent(message)}&auth_error_code=${encodeURIComponent(code)}`;
}

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
        return new Response(
          JSON.stringify({
            error: "oauth_not_configured",
            message: "GitHub OAuth is not configured on this server. Please contact the administrator.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const redirectUri = Deno.env.get("GITHUB_REDIRECT_URI") || `${supabaseUrl}/functions/v1/github-auth/callback`;

      console.log("[login] SUPABASE_URL:", supabaseUrl);
      console.log("[login] GITHUB_REDIRECT_URI env:", Deno.env.get("GITHUB_REDIRECT_URI") || "(not set, using default)");
      console.log("[login] resolved redirectUri:", redirectUri);

      if (!redirectUri) {
        return new Response(
          JSON.stringify({
            error: "redirect_uri_missing",
            message: "Could not determine the OAuth redirect URI. Please contact the administrator.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const redirectTo = url.searchParams.get("redirect_to") || "https://pr-review.com";
      console.log("[login] redirect_to param (raw):", url.searchParams.get("redirect_to"));
      console.log("[login] resolved redirectTo:", redirectTo);

      const nonce = crypto.randomUUID();
      const statePayload = btoa(JSON.stringify({ nonce, redirectTo }));
      console.log("[login] statePayload (btoa):", statePayload);
      console.log("[login] statePayload decoded back:", JSON.parse(atob(statePayload)));

      const scope = "read:user read:org repo";

      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(statePayload)}&prompt=consent`;
      console.log("[login] githubAuthUrl:", githubAuthUrl);

      return new Response(
        JSON.stringify({ url: githubAuthUrl, state: statePayload, client_id: clientId }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (path === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const githubError = url.searchParams.get("error");
      const githubErrorDescription = url.searchParams.get("error_description");

      console.log("[callback] code present:", !!code);
      console.log("[callback] state (raw from GitHub):", state);
      console.log("[callback] github error param:", githubError || "(none)");
      console.log("[callback] github error_description:", githubErrorDescription || "(none)");

      let appUrl = "https://pr-review.com";
      let stateParseFailed = false;

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
        stateParseFailed = true;
      }

      console.log("[callback] resolved appUrl:", appUrl);

      if (stateParseFailed) {
        const errorUrl = buildErrorUrl(
          appUrl,
          "invalid_state",
          "The sign-in session data was corrupted or tampered with. Please try signing in again."
        );
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      if (githubError) {
        let friendlyMessage: string;
        if (githubError === "access_denied") {
          friendlyMessage = "You cancelled the sign-in request on GitHub. Please try again if this was unintentional.";
        } else if (githubError === "redirect_uri_mismatch") {
          friendlyMessage = "The OAuth redirect URI is misconfigured. Please contact the administrator. (GitHub error: redirect_uri_mismatch)";
        } else {
          friendlyMessage = githubErrorDescription
            ? `GitHub returned an error: ${githubErrorDescription} (${githubError})`
            : `GitHub returned an unexpected error: ${githubError}. Please try again.`;
        }
        const errorUrl = buildErrorUrl(appUrl, githubError, friendlyMessage);
        console.log("[callback] github error param, redirecting to:", errorUrl);
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      if (!code) {
        const errorUrl = buildErrorUrl(
          appUrl,
          "no_code",
          "No authorization code was received from GitHub. The request may have expired or been interrupted. Please try signing in again."
        );
        console.log("[callback] no code, redirecting to error:", errorUrl);
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        const errorUrl = buildErrorUrl(
          appUrl,
          "oauth_not_configured",
          "GitHub OAuth credentials are not configured on this server. Please contact the administrator."
        );
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
        let friendlyMessage: string;
        if (tokenData.error === "bad_verification_code") {
          friendlyMessage = "The authorization code expired or has already been used. Please sign in again.";
        } else if (tokenData.error === "incorrect_client_credentials") {
          friendlyMessage = "The GitHub OAuth app credentials are incorrect. Please contact the administrator. (GitHub error: incorrect_client_credentials)";
        } else if (tokenData.error === "redirect_uri_mismatch") {
          friendlyMessage = "The OAuth redirect URI does not match the registered GitHub app. Please contact the administrator. (GitHub error: redirect_uri_mismatch)";
        } else {
          friendlyMessage = tokenData.error_description
            ? `Failed to exchange authorization code: ${tokenData.error_description} (${tokenData.error})`
            : `Failed to complete sign-in with GitHub. Error code: ${tokenData.error}. Please try again.`;
        }
        const errorUrl = buildErrorUrl(appUrl, tokenData.error, friendlyMessage);
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

      if (!userResponse.ok) {
        const errorUrl = buildErrorUrl(
          appUrl,
          "user_fetch_failed",
          `Signed in successfully but failed to retrieve your GitHub profile (HTTP ${userResponse.status}). Please try again.`
        );
        console.log("[callback] user fetch failed, status:", userResponse.status);
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

      const userData = await userResponse.json();

      if (userData.message) {
        const errorUrl = buildErrorUrl(
          appUrl,
          "user_fetch_error",
          `Failed to retrieve your GitHub profile: ${userData.message}. Please try again.`
        );
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: errorUrl },
        });
      }

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
