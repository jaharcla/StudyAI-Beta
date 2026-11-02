# StudyAI in GitHub Codespaces

The Codespaces devcontainer installs the Linux browser/VNC dependencies, Playwright Chromium, and both JavaScript workspaces. It builds the existing Waterloo LEARN MCP server; it does not run the Windows MCP registration script.

## Start

Add `GROQ_API_KEY` as a GitHub Codespaces secret, then create or rebuild the Codespace from the repository root. Start StudyAI from the app directory:

```bash
cd template-react-ts-main/template-react-ts-main
npm run dev-study
```

Open the private `StudyAI` port (5173) from the Codespaces Ports panel. Codespaces supplies the forwarded-port domain and Codespace name. Ollama is not used in this profile.

## Connect LEARN

1. Choose **Connect LEARN** in StudyAI. It starts a temporary headed Chromium session and a private Codespaces-forwarded noVNC viewer on port 6080.
2. In that viewer, sign in to Waterloo LEARN with WatIAM and approve Duo yourself. StudyAI does not collect or fill credentials or automate MFA.
3. Once LEARN returns authenticated course enrollments, the browser state is saved and the viewer services stop. StudyAI can then sync courses through the existing MCP bridge.
4. If LEARN later expires the session, cached course data remains available. Choose **Reconnect**, complete WatIAM/Duo again, then sync.

The saved Playwright state lives at repository-root `.studyai-private/learn-auth-state.json`, with directory mode `0700` and file mode `0600`; `.studyai-private/` is gitignored. The MCP receives only the file path and reloads its browser context after the state file is replaced. The temporary VNC server listens on loopback; only the private forwarded noVNC port reaches it. The viewer listener and sign-in browser stop after success, cancellation, or failure.

Groq is contacted only when a student requests question generation. Selected lecture text is sent to Groq using the Codespaces `GROQ_API_KEY` secret; WatIAM credentials and LEARN cookies stay in the Codespace.

Real WatIAM/Duo approval and a live university course sync must be completed by the student in the Codespace; local mocked tests cannot verify university access.
