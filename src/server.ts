#!/usr/bin/env bun
/// <reference types="bun-types" />

import { Hono } from "hono";
import { Config, DEFAULT_CONFIG, getRepos, Repository, CacheStats } from "./lib";

function parseConfigFromUrl(url: URL): Config {
  const config: Config = { ...DEFAULT_CONFIG };

  const scope = url.searchParams.get("scope");
  if (scope === "own" || scope === "external" || scope === "all") {
    config.scope = scope;
  }

  const sort = url.searchParams.get("sort");
  if (sort === "stars" || sort === "contributions" || sort === "all" || sort === "recent") {
    config.sortBy = sort;
  }

  const limit = url.searchParams.get("limit");
  if (limit) {
    config.limit = parseInt(limit, 10) || 0;
  }

  const include = url.searchParams.get("include");
  if (include) {
    config.include = include.split(",").map(r => r.trim()).filter(Boolean);
  }

  const exclude = url.searchParams.get("exclude");
  if (exclude) {
    config.exclude = exclude.split(",").map(r => r.trim()).filter(Boolean);
  }

  const includePrivate = url.searchParams.get("private");
  if (includePrivate === "true") {
    config.includePrivate = true;
  }

  return config;
}

function renderHtml(repos: Repository[], config: Config): string {
  const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
  const totalPRs = repos.reduce((sum, r) => sum + r.prCount, 0);

  const repoRows = repos
    .map(
      (repo) => `
    <tr>
      <td><a href="${repo.url}">${repo.fullName}</a></td>
      <td>${repo.stars.toLocaleString()}</td>
      <td>${repo.prCount}</td>
      <td>${repo.isOwned ? "yes" : "no"}</td>
      <td>${repo.lastContributedAt.slice(0, 10)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <title>GitHub Contributions</title>
</head>
<body>
  <h1>GitHub Contributions</h1>

  <h2>Summary</h2>
  <p>
    <strong>Total repositories:</strong> ${repos.length}<br>
    <strong>Total stars:</strong> ${totalStars.toLocaleString()}<br>
    <strong>Total PRs:</strong> ${totalPRs}
  </p>

  <h2>Filters</h2>
  <p>
    <strong>Scope:</strong> ${config.scope}<br>
    <strong>Sort by:</strong> ${config.sortBy}<br>
    <strong>Limit:</strong> ${config.limit || "none"}<br>
    <strong>Excluded:</strong> ${config.exclude.length > 0 ? config.exclude.join(", ") : "none"}<br>
    <strong>Included:</strong> ${config.include.length > 0 ? config.include.join(", ") : "none"}
  </p>

  <h2>Repositories</h2>
  <table>
    <thead>
      <tr>
        <th>Repository</th>
        <th>Stars</th>
        <th>PRs</th>
        <th>Own</th>
        <th>Last PR</th>
      </tr>
    </thead>
    <tbody>
      ${repoRows}
    </tbody>
  </table>
</body>
</html>`;
}

const app = new Hono();

function getCacheControl(isStale: boolean): string {
  if (isStale) {
    return "public, max-age=60, stale-while-revalidate=86400";
  }
  return "public, max-age=60, stale-while-revalidate=86400";
}

app.get("/", async (c) => {
  try {
    const config = parseConfigFromUrl(new URL(c.req.url));
    const { repos, cache } = await getRepos(config);

    const html = renderHtml(repos, config);

    c.res.headers.set("Cache-Control", getCacheControl(cache.isStale));
    c.res.headers.set("X-Cache", cache.fromCache ? (cache.isStale ? "STALE" : "HIT") : "MISS");

    return c.html(html);
  } catch (error) {
    return c.html(
      `<html><body><h1>Error</h1><pre>${error instanceof Error ? error.message : "Unknown error"}</pre></body></html>`,
      500
    );
  }
});

app.get("/api", async (c) => {
  try {
    const config = parseConfigFromUrl(new URL(c.req.url));
    const { repos, cache } = await getRepos(config);

    const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
    const totalPRs = repos.reduce((sum, r) => sum + r.prCount, 0);

    c.res.headers.set("Cache-Control", getCacheControl(cache.isStale));
    c.res.headers.set("X-Cache", cache.fromCache ? (cache.isStale ? "STALE" : "HIT") : "MISS");

    return c.json({
      total: repos.length,
      totalStars,
      totalPRs,
      repositories: repos,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

app.get("/help", (c) => {
  return c.text(`GitHub Contributions Server

Endpoints:
  GET /                   HTML view of repositories
  GET /api                JSON API response
  GET /help               This help message

Query Parameters:
  scope=own               Only your own repos
  scope=external          Only external repos (default)
  scope=all               All repos (own + external)
  sort=stars              Sort by stars (default)
  sort=contributions      Sort by PR count
  sort=all                Sort by combined score
  sort=recent             Sort by most recent contribution
  limit=N                 Limit to N results
  include=owner/repo      Always include repo (comma-separated)
  exclude=owner/repo      Always exclude repo (comma-separated)
  private=true            Include private repos (excluded by default)

Examples:
  https://your-app.vercel.app/?scope=all&limit=10
  https://your-app.vercel.app/api?scope=own
  https://your-app.vercel.app/?sort=recent
  https://your-app.vercel.app/?private=true
  https://your-app.vercel.app/?exclude=owner/repo1,owner/repo2
`);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export default {
  port,
  fetch: app.fetch,
};