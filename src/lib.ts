/// <reference types="bun-types" />

export interface Repository {
  name: string;
  fullName: string;
  url: string;
  stars: number;
  prCount: number;
  isOwned: boolean;
  isPrivate: boolean;
  lastContributedAt: string;
}

export interface Cache {
  username: string;
  repos: Record<string, Repository>;
  fetchedAt: string;
}

export interface Config {
  scope: "own" | "external" | "all";
  sortBy: "stars" | "contributions" | "all" | "recent";
  includePrivate: boolean;
  limit: number;
  include: string[];
  exclude: string[];
  user?: string;
  starsLimit?: number;
}

export const DEFAULT_CONFIG: Config = {
  scope: "external",
  sortBy: "stars",
  includePrivate: false,
  limit: 0,
  include: [],
  exclude: [],
  user: undefined,
  starsLimit: 20,
};

const CACHE_FILE = "cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_AGE_MS = 60 * 1000;
const STALE_WHILE_REVALIDATE_MS = 24 * 60 * 60 * 1000;

const memoryCache: Map<string, {
  data: Repository[] | null;
  fetchedAt: number;
}> = new Map();

let revalidatePromise: Promise<Repository[]> | null = null;
let revalidateUser: string | null = null;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function ghApi(endpoint: string): Promise<string> {
  const url = `https://api.github.com${endpoint}`;
  
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  
  if (res.status === 403) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const reset = res.headers.get("X-RateLimit-Reset");
    if (remaining === "0") {
      const resetTime = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString() : "unknown";
      throw new Error(`GitHub API rate limited. Resets at ${resetTime}`);
    }
  }
  
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function runGhCommand(args: string[]): string {
  const result = Bun.spawnSync(["gh", ...args]);
  return result.stdout.toString().trim();
}

export async function getAuthenticatedUser(): Promise<string> {
  if (GITHUB_TOKEN) {
    const data = JSON.parse(await ghApi("/user"));
    return data.login;
  }
  return runGhCommand(["api", "user", "--jq", ".login"]);
}

function isValidRepoUrl(url: string): boolean {
  return url.startsWith("https://api.github.com/repos/");
}

function parseRepoUrl(url: string): string | null {
  if (!isValidRepoUrl(url)) return null;
  const parts = url.split("/");
  const fullName = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return fullName;
}

export async function loadCache(): Promise<Cache> {
  try {
    const file = Bun.file(CACHE_FILE);
    const exists = await file.exists();
    if (!exists) return { username: "", repos: {}, fetchedAt: "" };
    const text = await file.text();
    if (!text) return { username: "", repos: {}, fetchedAt: "" };
    return JSON.parse(text);
  } catch {
    return { username: "", repos: {}, fetchedAt: "" };
  }
}

