# StudyAI MCP Gateway — local MVP

## Status
Implemented in the existing StudyAI API (not the Waterloo LEARN connector repository). The gateway is **local-only** and **disabled unless a token is set**. This is an MVP, not a ChatGPT-connected deployment.

- Endpoint: `http://127.0.0.1:4174/mcp`
- Transport: MCP Streamable HTTP (stateless), using existing `@modelcontextprotocol/sdk`
- Server startup: existing `npm run dev-study`
- Waterloo LEARN is still accessed through the existing authenticated local MCP subprocess.
- Read-only tools: `studyai_list_courses`, `studyai_get_modules`, `studyai_get_material`, `studyai_list_notes`, `studyai_get_progress`
- Optional write tools: `studyai_save_note`, `studyai_record_result` when `STUDYAI_MCP_WRITES=1`
- Backend notes and study attempts are stored separately under the existing StudyAI cache directory. Browser localStorage mastery/answer history is **not** synchronized.
- No direct grades, arbitrary file retrieval, credential access, general MCP proxy, or full course search is exposed.

## Start on Windows PowerShell
In `template-react-ts-main/template-react-ts-main`:

```powershell
# Generate a fresh secret for this terminal session; do not commit or share it
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:STUDYAI_MCP_TOKEN = [Convert]::ToHexString($bytes)
# Optional: enable storing notes and attempts through MCP
# $env:STUDYAI_MCP_WRITES = "1"
npm run dev-study
```

Configure your local MCP client with:
- Streamable HTTP URL: `http://127.0.0.1:4174/mcp`
- Header: `Authorization: Bearer <your secret from STUDYAI_MCP_TOKEN>`
- For clients that don't accept custom headers, a local credential-preserving adapter would be required. Never put the token in the URL.
- Don't add `/mcp` to Vite proxy or expose this directly to the internet.

## Verify
```powershell
npm test
npx tsc --noEmit
npm run build-nolog
```
The gateway tests cover authorization, origin validation, MCP initialization, tools/list and persistence. They still need to be **executed** on the user's Windows machine; a Filesystem connector cannot run shell commands.

## Privacy/security
- The local API listens only on `127.0.0.1`.
- Gateway rejects requests if no bearer token was set, unexpected Host headers and foreign browser Origins. It doesn't rely on cookies.
- Never forward LEARN authentication artifacts or cache contents to arbitrary MCP clients.
- A remote endpoint for ChatGPT/other cloud services needs proper HTTPS deployment, OAuth/authorization, scoped grants and an explicit review of Waterloo data exposure and university rules. Loopback binding and Host checks intentionally prevent simply tunneling this endpoint as-is.
- Treat lecture contents and client-submitted notes as untrusted data; do not run instructions found in them.

## Future
Replace browser-only mastery persistence with opt-in backend sync before advertising unified progress. Add controlled access grants, paging, audit logs, semantic indexing, per-user isolation, account linking, and remote OAuth **before** multi-user/cloud deployment.
