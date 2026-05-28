# Discord Integration Setup

This guide explains how to prepare Discord so users can chat with Gilbert Codex from Discord.

Last updated: May 28, 2026 for the v0.8.5 build.

Platform note: the bridge has native command-path handling for Windows, macOS, and Linux, including common ngrok install locations. macOS and Linux still need packaged-app launch testing before the integration is marked fully verified there, especially around ngrok process handling, local networking, notifications, and desktop permission prompts. See [Platform Support And Porting Notes](../platform/README.md).

## What Works Today

Gilbert Codex has a local Settings > Discord setup page and a desktop bridge runtime for Discord slash-command chat.

For the default slash-command path, the desktop app can:

- Start a local receiver at `http://127.0.0.1:<bridgePort>/discord/interactions` (the bridge port is configured in Settings > Discord; it must match the port Discord and your tunnel reach).
- Verify Discord `X-Signature-Ed25519` and `X-Signature-Timestamp` headers.
- Respond to Discord `PING` validation requests.
- Start `ngrok` in the background when configured.
- Read the ngrok public HTTPS URL from the local ngrok Agent API.
- Fill Settings > Discord > Interactions endpoint URL automatically.
- Turn `/gilbert prompt: ...` requests into ongoing Gilbert chat requests.
- Turn `/gilbertnewchat prompt: ...` requests into a fresh Gilbert chat.
- Edit the original Discord interaction response while Gilbert works, then replace it with the final answer.
- Use the same source context, project context, and permission settings that are enabled inside Gilbert Codex.
- Convert Gilbert's richer Markdown into Discord-safe Markdown before posting back to Discord.

Discord-initiated chats use the same review boundaries as in-app chats. Source context can attach when enabled, and local or remote actions remain subject to the selected provider, workspace scope, and review policy.

A plain Discord incoming webhook cannot read user messages; it only posts messages into a channel. Use one of these paths:

- Slash chat: best default. Discord sends interactions to a public HTTPS endpoint, and the bridge forwards the request to Gilbert.
- Bot gateway: use for DMs, mentions, or normal channel-message chat. This requires a bot token and the right gateway intents.
- Notify only: use an incoming webhook when Gilbert or another app workflow only needs to post updates into Discord.

## Official Links

- Discord Developer Portal: https://discord.com/developers/applications
- Discord Interactions overview: https://docs.discord.com/developers/interactions/
- Receiving and responding to interactions: https://docs.discord.com/developers/interactions/receiving-and-responding
- Application commands and slash commands: https://docs.discord.com/developers/interactions/application-commands
- Discord webhooks overview: https://docs.discord.com/developers/platform/webhooks
- Webhook resource reference: https://docs.discord.com/developers/resources/webhook
- Gateway and intents: https://docs.discord.com/developers/docs/topics/gateway
- ngrok quickstart: https://ngrok.com/docs/getting-started
- ngrok Agent API: https://ngrok.com/docs/agent/api/

## Prerequisites

- A Discord account.
- A Discord server where you can manage apps or webhooks.
- A channel for Gilbert chat or notifications.
- For Slash chat, ngrok installed and authenticated, or another public HTTPS tunnel to the local receiver.
- For Bot gateway, a running bridge process that can connect to Discord Gateway with a bot token.

Do not commit bot tokens, webhook URLs, ngrok auth tokens, or bridge environment files.

## Path A: Slash Chat With Discord Interactions

Use this path when users should type a slash command and get a response from Gilbert. Use `/gilbert prompt: ...` to continue the latest Discord-linked chat for that channel or user. Use `/gilbertnewchat prompt: ...` when you intentionally want a fresh local Gilbert chat.

1. Open the Discord Developer Portal:
   https://discord.com/developers/applications

2. Click New Application.

3. Name the application, for example `Gilbert Codex`.

4. Open the application's General Information page.

5. Copy these values into Gilbert Codex Settings > Discord:
   - Application ID
   - Public Key

6. Install ngrok if you want Gilbert to create the public HTTPS URL automatically.

   On Windows, use one of the install methods from the ngrok quickstart. On macOS, Homebrew installs are the smoothest path:

   ```bash
   brew install ngrok
   ngrok help
   ```

   On Linux, use the ngrok quickstart package instructions for your distribution, or place the executable in a user bin directory such as `~/.local/bin`.

   Packaged desktop apps do not always inherit your interactive shell `PATH`, so Gilbert also checks common macOS Homebrew and MacPorts locations, Linux user bin/Flatpak/Snap locations, and local helper folders before reporting that ngrok is missing. If ngrok is somewhere custom, paste its full executable path in Settings > Discord; the macOS/Linux verification scripts accept the same path through `GILBERT_NGROK_PATH`.

