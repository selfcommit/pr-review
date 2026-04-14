import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}

function buildErrorUrl(
  appUrl: string,
  code: string,
  message: string
): string {
  return `${appUrl}/#auth_error=${encodeURIComponent(message)}&auth_error_code=${encodeURIComponent(code)}`;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

interface OrgInfo {
  login: string;
  id: number | null;
  avatar_url: string;
  role: string;
}

async function fetchUserOrgs(accessToken: string): Promise<OrgInfo[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  const orgsResp = await fetch(
    "https://api.github.com/user/orgs?per_page=100",
    { headers }
  );

  if (!orgsResp.ok) {
    console.error(
      "[fetchUserOrgs] /user/orgs fetch failed:",
      orgsResp.status,
      await orgsResp.text()
    );
    return [];
  }

  const userOrgs = await orgsResp.json();
  console.log(
    `[fetchUserOrgs] Found ${userOrgs.length} org membership(s)`
  );

  return userOrgs.map((org: { login: string; id?: number; avatar_url: string }) => ({
    login: org.login,
    id: org.id ?? null,
    avatar_url: org.avatar_url,
    role: "member",
  }));
}

async function syncUserAndOrgs(
  userId: number,
  login: string,
  name: string | null,
  avatarUrl: string | null,
  email: string | null,
  accessToken: string,
  oauthScopes: string | null,
  orgs: OrgInfo[]
) {
  const supabase = getSupabaseAdmin();

  const { data: existingUser } = await supabase
    .from("app_users")
    .select("session_token")
    .eq("github_user_id", userId)
    .maybeSingle();

  const sessionToken = existingUser?.session_token || crypto.randomUUID();

  await supabase.from("app_users").upsert(
    {
      github_user_id: userId,
      login,
      name,
      avatar_url: avatarUrl,
      email,
      access_token: accessToken,
      oauth_scopes: oauthScopes,
      session_token: sessionToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "github_user_id" }
  );

  for (const org of orgs) {
    await supabase.from("user_orgs").upsert(
      {
        github_user_id: userId,
        org_login: org.login,
        org_id: org.id,
        org_avatar_url: org.avatar_url,
        role: org.role,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "github_user_id,org_login" }
    );
  }

  const orgLogins = orgs.map((o) => o.login.toLowerCase());
  const { data: existing } = await supabase
    .from("user_orgs")
    .select("id, org_login")
    .eq("github_user_id", userId);

  if (existing) {
    const toRemove = existing.filter(
      (e: { org_login: string }) =>
        !orgLogins.includes(e.org_login.toLowerCase())
    );
    for (const r of toRemove) {
      await supabase.from("user_orgs").delete().eq("id", r.id);
    }
  }

  return sessionToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    if (path === "login") {
      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      if (!clientId) {
        return jsonResponse(
          {
            error: "oauth_not_configured",
            message: "GitHub OAuth is not configured on this server.",
          },
          500
        );
      }

      const redirectTo =
        url.searchParams.get("redirect_to") || Deno.env.get("APP_URL") || "https://pr-review.com";

      const nonce = crypto.randomUUID();
      const statePayload = btoa(JSON.stringify({ nonce, redirectTo }));

      const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/github-auth/callback`;
      const scope = "repo read:org";
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(statePayload)}&scope=${encodeURIComponent(scope)}`;

      return jsonResponse({
        url: authUrl,
        state: statePayload,
        client_id: clientId,
      });
    }

    if (path === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const githubError = url.searchParams.get("error");
      const githubErrorDescription = url.searchParams.get("error_description");

      let appUrl = Deno.env.get("APP_URL") || "https://pr-review.com";

      try {
        if (state) {
          const parsed = JSON.parse(atob(state));
          if (parsed.redirectTo) appUrl = parsed.redirectTo;
        }
      } catch {
        return redirectResponse(
          buildErrorUrl(
            appUrl,
            "invalid_state",
            "The sign-in session data was corrupted. Please try again."
          )
        );
      }

      if (githubError) {
        let msg: string;
        if (githubError === "access_denied") {
          msg = "You cancelled the sign-in request on GitHub.";
        } else {
          msg = githubErrorDescription
            ? `GitHub error: ${githubErrorDescription} (${githubError})`
            : `GitHub error: ${githubError}`;
        }
        return redirectResponse(buildErrorUrl(appUrl, githubError, msg));
      }

      if (!code) {
        return redirectResponse(
          buildErrorUrl(
            appUrl,
            "no_code",
            "No authorization code was received from GitHub."
          )
        );
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return redirectResponse(
          buildErrorUrl(
            appUrl,
            "oauth_not_configured",
            "GitHub OAuth credentials are not configured."
          )
        );
      }

      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        }
      );

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        let msg: string;
        if (tokenData.error === "bad_verification_code") {
          msg = "The authorization code expired or has already been used.";
        } else {
          msg = tokenData.error_description || tokenData.error;
        }
        return redirectResponse(buildErrorUrl(appUrl, tokenData.error, msg));
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!userResponse.ok) {
        return redirectResponse(
          buildErrorUrl(
            appUrl,
            "user_fetch_failed",
            `Failed to retrieve your GitHub profile (HTTP ${userResponse.status}).`
          )
        );
      }

      const userData = await userResponse.json();
      if (userData.message) {
        return redirectResponse(
          buildErrorUrl(
            appUrl,
            "user_fetch_error",
            `Failed to retrieve profile: ${userData.message}`
          )
        );
      }

      const grantedScopes = tokenData.scope || null;
      console.log(`[callback] Token scopes granted: ${grantedScopes || "(none)"}`);

      const orgs = await fetchUserOrgs(tokenData.access_token);

      const sessionToken = await syncUserAndOrgs(
        userData.id,
        userData.login,
        userData.name,
        userData.avatar_url,
        userData.email,
        tokenData.access_token,
        grantedScopes,
        orgs
      );

      const user = {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        avatar_url: userData.avatar_url,
      };

      const params = new URLSearchParams({
        session_token: sessionToken,
        user: JSON.stringify(user),
        state: state || "",
      });

      return redirectResponse(`${appUrl}/#${params.toString()}`);
    }

    if (path === "session") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      const { data: user } = await supabase
        .from("app_users")
        .select("github_user_id, login, name, avatar_url, email")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      return jsonResponse({ user });
    }

    if (path === "orgs") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      const { data: user } = await supabase
        .from("app_users")
        .select("github_user_id, access_token, oauth_scopes")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const refresh = url.searchParams.get("refresh") === "true";
      if (refresh) {
        const orgs = await fetchUserOrgs(user.access_token);
        for (const org of orgs) {
          await supabase.from("user_orgs").upsert(
            {
              github_user_id: user.github_user_id,
              org_login: org.login,
              org_id: org.id,
              org_avatar_url: org.avatar_url,
              role: org.role,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "github_user_id,org_login" }
          );
        }
        const orgLogins = orgs.map((o) => o.login.toLowerCase());
        const { data: existing } = await supabase
          .from("user_orgs")
          .select("id, org_login")
          .eq("github_user_id", user.github_user_id);
        if (existing) {
          const toRemove = existing.filter(
            (e: { org_login: string }) =>
              !orgLogins.includes(e.org_login.toLowerCase())
          );
          for (const r of toRemove) {
            await supabase.from("user_orgs").delete().eq("id", r.id);
          }
        }
      }

      const { data: orgs } = await supabase
        .from("user_orgs")
        .select(
          "org_login, org_id, org_avatar_url, role, last_synced_at"
        )
        .eq("github_user_id", user.github_user_id)
        .order("org_login");

      return jsonResponse({
        orgs: orgs || [],
        oauthScopes: user.oauth_scopes || null,
      });
    }

    if (path === "pull-requests") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      const { data: user } = await supabase
        .from("app_users")
        .select("access_token, login")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const headers = {
        Authorization: `Bearer ${user.access_token}`,
        Accept: "application/vnd.github.v3+json",
      };

      const pendingQueries = [
        "is:open is:pr review-requested:@me",
        "is:open is:pr assignee:@me",
      ];
      const reviewedQuery = "is:pr reviewed-by:@me sort:updated-desc";
      const allQueries = [...pendingQueries, reviewedQuery];

      const responses = await Promise.all(
        allQueries.map((q) =>
          fetch(
            `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${q === reviewedQuery ? "30" : "100"}`,
            { headers }
          )
        )
      );

      for (const resp of responses) {
        if (resp.status === 401) {
          return jsonResponse(
            { error: "GitHub token expired", code: "token_expired" },
            401
          );
        }
      }

      const results = await Promise.all(responses.map((r) => r.json()));

      const rateLimitRemaining =
        responses[0]?.headers.get("X-RateLimit-Remaining") || null;
      const rateLimitReset =
        responses[0]?.headers.get("X-RateLimit-Reset") || null;
      const oauthScopes =
        responses[0]?.headers.get("X-OAuth-Scopes") || null;

      return jsonResponse({
        pending: results.slice(0, 2),
        reviewed: results[2],
        username: user.login,
        rateLimitRemaining,
        rateLimitReset,
        oauthScopes,
      });
    }

    if (path === "logout") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ success: true });
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      await supabase
        .from("app_users")
        .update({
          session_token: crypto.randomUUID(),
          updated_at: new Date().toISOString(),
        })
        .eq("session_token", sessionToken);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid path" }, 404);
  } catch (error) {
    console.error("Auth error:", error);
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
