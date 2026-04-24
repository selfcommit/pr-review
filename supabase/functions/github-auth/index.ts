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

const TEAMS_SYNC_INTERVAL_MS = 5 * 60 * 1000;

interface TeamInfo {
  slug: string;
  name: string;
  id: number | null;
  org_login: string;
}

async function fetchUserTeams(accessToken: string): Promise<TeamInfo[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  const teams: TeamInfo[] = [];
  let page = 1;

  while (page <= 10) {
    const resp = await fetch(
      `https://api.github.com/user/teams?per_page=100&page=${page}`,
      { headers }
    );

    if (!resp.ok) {
      console.error("[fetchUserTeams] failed:", resp.status);
      break;
    }

    const items = await resp.json();
    if (!Array.isArray(items) || items.length === 0) break;

    for (const t of items) {
      teams.push({
        slug: t.slug,
        name: t.name || t.slug,
        id: t.id ?? null,
        org_login: t.organization?.login || "",
      });
    }

    if (items.length < 100) break;
    page++;
  }

  return teams;
}

async function syncUserTeams(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string
) {
  const teams = await fetchUserTeams(accessToken);

  for (const team of teams) {
    await supabase.from("user_teams").upsert(
      {
        github_user_id: githubUserId,
        org_login: team.org_login,
        team_slug: team.slug,
        team_name: team.name,
        team_id: team.id,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "github_user_id,org_login,team_slug" }
    );
  }

  const teamKeys = new Set(
    teams.map((t) => `${t.org_login.toLowerCase()}/${t.slug.toLowerCase()}`)
  );
  const { data: existing } = await supabase
    .from("user_teams")
    .select("id, org_login, team_slug")
    .eq("github_user_id", githubUserId);

  if (existing) {
    const toRemove = existing.filter(
      (e: { org_login: string; team_slug: string }) =>
        !teamKeys.has(
          `${e.org_login.toLowerCase()}/${e.team_slug.toLowerCase()}`
        )
    );
    for (const r of toRemove) {
      await supabase.from("user_teams").delete().eq("id", r.id);
    }
  }

  await supabase
    .from("app_users")
    .update({ teams_last_synced_at: new Date().toISOString() })
    .eq("github_user_id", githubUserId);

  console.log(
    `[syncUserTeams] Synced ${teams.length} team(s) for user ${githubUserId}`
  );
}

function ensureUserTeamsFresh(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  teamsLastSyncedAt: string | null
) {
  if (teamsLastSyncedAt) {
    const elapsed = Date.now() - new Date(teamsLastSyncedAt).getTime();
    if (elapsed < TEAMS_SYNC_INTERVAL_MS) return;
  }

  try {
    // @ts-ignore: EdgeRuntime available in Supabase edge functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        syncUserTeams(supabase, githubUserId, accessToken)
      );
    } else {
      syncUserTeams(supabase, githubUserId, accessToken).catch((err) =>
        console.error("[ensureUserTeamsFresh] background sync failed", err)
      );
    }
  } catch {
    syncUserTeams(supabase, githubUserId, accessToken).catch((err) =>
      console.error("[ensureUserTeamsFresh] background sync failed", err)
    );
  }
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

interface ReviewRequestedTimelineNode {
  __typename?: string;
  createdAt?: string;
  requestedReviewer?: { __typename?: string; login?: string };
}

async function fetchReviewRequestedAtBatch(
  accessToken: string,
  items: Array<{ id: number; number: number; repoFullName: string }>,
  targetLogin: string
): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  if (items.length === 0) return result;

  const loginLower = targetLogin.toLowerCase();
  const chunkSize = 20;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const aliases = chunk.map((item, idx) => {
      const [owner, repo] = item.repoFullName.split("/");
      return `pr${idx}: repository(owner: "${owner}", name: "${repo}") {
        pullRequest(number: ${item.number}) {
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT], last: 50) {
            nodes {
              __typename
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  __typename
                  ... on User { login }
                }
              }
              ... on ReadyForReviewEvent {
                createdAt
              }
            }
          }
        }
      }`;
    });

    const query = `query { ${aliases.join(" ")} }`;

    try {
      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) {
        console.error(
          `[fetchReviewRequestedAtBatch] graphql failed: ${resp.status}`
        );
        continue;
      }

      const data = await resp.json();
      if (!data || !data.data) {
        console.error(
          "[fetchReviewRequestedAtBatch] empty graphql response",
          data?.errors
        );
        continue;
      }

      chunk.forEach((item, idx) => {
        try {
          const pr = data.data[`pr${idx}`]?.pullRequest;
          if (!pr) return;
          const nodes: ReviewRequestedTimelineNode[] =
            pr.timelineItems?.nodes || [];

          let latestReviewRequested: string | null = null;
          let latestReadyForReview: string | null = null;

          for (const node of nodes) {
            if (!node?.createdAt) continue;
            if (node.__typename === "ReviewRequestedEvent") {
              if (
                node.requestedReviewer?.__typename === "User" &&
                node.requestedReviewer.login?.toLowerCase() === loginLower
              ) {
                latestReviewRequested = node.createdAt;
              }
            } else if (node.__typename === "ReadyForReviewEvent") {
              latestReadyForReview = node.createdAt;
            }
          }

          if (!latestReviewRequested) return;

          if (
            latestReadyForReview &&
            new Date(latestReadyForReview) > new Date(latestReviewRequested)
          ) {
            result[item.id] = latestReadyForReview;
          } else {
            result[item.id] = latestReviewRequested;
          }
        } catch (err) {
          console.error(
            `[fetchReviewRequestedAtBatch] parse failed for ${item.repoFullName}#${item.number}`,
            err
          );
        }
      });
    } catch (err) {
      console.error("[fetchReviewRequestedAtBatch] request failed", err);
    }
  }

  return result;
}

const STATS_WINDOW_DAYS = 120;
const STATS_BACKFILL_TTL_MS = 30 * 60 * 1000;
const COMMENT_RECHECK_TTL_MS = 5 * 60 * 1000;

