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

interface PullRequestInfo {
  title: string;
  number: number;
  url: string;
  additions: number;
  deletions: number;
  pinned: boolean;
}

const REPOS = [
  { owner: "sindresorhus", repo: "type-fest" },
  { owner: "ts-essentials", repo: "ts-essentials" },
  { owner: "orta", repo: "vscode-twoslash-queries" },
  { owner: "sindresorhus", repo: "eslint-plugin-unicorn" },
  { owner: "xojs", repo: "xo" },
  { owner: "DavidHDev", repo: "haiku" },
];

const PINNED_PRS_PER_REPO: Record<string, number[]> = {
  "sindresorhus/type-fest": [
    1265, 1300, 1309, 1364, 1347, 1396, 1343, 1324, 1044,
  ],
};

const octokit = new Octokit({ auth: TOKEN });

async function fetchMergedPRs(repo: (typeof REPOS)[number]): Promise<{
  prs: Array<PullRequestInfo>;
  totalCount: number;
}> {
  const repoFullName = `${repo.owner}/${repo.repo}`;
  const pinnedPRNumbers = PINNED_PRS_PER_REPO[repoFullName] ?? [];

  const { data } = await octokit.request("GET /search/issues", {
    q: `is:pr is:merged author:${USERNAME} repo:${repoFullName}`,
    per_page: PER_PAGE,
    sort: "updated",
    order: "desc",
  });

  const prNumbers = [
    ...pinnedPRNumbers,
    ...data.items
      .filter((item) => !pinnedPRNumbers.includes(item.number))
      .map(({ number }) => number),
  ].slice(0, Math.max(pinnedPRNumbers.length, PER_PAGE));

  const prs = await Promise.all(
    prNumbers.map(async (prNumber) => {
      const { data: pr } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: repo.owner,
          repo: repo.repo,
          pull_number: prNumber,
        },
      );

      return {
        title: pr.title,
        number: pr.number,
        url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        pinned: pinnedPRNumbers.includes(pr.number),
      };
    }),
  );

  return {
    prs,
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
    prs: Array<PullRequestInfo>;
    totalCount: number;
  }>,
) {
  let md = "## 🧩 Open Source Contributions\n";

  for (const [index, repo] of repos.entries()) {
    if (repo.prs.length === 0) {
      continue;
    }

    if (index > 0) {
      md += `\n<br>`;
    }

    const prsUrl = buildRepoMergedPrsUrl(repo.name);
    const repoUrl = `https://github.com/${repo.name}`;
    // `label` is prefixed with a zero-width character because shields.io uppercases the first character by default
    const starsBadge = `<img src="https://img.shields.io/github/stars/${repo.name}?label=%E2%80%8B${repo.name}&style=flat-square&logo=github" alt="${repo.name}" style="height:24px">`;
    const mergedPrsBadge = `<img src="https://img.shields.io/badge/Merged%20PRs-${repo.totalCount}-blue?style=flat-square" alt="Merged PRs" style="height:24px"/>`;
    md += `\n\n<a href="${repoUrl}">${starsBadge}</a> <a href="${prsUrl}">${mergedPrsBadge}</a>`;

    md += `\n| PRs | | |`;
    md += `\n| :--- | :--- | :--- |`;

    for (const pr of repo.prs) {
      const pin = pr.pinned ? "📌 " : "";
      md += `\n| ${pin}${pr.title.replace(/\|/g, "\\|")} | [#${pr.number}](${
        pr.url
      }) | $\\color{green}{+${pr.additions}}\\ \\ \\color{red}{-${pr.deletions}}$ |`;
    }

    if (repo.totalCount > repo.prs.length) {
      const remaining = repo.totalCount - repo.prs.length;
      const plural = remaining === 1 ? "" : "s";
      md += `\n| [View ${remaining} more PR${plural}](${buildRepoMergedPrsUrl(
        repo.name,
      )}) | | |`;
    }
  }

  return md;
}

async function getReadme(): Promise<{ readme: string; sha: string }> {
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/contents/{path}",
    { owner: USERNAME, repo: USERNAME, path: README_PATH },
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
      return { name: `${repo.owner}/${repo.repo}`, prs, totalCount };
    }),
  );

  const { readme, sha } = await getReadme();
  const updatedReadme = getUpdatedReadme(readme, generateMarkdown(results));

  if (readme === updatedReadme) {
    console.log("No changes detected, skipping update");
    return;
  }

  console.log("Changes detected, updating README");
  await updateReadme(updatedReadme, sha);
}

main();
