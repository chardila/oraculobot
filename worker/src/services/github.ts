export async function triggerSiteBuild(pat: string, repo: string): Promise<void> {
  const [owner, repoName] = repo.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/build-site.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'oraculobot-worker/1.0',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`GitHub Actions trigger failed: ${res.status} ${text}`);
  }
}
