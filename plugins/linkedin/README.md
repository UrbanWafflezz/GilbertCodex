# LinkedIn Plugin

LinkedIn is a first-party Gilbert Codex plugin for compliant profile setup, authenticated self-profile reads, user-supplied profile research briefs, and post draft review through a local MCP server.

## What It Does

- Guides users through LinkedIn developer/OAuth setup.
- Reads the signed-in member's own profile when `LINKEDIN_ACCESS_TOKEN` is saved as secure MCP environment.
- Builds profile setup plans from user-provided goals, experience, strengths, achievements, and keywords.
- Turns pasted profile text, resume notes, or public bio text into a research brief.
- Reviews LinkedIn post drafts without publishing them.

## Safety Boundary

This plugin intentionally does not scrape LinkedIn, crawl profile pages, automate a logged-in browser, update profile fields, send connection requests, send messages, or publish posts. LinkedIn's public developer surface is limited and requires OAuth/member consent for member data. For other people's profiles, users should provide text or separately authorized public sources for Gilbert to analyze.

## Setup

1. Create or reuse a LinkedIn Developer app.
2. Enable Sign in with LinkedIn using OpenID Connect.
3. Request the minimal scopes needed for self-profile reads: `openid`, `profile`, and `email`.
4. Complete OAuth outside the MCP server and save the resulting member access token in Settings > Keys as `LINKEDIN_ACCESS_TOKEN`.
5. In Apps > MCP, configure the LinkedIn preset, apply the saved key as secure environment, then Save and test.

The setup and draft/research tools can run without a token. `linkedin_get_authenticated_profile` requires `LINKEDIN_ACCESS_TOKEN`.

## Included MCP Tools

- `linkedin_setup_checklist`
- `linkedin_get_authenticated_profile`
- `linkedin_profile_setup_plan`
- `linkedin_profile_research_brief`
- `linkedin_post_draft_review`

## Files

- `.codex-plugin/plugin.json` is the user-visible plugin manifest.
- `.app.json` documents the connector boundary and safety contract.
- `.mcp.json` declares the local stdio MCP server.
- `scripts/linkedin-mcp-server.mjs` implements the MCP server without third-party runtime dependencies.
- `assets/linkedin.svg` provides the plugin icon.

## References

- LinkedIn API access: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- LinkedIn OIDC sign-in: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- LinkedIn Profile Details API: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/api-reference/identity-me
- LinkedIn API Terms: https://www.linkedin.com/legal/l/api-terms-of-use
