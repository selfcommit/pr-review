import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { decideReviewedState } from "./reviewedState.ts";

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

function isCustomScheme(url: string): boolean {
  return !url.startsWith("http://") && !url.startsWith("https://");
}

function redirectResponse(url: string) {
  if (isCustomScheme(url)) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting...</title></head><body><script>window.location.href=${JSON.stringify(url)};</script><noscript><a href="${url.replace(/"/g, "&quot;")}">Tap here to continue</a></noscript></body></html>`;
    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }
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

const ARCHIVED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchRepoArchivedStatusBatch(
  accessToken: string,
  repoFullNames: string[]
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  if (repoFullNames.length === 0) return result;

  const chunkSize = 20;

  for (let i = 0; i < repoFullNames.length; i += chunkSize) {
    const chunk = repoFullNames.slice(i, i + chunkSize);
    const aliases = chunk.map((fullName, idx) => {
      const [owner, repo] = fullName.split("/");
      return `repo${idx}: repository(owner: "${owner}", name: "${repo}") { isArchived }`;
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
        console.error(`[fetchRepoArchivedStatusBatch] graphql failed: ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      if (!data || !data.data) {
        console.error("[fetchRepoArchivedStatusBatch] empty graphql response", data?.errors);
        continue;
      }

      chunk.forEach((fullName, idx) => {
        const repoData = data.data[`repo${idx}`];
        if (repoData && typeof repoData.isArchived === "boolean") {
          result[fullName] = repoData.isArchived;
        }
      });
    } catch (err) {
      console.error("[fetchRepoArchivedStatusBatch] request failed", err);
    }
  }

  return result;
}

async function getArchivedRepos(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  accessToken: string,
  repoFullNames: string[]
): Promise<Set<string>> {
  if (repoFullNames.length === 0) return new Set();

  const { data: cachedRows } = await supabase
    .from("archived_repos")
    .select("repo_full_name, is_archived, checked_at")
    .in("repo_full_name", repoFullNames);

  const nowMs = Date.now();
  const archivedSet = new Set<string>();
  const needsCheck: string[] = [];
  const cachedMap = new Map<string, { is_archived: boolean; checked_at: string }>();

  for (const row of cachedRows || []) {
    cachedMap.set(row.repo_full_name, row);
  }

  for (const name of repoFullNames) {
    const cached = cachedMap.get(name);
    if (cached) {
      const age = nowMs - new Date(cached.checked_at).getTime();
      if (age < ARCHIVED_CACHE_TTL_MS) {
        if (cached.is_archived) archivedSet.add(name);
        continue;
      }
    }
    needsCheck.push(name);
  }

  if (needsCheck.length > 0) {
    const freshStatus = await fetchRepoArchivedStatusBatch(accessToken, needsCheck);
    const now = new Date().toISOString();

    for (const name of needsCheck) {
      const isArchived = freshStatus[name] ?? false;
      if (isArchived) archivedSet.add(name);

      await supabase.from("archived_repos").upsert(
        { repo_full_name: name, is_archived: isArchived, checked_at: now },
        { onConflict: "repo_full_name" }
      );
    }
  }

  return archivedSet;
}

const STATS_WINDOW_DAYS = 30;
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

async function applyDeclineRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  declineRows: Array<{
    pr_id: number;
    pr_number: number;
    repo_full_name: string;
    pr_title: string;
    pr_html_url: string;
    declined_at: string;
    comment_id: number;
  }>
): Promise<void> {
  if (declineRows.length === 0) return;
  const prIds = declineRows.map((r) => r.pr_id);

  await supabase.from("pr_declines").upsert(
    declineRows.map((r) => ({ github_user_id: githubUserId, ...r })),
    { onConflict: "github_user_id,pr_id", ignoreDuplicates: true }
  );

  await Promise.all([
    supabase
      .from("pr_reviews")
      .delete()
      .eq("github_user_id", githubUserId)
      .in("pr_id", prIds),
    supabase
      .from("review_requests")
      .delete()
      .eq("github_user_id", githubUserId)
      .in("pr_id", prIds),
    supabase
      .from("user_pr_snapshots")
      .delete()
      .eq("github_user_id", githubUserId)
      .in("pr_id", prIds),
  ]);
}

async function backfillUserPrReviews(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  login: string,
  lastBackfilledAt: string | null,
  force = false
): Promise<boolean> {
  if (!force && lastBackfilledAt) {
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
    const prsForDeclineOnly = candidates.filter((c) => prsWithReviews.has(c.id));

    if (prsForDeclineOnly.length > 0) {
      const existingDeclinesForCandidates = await supabase
        .from("pr_declines")
        .select("pr_id")
        .eq("github_user_id", githubUserId)
        .in("pr_id", prsForDeclineOnly.map((p) => p.id));
      const alreadyDeclined = new Set<number>(
        (existingDeclinesForCandidates.data || []).map(
          (r: { pr_id: number }) => r.pr_id
        )
      );
      const needComments = prsForDeclineOnly.filter(
        (p) => !alreadyDeclined.has(p.id)
      );
      if (needComments.length > 0) {
        const declines = await fetchDeclineCommentsBatch(
          accessToken,
          needComments.map((p) => ({
            id: p.id,
            number: p.number,
            repoFullName: p.repoFullName,
          })),
          login
        );
        const declineRowsAlreadyReviewed: Array<{
          pr_id: number;
          pr_number: number;
          repo_full_name: string;
          pr_title: string;
          pr_html_url: string;
          declined_at: string;
          comment_id: number;
        }> = [];
        for (const pr of needComments) {
          const decline = declines[pr.id];
          if (!decline) continue;
          declineRowsAlreadyReviewed.push({
            pr_id: pr.id,
            pr_number: pr.number,
            repo_full_name: pr.repoFullName,
            pr_title: pr.title,
            pr_html_url: pr.html_url,
            declined_at: decline.declinedAt,
            comment_id: decline.commentId,
          });
        }
        await applyDeclineRows(supabase, githubUserId, declineRowsAlreadyReviewed);
      }
    }

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

    const declineRows: Array<{
      pr_id: number;
      pr_number: number;
      repo_full_name: string;
      pr_title: string;
      pr_html_url: string;
      declined_at: string;
      comment_id: number;
    }> = [];
    const reviewRequestRows: Record<string, unknown>[] = [];
    const reviewRows: Record<string, unknown>[] = [];

    for (const pr of prsToFetch) {
      const detail = details[pr.id];
      if (!detail) continue;

      if (detail.decline) {
        declineRows.push({
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

    const declinedInThisBatch = new Set(declineRows.map((r) => r.pr_id));
    const filteredReviewRequestRows = reviewRequestRows.filter(
      (r) => !declinedInThisBatch.has(r.pr_id as number)
    );
    const filteredReviewRows = reviewRows.filter(
      (r) => !declinedInThisBatch.has(r.pr_id as number)
    );

    const batchUpserts: Promise<unknown>[] = [];
    if (filteredReviewRequestRows.length > 0) {
      batchUpserts.push(
        supabase.from("review_requests").upsert(filteredReviewRequestRows, {
          onConflict: "github_user_id,pr_id",
        })
      );
    }
    if (filteredReviewRows.length > 0) {
      batchUpserts.push(
        supabase.from("pr_reviews").upsert(filteredReviewRows, {
          onConflict: "github_user_id,review_id",
        })
      );
    }
    await Promise.all(batchUpserts);
    await applyDeclineRows(supabase, githubUserId, declineRows);

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

async function deepBackfillDeclines(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number,
  accessToken: string,
  login: string
): Promise<void> {
  const windowStart = new Date(
    Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const dateStr = windowStart.toISOString().slice(0, 10);

  try {
    const [reviewedPrs, requestedPrs, commentedPrs] = await Promise.all([
      searchPrsForBackfill(
        accessToken,
        `is:pr reviewed-by:@me updated:>=${dateStr}`
      ),
      searchPrsForBackfill(
        accessToken,
        `is:pr review-requested:@me updated:>=${dateStr}`
      ),
      searchPrsForBackfill(
        accessToken,
        `is:pr commenter:@me updated:>=${dateStr}`
      ),
    ]);

    const byId = new Map<number, BackfillPr>();
    for (const p of [...reviewedPrs, ...requestedPrs, ...commentedPrs]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    const candidates = Array.from(byId.values()).slice(0, 1000);
    if (candidates.length === 0) return;

    const { data: existingDeclines } = await supabase
      .from("pr_declines")
      .select("pr_id")
      .eq("github_user_id", githubUserId)
      .in("pr_id", candidates.map((c) => c.id));
    const alreadyDeclined = new Set<number>(
      (existingDeclines || []).map((r: { pr_id: number }) => r.pr_id)
    );

    const needComments = candidates.filter((p) => !alreadyDeclined.has(p.id));
    if (needComments.length === 0) return;

    const declines = await fetchDeclineCommentsBatch(
      accessToken,
      needComments.map((p) => ({
        id: p.id,
        number: p.number,
        repoFullName: p.repoFullName,
      })),
      login
    );

    const rows: Array<{
      pr_id: number;
      pr_number: number;
      repo_full_name: string;
      pr_title: string;
      pr_html_url: string;
      declined_at: string;
      comment_id: number;
    }> = [];
    for (const pr of needComments) {
      const decline = declines[pr.id];
      if (!decline) continue;
      rows.push({
        pr_id: pr.id,
        pr_number: pr.number,
        repo_full_name: pr.repoFullName,
        pr_title: pr.title,
        pr_html_url: pr.html_url,
        declined_at: decline.declinedAt,
        comment_id: decline.commentId,
      });
    }
    await applyDeclineRows(supabase, githubUserId, rows);
  } catch (err) {
    console.error("[deepBackfillDeclines] failed", err);
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

interface ReviewedState {
  reviewed: boolean;
  state: string;
}

// For each PR, decide whether the user has already handled the current review
// request. A card counts as "reviewed" only when the user's most recent
// submitted review is at least as recent as the most recent time a review was
// requested from them (directly or through one of their teams). If a later
// re-request arrives, the review is stale and the card should come back.
async function resolveReviewedStates(
  accessToken: string,
  items: { id: number; number: number; repoFullName: string }[],
  userLogin: string,
  userTeamKeys: Set<string>,
  fixtureGraphql?: { data?: Record<string, { pullRequest: unknown } | null> } | null
): Promise<Record<number, ReviewedState>> {
  const result: Record<number, ReviewedState> = {};
  if (items.length === 0) return result;

  if (fixtureGraphql && fixtureGraphql.data) {
    items.forEach((item, idx) => {
      const pr = fixtureGraphql.data?.[`pr${idx}`]?.pullRequest;
      result[item.id] = decideReviewedState(pr as never, userLogin, userTeamKeys);
    });
    return result;
  }

  const prFragment = `
    reviews(first: 100) {
      nodes { author { login } state submittedAt }
    }
    timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 50) {
      nodes {
        ... on ReviewRequestedEvent {
          createdAt
          requestedReviewer {
            __typename
            ... on User { login }
            ... on Team { slug organization { login } }
          }
        }
      }
    }
  `;

  const aliases = items.map((item, idx) => {
    const [owner, repo] = item.repoFullName.split("/");
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
      console.error("[resolveReviewedStates] graphql failed", resp.status);
      return result;
    }

    const data = await resp.json();
    if (!data || !data.data) return result;

    items.forEach((item, idx) => {
      const pr = data.data[`pr${idx}`]?.pullRequest;
      result[item.id] = decideReviewedState(pr, userLogin, userTeamKeys);
    });
  } catch (err) {
    console.error("[resolveReviewedStates] error", err);
  }

  return result;
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

      // Only suppress the card when there is no active re-request aimed at the
      // viewer. An individual re-request or a pending request to one of the
      // viewer's own teams means the card must resurface regardless of whatever
      // review state they (or anyone else) last submitted.
      const hasActivePendingRequest =
        individuallyRequested ||
        [...relevantTeams].some((key) => pendingTeamKeys.has(key));

      if (hasChangesRequested && !hasActivePendingRequest) {
        result[item.id] = { team_approval_required: false };
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
        if (!approvedTeamKeys.has(teamKey) && pendingTeamKeys.has(teamKey)) {
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

interface AssembledStats {
  summary: {
    total_reviews: number;
    approved: number;
    changes_requested: number;
    commented: number;
    declined: number;
    p90_latency_seconds: number | null;
    latency_sample_size: number;
    prs: unknown[];
    excluded_prs: unknown[];
  };
  repos: unknown[];
  window_days: number;
}

async function assembleStats(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  githubUserId: number
): Promise<AssembledStats> {
  const windowStartIso = new Date(
    Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [{ data: reviews }, { data: declines }] = await Promise.all([
    supabase
      .from("pr_reviews")
      .select(
        "review_id, pr_id, pr_number, pr_title, pr_html_url, repo_full_name, review_state, submitted_at, latency_seconds"
      )
      .eq("github_user_id", githubUserId)
      .gte("submitted_at", windowStartIso),
    supabase
      .from("pr_declines")
      .select("pr_id, repo_full_name, declined_at")
      .eq("github_user_id", githubUserId)
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
    latency_seconds: number | null;
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
    if (state === "approved" || state === "changes_requested") {
      agg.reviewEvents.push({
        review_id: r.review_id as number,
        pr_id: r.pr_id as number,
        pr_number: r.pr_number as number,
        title: (r.pr_title as string) || "",
        html_url: (r.pr_html_url as string) || "",
        latency_seconds: typeof lat === "number" && lat >= 0 ? lat : null,
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
    const timed = agg.reviewEvents.filter(
      (p) => p.latency_seconds !== null
    ) as (IncludedPr & { latency_seconds: number })[];
    const unrequested = agg.reviewEvents.filter(
      (p) => p.latency_seconds === null
    );
    timed.sort((a, b) => b.latency_seconds - a.latency_seconds);
    const latencies = timed.map((p) => p.latency_seconds);
    const p90 = percentile(latencies, 90);
    const excluded_prs =
      p90 === null ? [] : timed.filter((p) => p.latency_seconds > p90);
    const includedTimed =
      p90 === null ? timed : timed.filter((p) => p.latency_seconds <= p90);
    const prs = [...includedTimed, ...unrequested];
    return {
      repo: agg.repo,
      total_reviews: agg.total,
      approved: agg.approved,
      changes_requested: agg.changesRequested,
      commented: agg.commented,
      declined: declinedByRepo.get(agg.repo) || 0,
      p90_latency_seconds: p90,
      latency_sample_size: agg.reviewEvents.length,
      prs,
      excluded_prs,
    };
  });

  perRepo.sort(
    (a, b) => b.total_reviews + b.declined - (a.total_reviews + a.declined)
  );

  // Compute repo-wide P90 across ALL users for comparison
  const repoNames = perRepo.map((r) => r.repo);
  let repoWideP90Map = new Map<string, { p90: number | null; sampleSize: number }>();
  if (repoNames.length > 0) {
    const { data: allRepoReviews } = await supabase
      .from("pr_reviews")
      .select("repo_full_name, latency_seconds, review_state")
      .in("repo_full_name", repoNames)
      .gte("submitted_at", windowStartIso)
      .in("review_state", ["approved", "changes_requested"]);

    const repoLatencies = new Map<string, number[]>();
    for (const r of allRepoReviews || []) {
      const repo = r.repo_full_name as string;
      const lat = r.latency_seconds as number | null;
      if (lat != null && lat >= 0) {
        let arr = repoLatencies.get(repo);
        if (!arr) {
          arr = [];
          repoLatencies.set(repo, arr);
        }
        arr.push(lat);
      }
    }
    for (const [repo, lats] of repoLatencies) {
      repoWideP90Map.set(repo, {
        p90: percentile(lats, 90),
        sampleSize: lats.length,
      });
    }
  }

  for (const repo of perRepo) {
    const wide = repoWideP90Map.get(repo.repo);
    (repo as Record<string, unknown>).repo_p90_latency_seconds = wide?.p90 ?? null;
    (repo as Record<string, unknown>).repo_latency_sample_size = wide?.sampleSize ?? 0;
  }

  const allGlobalPrs = perRepo.flatMap((r) => [...r.prs, ...r.excluded_prs]);
  const allGlobalTimed = allGlobalPrs.filter(
    (p) => p.latency_seconds !== null
  ) as (IncludedPr & { latency_seconds: number })[];
  const allGlobalUnrequested = allGlobalPrs.filter(
    (p) => p.latency_seconds === null
  );
  const allLatencies = allGlobalTimed.map((p) => p.latency_seconds);
  const globalP90 = percentile(allLatencies, 90);

  const summaryExcludedPrs =
    globalP90 === null
      ? []
      : allGlobalTimed
          .filter((p) => p.latency_seconds > globalP90)
          .sort((a, b) => b.latency_seconds - a.latency_seconds);
  const summaryIncludedTimed =
    globalP90 === null
      ? allGlobalTimed.sort((a, b) => b.latency_seconds - a.latency_seconds)
      : allGlobalTimed
          .filter((p) => p.latency_seconds <= globalP90)
          .sort((a, b) => b.latency_seconds - a.latency_seconds);
  const summaryPrs = [...summaryIncludedTimed, ...allGlobalUnrequested];

  const summary = {
    total_reviews: perRepo.reduce((s, r) => s + r.total_reviews, 0),
    approved: perRepo.reduce((s, r) => s + r.approved, 0),
    changes_requested: perRepo.reduce((s, r) => s + r.changes_requested, 0),
    commented: perRepo.reduce((s, r) => s + r.commented, 0),
    declined: declinedPrIds.size,
    p90_latency_seconds: globalP90,
    latency_sample_size: allGlobalPrs.length,
    prs: summaryPrs,
    excluded_prs: summaryExcludedPrs,
  };

  return {
    summary,
    repos: perRepo,
    window_days: STATS_WINDOW_DAYS,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const match = url.pathname.match(/\/github-auth\/(.+)$/);
    const path = match ? match[1].replace(/\/+$/, "") : url.pathname.split("/").pop();

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

      const { data: adminRow } = await supabaseForCallback
        .from("app_users")
        .select("is_admin")
        .eq("github_user_id", userData.id)
        .maybeSingle();

      const user = {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        avatar_url: userData.avatar_url,
        is_admin: !!adminRow?.is_admin,
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
          "org_login, org_id, org_avatar_url, role, excluded, last_synced_at"
        )
        .eq("github_user_id", user.github_user_id)
        .order("org_login");

      return jsonResponse({
        orgs: orgs || [],
        oauthScopes: user.oauth_scopes || null,
      });
    }

    if (path === "org-exclusion" && req.method === "POST") {
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

      const body = await req.json();
      const orgLogin = body.org_login;
      const excluded = body.excluded === true;

      if (!orgLogin || typeof orgLogin !== "string") {
        return jsonResponse({ error: "org_login is required" }, 400);
      }

      const { error } = await supabase
        .from("user_orgs")
        .update({ excluded })
        .eq("github_user_id", user.github_user_id)
        .eq("org_login", orgLogin);

      if (error) {
        return jsonResponse({ error: "Failed to update org exclusion" }, 500);
      }

      return jsonResponse({ org_login: orgLogin, excluded });
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

      const [{ data: declinedRowsPR }, { data: excludedOrgRows }] =
        await Promise.all([
          supabase
            .from("pr_declines")
            .select("pr_id")
            .eq("github_user_id", user.github_user_id),
          supabase
            .from("user_orgs")
            .select("org_login")
            .eq("github_user_id", user.github_user_id)
            .eq("excluded", true),
        ]);
      const declinedIdsPR = new Set<number>(
        (declinedRowsPR || []).map((r: { pr_id: number }) => r.pr_id)
      );
      const excludedOrgs = new Set<string>(
        (excludedOrgRows || []).map((r: { org_login: string }) =>
          r.org_login.toLowerCase()
        )
      );

      let reviewReqItems: GitHubSearchItem[] = (
        reviewReqResult.items && Array.isArray(reviewReqResult.items)
          ? (reviewReqResult.items as GitHubSearchItem[])
          : []
      ).filter((item) => {
        if (declinedIdsPR.has(item.id)) return false;
        const owner = item.repository_url.split("/").slice(-2)[0].toLowerCase();
        if (excludedOrgs.has(owner)) return false;
        return true;
      });

      const uniqueRepos = [
        ...new Set(reviewReqItems.map((i) => i.repository_url.split("/").slice(-2).join("/")))
      ];
      const archivedRepos = await getArchivedRepos(supabase, user.access_token, uniqueRepos);

      if (archivedRepos.size > 0) {
        const archivedItems = reviewReqItems.filter((item) => {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          return archivedRepos.has(repoFullName);
        });
        for (const item of archivedItems) {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          await supabase.from("pr_declines").upsert(
            {
              github_user_id: user.github_user_id,
              pr_id: item.id,
              pr_number: item.number,
              repo_full_name: repoFullName,
              pr_title: (item.title || "").slice(0, 500),
              pr_html_url: (item.html_url || "").slice(0, 500),
              declined_at: new Date().toISOString(),
              comment_id: 0,
            },
            { onConflict: "github_user_id,pr_id", ignoreDuplicates: true }
          );
        }
        reviewReqItems = reviewReqItems.filter((item) => {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          return !archivedRepos.has(repoFullName);
        });
      }

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
        reviewRequested: { ...reviewReqResult, items: reviewReqItems },
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

      const payload = row.payload as Record<string, unknown>;
      const cachedReviewRequested = payload.reviewRequested as
        | { items?: unknown[] }
        | undefined;
      if (cachedReviewRequested?.items && Array.isArray(cachedReviewRequested.items)) {
        const [{ data: declinedRowsCache }, { data: excludedOrgRowsCache }] =
          await Promise.all([
            supabase
              .from("pr_declines")
              .select("pr_id")
              .eq("github_user_id", user.github_user_id),
            supabase
              .from("user_orgs")
              .select("org_login")
              .eq("github_user_id", user.github_user_id)
              .eq("excluded", true),
          ]);
        const declinedIdsCache = new Set<number>(
          (declinedRowsCache || []).map((r: { pr_id: number }) => r.pr_id)
        );
        const excludedOrgsCache = new Set<string>(
          (excludedOrgRowsCache || []).map((r: { org_login: string }) =>
            r.org_login.toLowerCase()
          )
        );
        cachedReviewRequested.items = cachedReviewRequested.items.filter(
          (item: unknown) => {
            const i = item as { id: number; repository_url?: string };
            if (declinedIdsCache.has(i.id)) return false;
            if (i.repository_url) {
              const owner = i.repository_url.split("/").slice(-2)[0].toLowerCase();
              if (excludedOrgsCache.has(owner)) return false;
            }
            return true;
          }
        );
      }

      return jsonResponse({
        cached: true,
        updatedAt: row.updated_at,
        ...payload,
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

    if (path === "poll-reviews" || path.startsWith("poll-reviews?")) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();

      // Operator-only smoke-test hook: swap the live GitHub calls for a canned
      // fixture. Gated on the service-role secret already present in the
      // deployed environment. If either header is missing or wrong the poll
      // runs exactly as it always has — no user can trigger this path.
      let testFixture: {
        search?: { items?: GitHubSearchItem[]; total_count?: number };
        graphql?: { data?: Record<string, { pullRequest: unknown } | null> };
        rateLimitRemaining?: string | null;
        rateLimitReset?: string | null;
      } | null = null;
      const fixtureHeader = req.headers.get("X-PR-Review-Test-Fixture");
      const fixtureAuthHeader = req.headers.get("X-PR-Review-Test-Auth");
      if (fixtureHeader && fixtureAuthHeader) {
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        if (serviceRoleKey && fixtureAuthHeader === serviceRoleKey) {
          try {
            testFixture = JSON.parse(atob(fixtureHeader));
          } catch (err) {
            console.error("[poll-reviews] failed to parse test fixture", err);
            return jsonResponse({ error: "Invalid test fixture" }, 400);
          }
        } else {
          return jsonResponse({ error: "Invalid test fixture auth" }, 401);
        }
      }

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
      let rateLimitRemaining: string | null = null;
      let rateLimitReset: string | null = null;
      let rawFreshItems: GitHubSearchItem[] = [];

      // Short-lived server-side cache: multiple tabs and back-to-back polls
      // from the same user share one GitHub Search API call. Search's 30/min
      // budget is easy to blow through otherwise, and every extra call was a
      // wasted token spent on an unchanged answer.
      const POLL_CACHE_TTL_MS = 4000;
      let servedFromCache = false;
      if (!testFixture) {
        const { data: cachedRow } = await supabase
          .from("poll_reviews_cache")
          .select("payload, cached_at")
          .eq("github_user_id", user.github_user_id)
          .maybeSingle();
        if (cachedRow && cachedRow.payload && cachedRow.cached_at) {
          const cachedAt = new Date(cachedRow.cached_at as string).getTime();
          if (!Number.isNaN(cachedAt) && Date.now() - cachedAt < POLL_CACHE_TTL_MS) {
            servedFromCache = true;
            return jsonResponse({
              ...(cachedRow.payload as Record<string, unknown>),
              servedFromCache: true,
            });
          }
        }
      }

      if (testFixture) {
        rawFreshItems = Array.isArray(testFixture.search?.items)
          ? (testFixture.search!.items as GitHubSearchItem[])
          : [];
        rateLimitRemaining = testFixture.rateLimitRemaining ?? null;
        rateLimitReset = testFixture.rateLimitReset ?? null;
      } else {
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

        rateLimitRemaining = searchResp.headers.get("X-RateLimit-Remaining") || null;
        rateLimitReset = searchResp.headers.get("X-RateLimit-Reset") || null;

        if (!searchResp.ok) {
          // GitHub secondary rate limits (403/429) and other transient errors
          // include a Retry-After header specifying how many seconds to wait.
          // Return a pause signal using the existing rateLimitRemaining=0
          // mechanism so the client backs off gracefully and keeps its current
          // card list intact, rather than treating an empty result as
          // "all PRs disappeared".
          const retryAfterSec = searchResp.headers.get("Retry-After");
          const retryAfterReset = retryAfterSec
            ? String(Math.ceil(Date.now() / 1000) + parseInt(retryAfterSec, 10))
            : null;
          console.warn(
            `[poll-reviews] GitHub search returned ${searchResp.status}; Retry-After=${retryAfterSec ?? "none"}`
          );
          return jsonResponse({
            changed: false,
            updatedPRs: [],
            removedPRIds: [],
            removalReasons: {},
            newPRs: [],
            reviewTimestamps: {},
            visibleIds: null,
            rateLimitRemaining: "0",
            rateLimitReset: retryAfterReset ?? rateLimitReset,
          });
        }

        const searchRaw = await searchResp.json();
        const searchResult =
          searchRaw && typeof searchRaw === "object"
            ? searchRaw
            : { items: [], total_count: 0 };
        if (searchResult.items && !Array.isArray(searchResult.items)) {
          searchResult.items = [];
        }

        rawFreshItems = Array.isArray(searchResult.items) ? searchResult.items : [];
      }

      const [{ data: declinedRows }, { data: reviewedRows }] = await Promise.all([
        supabase
          .from("pr_declines")
          .select("pr_id")
          .eq("github_user_id", user.github_user_id),
        supabase
          .from("poll_reviewed_prs")
          .select("pr_id")
          .eq("github_user_id", user.github_user_id),
      ]);

      const declinedIds = new Set<number>(
        (declinedRows || []).map((r: { pr_id: number }) => r.pr_id)
      );
      // PRs we previously determined the user had already reviewed. We no
      // longer blindly hide these: each poll re-validates them so a fresh
      // re-request can bring the card back.
      const previouslyReviewedIds = new Set<number>(
        (reviewedRows || []).map((r: { pr_id: number }) => r.pr_id)
      );

      let freshItems = rawFreshItems.filter(
        (i) => !declinedIds.has(i.id)
      );

      const pollUniqueRepos = [
        ...new Set(freshItems.map((i) => i.repository_url.split("/").slice(-2).join("/")))
      ];
      const pollArchivedRepos = await getArchivedRepos(supabase, user.access_token, pollUniqueRepos);

      if (pollArchivedRepos.size > 0) {
        const archivedPollItems = freshItems.filter((item) => {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          return pollArchivedRepos.has(repoFullName);
        });
        for (const item of archivedPollItems) {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          await supabase.from("pr_declines").upsert(
            {
              github_user_id: user.github_user_id,
              pr_id: item.id,
              pr_number: item.number,
              repo_full_name: repoFullName,
              pr_title: (item.title || "").slice(0, 500),
              pr_html_url: (item.html_url || "").slice(0, 500),
              declined_at: new Date().toISOString(),
              comment_id: 0,
            },
            { onConflict: "github_user_id,pr_id", ignoreDuplicates: true }
          );
        }
        freshItems = freshItems.filter((item) => {
          const repoFullName = item.repository_url.split("/").slice(-2).join("/");
          return !pollArchivedRepos.has(repoFullName);
        });
      }

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

      const removalReasons: Record<number, string> = {};
      // Re-validate every visible card each poll: a card is cleared once the
      // user's own review is newer than the latest request, and a card that
      // was previously cleared comes back the moment a fresh re-request lands.
      // Raised from 25 to 100 (the GitHub search page size) so a card can't
      // linger on the dashboard simply because its position in the search
      // result put it outside the reviewed-check window.
      const reviewCheckItems = freshItems
        .map((item) => ({
          id: item.id,
          number: item.number,
          repoFullName: item.repository_url.split("/").slice(-2).join("/"),
        }))
        .slice(0, 100);

      if (reviewCheckItems.length > 0) {
        const reviewedStates = await resolveReviewedStates(
          user.access_token,
          reviewCheckItems,
          user.login,
          userTeamKeys,
          testFixture?.graphql ?? null
        );

        const reviewedIds = new Set<number>();
        const newlyReviewedRows: Array<{
          github_user_id: number;
          pr_id: number;
          review_state: string;
        }> = [];
        const reinstatedIds: number[] = [];

        for (const item of reviewCheckItems) {
          const res = reviewedStates[item.id];
          if (!res) continue;
          if (res.reviewed) {
            reviewedIds.add(item.id);
            // Always announce the removal so the browser drops the card even
            // if the server never had a snapshot for it (e.g. dismiss + re-request).
            // The browser filter is idempotent when the card isn't on screen.
            removedPrIds.push(item.id);
            // Count the review toward stats and play the chime only the first
            // time we detect the transition into "reviewed".
            if (!previouslyReviewedIds.has(item.id)) {
              removalReasons[item.id] = res.state;
              newlyReviewedRows.push({
                github_user_id: user.github_user_id,
                pr_id: item.id,
                review_state: res.state,
              });
            }
          } else if (previouslyReviewedIds.has(item.id)) {
            // Was cleared before, but a newer request arrived: bring it back.
            reinstatedIds.push(item.id);
          }
        }

        if (reviewedIds.size > 0) {
          const reviewedIdArr = Array.from(reviewedIds);
          freshItems = freshItems.filter((i) => !reviewedIds.has(i.id));
          updatedItems = updatedItems.filter((i) => !reviewedIds.has(i.id));
          newItems = newItems.filter((i) => !reviewedIds.has(i.id));
          freshIdSet = new Set(freshItems.map((i) => i.id));

          await supabase
            .from("user_pr_snapshots")
            .delete()
            .eq("github_user_id", user.github_user_id)
            .in("pr_id", reviewedIdArr);
          for (const id of reviewedIds) snapMap.delete(id);
        }

        if (newlyReviewedRows.length > 0) {
          await supabase
            .from("poll_reviewed_prs")
            .upsert(newlyReviewedRows, { onConflict: "github_user_id,pr_id" });
        }

        if (reinstatedIds.length > 0) {
          await supabase
            .from("poll_reviewed_prs")
            .delete()
            .eq("github_user_id", user.github_user_id)
            .in("pr_id", reinstatedIds);
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

      if (previouslyReviewedIds.size > 0) {
        const rawFreshIdSet = new Set(rawFreshItems.map((i) => i.id));
        const expiredReviewedIds = Array.from(previouslyReviewedIds).filter(
          (id) => !rawFreshIdSet.has(id)
        );
        if (expiredReviewedIds.length > 0) {
          await supabase
            .from("poll_reviewed_prs")
            .delete()
            .eq("github_user_id", user.github_user_id)
            .in("pr_id", expiredReviewedIds);
        }
      }

      // Run approval status for ALL fresh items, not only new/updated ones.
      // A review re-request does not change any snapshot field (title, state,
      // draft, updated_at), so without this an unchanged card's
      // team_approval_required would never be refreshed after a re-request.
      const newOrUpdatedIds = new Set<number>([
        ...newItems.map((i) => i.id),
        ...updatedItems.map((i) => i.id),
      ]);
      const unchangedItems = (freshItems as GitHubSearchItem[]).filter(
        (i) => !newOrUpdatedIds.has(i.id)
      );
      const itemsNeedingApproval = [...newItems, ...updatedItems, ...unchangedItems];
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
        // Push unchanged items into updatedItems so the client receives the
        // corrected team_approval_required and can immediately un-hide any card
        // that a re-request has made actionable again.
        for (const item of unchangedItems as Array<GitHubSearchItem & { team_approval_required?: boolean }>) {
          applyApproval(item);
          updatedItems.push(item as GitHubSearchItem);
        }
      }

      const visibleIds = (freshItems as GitHubSearchItem[]).map((it) => it.id);

      const responseBody = {
        changed,
        updatedPRs: updatedItems,
        removedPRIds: removedPrIds,
        removalReasons,
        newPRs: newItems,
        reviewTimestamps: newReviewTimestamps,
        visibleIds,
        rateLimitRemaining,
        rateLimitReset,
      };

      if (!testFixture) {
        try {
          await supabase
            .from("poll_reviews_cache")
            .upsert({
              github_user_id: user.github_user_id,
              payload: responseBody,
              cached_at: new Date().toISOString(),
            });
        } catch (err) {
          console.error("[poll-reviews] failed to write cache:", err);
        }
      }

      // Silence the unused-var warning for the flag we may want later.
      void servedFromCache;

      return jsonResponse(responseBody);
    }

    if (path === "stats") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }

      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const statsUrl = new URL(req.url);
      const force = statsUrl.searchParams.get("force") === "true";

      const { data: user } = await supabase
        .from("app_users")
        .select(
          "github_user_id, access_token, login, stats_backfilled_at, declines_backfilled_at"
        )
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
        user.stats_backfilled_at,
        force
      );

      if (force && !user.declines_backfilled_at) {
        await deepBackfillDeclines(
          supabase,
          user.github_user_id,
          user.access_token,
          user.login
        );
        await supabase
          .from("app_users")
          .update({ declines_backfilled_at: new Date().toISOString() })
          .eq("github_user_id", user.github_user_id);
      }

      const { data: freshUser } = await supabase
        .from("app_users")
        .select("stats_backfilled_at")
        .eq("github_user_id", user.github_user_id)
        .maybeSingle();

      const stats = await assembleStats(supabase, user.github_user_id);
      return jsonResponse({
        ...stats,
        backfilled_at: freshUser?.stats_backfilled_at ?? null,
      });
    }

    if (path?.startsWith("public-stats/")) {
      const loginParam = decodeURIComponent(path.slice("public-stats/".length))
        .replace(/\/+$/, "")
        .trim();
      if (!loginParam) {
        return jsonResponse({ error: "Missing login" }, 400);
      }

      const supabase = getSupabaseAdmin();
      const { data: profile } = await supabase
        .from("app_users")
        .select(
          "github_user_id, login, name, avatar_url, public_profile_hidden, stats_backfilled_at"
        )
        .ilike("login", loginParam)
        .maybeSingle();

      if (!profile || profile.public_profile_hidden) {
        return jsonResponse(
          {
            enabled: false,
            login: profile?.login ?? loginParam,
          },
          404
        );
      }

      const stats = await assembleStats(supabase, profile.github_user_id);

      type PrLike = { latency_seconds: number | null };
      const anonymizeLatencies = (arr: unknown) =>
        Array.isArray(arr)
          ? (arr as PrLike[]).map((p) => ({ latency_seconds: p?.latency_seconds ?? null }))
          : [];

      const summary = stats.summary ?? {};
      const publicSummary = {
        ...summary,
        prs: anonymizeLatencies((summary as Record<string, unknown>).prs),
        excluded_prs: [],
      };
      const publicRepos = (stats.repos ?? []).map((repo: Record<string, unknown>) => ({
        ...repo,
        prs: anonymizeLatencies(repo.prs),
        excluded_prs: [],
      }));
      const publicStats = {
        ...stats,
        summary: publicSummary,
        repos: publicRepos,
      };

      return new Response(
        JSON.stringify({
          enabled: true,
          login: profile.login,
          name: profile.name,
          avatar_url: profile.avatar_url,
          backfilled_at: profile.stats_backfilled_at ?? null,
          ...publicStats,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
          },
        }
      );
    }

    if (path === "profile-visibility") {
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
        .select("github_user_id")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }
      let body: { hidden?: boolean } = {};
      try {
        body = await req.json();
      } catch {
        /* no body */
      }
      if (typeof body.hidden !== "boolean") {
        return jsonResponse({ error: "Missing boolean 'hidden'" }, 400);
      }
      await supabase
        .from("app_users")
        .update({ public_profile_hidden: body.hidden })
        .eq("github_user_id", user.github_user_id);
      return jsonResponse({ hidden: body.hidden });
    }

    if (path === "profile-settings") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }
      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const { data: user } = await supabase
        .from("app_users")
        .select("login, public_profile_hidden")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }
      return jsonResponse({
        login: user.login,
        hidden: !!user.public_profile_hidden,
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
          .select("audio_unlocked, last_unlocked_at, sound_enabled, desktop_notifications_enabled, last_desktop_notification_at")
          .eq("github_user_id", user.github_user_id)
          .maybeSingle();

        return jsonResponse({
          audio_unlocked: state?.audio_unlocked ?? false,
          last_unlocked_at: state?.last_unlocked_at ?? null,
          sound_enabled: state?.sound_enabled ?? null,
          desktop_notifications_enabled: state?.desktop_notifications_enabled ?? null,
          last_desktop_notification_at: state?.last_desktop_notification_at ?? null,
        });
      }

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {
          github_user_id: user.github_user_id,
          updated_at: new Date().toISOString(),
        };
        if (typeof body?.audio_unlocked === "boolean") {
          patch.audio_unlocked = body.audio_unlocked;
          if (body.audio_unlocked) patch.last_unlocked_at = new Date().toISOString();
        }
        if (typeof body?.sound_enabled === "boolean") {
          patch.sound_enabled = body.sound_enabled;
        }
        if (typeof body?.desktop_notifications_enabled === "boolean") {
          patch.desktop_notifications_enabled = body.desktop_notifications_enabled;
        }
        if (body?.desktop_notification_delivered === true) {
          patch.last_desktop_notification_at = new Date().toISOString();
        }

        await supabase.from("user_audio_state").upsert(patch, { onConflict: "github_user_id" });

        return jsonResponse({ success: true });
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (path === "me") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }
      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const { data: user } = await supabase
        .from("app_users")
        .select("github_user_id, login, name, avatar_url, is_admin")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!user) return jsonResponse({ error: "Invalid session" }, 401);

      await supabase
        .from("app_users")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("github_user_id", user.github_user_id);

      return jsonResponse({
        id: user.github_user_id,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        is_admin: !!user.is_admin,
      });
    }

    if (path === "admin/users") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }
      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const { data: caller } = await supabase
        .from("app_users")
        .select("github_user_id, is_admin")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!caller) return jsonResponse({ error: "Invalid session" }, 401);
      if (!caller.is_admin)
        return jsonResponse({ error: "Admin access required" }, 403);

      const { data: users } = await supabase
        .from("app_users")
        .select(
          "github_user_id, login, name, avatar_url, email, is_admin, created_at, updated_at, last_seen_at, teams_last_synced_at, stats_backfilled_at"
        )
        .order("created_at", { ascending: false });

      const userIds = (users || []).map(
        (u: { github_user_id: number }) => u.github_user_id
      );

      const aggregates = new Map<
        number,
        {
          orgs: number;
          teams: number;
          openRequests: number;
          totalReviews: number;
          lastActivityAt: string | null;
        }
      >();
      for (const id of userIds) {
        aggregates.set(id, {
          orgs: 0,
          teams: 0,
          openRequests: 0,
          totalReviews: 0,
          lastActivityAt: null,
        });
      }

      if (userIds.length > 0) {
        const { data: orgRows } = await supabase
          .from("user_orgs")
          .select("github_user_id")
          .in("github_user_id", userIds);
        for (const row of orgRows || []) {
          const a = aggregates.get(row.github_user_id as number);
          if (a) a.orgs += 1;
        }

        const { data: teamRows } = await supabase
          .from("user_teams")
          .select("github_user_id")
          .in("github_user_id", userIds);
        for (const row of teamRows || []) {
          const a = aggregates.get(row.github_user_id as number);
          if (a) a.teams += 1;
        }

        const { data: reqRows } = await supabase
          .from("review_requests")
          .select("github_user_id, review_requested_at, reviewed_at")
          .in("github_user_id", userIds);
        for (const row of reqRows || []) {
          const a = aggregates.get(row.github_user_id as number);
          if (!a) continue;
          if (!row.reviewed_at) a.openRequests += 1;
          const candidate =
            (row.reviewed_at as string | null) ||
            (row.review_requested_at as string | null);
          if (candidate && (!a.lastActivityAt || candidate > a.lastActivityAt)) {
            a.lastActivityAt = candidate;
          }
        }

        const { data: reviewRows } = await supabase
          .from("pr_reviews")
          .select("github_user_id, submitted_at")
          .in("github_user_id", userIds);
        for (const row of reviewRows || []) {
          const a = aggregates.get(row.github_user_id as number);
          if (!a) continue;
          a.totalReviews += 1;
          const submitted = row.submitted_at as string | null;
          if (
            submitted &&
            (!a.lastActivityAt || submitted > a.lastActivityAt)
          ) {
            a.lastActivityAt = submitted;
          }
        }
      }

      const enriched = (users || []).map(
        (u: {
          github_user_id: number;
          login: string;
          name: string | null;
          avatar_url: string | null;
          email: string | null;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
          last_seen_at: string | null;
          teams_last_synced_at: string | null;
          stats_backfilled_at: string | null;
        }) => {
          const agg = aggregates.get(u.github_user_id) || {
            orgs: 0,
            teams: 0,
            openRequests: 0,
            totalReviews: 0,
            lastActivityAt: null,
          };
          let lastActivityAt = agg.lastActivityAt;
          if (
            u.last_seen_at &&
            (!lastActivityAt || u.last_seen_at > lastActivityAt)
          ) {
            lastActivityAt = u.last_seen_at;
          }
          return {
            github_user_id: u.github_user_id,
            login: u.login,
            name: u.name,
            avatar_url: u.avatar_url,
            email: u.email,
            is_admin: u.is_admin,
            created_at: u.created_at,
            updated_at: u.updated_at,
            teams_last_synced_at: u.teams_last_synced_at,
            stats_backfilled_at: u.stats_backfilled_at,
            org_count: agg.orgs,
            team_count: agg.teams,
            open_review_requests: agg.openRequests,
            total_reviews: agg.totalReviews,
            last_activity_at: lastActivityAt,
          };
        }
      );

      return jsonResponse({ users: enriched, total: enriched.length });
    }

    if (path === "admin/toggle-admin") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }
      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const { data: caller } = await supabase
        .from("app_users")
        .select("github_user_id, is_admin")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!caller) return jsonResponse({ error: "Invalid session" }, 401);
      if (!caller.is_admin)
        return jsonResponse({ error: "Admin access required" }, 403);

      const body = await req.json().catch(() => ({}));
      const targetId = Number(body.github_user_id);
      const makeAdmin = !!body.is_admin;
      if (!targetId) {
        return jsonResponse({ error: "github_user_id required" }, 400);
      }
      if (targetId === caller.github_user_id && !makeAdmin) {
        return jsonResponse(
          { error: "You cannot remove your own admin access" },
          400
        );
      }

      const { error } = await supabase
        .from("app_users")
        .update({ is_admin: makeAdmin, updated_at: new Date().toISOString() })
        .eq("github_user_id", targetId);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ success: true });
    }

    if (path === "decline-review") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing session token" }, 401);
      }
      const sessionToken = authHeader.replace("Bearer ", "");
      const supabase = getSupabaseAdmin();
      const { data: declineUser } = await supabase
        .from("app_users")
        .select("github_user_id, access_token, login")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (!declineUser) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      let body: {
        repo_full_name?: string;
        pr_number?: number;
        pr_id?: number;
        pr_title?: string;
        pr_html_url?: string;
        reason?: string;
        skip_comment?: boolean;
      } = {};
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const repo = (body.repo_full_name || "").trim();
      const prNumber = Number(body.pr_number);
      const prId = Number(body.pr_id);
      const reasonRaw = (body.reason || "").trim();
      const skipComment = body.skip_comment === true;

      if (!repo.includes("/") || !Number.isFinite(prNumber) || prNumber <= 0) {
        return jsonResponse({ error: "repo_full_name and pr_number are required" }, 422);
      }

      let commentId = 0;
      let commentUrl: string | null = null;

      if (skipComment) {
        // Silent decline: no GitHub comment posted (e.g., archived repos)
      } else {
        if (!reasonRaw) {
          return jsonResponse({ error: "Please provide a reason" }, 422);
        }
        if (reasonRaw.length > 1000) {
          return jsonResponse({ error: "Reason must be 1000 characters or fewer" }, 422);
        }

        const [owner, repoName] = repo.split("/");
        const commentBody = `:runner: ${reasonRaw}`;
        const ghResp = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/issues/${prNumber}/comments`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${declineUser.access_token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ body: commentBody }),
          }
        );
        if (!ghResp.ok) {
          const errText = await ghResp.text().catch(() => "");
          console.error("[decline-review] GitHub post failed", ghResp.status, errText);
          return jsonResponse(
            { error: `GitHub rejected comment (${ghResp.status})` },
            ghResp.status === 403 || ghResp.status === 404 ? ghResp.status : 502
          );
        }
        const ghComment = (await ghResp.json()) as { id?: number; html_url?: string };
        commentId = typeof ghComment.id === "number" ? ghComment.id : 0;
        commentUrl = ghComment.html_url || null;
      }

      if (Number.isFinite(prId) && prId > 0) {
        await supabase.from("pr_declines").upsert(
          {
            github_user_id: declineUser.github_user_id,
            pr_id: prId,
            pr_number: prNumber,
            repo_full_name: repo,
            pr_title: (body.pr_title || "").slice(0, 500),
            pr_html_url: (body.pr_html_url || "").slice(0, 500),
            declined_at: new Date().toISOString(),
            comment_id: commentId,
          },
          { onConflict: "github_user_id,pr_id" }
        );
      }

      return jsonResponse({
        success: true,
        comment_id: commentId,
        comment_url: commentUrl,
      });
    }

    if (path === "revoke-access") {
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
        .select("access_token")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (!user) {
        return jsonResponse({ error: "Invalid session" }, 401);
      }

      const clientId = Deno.env.get("GITHUB_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        return jsonResponse({ error: "oauth_not_configured" }, 500);
      }

      if (user.access_token) {
        try {
          const basic = btoa(`${clientId}:${clientSecret}`);
          const revokeResp = await fetch(
            `https://api.github.com/applications/${clientId}/grant`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Basic ${basic}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ access_token: user.access_token }),
            }
          );
          if (!revokeResp.ok && revokeResp.status !== 404) {
            console.error(
              `[revoke-access] GitHub grant revoke returned ${revokeResp.status}`
            );
          }
        } catch (e) {
          console.error("[revoke-access] Failed to revoke grant", e);
        }
      }

      return jsonResponse({ success: true });
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