const RUNNER_EMOJI_REGEX = /(:runner:|\uD83C\uDFC3)/i;

function commentDeclinesReview(body: string | null | undefined): boolean {
  if (!body) return false;
  return RUNNER_EMOJI_REGEX.test(body);
}

interface BackfillCommentNode {
  databaseId?: number;
  createdAt?: string;
  bodyText?: string;
  author?: { login?: string };
}

function findDeclineComment(
  comments: BackfillCommentNode[],
  loginLower: string
): { declinedAt: string; commentId: number } | null {
  let best: { declinedAt: string; commentId: number } | null = null;
  for (const c of comments) {
    if (!c?.createdAt || typeof c.databaseId !== "number") continue;
    if ((c.author?.login || "").toLowerCase() !== loginLower) continue;
    if (!commentDeclinesReview(c.bodyText)) continue;
    if (!best || new Date(c.createdAt) < new Date(best.declinedAt)) {
      best = { declinedAt: c.createdAt, commentId: c.databaseId };
    }
  }
  return best;
}

interface BackfillPr {
  id: number;
  number: number;
  repoFullName: string;
  title: string;
  html_url: string;
}

async function searchPrsForBackfill(
  accessToken: string,
  query: string,
  maxPages = 3
): Promise<BackfillPr[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github.v3+json",
  };
  const result: BackfillPr[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
      { headers }
    );
    if (!resp.ok) {
      console.error("[searchPrsForBackfill] failed", resp.status, query);
      break;
    }
    const data = await resp.json();
    const items: Array<{
      id: number;
      number: number;
      title?: string;
      html_url?: string;
      repository_url?: string;
    }> = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const repoFullName = (item.repository_url || "")
        .split("/")
        .slice(-2)
        .join("/");
      if (!repoFullName) continue;
      result.push({
        id: item.id,
        number: item.number,
        repoFullName,
        title: item.title || "",
        html_url: item.html_url || "",
      });
    }
    if (items.length < 100) break;
  }
  return result;
}

interface BackfillTimelineNode {
  __typename?: string;
  createdAt?: string;
  requestedReviewer?: { __typename?: string; login?: string };
}

interface BackfillReviewNode {
  databaseId?: number;
  state?: string;
  submittedAt?: string;
  author?: { login?: string };
}

async function fetchBackfillDetailsBatch(
  accessToken: string,
  items: BackfillPr[],
  targetLogin: string
): Promise<
  Record<
    number,
    {
      reviewRequestedAt: string | null;
      reviews: Array<{ id: number; state: string; submittedAt: string }>;
      decline: { declinedAt: string; commentId: number } | null;
    }
  >
> {
  const loginLower = targetLogin.toLowerCase();
  const result: Record<
    number,
    {
      reviewRequestedAt: string | null;
      reviews: Array<{ id: number; state: string; submittedAt: string }>;
      decline: { declinedAt: string; commentId: number } | null;
    }
  > = {};
  if (items.length === 0) return result;

  const chunkSize = 15;
  const chunks: BackfillPr[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  await Promise.all(chunks.map(async (chunk) => {
    const aliases = chunk.map((item, idx) => {
      const [owner, repo] = item.repoFullName.split("/");
      return `pr${idx}: repository(owner: "${owner}", name: "${repo}") {
        pullRequest(number: ${item.number}) {
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT], last: 50) {
            nodes {
              __typename
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer { __typename ... on User { login } }
              }
              ... on ReadyForReviewEvent { createdAt }
            }
          }
          reviews(first: 50) {
            nodes {
              databaseId
              state
              submittedAt
              author { login }
            }
          }
          comments(last: 50) {
            nodes {
              databaseId
              createdAt
              bodyText
              author { login }
            }
          }
        }
      }`;
    });

    const query = `query { ${aliases.join(" ")} }`;
    try {
      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ query }),
      });
      if (!resp.ok) {
        console.error("[fetchBackfillDetailsBatch] failed", resp.status);
        return;
      }
      const data = await resp.json();
      if (!data?.data) return;

      chunk.forEach((item, idx) => {
        const pr = data.data[`pr${idx}`]?.pullRequest;
        if (!pr) return;

        let latestReviewRequested: string | null = null;
        let latestReadyForReview: string | null = null;
        const timelineNodes: BackfillTimelineNode[] =
          pr.timelineItems?.nodes || [];
        for (const node of timelineNodes) {
          if (!node?.createdAt) continue;
          if (node.__typename === "ReviewRequestedEvent") {
            const rev = node.requestedReviewer;
            if (
              rev?.__typename === "User" &&
              rev?.login?.toLowerCase() === loginLower
            ) {
              if (
                !latestReviewRequested ||
                new Date(node.createdAt) > new Date(latestReviewRequested)
              ) {
                latestReviewRequested = node.createdAt;
              }
            }
          } else if (node.__typename === "ReadyForReviewEvent") {
            if (
              !latestReadyForReview ||
              new Date(node.createdAt) > new Date(latestReadyForReview)
            ) {
              latestReadyForReview = node.createdAt;
            }
          }
        }

        let reviewRequestedAt: string | null = latestReviewRequested;
        if (
          latestReadyForReview &&
          (!reviewRequestedAt ||
            new Date(latestReadyForReview) > new Date(reviewRequestedAt))
        ) {
          reviewRequestedAt = latestReadyForReview;
        }

        const reviewNodes: BackfillReviewNode[] = pr.reviews?.nodes || [];
        const reviews = reviewNodes
          .filter(
            (r) =>
              r.author?.login?.toLowerCase() === loginLower &&
              r.submittedAt &&
              typeof r.databaseId === "number"
          )
          .map((r) => ({
            id: r.databaseId as number,
            state: (r.state || "COMMENTED").toLowerCase(),
            submittedAt: r.submittedAt as string,
          }));

        const commentNodes: BackfillCommentNode[] = pr.comments?.nodes || [];
        const decline = findDeclineComment(commentNodes, loginLower);

        result[item.id] = { reviewRequestedAt, reviews, decline };
      });
    } catch (err) {
      console.error("[fetchBackfillDetailsBatch] error", err);
    }
  }));

  return result;
}