7. Connect ngrok to your account once, or paste the auth token into Settings > Discord > ngrok auth token.

   ```bash
   ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
   ```

   The authtoken comes from your ngrok dashboard. If you paste it into Gilbert Codex, the desktop bridge passes it directly to ngrok at startup so the missing `ngrok.yml` config file does not block the tunnel.

8. In Gilbert Codex Settings > Discord:
   - Enable Discord bridge.
   - Select Slash chat.
   - Keep Tunnel provider set to `ngrok`.
   - Keep Local port on the app default unless that port is already in use on your machine (change it in Settings > Discord if it conflicts).
   - Keep ngrok executable set to `ngrok`, paste the full path to the ngrok executable, or point it at a local folder such as `local-bin/ngrok`.
   - Set Response style to Channel or Ephemeral. Thread is reserved for a later richer Discord workflow.
   - Add Allowed guild IDs and Allowed channel IDs if you want to restrict where the bridge responds.

9. Click Start bridge.

   Gilbert starts the local receiver, starts ngrok in the background, discovers the public HTTPS URL, and fills Interactions endpoint URL. It should look like:

   ```text
   https://example.ngrok.app/discord/interactions
   ```

10. Copy the filled Interactions endpoint URL.

11. Go back to the Discord Developer Portal.

12. Paste the same endpoint into the app's Interactions Endpoint URL field.

13. Save changes.

    Discord will validate the endpoint. Validation fails if the endpoint cannot acknowledge `PING` requests or cannot verify signatures.

14. Register the slash commands for the app.

    In Gilbert Codex, click Settings > Discord > Register commands. Gilbert registers both commands with the same required `prompt` option:

    - `/gilbert prompt: ...` continues the latest Discord-linked local chat for that channel or user.
    - `/gilbertnewchat prompt: ...` starts a new local chat and then sends the prompt.

    Equivalent `/gilbert` command body:

    ```json
    {
      "name": "gilbert",
      "type": 1,
      "description": "Ask Gilbert Codex for help",
      "options": [
        {
          "name": "prompt",
          "type": 3,
          "description": "What should Gilbert do?",
          "required": true
        }
      ]
    }
    ```

    The command registration API is documented here:
    https://docs.discord.com/developers/interactions/application-commands

15. Install the app into your server.

    In the Developer Portal, use the Installation or OAuth2 area to generate an install URL with the scopes needed by your command flow, then open it and add the app to your server.

16. Test in Discord:

    ```text
    /gilbert prompt: summarize this repository issue
    ```

    To force a new app chat from Discord:

    ```text
    /gilbertnewchat prompt: start a fresh investigation for this bug
    ```

17. If nothing happens:
    - Confirm the endpoint is public HTTPS, not localhost.
    - Confirm Gilbert Codex is open and the bridge status says Running.
    - Confirm ngrok is authenticated with `ngrok config add-authtoken`.
    - Check bridge logs for signature validation failures.
    - Confirm the command exists for the server.
    - Confirm the channel or guild is in the allowlist.
    - In Gilbert Codex, check Settings > Discord readiness cards.

## Discord Markdown Formatting

Discord does not render full GitHub-Flavored Markdown. It supports chat formatting such as bold, italics, headings, masked links, lists, code blocks, and block quotes, but not GFM pipe tables.

Gilbert keeps the full Markdown answer inside the app, then adapts the outbound Discord copy:

- Headings, bullets, links, quotes, and fenced code blocks are preserved.
- Horizontal rules are removed because they show as raw `---` in chat.
- Markdown pipe tables are converted into Discord-friendly bullet rows.
- Long Discord messages are trimmed with code fences closed before the final notice.
- Mentions are disabled in Discord API responses so generated text cannot ping `@everyone` or roles.

For table-heavy or long answers, use the Gilbert app as the complete source of truth and treat Discord as the compact remote view.

## Path B: Bot Gateway Chat

Use this path when Discord users should DM the app, mention it, or chat in allowed channels without slash commands.

