#!/usr/bin/env bun

import { Config, DEFAULT_CONFIG, getRepos, Repository } from "./lib";

function parseArgs(): Config {
  const args = Bun.argv.slice(2);

  const config: Config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--scope") {
      const value = args[++i];
      if (value === "own" || value === "external" || value === "all") {
        config.scope = value;
      }
    } else if (arg === "-o") {
      config.scope = "own";
    } else if (arg === "-e") {
      config.scope = "external";
    } else if (arg === "-a") {
      config.scope = "all";
    } else if (arg === "--sort") {
      const value = args[++i];
      if (value === "stars" || value === "contributions" || value === "all" || value === "recent") {
        config.sortBy = value;
      }
    } else if (arg === "--limit" || arg === "-l") {
      config.limit = parseInt(args[++i], 10) || 0;
    } else if (arg === "--include" || arg === "-i") {
      const value = args[++i];
      if (value) {
        config.include = value.split(",").map(r => r.trim()).filter(Boolean);
      }
    } else if (arg === "--exclude" || arg === "-x") {
      const value = args[++i];
      if (value) {
        config.exclude = value.split(",").map(r => r.trim()).filter(Boolean);
      }
    } else if (arg === "--private" || arg === "-p") {
      config.includePrivate = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
GitHub Contributions Fetcher

Options:
  --scope <type>           Which repos to show: own, external (default), all
  -o                       Shortcut for --scope own
  -e                       Shortcut for --scope external
  -a                       Shortcut for --scope all
  --sort <type>            Sort by: stars (default), contributions, all, recent
  --limit, -l <n>          Limit number of results
  --include, -i <repos>    Always include these repos (comma-separated)
  --exclude, -x <repos>    Always exclude these repos (comma-separated)
  --private, -p            Include private repos (excluded by default)
  --help, -h               Show this help

Examples:
  bun run cli.ts                           # External repos, sorted by stars
  bun run cli.ts -o                        # Own repos only
  bun run cli.ts -a                        # All repos (own + external)
  bun run cli.ts --scope own               # Own repos only (long form)
  bun run cli.ts --sort contributions      # Sort by PR count
  bun run cli.ts --sort all -l 10          # Top 10 by combined score
  bun run cli.ts --sort recent             # Most recently contributed
  bun run cli.ts -o -i vercel/hyper        # Own repos + vercel/hyper
  bun run cli.ts -x mazedesignhq/maze-monorepo   # Exclude specific repo
  bun run cli.ts --private                 # Include private repos
`);
      process.exit(0);
    }
  }

  return config;
}

function formatOutput(repos: Repository[], sortBy: Config["sortBy"]): string {
  const lines: string[] = [];

  lines.push(`Found ${repos.length} repositories:\n`);

  for (const repo of repos) {
    const stars = repo.stars.toLocaleString().padStart(8);
    const prs = String(repo.prCount).padStart(3);
    const owned = repo.isOwned ? " [own]" : "";
    const date = sortBy === "recent" ? `  ${repo.lastContributedAt.slice(0, 10)}` : "";
    lines.push(`  ${stars} stars  ${prs} PRs${date}  ${repo.fullName}${owned}`);
  }

  const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
  const totalPRs = repos.reduce((sum, r) => sum + r.prCount, 0);
  lines.push(
    `\nTotal: ${repos.length} repositories, ${totalStars.toLocaleString()} stars, ${totalPRs} PRs`
  );

  return lines.join("\n");
}

async function main() {
  const config = parseArgs();

  console.log("GitHub Contributions Fetcher\n");

  try {
    const repos = await getRepos(config, {
      onProgress: (msg) => console.log(msg),
    });

    console.log(formatOutput(repos, config.sortBy));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();