async function backfillUserPrReviews(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  login: string,
  lastBackfilledAt: string | null
): Promise<boolean> {
  if (lastBackfilledAt) {
    const ageMs = Date.now() - new Date(lastBackfilledAt).getTime();
    if (ageMs < STATS_BACKFILL_TTL_MS) return false;
  }

  const windowStart = new Date(
    Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const dateStr = windowStart.toISOString().slice(0, 10);

  try {
    const [reviewedPrs, requestedPrs] = await Promise.all([
      searchPrsForBackfill(
        accessToken,
        `is:pr reviewed-by:@me updated:>=${dateStr}`
      ),
      searchPrsForBackfill(
        accessToken,
        `is:pr review-requested:@me updated:>=${dateStr}`
      ),
    ]);

    const byId = new Map<number, BackfillPr>();
    for (const p of [...reviewedPrs, ...requestedPrs]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    const candidates = Array.from(byId.values()).slice(0, 500);
    if (candidates.length === 0) {
      await supabase
        .from("app_users")
        .update({ stats_backfilled_at: new Date().toISOString() })
        .eq("github_user_id", githubUserId);
      return true;
    }

    const { data: existingReviews } = await supabase
      .from("pr_reviews")
      .select("pr_id, review_id")
      .eq("github_user_id", githubUserId)
      .in("pr_id", candidates.map((c) => c.id));

    const existingReviewIds = new Set<string>(
      (existingReviews || []).map(
        (r: { pr_id: number; review_id: number }) =>
          `${r.pr_id}:${r.review_id}`
      )
    );
    const prsWithReviews = new Set<number>(
      (existingReviews || []).map((r: { pr_id: number }) => r.pr_id)
    );

    const prsToFetch = candidates.filter((c) => !prsWithReviews.has(c.id));
    if (prsToFetch.length === 0) {
      await supabase
        .from("app_users")
        .update({ stats_backfilled_at: new Date().toISOString() })
        .eq("github_user_id", githubUserId);
      return true;
    }

    const details = await fetchBackfillDetailsBatch(
      accessToken,
      prsToFetch,
      login
    );

    const declineRows: Record<string, unknown>[] = [];
    const reviewRequestRows: Record<string, unknown>[] = [];
    const reviewRows: Record<string, unknown>[] = [];

    for (const pr of prsToFetch) {
      const detail = details[pr.id];
      if (!detail) continue;

      if (detail.decline) {
        declineRows.push({
          github_user_id: githubUserId,
          pr_id: pr.id,
          pr_number: pr.number,
          repo_full_name: pr.repoFullName,
          pr_title: pr.title,
          pr_html_url: pr.html_url,
          declined_at: detail.decline.declinedAt,
          comment_id: detail.decline.commentId,
        });
      }

      if (detail.reviewRequestedAt) {
        reviewRequestRows.push({
          github_user_id: githubUserId,
          pr_id: pr.id,
          pr_number: pr.number,
          repo_full_name: pr.repoFullName,
          review_requested_at: detail.reviewRequestedAt,
          is_fallback_timestamp: false,
        });
      }

      const requestedMs = detail.reviewRequestedAt
        ? new Date(detail.reviewRequestedAt).getTime()
        : null;

      for (const review of detail.reviews) {
        const key = `${pr.id}:${review.id}`;
        if (existingReviewIds.has(key)) continue;

        let latencySeconds: number | null = null;
        if (requestedMs) {
          const diff = Math.floor(
            (new Date(review.submittedAt).getTime() - requestedMs) / 1000
          );
          if (diff >= 0) latencySeconds = diff;
        }

        reviewRows.push({
          github_user_id: githubUserId,
          pr_id: pr.id,
          pr_number: pr.number,
          repo_full_name: pr.repoFullName,
          pr_title: pr.title,
          pr_html_url: pr.html_url,
          review_id: review.id,
          review_state: review.state,
          submitted_at: review.submittedAt,
          latency_seconds: latencySeconds,
        });
      }
    }

    const batchUpserts: Promise<unknown>[] = [];
    if (declineRows.length > 0) {
      batchUpserts.push(
        supabase.from("pr_declines").upsert(declineRows, {
          onConflict: "github_user_id,pr_id",
          ignoreDuplicates: true,
        })
      );
    }
    if (reviewRequestRows.length > 0) {
      batchUpserts.push(
        supabase.from("review_requests").upsert(reviewRequestRows, {
          onConflict: "github_user_id,pr_id",
        })
      );
    }
    if (reviewRows.length > 0) {
      batchUpserts.push(
        supabase.from("pr_reviews").upsert(reviewRows, {
          onConflict: "github_user_id,review_id",
        })
      );
    }
    await Promise.all(batchUpserts);

    await supabase
      .from("app_users")
      .update({ stats_backfilled_at: new Date().toISOString() })
      .eq("github_user_id", githubUserId);

    return true;
  } catch (err) {
    console.error("[backfillUserPrReviews] failed", err);
    return false;
  }
}

async function fetchPrReviewStatusBatch(
  accessToken: string,
  items: Array<{ id: number; number: number; repoFullName: string }>
): Promise<Record<number, { review_decision: string | null; mergeable: string | null }>> {
  const result: Record<number, { review_decision: string | null; mergeable: string | null }> = {};
  if (items.length === 0) return result;

  const chunkSize = 20;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const aliases = chunk.map((item, idx) => {
      const [owner, repo] = item.repoFullName.split("/");
      return `pr${idx}: repository(owner: "${owner}", name: "${repo}") {
        pullRequest(number: ${item.number}) {
          reviewDecision
          mergeable
        }
      }`;
    });

    const query = `query { ${aliases.join(" ")} }`;

    try {
      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) {
        console.error(
          `[fetchPrReviewStatusBatch] graphql failed: ${resp.status}`
        );
        continue;
      }

      const data = await resp.json();
      if (!data || !data.data) {
        console.error(
          "[fetchPrReviewStatusBatch] empty graphql response",
          data?.errors
        );
        continue;
      }

      chunk.forEach((item, idx) => {
        const pr = data.data[`pr${idx}`]?.pullRequest;
        if (!pr) return;
        result[item.id] = {
          review_decision: pr.reviewDecision ?? null,
          mergeable: pr.mergeable ?? null,
        };
      });
    } catch (err) {
      console.error("[fetchPrReviewStatusBatch] request failed", err);
    }
  }

  return result;
}

