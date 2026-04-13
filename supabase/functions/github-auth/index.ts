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

async function fetchUserOrgs(accessToken: string) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  const [orgsResp, membershipsResp] = await Promise.all([
    fetch("https://api.github.com/user/orgs?per_page=100", { headers }),
    fetch(
      "https://api.github.com/user/memberships/orgs?state=active&per_page=100",
      { headers }
    ),
  ]);

  const orgMap = new Map<
    string,
    {
      login: string;
      id: number | null;
      avatar_url: string;
      role: string;
      accessible: boolean;
    }
  >();

  if (membershipsResp.ok) {
    const memberships = await membershipsResp.json();
    for (const m of memberships) {
      orgMap.set(m.organization.login.toLowerCase(), {
        login: m.organization.login,
        id: m.organization.id ?? null,
        avatar_url: m.organization.avatar_url,
        role: m.role === "admin" ? "admin" : "member",
        accessible: false,
      });
    }
  }

  if (orgsResp.ok) {
    const orgs = await orgsResp.json();
    for (const org of orgs) {
      const key = org.login.toLowerCase();
      if (orgMap.has(key)) {
        orgMap.get(key)!.accessible = true;
      } else {
        orgMap.set(key, {
          login: org.login,
          id: org.id ?? null,
          avatar_url: org.avatar_url,
          role: "member",
          accessible: true,
        });
      }
    }
  }

  const oauthScopes =
    orgsResp.headers.get("X-OAuth-Scopes") ||
    membershipsResp.headers.get("X-OAuth-Scopes") ||
    null;

  return { orgs: Array.from(orgMap.values()), oauthScopes };
}

async function syncUserAndOrgs(
  userId: number,
  login: string,
  name: string | null,
  avatarUrl: string | null,
  email: string | null,
  accessToken: string,
  oauthScopes: string | null,
  orgs: Array<{
    login: string;
    id: number | null;
    avatar_url: string;
    role: string;
    accessible: boolean;
  }>
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
        accessible: org.accessible,
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
      (e) => !orgLogins.includes(e.org_login.toLowerCase())
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

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const redirectUri =
        Deno.env.get("GITHUB_REDIRECT_URI") ||
        `${supabaseUrl}/functions/v1/github-auth/callback`;

      const redirectTo =
        url.searchParams.get("redirect_to") || "https://pr-review.com";

      const nonce = crypto.randomUUID();
      const statePayload = btoa(JSON.stringify({ nonce, redirectTo }));
      const scope = "read:user read:org repo";

      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(statePayload)}`;

      return jsonResponse({
        url: githubAuthUrl,
        state: statePayload,
        client_id: clientId,
      });
    }

    if (path === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const githubError = url.searchParams.get("error");
      const githubErrorDescription = url.searchParams.get("error_description");

      let appUrl = "https://pr-review.com";

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

      const { orgs, oauthScopes } = await fetchUserOrgs(
        tokenData.access_token
      );

      const sessionToken = await syncUserAndOrgs(
        userData.id,
        userData.login,
        userData.name,
        userData.avatar_url,
        userData.email,
        tokenData.access_token,
        oauthScopes,
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

    if (path === "revoke-grant") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      const { data: user } = await supabase
        .from("app_users")
        .select("github_user_id, access_token")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return jsonResponse({ error: "OAuth not configured" }, 500);
      }

      const revokeResponse = await fetch(
        `https://api.github.com/applications/${clientId}/grant`,
        {
          method: "DELETE",
          headers: {
            Authorization:
              "Basic " + btoa(`${clientId}:${clientSecret}`),
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: user.access_token }),
        }
      );

      if (revokeResponse.status === 204 || revokeResponse.status === 200) {
        await supabase
          .from("user_orgs")
          .delete()
          .eq("github_user_id", user.github_user_id);

        await supabase
          .from("app_users")
          .delete()
          .eq("github_user_id", user.github_user_id);

        return jsonResponse({ success: true });
      }

      const body = await revokeResponse.text();
      console.error(
        "[revoke-grant] GitHub API error:",
        revokeResponse.status,
        body
      );

      return jsonResponse({
        success: true,
        note: "Grant may already have been revoked",
      });
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
        .select(
          "github_user_id, login, name, avatar_url, email, oauth_scopes"
        )
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
        .select("github_user_id")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const { data: orgs } = await supabase
        .from("user_orgs")
        .select("org_login, org_id, org_avatar_url, role, accessible, last_synced_at")
        .eq("github_user_id", user.github_user_id)
        .order("org_login");

      return jsonResponse({ orgs: orgs || [] });
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

      return jsonResponse({
        pending: results.slice(0, 2),
        reviewed: results[2],
        username: user.login,
        rateLimitRemaining,
        rateLimitReset,
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
    return jsonResponse({ error: error.message }, 500);
  }
});
