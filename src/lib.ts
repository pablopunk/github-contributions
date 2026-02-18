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
}

export const DEFAULT_CONFIG: Config = {
  scope: "external",
  sortBy: "stars",
  includePrivate: false,
  limit: 0,
  include: [],
  exclude: [],
};

const CACHE_FILE = "cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function getAuthHeader(): Record<string, string> | undefined {
  if (!GITHUB_TOKEN) return undefined;
  return { Authorization: `Bearer ${GITHUB_TOKEN}` };
}

async function ghApi(endpoint: string, jq?: string): Promise<string> {
  const url = `https://api.github.com${endpoint}${jq ? `?${jq}` : ""}`;
  
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    ...(getAuthHeader() || {}),
  };

  const res = await fetch(url, { headers });
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
    return (await ghApi("/user", "jq=.login")).trim();
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

  progress?.onProgress?.(`Fetching repo data for ${toFetch.length} repos...`);

  for (let i = 0; i < toFetch.length; i++) {
    const repo = toFetch[i];
    progress?.onProgress?.(`[${i + 1}/${toFetch.length}] ${repo.fullName}`);
    const data = await fetchRepoData(repo.fullName);
    repo.stars = data.stars;
    repo.isPrivate = data.isPrivate;
    cache.repos[repo.fullName] = { ...repo };

    if (i < toFetch.length - 1) {
      await new Promise(r => setTimeout(r, 100));
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

export async function getRepos(config: Config, progress?: FetchProgress): Promise<Repository[]> {
  const username = await getAuthenticatedUser();
  progress?.onProgress?.(`Fetching contributions for: ${username}`);

  const cache = await loadCache();

  let repos: Repository[];

  if (!isCacheStale(cache) && cache.username === username && Object.keys(cache.repos).length > 0) {
    progress?.onProgress?.("Using cached repository list");
    repos = Object.values(cache.repos);
  } else {
    repos = await fetchContributedRepos(username, progress);
    cache.username = username;
  }

  await fetchStarsForRepos(repos, cache, progress);
  saveCache(cache);

  const allRepos = repos;
  repos = filterRepos(repos, config, allRepos);
  repos = sortRepos(repos, config);

  if (config.limit > 0) {
    repos = repos.slice(0, config.limit);
  }

  return repos;
}