async function fetchDeclineCommentsBatch(
  accessToken: string,
  items: Array<{ id: number; number: number; repoFullName: string }>,
  targetLogin: string
): Promise<Record<number, { declinedAt: string; commentId: number }>> {
  const result: Record<number, { declinedAt: string; commentId: number }> = {};
  if (items.length === 0) return result;

  const loginLower = targetLogin.toLowerCase();
  const chunkSize = 15;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const aliases = chunk.map((item, idx) => {
      const [owner, repo] = item.repoFullName.split("/");
      return `pr${idx}: repository(owner: "${owner}", name: "${repo}") {
        pullRequest(number: ${item.number}) {
          comments(last: 50) {
            nodes {
              databaseId
              createdAt
              bodyText
              author { login }
            }
          }
        }
      }`;
    });

    const query = `query { ${aliases.join(" ")} }`;
    try {
      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ query }),
      });
      if (!resp.ok) {
        console.error("[fetchDeclineCommentsBatch] failed", resp.status);
        continue;
      }
      const data = await resp.json();
      if (!data?.data) continue;

      chunk.forEach((item, idx) => {
        const pr = data.data[`pr${idx}`]?.pullRequest;
        if (!pr) return;
        const commentNodes: BackfillCommentNode[] = pr.comments?.nodes || [];
        const decline = findDeclineComment(commentNodes, loginLower);
        if (decline) result[item.id] = decline;
      });
    } catch (err) {
      console.error("[fetchDeclineCommentsBatch] error", err);
    }
  }

  return result;
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
  last_comment_check_at?: string | null;
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
    new Date(snap.pr_updated_at).getTime() !== new Date(fields.pr_updated_at).getTime()
  );
}

interface TeamApprovalResult {
  team_approval_required: boolean;
}