export function saveCache(cache: Cache): void {
  cache.fetchedAt = new Date().toISOString();
  Bun.write(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function isCacheStale(cache: Cache): boolean {
  if (!cache.fetchedAt) return true;
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return Date.now() - fetchedAt > CACHE_TTL_MS;
}

async function fetchRepoData(fullName: string): Promise<{ stars: number; isPrivate: boolean }> {
  try {
    const data = JSON.parse(await ghApi(`/repos/${fullName}`));
    return {
      stars: data.stargazers_count || 0,
      isPrivate: data.private || false,
    };
  } catch {
    return { stars: 0, isPrivate: false };
  }
}

export interface FetchProgress {
  onProgress?: (message: string) => void;
}

export async function fetchStarsForRepos(
  repos: Repository[],
  cache: Cache,
  progress?: FetchProgress
): Promise<void> {
  const cachedRepos = repos.filter(r => cache.repos[r.fullName] !== undefined);
  const toFetch = repos.filter(r => cache.repos[r.fullName] === undefined);

  for (const repo of cachedRepos) {
    const cached = cache.repos[repo.fullName];
    repo.stars = cached.stars;
    repo.isOwned = cached.isOwned;
    repo.isPrivate = cached.isPrivate;
    repo.lastContributedAt = cached.lastContributedAt;
  }

  if (cachedRepos.length > 0) {
    progress?.onProgress?.(`Using cached data: ${cachedRepos.length} repos`);
  }

  if (toFetch.length === 0) return;

  if (toFetch.length > 10) {
    progress?.onProgress?.(`Fetching repo data for ${toFetch.length} repos (rate limited)...`);
  }

  for (let i = 0; i < toFetch.length; i++) {
    const repo = toFetch[i];
    progress?.onProgress?.(`[${i + 1}/${toFetch.length}] ${repo.fullName}`);
    const data = await fetchRepoData(repo.fullName);
    repo.stars = data.stars;
    repo.isPrivate = data.isPrivate;
    cache.repos[repo.fullName] = { ...repo };

    if (i < toFetch.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

async function fetchPRsForYear(
  username: string,
  year: number,
  reposMap: Map<string, Repository>
): Promise<number> {
  const perPage = 100;
  let page = 1;
  let totalFetched = 0;

  while (true) {
    const query = `q=author:${username}+type:pr+created:${year}-01-01..${year}-12-31&per_page=${perPage}&page=${page}`;
    const data = JSON.parse(await ghApi(`/search/issues?${query}`));

    const items = data.items || [];
    if (items.length === 0) break;

    totalFetched += items.length;

    for (const pr of items) {
      const url = pr.repository_url;
      const createdAt = pr.created_at;
      const fullName = parseRepoUrl(url);
      if (fullName) {
        const isOwned = fullName.startsWith(`${username}/`);
        const existing = reposMap.get(fullName);
        if (existing) {
          existing.prCount++;
          if (createdAt > existing.lastContributedAt) {
            existing.lastContributedAt = createdAt;
          }
        } else {
          reposMap.set(fullName, {
            name: fullName.split("/")[1],
            fullName,
            url: `https://github.com/${fullName}`,
            stars: 0,
            prCount: 1,
            isOwned,
            isPrivate: false,
            lastContributedAt: createdAt,
          });
        }
      }
    }

    if (items.length < perPage) break;
    page++;
  }

  return totalFetched;
}

export async function fetchContributedRepos(
  username: string,
  progress?: FetchProgress
): Promise<Repository[]> {
  const reposMap = new Map<string, Repository>();
  const currentYear = new Date().getFullYear();
  const startYear = 2015;

  progress?.onProgress?.("Fetching repositories from pull requests...");

  for (let year = currentYear; year >= startYear; year--) {
    const count = await fetchPRsForYear(username, year, reposMap);
    if (count > 0) {
      progress?.onProgress?.(`${year}: ${count} PRs`);
    }
    if (year > startYear) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return Array.from(reposMap.values());
}

export function filterRepos(repos: Repository[], config: Config, allRepos: Repository[]): Repository[] {
  const excludeSet = new Set(config.exclude);
  const includeSet = new Set(config.include);

  const filtered = repos.filter(repo => {
    if (excludeSet.has(repo.fullName)) return false;
    if (includeSet.has(repo.fullName)) return true;
    if (config.scope === "own" && !repo.isOwned) return false;
    if (config.scope === "external" && repo.isOwned) return false;
    if (!config.includePrivate && repo.isPrivate) return false;
    return true;
  });

  const filteredSet = new Set(filtered.map(r => r.fullName));

  for (const fullName of config.include) {
    if (!filteredSet.has(fullName) && !excludeSet.has(fullName)) {
      const repo = allRepos.find(r => r.fullName === fullName);
      if (repo) {
        filtered.push(repo);
      }
    }
  }

  return filtered;
}

export function sortRepos(repos: Repository[], config: Config): Repository[] {
  const sorted = [...repos];

  sorted.sort((a, b) => {
    switch (config.sortBy) {
      case "stars":
        return b.stars - a.stars;
      case "contributions":
        return b.prCount - a.prCount;
      case "all":
        const scoreA = a.stars * (a.prCount ** 2);
        const scoreB = b.stars * (b.prCount ** 2);
        return scoreB - scoreA;
      case "recent":
        return b.lastContributedAt.localeCompare(a.lastContributedAt);
      default:
        return 0;
    }
  });

  return sorted;
}

export interface CacheStats {
  fromCache: boolean;
  isStale: boolean;
  age: number;
}

const NO_CACHE: CacheStats = { fromCache: false, isStale: false, age: 0 };

export async function getRepos(
  config: Config,
  progress?: FetchProgress
): Promise<{ repos: Repository[]; cache: CacheStats; user: string }> {
  const username = config.user || await getAuthenticatedUser();
  const now = Date.now();

  const cached = memoryCache.get(username);
  const isFresh = cached && (now - cached.fetchedAt) < CACHE_AGE_MS;
  const isStale = cached && (now - cached.fetchedAt) < STALE_WHILE_REVALIDATE_MS;

  if (cached && cached.data) {
    const age = now - cached.fetchedAt;
    const fromCache = isFresh || isStale;

    if (fromCache) {
      let repos = [...cached.data];
      repos = filterRepos(repos, config, repos);
      repos = sortRepos(repos, config);
      if (config.limit > 0) repos = repos.slice(0, config.limit);

      progress?.onProgress?.(`Cache hit (${isFresh ? "fresh" : "stale"}, ${Math.round(age / 1000)}s old)`);

      if (isStale && (!revalidatePromise || revalidateUser !== username)) {
        revalidateUser = username;
        revalidatePromise = fetchAndCache(username, config, progress);
      }

      return {
        repos,
        cache: { fromCache: true, isStale: !isFresh, age },
        user: username,
      };
    }
  }

  progress?.onProgress?.(`Fetching contributions for: ${username}`);
  const repos = await fetchAndCache(username, config, progress);

  let filtered = filterRepos(repos, config, repos);
  filtered = sortRepos(filtered, config);
  if (config.limit > 0) filtered = filtered.slice(0, config.limit);

  return { repos: filtered, cache: NO_CACHE, user: username };
}

async function fetchAndCache(username: string, config: Config, progress?: FetchProgress): Promise<Repository[]> {
  const cache = await loadCache();
  let repos: Repository[];

  if (!isCacheStale(cache) && cache.username === username && Object.keys(cache.repos).length > 0) {
    progress?.onProgress?.("Using cached repository list");
    repos = Object.values(cache.repos);
  } else {
    repos = await fetchContributedRepos(username, progress);
    cache.username = username;
  }

  repos.sort((a, b) => b.prCount - a.prCount);
  
  const starsLimit = config.starsLimit || 20;
  const topRepos = repos.slice(0, starsLimit);
  const otherRepos = repos.slice(starsLimit);
  
  await fetchStarsForRepos(topRepos, cache, progress);
  
  for (const repo of otherRepos) {
    const cached = cache.repos[repo.fullName];
    if (cached) {
      repo.stars = cached.stars;
      repo.isPrivate = cached.isPrivate;
    }
  }
  
  saveCache(cache);

  memoryCache.set(username, { data: repos, fetchedAt: Date.now() });

  return repos;
}
