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

async function fetchReviewRequestedAt(
  accessToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  targetLogin: string
): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  let latestReviewRequested: string | null = null;
  let latestReadyForReview: string | null = null;
  let page = 1;
  const perPage = 100;

  while (page <= 5) {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/timeline?per_page=${perPage}&page=${page}`,
      { headers }
    );

    if (!resp.ok) {
      console.error(
        `[fetchTimeline] Failed for ${owner}/${repo}#${prNumber}: ${resp.status}`
      );
      break;
    }

    const events = await resp.json();
    if (!Array.isArray(events) || events.length === 0) break;

    for (const event of events) {
      if (event.event === "review_requested") {
        const reviewer = event.requested_reviewer;
        if (
          reviewer &&
          reviewer.login?.toLowerCase() === targetLogin.toLowerCase()
        ) {
          latestReviewRequested = event.created_at;
        }
      } else if (event.event === "ready_for_review") {
        latestReadyForReview = event.created_at;
      }
    }

    if (events.length < perPage) break;
    page++;
  }

  if (!latestReviewRequested) return null;

  if (
    latestReadyForReview &&
    new Date(latestReadyForReview) > new Date(latestReviewRequested)
  ) {
    return latestReadyForReview;
  }

  return latestReviewRequested;
}

interface SnapshotRow {
  id: string;
  pr_id: number;
  pr_number: number;
  repo_full_name: string;
  state: string;
  draft: boolean;
  title: string;
  html_url: string;
  author_login: string;
  author_avatar_url: string;
  pull_request_merged: boolean;
  pr_updated_at: string;
}

interface GitHubSearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  updated_at: string;
  created_at: string;
  repository_url: string;
  user: { login: string; avatar_url: string };
  pull_request?: { merged_at?: string };
}

function extractSnapshotFields(item: GitHubSearchItem) {
  const repoFullName = item.repository_url.split("/").slice(-2).join("/");
  return {
    pr_id: item.id,
    pr_number: item.number,
    repo_full_name: repoFullName,
    state: item.state || "open",
    draft: item.draft || false,
    title: item.title || "",
    html_url: item.html_url || "",
    author_login: item.user?.login || "",
    author_avatar_url: item.user?.avatar_url || "",
    pull_request_merged: item.pull_request?.merged_at != null,
    pr_updated_at: item.updated_at,
  };
}

async function syncSnapshots(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  items: GitHubSearchItem[]
) {
  const now = new Date().toISOString();

  for (const item of items) {
    const fields = extractSnapshotFields(item);
    await supabase.from("user_pr_snapshots").upsert(
      {
        github_user_id: githubUserId,
        ...fields,
        snapshot_at: now,
      },
      { onConflict: "github_user_id,pr_id" }
    );
  }

  const currentPrIds = items.map((i) => i.id);
  const { data: allSnaps } = await supabase
    .from("user_pr_snapshots")
    .select("id, pr_id")
    .eq("github_user_id", githubUserId);

  if (allSnaps) {
    const stale = allSnaps.filter(
      (s: { pr_id: number }) => !currentPrIds.includes(s.pr_id)
    );
    for (const row of stale) {
      await supabase.from("user_pr_snapshots").delete().eq("id", row.id);
    }
  }
}

function snapshotChanged(snap: SnapshotRow, item: GitHubSearchItem): boolean {
  const fields = extractSnapshotFields(item);
  return (
    snap.state !== fields.state ||
    snap.draft !== fields.draft ||
    snap.title !== fields.title ||
    snap.pull_request_merged !== fields.pull_request_merged ||
    snap.pr_updated_at !== fields.pr_updated_at
  );
}

interface GitHubReview {
  id: number;
  user?: { id: number; login: string } | null;
  state: string;
  submitted_at: string | null;
}

