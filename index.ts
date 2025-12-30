import { Octokit } from "octokit";

const TOKEN = process.env.API_TOKEN;

const USERNAME = "som-sm";
const README_PATH = "README.md";
const PER_PAGE = 15;

// Markers to identify the section to update
const START_MARKER = "<!-- OSS_CONTRIBUTIONS:START -->";
const END_MARKER = "<!-- OSS_CONTRIBUTIONS:END -->";

if (!TOKEN) {
  throw new Error("Missing GITHUB_TOKEN env var");
}

const REPOS = [
  "sindresorhus/type-fest",
  "ts-essentials/ts-essentials",
  "orta/vscode-twoslash-queries",
  "sindresorhus/eslint-plugin-unicorn",
  "xojs/xo",
  "DavidHDev/haiku",
];

const octokit = new Octokit({ auth: TOKEN });

async function fetchMergedPRs(repo: string): Promise<{
  prs: Array<{ title: string; number: number; url: string }>;
  totalCount: number;
}> {
  const { data } = await octokit.request("GET /search/issues", {
    q: `is:pr is:merged author:${USERNAME} repo:${repo}`,
    per_page: PER_PAGE,
    sort: "created",
    order: "desc",
  });

  return {
    prs: data.items.map((item) => ({
      title: item.title,
      number: item.number,
      url: item.html_url,
    })),
    totalCount: data.total_count,
  };
}

function buildRepoMergedPrsUrl(repo: string) {
  const q = `is:pr is:merged author:${USERNAME}`;
  return `https://github.com/${repo}/pulls?q=${encodeURIComponent(q)}`;
}

function generateMarkdown(
  repos: Array<{
    name: string;
    prs: Array<{ title: string; number: number; url: string }>;
    totalCount: number;
  }>
) {
  let md = "## 🧩 Open Source Contributions\n";

  for (const repo of repos) {
    if (repo.prs.length === 0) {
      continue;
    }

    md += `\n### 📦 ${repo.name}`;

    for (const pr of repo.prs) {
      md += `\n- ${pr.title} — [#${pr.number}](${pr.url})`;
    }

    if (repo.totalCount > PER_PAGE) {
      const remaining = repo.totalCount - PER_PAGE;
      const plural = remaining === 1 ? "" : "s";
      md += `\n\n [View ${remaining} more PR${plural}](${buildRepoMergedPrsUrl(
        repo.name
      )})`;
    }
  }

  return md;
}

async function getReadme(): Promise<{ readme: string; sha: string }> {
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/contents/{path}",
    { owner: USERNAME, repo: USERNAME, path: README_PATH }
  );

  if (!Array.isArray(data) && data.type === "file") {
    const readme = Buffer.from(data.content, "base64").toString("utf-8");
    return { readme, sha: data.sha };
  }

  throw new Error("Something went wrong while fetching the README");
}

async function updateReadme(readme: string, sha: string): Promise<void> {
  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner: USERNAME,
    repo: USERNAME,
    path: README_PATH,
    message: "Update merged PRs section",
    content: Buffer.from(readme).toString("base64"),
    sha,
  });
}

function getUpdatedReadme(readme: string, newContent: string): string {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);

  if (startIndex === -1 || endIndex === -1) {
    return `${readme.trimEnd()}\n\n${START_MARKER}\n${newContent}\n${END_MARKER}\n`;
  }

  if (startIndex >= endIndex) {
    throw new Error("START marker must come before END marker");
  }

  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);

  return `${before}\n${newContent}\n${after}`;
}

async function main() {
  const results = await Promise.all(
    REPOS.map(async (repo) => {
      const { prs, totalCount } = await fetchMergedPRs(repo);
      return { name: repo, prs, totalCount };
    })
  );

  const { readme, sha } = await getReadme();
  const updatedReadme = getUpdatedReadme(readme, generateMarkdown(results));
  await updateReadme(updatedReadme, sha);
}

main();