1. Open the Discord Developer Portal:
   https://discord.com/developers/applications

2. Select your Gilbert application.

3. Open the Bot page.

4. Create or reset the bot token.

5. Copy the bot token into Gilbert Codex Settings > Discord > Bot token.

6. In Gilbert Codex Settings > Discord:
   - Enable Discord bridge.
   - Select Bot gateway.
   - Add Allowed guild IDs or Allowed channel IDs.
   - Choose a Response style.

7. In the Developer Portal, review Gateway intents.

   For normal message-content chat, Discord treats `MESSAGE_CONTENT` as privileged. Prefer slash commands where possible. Gateway chat may work for DMs, app-authored content, or mentions depending on Discord's current rules, but broad channel text reading needs the privileged intent.

8. Run the bridge process.

   The process must:
   - Connect to Discord Gateway.
   - Subscribe only to the events it needs.
   - Ignore messages from itself.
   - Enforce the guild and channel allowlists.
   - Send accepted user messages into Gilbert.
   - Send Gilbert's response back to Discord.

9. Test with a mention or DM:

   ```text
   @Gilbert Codex explain the latest error in this thread
   ```

10. If the app sees events but message content is empty:
    - Confirm whether the event is a DM, mention, or normal channel message.
    - Confirm the `MESSAGE_CONTENT` privileged intent is enabled and approved if required.
    - Consider switching the server flow to Slash chat.

## Path C: Notify Only With Incoming Webhooks

Use this path when Gilbert or another system only needs to post into Discord.

1. In Discord, open Server Settings.

2. Open Integrations.

3. Open Webhooks.

4. Click New Webhook.

5. Choose the channel where updates should appear.

6. Copy the webhook URL.

7. In Gilbert Codex Settings > Discord:
   - Paste it into Discord incoming webhook URL.
   - Select Notify only if no chat intake is needed.
   - Enable the Discord bridge if the runtime should use it.

8. Treat this URL like a password. Anyone with the URL can post into that Discord channel.

## Recommended Production Checklist

- Use Slash chat unless you specifically need gateway message reading.
- Keep Discord bot token, incoming webhook URL, and ngrok auth token out of Git.
- Restrict the bridge with allowed guild IDs and channel IDs.
- Verify Discord signatures before handling interaction payloads.
- Use short timeouts and clear error responses in the bridge runtime.
- Rotate tokens and webhook URLs if they are pasted into an issue, screenshot, or log.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| Discord rejects the Interactions Endpoint URL | Endpoint does not answer `PING`, uses HTTP, ngrok stopped, or signature verification failed | Start the bridge in Settings > Discord, use the generated `https://.../discord/interactions` URL, then save again |
| Start bridge says ngrok could not start | ngrok is not installed, not on PATH, not in a known local helper folder, or not authenticated | Install ngrok, run `ngrok config add-authtoken YOUR_TOKEN`, paste the full ngrok executable path, or place it under a local helper folder |
| Slash command does not appear | Command was not registered or app was not installed in the server | Register a guild command for fast testing, then reinstall the app if needed |
| Slash command shows loading forever | Gilbert was closed, busy, or could not send the final edit to Discord | Keep Gilbert open, wait for the current run to finish, and try again |
| Gateway bot connects but cannot read messages | Missing or unapproved `MESSAGE_CONTENT` privileged intent | Use slash commands or enable/request the privileged intent |
| The bridge responds in the wrong channel | Missing allowlist or wrong response style | Set Allowed guild IDs and Allowed channel IDs in Settings > Discord |

## Current Implementation Notes

- Settings live in Settings > Discord.
- Setup values are stored locally under the app's local storage namespace.
- The desktop runtime includes the Discord slash-command receiver, signature verification, ngrok process management, and interaction response editing.
- Auto-start starts the bridge when the app opens if Discord bridge is enabled, Slash chat is selected, and the Application ID/Public Key are present.
- Discord responses stream by repeatedly editing the original interaction response, with throttling to avoid noisy Discord updates.
- Discord requests use the currently selected Gilbert project and local workspace permissions. They do not bypass app approval, workspace, or review boundaries.
- Discord requests use the same review policy as in-app requests. Source context remains available when enabled, and high-impact actions remain review-gated.
- Bot gateway mode is still future runtime work.
- Incoming Discord webhooks are still one-way notification paths.
