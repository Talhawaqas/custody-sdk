// packages/cli/src/commands/orgBackup.js -- GET /api/public/v1/endpoint-backup/health (same Bearer API key as every other organization command).
export async function backupHealth({ baseUrl, apiKey }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/v1/endpoint-backup/health`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
  return data;
}