async function syncPrReviewsForItems(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  reviewedItems: GitHubSearchItem[],
  maxPrsToFetch = 8
) {
  if (reviewedItems.length === 0) return;

  const prIds = reviewedItems.map((i) => i.id);
  const { data: existing } = await supabase
    .from("pr_reviews")
    .select("pr_id")
    .eq("github_user_id", githubUserId)
    .in("pr_id", prIds);

  const alreadyTracked = new Set<number>(
    (existing || []).map((r: { pr_id: number }) => r.pr_id)
  );

  const toFetch = reviewedItems
    .filter((item) => !alreadyTracked.has(item.id))
    .slice(0, maxPrsToFetch);

  if (toFetch.length === 0) return;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  await Promise.all(
    toFetch.map(async (item) => {
      const repoFullName = item.repository_url.split("/").slice(-2).join("/");
      const [owner, repo] = repoFullName.split("/");
      try {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${item.number}/reviews?per_page=100`,
          { headers }
        );
        if (!resp.ok) return;
        const reviews = (await resp.json()) as GitHubReview[];
        if (!Array.isArray(reviews)) return;

        const mine = reviews.filter(
          (r) => r.user && r.user.id === githubUserId && r.submitted_at
        );
        if (mine.length === 0) return;

        const { data: reqRow } = await supabase
          .from("review_requests")
          .select("id, review_requested_at, reviewed_at")
          .eq("github_user_id", githubUserId)
          .eq("pr_id", item.id)
          .maybeSingle();

        const requestedAt = reqRow?.review_requested_at
          ? new Date(reqRow.review_requested_at).getTime()
          : null;

        for (const review of mine) {
          const submittedAt = review.submitted_at as string;
          let latencySeconds: number | null = null;
          if (requestedAt) {
            const diff = Math.floor(
              (new Date(submittedAt).getTime() - requestedAt) / 1000
            );
            if (diff >= 0) latencySeconds = diff;
          }

          await supabase.from("pr_reviews").upsert(
            {
              github_user_id: githubUserId,
              pr_id: item.id,
              pr_number: item.number,
              repo_full_name: repoFullName,
              pr_title: item.title || "",
              pr_html_url: item.html_url || "",
              review_id: review.id,
              review_state: (review.state || "commented").toLowerCase(),
              submitted_at: submittedAt,
              latency_seconds: latencySeconds,
            },
            { onConflict: "github_user_id,review_id" }
          );
        }

        const firstCompletion = mine
          .filter((r) => {
            const s = (r.state || "").toUpperCase();
            return s === "APPROVED" || s === "CHANGES_REQUESTED";
          })
          .map((r) => r.submitted_at as string)
          .sort()[0];

        if (firstCompletion && reqRow && !reqRow.reviewed_at) {
          await supabase
            .from("review_requests")
            .update({ reviewed_at: firstCompletion })
            .eq("id", reqRow.id);
        }
      } catch (err) {
        console.error("[syncPrReviewsForItems] failed", item.id, err);
      }
    })
  );
}

async function resolveReviewTimestamps(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  login: string,
  prItems: Array<{ id: number; number: number; repoFullName: string }>,
  forceRefreshIds: Set<number> = new Set()
): Promise<Record<number, string>> {
  const timestamps: Record<number, string> = {};
  if (prItems.length === 0) return timestamps;

  const prIds = prItems.map((p) => p.id);
  const { data: cached } = await supabase
    .from("review_requests")
    .select("pr_id, review_requested_at")
    .eq("github_user_id", githubUserId)
    .in("pr_id", prIds);

  if (cached) {
    for (const row of cached) {
      if (!forceRefreshIds.has(row.pr_id)) {
        timestamps[row.pr_id] = row.review_requested_at;
      }
    }
  }

  const uncachedItems = prItems.filter((p) => !timestamps[p.id]);

  const batchSize = 5;
  for (let i = 0; i < uncachedItems.length; i += batchSize) {
    const batch = uncachedItems.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (item) => {
        const [owner, repo] = item.repoFullName.split("/");
        const ts = await fetchReviewRequestedAt(
          accessToken,
          owner,
          repo,
          item.number,
          login
        );
        return { item, ts };
      })
    );

    for (const { item, ts } of results) {
      if (ts) {
        timestamps[item.id] = ts;
        await supabase.from("review_requests").upsert(
          {
            github_user_id: githubUserId,
            pr_id: item.id,
            pr_number: item.number,
            repo_full_name: item.repoFullName,
            review_requested_at: ts,
          },
          { onConflict: "github_user_id,pr_id" }
        );
      }
    }
  }

  const currentPrIds = prItems.map((p) => p.id);
  const { data: allCached } = await supabase
    .from("review_requests")
    .select("id, pr_id")
    .eq("github_user_id", githubUserId);

  if (allCached) {
    const stale = allCached.filter((r: { pr_id: number }) => !currentPrIds.includes(r.pr_id));
    for (const row of stale) {
      await supabase.from("review_requests").delete().eq("id", row.id);
    }
  }

  return timestamps;
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
        .select("github_user_id, access_token, login")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const ghHeaders = {
        Authorization: `Bearer ${user.access_token}`,
        Accept: "application/vnd.github.v3+json",
      };

      const reviewRequestedQuery = "is:open is:pr user-review-requested:@me";
      const reviewedQuery = "is:pr reviewed-by:@me sort:updated-desc";

      const [reviewReqResp, reviewedResp] = await Promise.all([
        fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(reviewRequestedQuery)}&per_page=100`,
          { headers: ghHeaders }
        ),
        fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(reviewedQuery)}&per_page=30`,
          { headers: ghHeaders }
        ),
      ]);

      if (reviewReqResp.status === 401 || reviewedResp.status === 401) {
        return jsonResponse(
          { error: "GitHub token expired", code: "token_expired" },
          401
        );
      }

      const [reviewReqRaw, reviewedRaw] = await Promise.all([
        reviewReqResp.json(),
        reviewedResp.json(),
      ]);

      const reviewReqResult = reviewReqRaw && typeof reviewReqRaw === "object"
        ? reviewReqRaw
        : { items: [], total_count: 0 };
      const reviewedResult = reviewedRaw && typeof reviewedRaw === "object"
        ? reviewedRaw
        : { items: [], total_count: 0 };

      if (reviewReqResult.items && !Array.isArray(reviewReqResult.items)) {
        reviewReqResult.items = [];
      }
      if (reviewedResult.items && !Array.isArray(reviewedResult.items)) {
        reviewedResult.items = [];
      }

      const rateLimitRemaining =
        reviewReqResp.headers.get("X-RateLimit-Remaining") || null;
      const rateLimitReset =
        reviewReqResp.headers.get("X-RateLimit-Reset") || null;
      const oauthScopes =
        reviewReqResp.headers.get("X-OAuth-Scopes") || null;

      let reviewTimestamps: Record<number, string> = {};

      if (reviewReqResult.items && Array.isArray(reviewReqResult.items)) {
        const prItems = reviewReqResult.items.map(
          (item: { id: number; number: number; repository_url: string }) => ({
            id: item.id,
            number: item.number,
            repoFullName: item.repository_url.split("/").slice(-2).join("/"),
          })
        );

        reviewTimestamps = await resolveReviewTimestamps(
          supabase,
          user.github_user_id,
          user.access_token,
          user.login,
          prItems
        );
      }

      if (reviewReqResult.items && Array.isArray(reviewReqResult.items)) {
        await syncSnapshots(
          supabase,
          user.github_user_id,
          reviewReqResult.items as GitHubSearchItem[]
        );
      }

      if (reviewedResult.items && Array.isArray(reviewedResult.items)) {
        await syncPrReviewsForItems(
          supabase,
          user.github_user_id,
          user.access_token,
          reviewedResult.items as GitHubSearchItem[]
        );
      }

      return jsonResponse({
        reviewRequested: reviewReqResult,
        reviewed: reviewedResult,
        reviewTimestamps,
        username: user.login,
        rateLimitRemaining,
        rateLimitReset,
        oauthScopes,
      });
    }

    if (path === "pull-requests-assigned") {
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

      const ghHeaders = {
        Authorization: `Bearer ${user.access_token}`,
        Accept: "application/vnd.github.v3+json",
      };

      const assignedQuery = "is:open is:pr assignee:@me";
      const resp = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`,
        { headers: ghHeaders }
      );

      if (resp.status === 401) {
        return jsonResponse(
          { error: "GitHub token expired", code: "token_expired" },
          401
        );
      }

      const resultRaw = await resp.json();
      const result = resultRaw && typeof resultRaw === "object"
        ? resultRaw
        : { items: [], total_count: 0 };
      if (result.items && !Array.isArray(result.items)) {
        result.items = [];
      }

      const rateLimitRemaining =
        resp.headers.get("X-RateLimit-Remaining") || null;
      const rateLimitReset =
        resp.headers.get("X-RateLimit-Reset") || null;

      return jsonResponse({
        assigned: result,
        username: user.login,
        rateLimitRemaining,
        rateLimitReset,
      });
    }

    if (path === "poll-reviews") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      const { data: user } = await supabase
        .from("app_users")
        .select("github_user_id, access_token, login")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const ghHeaders = {
        Authorization: `Bearer ${user.access_token}`,
        Accept: "application/vnd.github.v3+json",
      };

      const reviewRequestedQuery = "is:open is:pr user-review-requested:@me";
      const searchResp = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(reviewRequestedQuery)}&per_page=100`,
        { headers: ghHeaders }
      );

      if (searchResp.status === 401) {
        return jsonResponse(
          { error: "GitHub token expired", code: "token_expired" },
          401
        );
      }

      const rateLimitRemaining =
        searchResp.headers.get("X-RateLimit-Remaining") || null;
      const rateLimitReset =
        searchResp.headers.get("X-RateLimit-Reset") || null;

      const searchRaw = await searchResp.json();
      const searchResult =
        searchRaw && typeof searchRaw === "object"
          ? searchRaw
          : { items: [], total_count: 0 };
      if (searchResult.items && !Array.isArray(searchResult.items)) {
        searchResult.items = [];
      }

      const freshItems: GitHubSearchItem[] = Array.isArray(searchResult.items)
        ? searchResult.items
        : [];

      const { data: snapshots } = await supabase
        .from("user_pr_snapshots")
        .select(
          "id, pr_id, pr_number, repo_full_name, state, draft, title, html_url, author_login, author_avatar_url, pull_request_merged, pr_updated_at"
        )
        .eq("github_user_id", user.github_user_id);

      const snapMap = new Map<number, SnapshotRow>();
      if (snapshots) {
        for (const s of snapshots) {
          snapMap.set(s.pr_id, s as SnapshotRow);
        }
      }

      const freshIdSet = new Set(freshItems.map((i) => i.id));
      const updatedItems: GitHubSearchItem[] = [];
      const newItems: GitHubSearchItem[] = [];
      const removedPrIds: number[] = [];

      for (const item of freshItems) {
        const snap = snapMap.get(item.id);
        if (!snap) {
          newItems.push(item);
        } else if (snapshotChanged(snap, item)) {
          updatedItems.push(item);
        }
      }

      for (const [prId] of snapMap) {
        if (!freshIdSet.has(prId)) {
          removedPrIds.push(prId);
        }
      }

      const changed =
        updatedItems.length > 0 ||
        newItems.length > 0 ||
        removedPrIds.length > 0;

      const draftExitedItems: GitHubSearchItem[] = [];
      for (const item of updatedItems) {
        const snap = snapMap.get(item.id);
        if (snap && snap.draft === true && !item.draft) {
          draftExitedItems.push(item);
        }
      }

      const itemsNeedingTimestamps = [...newItems, ...draftExitedItems];
      const forceRefreshIds = new Set(draftExitedItems.map((i) => i.id));

      let newReviewTimestamps: Record<number, string> = {};
      if (itemsNeedingTimestamps.length > 0) {
        const prItems = itemsNeedingTimestamps.map((item) => ({
          id: item.id,
          number: item.number,
          repoFullName: item.repository_url.split("/").slice(-2).join("/"),
        }));

        newReviewTimestamps = await resolveReviewTimestamps(
          supabase,
          user.github_user_id,
          user.access_token,
          user.login,
          prItems,
          forceRefreshIds
        );
      }

      if (changed) {
        await syncSnapshots(supabase, user.github_user_id, freshItems);
      }

      return jsonResponse({
        changed,
        updatedPRs: updatedItems,
        removedPRIds: removedPrIds,
        newPRs: newItems,
        reviewTimestamps: newReviewTimestamps,
        rateLimitRemaining,
        rateLimitReset,
      });
    }

    if (path === "stats") {
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

      const { data: reviews } = await supabase
        .from("pr_reviews")
        .select(
          "pr_id, pr_number, pr_title, pr_html_url, repo_full_name, review_state, submitted_at, latency_seconds"
        )
        .eq("github_user_id", user.github_user_id);

      const rows = reviews || [];

      interface RepoAgg {
        repo: string;
        total: number;
        approved: number;
        changesRequested: number;
        commented: number;
        latencies: number[];
        prMap: Map<
          number,
          {
            pr_id: number;
            pr_number: number;
            title: string;
            html_url: string;
            latency_seconds: number;
            review_state: string;
            submitted_at: string;
          }
        >;
      }

      const byRepo = new Map<string, RepoAgg>();

      for (const r of rows) {
        const repo = r.repo_full_name as string;
        let agg = byRepo.get(repo);
        if (!agg) {
          agg = {
            repo,
            total: 0,
            approved: 0,
            changesRequested: 0,
            commented: 0,
            latencies: [],
            prMap: new Map(),
          };
          byRepo.set(repo, agg);
        }
        agg.total += 1;
        const state = (r.review_state as string) || "commented";
        if (state === "approved") agg.approved += 1;
        else if (state === "changes_requested") agg.changesRequested += 1;
        else agg.commented += 1;

        const lat = r.latency_seconds as number | null;
        if (typeof lat === "number" && lat >= 0) {
          const existingPr = agg.prMap.get(r.pr_id as number);
          if (
            (state === "approved" || state === "changes_requested") &&
            (!existingPr || new Date(r.submitted_at as string).getTime() <
              new Date(existingPr.submitted_at).getTime())
          ) {
            agg.prMap.set(r.pr_id as number, {
              pr_id: r.pr_id as number,
              pr_number: r.pr_number as number,
              title: (r.pr_title as string) || "",
              html_url: (r.pr_html_url as string) || "",
              latency_seconds: lat,
              review_state: state,
              submitted_at: r.submitted_at as string,
            });
          }
        }
      }

      function percentile(values: number[], p: number): number | null {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
      }

      const perRepo = Array.from(byRepo.values()).map((agg) => {
        const prs = Array.from(agg.prMap.values()).sort(
          (a, b) => b.latency_seconds - a.latency_seconds
        );
        const latencies = prs.map((p) => p.latency_seconds);
        return {
          repo: agg.repo,
          total_reviews: agg.total,
          approved: agg.approved,
          changes_requested: agg.changesRequested,
          commented: agg.commented,
          p90_latency_seconds: percentile(latencies, 90),
          latency_sample_size: latencies.length,
          prs,
        };
      });

      perRepo.sort((a, b) => b.total_reviews - a.total_reviews);

      const allLatencies = perRepo.flatMap((r) =>
        r.prs.map((p) => p.latency_seconds)
      );

      const summary = {
        total_reviews: perRepo.reduce((s, r) => s + r.total_reviews, 0),
        approved: perRepo.reduce((s, r) => s + r.approved, 0),
        changes_requested: perRepo.reduce(
          (s, r) => s + r.changes_requested,
          0
        ),
        commented: perRepo.reduce((s, r) => s + r.commented, 0),
        p90_latency_seconds: percentile(allLatencies, 90),
        latency_sample_size: allLatencies.length,
      };

      return jsonResponse({ summary, repos: perRepo });
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