async function fetchTeamApprovalStatus(
  accessToken: string,
  items: GitHubSearchItem[],
  userLogin: string,
  userTeamKeys: Set<string>
): Promise<Record<number, TeamApprovalResult>> {
  const result: Record<number, TeamApprovalResult> = {};
  if (items.length === 0) return result;

  const prFragment = `
    reviewRequests(first: 50) {
      nodes {
        requestedReviewer {
          __typename
          ... on Team { slug organization { login } }
          ... on User { login }
        }
      }
    }
    latestReviews(first: 50) {
      nodes {
        author { login }
        state
        onBehalfOf(first: 10) {
          nodes { slug organization { login } }
        }
      }
    }
    timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
      nodes {
        ... on ReviewRequestedEvent {
          requestedReviewer {
            __typename
            ... on Team { slug organization { login } }
          }
        }
      }
    }
  `;

  const aliases = items.map((item, idx) => {
    const repoFullName = item.repository_url.split("/").slice(-2).join("/");
    const [owner, repo] = repoFullName.split("/");
    return `pr${idx}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${item.number}) { id ${prFragment} } }`;
  });

  const query = `query { ${aliases.join(" ")} }`;

  try {
    const resp = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ query }),
    });

    if (!resp.ok) {
      console.error("[fetchTeamApprovalStatus] graphql failed", resp.status);
      for (const item of items) {
        result[item.id] = { team_approval_required: true };
      }
      return result;
    }

    const data = await resp.json();
    if (!data || !data.data) {
      for (const item of items) {
        result[item.id] = { team_approval_required: true };
      }
      return result;
    }

    items.forEach((item, idx) => {
      const node = data.data[`pr${idx}`];
      const pr = node?.pullRequest;
      if (!pr) {
        result[item.id] = { team_approval_required: true };
        return;
      }

      const loginLower = userLogin.toLowerCase();

      const individuallyRequested = (pr.reviewRequests?.nodes || []).some(
        (rr: { requestedReviewer?: { __typename?: string; login?: string } }) =>
          rr.requestedReviewer?.__typename === "User" &&
          rr.requestedReviewer?.login?.toLowerCase() === loginLower
      );

      const pendingTeamKeys = new Set<string>();
      for (const rr of pr.reviewRequests?.nodes || []) {
        const rev = rr.requestedReviewer;
        if (rev?.__typename === "Team" && rev.slug && rev.organization?.login) {
          const key = `${rev.organization.login.toLowerCase()}/${rev.slug.toLowerCase()}`;
          pendingTeamKeys.add(key);
        }
      }

      const everRequestedTeamKeys = new Set<string>(pendingTeamKeys);
      for (const tl of pr.timelineItems?.nodes || []) {
        const rev = tl?.requestedReviewer;
        if (rev?.__typename === "Team" && rev.slug && rev.organization?.login) {
          const key = `${rev.organization.login.toLowerCase()}/${rev.slug.toLowerCase()}`;
          everRequestedTeamKeys.add(key);
        }
      }

      const relevantTeams = new Set<string>();
      for (const key of everRequestedTeamKeys) {
        if (userTeamKeys.has(key)) relevantTeams.add(key);
      }

      const hasChangesRequested = (pr.latestReviews?.nodes || []).some(
        (review: { state?: string }) => review.state === "CHANGES_REQUESTED"
      );

      if (hasChangesRequested) {
        result[item.id] = { team_approval_required: false };
        return;
      }

      if (individuallyRequested) {
        result[item.id] = { team_approval_required: true };
        return;
      }

      if (relevantTeams.size === 0) {
        result[item.id] = { team_approval_required: true };
        return;
      }

      const approvedTeamKeys = new Set<string>();
      for (const review of pr.latestReviews?.nodes || []) {
        if (review.state === "APPROVED") {
          for (const behalf of review.onBehalfOf?.nodes || []) {
            if (behalf.slug && behalf.organization?.login) {
              const key = `${behalf.organization.login.toLowerCase()}/${behalf.slug.toLowerCase()}`;
              approvedTeamKeys.add(key);
            }
          }
        }
      }

      let anyUnapproved = false;
      for (const teamKey of relevantTeams) {
        if (!approvedTeamKeys.has(teamKey)) {
          anyUnapproved = true;
          break;
        }
      }

      result[item.id] = { team_approval_required: anyUnapproved };
    });
  } catch (err) {
    console.error("[fetchTeamApprovalStatus] error", err);
    for (const item of items) {
      result[item.id] = { team_approval_required: true };
    }
  }

  return result;
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
  prItems: Array<{ id: number; number: number; repoFullName: string; prCreatedAt?: string }>,
  forceRefreshIds: Set<number> = new Set()
): Promise<Record<number, string>> {
  const timestamps: Record<number, string> = {};
  if (prItems.length === 0) return timestamps;

  const prIds = prItems.map((p) => p.id);
  const { data: cached } = await supabase
    .from("review_requests")
    .select("pr_id, review_requested_at, is_fallback_timestamp")
    .eq("github_user_id", githubUserId)
    .in("pr_id", prIds);

  const cachedFallbackIds = new Set<number>();
  if (cached) {
    for (const row of cached) {
      if (row.is_fallback_timestamp) cachedFallbackIds.add(row.pr_id);
      if (!forceRefreshIds.has(row.pr_id)) {
        timestamps[row.pr_id] = row.review_requested_at;
      }
    }
  }

  const uncachedItems = prItems.filter(
    (p) =>
      forceRefreshIds.has(p.id) ||
      cachedFallbackIds.has(p.id) ||
      !timestamps[p.id]
  );

  if (uncachedItems.length > 0) {
    const fetched = await fetchReviewRequestedAtBatch(
      accessToken,
      uncachedItems,
      login
    );

    for (const item of uncachedItems) {
      const accurateTs = fetched[item.id];

      if (accurateTs) {
        timestamps[item.id] = accurateTs;
        await supabase.from("review_requests").upsert(
          {
            github_user_id: githubUserId,
            pr_id: item.id,
            pr_number: item.number,
            repo_full_name: item.repoFullName,
            review_requested_at: accurateTs,
            is_fallback_timestamp: false,
          },
          { onConflict: "github_user_id,pr_id" }
        );
      } else if (!timestamps[item.id] && item.prCreatedAt) {
        timestamps[item.id] = item.prCreatedAt;
        await supabase.from("review_requests").upsert(
          {
            github_user_id: githubUserId,
            pr_id: item.id,
            pr_number: item.number,
            repo_full_name: item.repoFullName,
            review_requested_at: item.prCreatedAt,
            is_fallback_timestamp: true,
          },
          { onConflict: "github_user_id,pr_id" }
        );
        console.warn(
          `[resolveReviewTimestamps] fallback to PR created_at for ${item.repoFullName}#${item.number}`
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

      const supabaseForCallback = getSupabaseAdmin();
      ensureUserTeamsFresh(
        supabaseForCallback,
        userData.id,
        tokenData.access_token,
        null
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
        .select("github_user_id, access_token, login, teams_last_synced_at")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      ensureUserTeamsFresh(
        supabase,
        user.github_user_id,
        user.access_token,
        user.teams_last_synced_at
      );

      const { data: userTeamRows } = await supabase
        .from("user_teams")
        .select("org_login, team_slug")
        .eq("github_user_id", user.github_user_id);

      const userTeamKeys = new Set<string>(
        (userTeamRows || []).map(
          (t: { org_login: string; team_slug: string }) =>
            `${t.org_login.toLowerCase()}/${t.team_slug.toLowerCase()}`
        )
      );

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

      const reviewReqItems: GitHubSearchItem[] =
        reviewReqResult.items && Array.isArray(reviewReqResult.items)
          ? (reviewReqResult.items as GitHubSearchItem[])
          : [];
      const reviewedItemsArr: GitHubSearchItem[] =
        reviewedResult.items && Array.isArray(reviewedResult.items)
          ? (reviewedResult.items as GitHubSearchItem[])
          : [];

      const prItems = reviewReqItems.map((item) => ({
        id: item.id,
        number: item.number,
        repoFullName: item.repository_url.split("/").slice(-2).join("/"),
        prCreatedAt: item.created_at,
      }));

      const [timestampsResult, , , approvalStatusResult] = await Promise.all([
        prItems.length > 0
          ? resolveReviewTimestamps(
              supabase,
              user.github_user_id,
              user.access_token,
              user.login,
              prItems
            )
          : Promise.resolve({} as Record<number, string>),
        reviewReqItems.length > 0
          ? syncSnapshots(supabase, user.github_user_id, reviewReqItems)
          : Promise.resolve(),
        reviewedItemsArr.length > 0
          ? syncPrReviewsForItems(
              supabase,
              user.github_user_id,
              user.access_token,
              reviewedItemsArr
            )
          : Promise.resolve(),
        reviewReqItems.length > 0
          ? fetchTeamApprovalStatus(
              user.access_token,
              reviewReqItems,
              user.login,
              userTeamKeys
            )
          : Promise.resolve({} as Record<number, TeamApprovalResult>),
      ]);

      const reviewTimestamps: Record<number, string> = timestampsResult;
      const approvalStatus = approvalStatusResult;

      for (const item of reviewReqItems as Array<
        GitHubSearchItem & { team_approval_required?: boolean }
      >) {
        const status = approvalStatus[item.id];
        item.team_approval_required = status?.team_approval_required ?? true;
      }

      const responsePayload = {
        reviewRequested: reviewReqResult,
        reviewed: reviewedResult,
        reviewTimestamps,
        username: user.login,
        rateLimitRemaining,
        rateLimitReset,
        oauthScopes,
      };

      const cacheWrite = supabase
        .from("user_pr_cache")
        .upsert(
          {
            github_user_id: user.github_user_id,
            payload: responsePayload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "github_user_id" }
        )
        .then(() => {})
        .catch((err: unknown) =>
          console.error("[pull-requests] cache write failed", err)
        );

      try {
        // @ts-ignore: EdgeRuntime available in Supabase edge functions
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(cacheWrite);
        } else {
          await cacheWrite;
        }
      } catch {
        await cacheWrite;
      }

      return jsonResponse(responsePayload);
    }

    if (path === "pull-requests-cached") {
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

      const { data: row } = await supabase
        .from("user_pr_cache")
        .select("payload, updated_at")
        .eq("github_user_id", user.github_user_id)
        .maybeSingle();

      if (!row) {
        return jsonResponse({ cached: false });
      }

      return jsonResponse({
        cached: true,
        updatedAt: row.updated_at,
        ...(row.payload as Record<string, unknown>),
      });
    }

    if (path === "pull-requests-mine") {
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

      const runSearch = (query: string) =>
        fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`,
          { headers: ghHeaders }
        );

      const [authoredResp, assignedResp] = await Promise.all([
        runSearch("is:open is:pr author:@me archived:false"),
        runSearch("is:open is:pr assignee:@me archived:false"),
      ]);

      if (authoredResp.status === 401 || assignedResp.status === 401) {
        return jsonResponse(
          { error: "GitHub token expired", code: "token_expired" },
          401
        );
      }

      const parseItems = async (resp: Response) => {
        const raw = await resp.json();
        if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
          return raw.items as Array<Record<string, unknown>>;
        }
        return [] as Array<Record<string, unknown>>;
      };

      const [authoredItems, assignedItems] = await Promise.all([
        parseItems(authoredResp),
        parseItems(assignedResp),
      ]);

      const byId = new Map<unknown, Record<string, unknown>>();
      for (const item of [...authoredItems, ...assignedItems]) {
        const id = (item as { id?: unknown }).id;
        if (id !== undefined && !byId.has(id)) {
          byId.set(id, item);
        }
      }
      const items = Array.from(byId.values());

      const minRemaining = (a: string | null, b: string | null) => {
        if (a === null) return b;
        if (b === null) return a;
        return Number(a) <= Number(b) ? a : b;
      };

      const rateLimitRemaining = minRemaining(
        authoredResp.headers.get("X-RateLimit-Remaining"),
        assignedResp.headers.get("X-RateLimit-Remaining")
      );
      const rateLimitReset =
        authoredResp.headers.get("X-RateLimit-Reset") ||
        assignedResp.headers.get("X-RateLimit-Reset") ||
        null;

      const statusItems = items
        .map((item) => {
          const id = (item as { id?: number }).id;
          const number = (item as { number?: number }).number;
          const repoUrl = (item as { repository_url?: string }).repository_url || "";
          const repoFullName = repoUrl.split("/").slice(-2).join("/");
          if (typeof id !== "number" || typeof number !== "number" || !repoFullName) {
            return null;
          }
          return { id, number, repoFullName };
        })
        .filter((x): x is { id: number; number: number; repoFullName: string } => x !== null);

      const statusMap = await fetchPrReviewStatusBatch(user.access_token, statusItems);

      const enrichedItems = items.map((item) => {
        const id = (item as { id?: number }).id;
        if (typeof id === "number" && statusMap[id]) {
          return {
            ...item,
            review_decision: statusMap[id].review_decision,
            mergeable: statusMap[id].mergeable,
          };
        }
        return item;
      });

      return jsonResponse({
        mine: { items: enrichedItems, total_count: enrichedItems.length },
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

      const { data: userTeamRows } = await supabase
        .from("user_teams")
        .select("org_login, team_slug")
        .eq("github_user_id", user.github_user_id);

      const userTeamKeys = new Set<string>(
        (userTeamRows || []).map(
          (t: { org_login: string; team_slug: string }) =>
            `${t.org_login.toLowerCase()}/${t.team_slug.toLowerCase()}`
        )
      );

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

      const rawFreshItems: GitHubSearchItem[] = Array.isArray(searchResult.items)
        ? searchResult.items
        : [];

      const { data: declinedRows } = await supabase
        .from("pr_declines")
        .select("pr_id")
        .eq("github_user_id", user.github_user_id);

      const declinedIds = new Set<number>(
        (declinedRows || []).map((r: { pr_id: number }) => r.pr_id)
      );

      let freshItems = rawFreshItems.filter((i) => !declinedIds.has(i.id));

      const { data: snapshots } = await supabase
        .from("user_pr_snapshots")
        .select(
          "id, pr_id, pr_number, repo_full_name, state, draft, title, html_url, author_login, author_avatar_url, pull_request_merged, pr_updated_at, last_comment_check_at"
        )
        .eq("github_user_id", user.github_user_id);

      const snapMap = new Map<number, SnapshotRow>();
      if (snapshots) {
        for (const s of snapshots) {
          snapMap.set(s.pr_id, s as SnapshotRow);
        }
      }

      let freshIdSet = new Set(freshItems.map((i) => i.id));
      let updatedItems: GitHubSearchItem[] = [];
      let newItems: GitHubSearchItem[] = [];
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

      const nowMs = Date.now();
      const commentCheckCandidates: GitHubSearchItem[] = [];
      const seenCheckIds = new Set<number>();
      const addCheckCandidate = (item: GitHubSearchItem) => {
        if (seenCheckIds.has(item.id)) return;
        seenCheckIds.add(item.id);
        commentCheckCandidates.push(item);
      };
      for (const item of newItems) addCheckCandidate(item);
      for (const item of updatedItems) addCheckCandidate(item);
      for (const item of freshItems) {
        const snap = snapMap.get(item.id);
        if (!snap) continue;
        const last = snap.last_comment_check_at
          ? new Date(snap.last_comment_check_at).getTime()
          : 0;
        if (nowMs - last >= COMMENT_RECHECK_TTL_MS) addCheckCandidate(item);
      }

      if (commentCheckCandidates.length > 0) {
        const declineItems = commentCheckCandidates.map((item) => ({
          id: item.id,
          number: item.number,
          repoFullName: item.repository_url.split("/").slice(-2).join("/"),
        }));
        const declines = await fetchDeclineCommentsBatch(
          user.access_token,
          declineItems,
          user.login
        );

        const newlyDeclinedIds = new Set<number>();
        for (const item of commentCheckCandidates) {
          const decline = declines[item.id];
          if (!decline) continue;
          newlyDeclinedIds.add(item.id);
          declinedIds.add(item.id);
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          await supabase.from("pr_declines").upsert(
            {
              github_user_id: user.github_user_id,
              pr_id: item.id,
              pr_number: item.number,
              repo_full_name: repoFullName,
              pr_title: item.title || "",
              pr_html_url: item.html_url || "",
              declined_at: decline.declinedAt,
              comment_id: decline.commentId,
            },
            { onConflict: "github_user_id,pr_id", ignoreDuplicates: true }
          );
        }

        if (newlyDeclinedIds.size > 0) {
          await supabase
            .from("user_pr_snapshots")
            .delete()
            .eq("github_user_id", user.github_user_id)
            .in("pr_id", Array.from(newlyDeclinedIds));

          for (const id of newlyDeclinedIds) {
            if (snapMap.has(id)) removedPrIds.push(id);
            snapMap.delete(id);
          }

          freshItems = freshItems.filter((i) => !newlyDeclinedIds.has(i.id));
          newItems = newItems.filter((i) => !newlyDeclinedIds.has(i.id));
          updatedItems = updatedItems.filter((i) => !newlyDeclinedIds.has(i.id));
          freshIdSet = new Set(freshItems.map((i) => i.id));
        }

        const checkedIds = commentCheckCandidates
          .map((i) => i.id)
          .filter((id) => !newlyDeclinedIds.has(id));
        if (checkedIds.length > 0) {
          await supabase
            .from("user_pr_snapshots")
            .update({ last_comment_check_at: new Date(nowMs).toISOString() })
            .eq("github_user_id", user.github_user_id)
            .in("pr_id", checkedIds);
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
          prCreatedAt: item.created_at,
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

      const itemsNeedingApproval = [...newItems, ...updatedItems];
      if (itemsNeedingApproval.length > 0) {
        const approvalStatus = await fetchTeamApprovalStatus(
          user.access_token,
          itemsNeedingApproval,
          user.login,
          userTeamKeys
        );
        const applyApproval = (item: GitHubSearchItem & { team_approval_required?: boolean }) => {
          const status = approvalStatus[item.id];
          item.team_approval_required = status?.team_approval_required ?? true;
        };
        for (const item of newItems as Array<GitHubSearchItem & { team_approval_required?: boolean }>) {
          applyApproval(item);
        }
        for (const item of updatedItems as Array<GitHubSearchItem & { team_approval_required?: boolean }>) {
          applyApproval(item);
        }
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
        .select("github_user_id, access_token, login, stats_backfilled_at")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      await backfillUserPrReviews(
        supabase,
        user.github_user_id,
        user.access_token,
        user.login,
        user.stats_backfilled_at
      );

      const { data: freshUser } = await supabase
        .from("app_users")
        .select("stats_backfilled_at")
        .eq("github_user_id", user.github_user_id)
        .maybeSingle();

      const windowStartIso = new Date(
        Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const [{ data: reviews }, { data: declines }] = await Promise.all([
        supabase
          .from("pr_reviews")
          .select(
            "review_id, pr_id, pr_number, pr_title, pr_html_url, repo_full_name, review_state, submitted_at, latency_seconds"
          )
          .eq("github_user_id", user.github_user_id)
          .gte("submitted_at", windowStartIso),
        supabase
          .from("pr_declines")
          .select("pr_id, repo_full_name, declined_at")
          .eq("github_user_id", user.github_user_id)
          .gte("declined_at", windowStartIso),
      ]);

      const declineRows = (declines || []) as Array<{
        pr_id: number;
        repo_full_name: string;
      }>;
      const declinedPrIds = new Set<number>(declineRows.map((d) => d.pr_id));
      const declinedByRepo = new Map<string, number>();
      for (const d of declineRows) {
        declinedByRepo.set(
          d.repo_full_name,
          (declinedByRepo.get(d.repo_full_name) || 0) + 1
        );
      }

      const rows = (reviews || []).filter(
        (r: { pr_id: number }) => !declinedPrIds.has(r.pr_id)
      );

      interface IncludedPr {
        review_id: number;
        pr_id: number;
        pr_number: number;
        title: string;
        html_url: string;
        latency_seconds: number;
        review_state: string;
        submitted_at: string;
        repo: string;
      }

      interface RepoAgg {
        repo: string;
        total: number;
        approved: number;
        changesRequested: number;
        commented: number;
        reviewEvents: IncludedPr[];
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
            reviewEvents: [],
          };
          byRepo.set(repo, agg);
        }
        agg.total += 1;
        const state = (r.review_state as string) || "commented";
        if (state === "approved") agg.approved += 1;
        else if (state === "changes_requested") agg.changesRequested += 1;
        else agg.commented += 1;

        const lat = r.latency_seconds as number | null;
        if (
          typeof lat === "number" &&
          lat >= 0 &&
          (state === "approved" || state === "changes_requested")
        ) {
          agg.reviewEvents.push({
            review_id: r.review_id as number,
            pr_id: r.pr_id as number,
            pr_number: r.pr_number as number,
            title: (r.pr_title as string) || "",
            html_url: (r.pr_html_url as string) || "",
            latency_seconds: lat,
            review_state: state,
            submitted_at: r.submitted_at as string,
            repo: repo,
          });
        }
      }

      function percentile(values: number[], p: number): number | null {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
      }

      for (const repo of declinedByRepo.keys()) {
        if (!byRepo.has(repo)) {
          byRepo.set(repo, {
            repo,
            total: 0,
            approved: 0,
            changesRequested: 0,
            commented: 0,
            reviewEvents: [],
          });
        }
      }

      const perRepo = Array.from(byRepo.values()).map((agg) => {
        const allPrs = agg.reviewEvents.slice().sort(
          (a, b) => b.latency_seconds - a.latency_seconds
        );
        const latencies = allPrs.map((p) => p.latency_seconds);
        const p90 = percentile(latencies, 90);
        const excluded_prs =
          p90 === null
            ? []
            : allPrs.filter((p) => p.latency_seconds > p90);
        const prs = p90 === null
          ? allPrs
          : allPrs.filter((p) => p.latency_seconds <= p90);
        return {
          repo: agg.repo,
          total_reviews: agg.total,
          approved: agg.approved,
          changes_requested: agg.changesRequested,
          commented: agg.commented,
          declined: declinedByRepo.get(agg.repo) || 0,
          p90_latency_seconds: p90,
          latency_sample_size: latencies.length,
          prs,
          excluded_prs,
        };
      });

      perRepo.sort((a, b) => (b.total_reviews + b.declined) - (a.total_reviews + a.declined));

      const allGlobalPrs = perRepo.flatMap((r) =>
        [...r.prs, ...r.excluded_prs]
      );
      const allLatencies = allGlobalPrs.map((p) => p.latency_seconds);
      const globalP90 = percentile(allLatencies, 90);

      const summaryExcludedPrs =
        globalP90 === null
          ? []
          : allGlobalPrs
              .filter((p) => p.latency_seconds > globalP90)
              .sort((a, b) => b.latency_seconds - a.latency_seconds);
      const summaryPrs =
        globalP90 === null
          ? allGlobalPrs.sort((a, b) => b.latency_seconds - a.latency_seconds)
          : allGlobalPrs
              .filter((p) => p.latency_seconds <= globalP90)
              .sort((a, b) => b.latency_seconds - a.latency_seconds);

      const summary = {
        total_reviews: perRepo.reduce((s, r) => s + r.total_reviews, 0),
        approved: perRepo.reduce((s, r) => s + r.approved, 0),
        changes_requested: perRepo.reduce(
          (s, r) => s + r.changes_requested,
          0
        ),
        commented: perRepo.reduce((s, r) => s + r.commented, 0),
        declined: declinedPrIds.size,
        p90_latency_seconds: globalP90,
        latency_sample_size: allLatencies.length,
        prs: summaryPrs,
        excluded_prs: summaryExcludedPrs,
      };

      return jsonResponse({
        summary,
        repos: perRepo,
        window_days: STATS_WINDOW_DAYS,
        backfilled_at: freshUser?.stats_backfilled_at ?? null,
      });
    }

    if (path === "activity") {
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

      const url = new URL(req.url);
      const daysParam = parseInt(url.searchParams.get("days") || "7", 10);
      const days = Math.min(Math.max(daysParam, 1), 120);

      const windowStart = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000
      ).toISOString();

      const [{ data: reviews }, { data: declines }] = await Promise.all([
        supabase
          .from("pr_reviews")
          .select(
            "pr_id, pr_number, pr_title, pr_html_url, repo_full_name, review_state, submitted_at"
          )
          .eq("github_user_id", user.github_user_id)
          .gte("submitted_at", windowStart)
          .order("submitted_at", { ascending: false }),
        supabase
          .from("pr_declines")
          .select(
            "pr_id, pr_number, pr_title, pr_html_url, repo_full_name, declined_at"
          )
          .eq("github_user_id", user.github_user_id)
          .gte("declined_at", windowStart)
          .order("declined_at", { ascending: false }),
      ]);

      interface ActivityItem {
        pr_id: number;
        pr_number: number;
        pr_title: string;
        pr_html_url: string;
        repo_full_name: string;
        event_type: string;
        timestamp: string;
      }

      const events: ActivityItem[] = [];

      for (const r of reviews || []) {
        events.push({
          pr_id: r.pr_id as number,
          pr_number: r.pr_number as number,
          pr_title: (r.pr_title as string) || "",
          pr_html_url: (r.pr_html_url as string) || "",
          repo_full_name: (r.repo_full_name as string) || "",
          event_type: (r.review_state as string) || "commented",
          timestamp: r.submitted_at as string,
        });
      }

      for (const d of declines || []) {
        events.push({
          pr_id: d.pr_id as number,
          pr_number: d.pr_number as number,
          pr_title: (d.pr_title as string) || "",
          pr_html_url: (d.pr_html_url as string) || "",
          repo_full_name: (d.repo_full_name as string) || "",
          event_type: "declined",
          timestamp: d.declined_at as string,
        });
      }

      events.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return jsonResponse({ events, days });
    }

    if (path === "audio-state") {
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

      if (req.method === "GET") {
        const { data: state } = await supabase
          .from("user_audio_state")
          .select("audio_unlocked, last_unlocked_at")
          .eq("github_user_id", user.github_user_id)
          .maybeSingle();

        return jsonResponse({
          audio_unlocked: state?.audio_unlocked ?? false,
          last_unlocked_at: state?.last_unlocked_at ?? null,
        });
      }

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const audioUnlocked = body?.audio_unlocked === true;

        await supabase.from("user_audio_state").upsert(
          {
            github_user_id: user.github_user_id,
            audio_unlocked: audioUnlocked,
            last_unlocked_at: audioUnlocked ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "github_user_id" }
        );

        return jsonResponse({ success: true });
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
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
