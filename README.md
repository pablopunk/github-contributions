# GitHub Contributions

A tool to fetch and analyze your GitHub contributions across all repositories. Get insights on your stars, pull requests, and contribution history.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/pablopunk/github-contributions&project-name=github-contributions&env=GITHUB_TOKEN&envDescription=Your%20GitHub%20personal%20access%20token&envLink=https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)

## Features

- 📊 Fetch all your GitHub repositories and contribution stats
- ⭐ Sort by stars, PR count, or combined score
- 🔍 Filter by owned vs external repos
- 🌐 Web interface with HTML and JSON API
- 🚀 CLI tool for quick analysis
- 📈 See your total stars and PR contributions

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (or Node.js)
- GitHub personal access token

### Installation

```bash
git clone https://github.com/pablopunk/github-contributions.git
cd github-contributions
bun install
```

### Configuration

Create a `.env` file with your GitHub token:

```
GITHUB_TOKEN=your_github_token_here
```

Get a personal access token from [GitHub Settings](https://github.com/settings/tokens).

## Usage

### CLI

```bash
# External repos, sorted by stars (default)
bun run cli

# Your own repos only
bun run cli -o

# All repos (owned + external contributions)
bun run cli -a

# Sort by PR contributions
bun run cli --sort contributions

# Top 10 by combined score
bun run cli --sort all -l 10

# Most recent contributions
bun run cli --sort recent

# Include private repos
bun run cli --private

# Exclude specific repos
bun run cli -x owner/repo1,owner/repo2

# Show help
bun run cli --help
```

### Web Server

```bash
bun run server
```

Then visit `http://localhost:3000` in your browser.

#### API Endpoints

- `GET /` - HTML view with repository table
- `GET /api` - JSON API response
- `GET /help` - Command help

#### Query Parameters

```bash
# All parameters work on both / and /api endpoints

# Scope
?scope=own       # Only your own repos
?scope=external  # Only external repos (default)
?scope=all       # All repos (own + external)

# Sorting
?sort=stars           # Sort by stars (default)
?sort=contributions   # Sort by PR count
?sort=all             # Sort by combined score
?sort=recent          # Sort by most recent contribution

# Filtering
?limit=10                              # Limit to 10 results
?exclude=owner/repo1,owner/repo2       # Exclude specific repos
?include=owner/repo1,owner/repo2       # Always include these repos
?private=true                          # Include private repos

# Examples
http://localhost:3000/?scope=all&limit=10
http://localhost:3000/api?scope=own
http://localhost:3000/?sort=recent
http://localhost:3000/?private=true
http://localhost:3000/?exclude=pablopunk/github-contributions
```

## Deployment

This project is ready to deploy on [Vercel](https://vercel.com). The repository includes:

- ✅ `vercel.json` configuration with Bun support
- ✅ Environment variable setup for `GITHUB_TOKEN`
- ✅ Compatible build system

### Deploy Now

Click the button at the top of this README or visit:
```
https://vercel.com/new/clone?repository-url=https://github.com/pablopunk/github-contributions&project-name=github-contributions&env=GITHUB_TOKEN
```

### Manual Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variable when prompted
GITHUB_TOKEN=your_token_here
```

## Development

### Type Checking

```bash
bun run typecheck
```

### Scripts

- `bun run cli` - Run CLI tool
- `bun run server` - Start web server
- `bun run typecheck` - Check TypeScript

## Technology Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Web Framework**: Hono
- **Deployment**: Vercel

## License

MIT

## Author

[Pablo Punk](https://github.com/pablopunk)
