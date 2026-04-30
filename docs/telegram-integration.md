# Telegram Integration

Stratos can be reached over Telegram: messages you send to your bot are
forwarded to the Manager Agent, and replies come back in the same chat (and
forum topic) you sent from.

This guide walks through enabling the feature, creating a bot, finding your
chat ID, and (optionally) using forum topics.

---

## 1. Enable the feature

The Telegram UI is gated behind a flag file so it stays hidden by default:

```bash
touch ~/.stratos/telegram.json
```

Restart Stratos. **Settings → Telegram** now appears.

---

## 2. Get a bot token from @BotFather

1. Open Telegram and search for [`@BotFather`](https://t.me/BotFather).
2. Send `/newbot`.
3. Pick a display name (e.g. `Stratos`) and a username ending in `bot`
   (e.g. `my_stratos_bot`). Usernames must be globally unique.
4. BotFather replies with a token that looks like:
   ```
   123456789:ABCdef-Gh1jKlMnOpQrStUvWxYz0AbCdEfGh
   ```
5. **Don't reuse a token across machines.** Telegram only lets one process
   long-poll a bot at a time — a second consumer silently steals updates from
   the first.
6. (Optional but recommended) Lock down the bot:
   - `/setjoingroups` → **Disable** (so nobody can drag the bot into random
     groups).
   - `/setprivacy` → **Disable** if you plan to use it in a group with topics
     and want it to read every message; **Enable** for DM-only use.
   - `/setdescription`, `/setuserpic` → cosmetic.

Paste the token into **Settings → Telegram → Bot Token** and save. The token
is stored in `~/Library/Application Support/Stratos/telegram-settings.json`
(or the per-worktree `userData` dir in dev mode).

---

## 3. Find your chat ID

The bot only responds to one trusted chat ID — every other sender is dropped.
Three ways to find yours, easiest first:

### a) Via the gateway log (works for any chat)

1. With the bot token saved, click **Connect** in Settings.
2. From the chat you want to authorise (DM, group, or forum topic), send the
   bot any message — e.g. `/start`.
3. Tail the gateway log:

   ```bash
   # Dev (worktree)
   tail -f ~/.stratos/instances/$(ls ~/.stratos/instances/)/logs/gateway.log

   # Packaged
   tail -f "~/Library/Application Support/Stratos/logs/gateway.log"
   ```

4. You'll see a line like:
   ```
   [telegram] blocked: chat 123456789
   ```
   That number is your chat ID. Paste it into **Trusted Chat ID** and save.

### b) Via [`@userinfobot`](https://t.me/userinfobot) (DMs only)

DM that bot anything; it replies with your numeric user ID, which doubles as
your DM chat ID.

### c) Via the Bot API directly

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq
```

After sending your bot a message, look for `message.chat.id`.

### Chat ID shapes

| Chat type          | Shape          | Example          |
| ------------------ | -------------- | ---------------- |
| Private (DM)       | positive int   | `123456789`      |
| Group              | negative int   | `-100123456`     |
| Supergroup / forum | `-100<digits>` | `-1001234567890` |

Stratos accepts all three — use the value the log/API returns verbatim.

---

## 4. (Optional) Use forum topics

If you want one Telegram chat that has multiple separate threads (e.g. one
topic per project), use a Telegram **forum supergroup**:

1. Create a new group (Telegram app → New Group).
2. Add the bot as a member.
3. Promote the group to a supergroup if it isn't already (sending the first
   message usually triggers this automatically).
4. Group settings → **Topics** → enable.
5. Create the topics you want (one per project, conversation, etc.).
6. The chat ID is the supergroup ID (`-100…`); you only need to paste it
   once, even though the group has many topics.

When you message the bot inside a topic, replies (including async Manager
notifications about session completion) automatically land back in the same
topic. There's nothing extra to configure — `message_thread_id` is preserved
through the gateway.

> ⚠️ **Manager state is shared across topics.** Stratos has a single Manager
> Agent session for the whole app, so context flows between every topic you
> use. The topic only controls **where the reply lands**, not which Manager
> conversation it joins. If you want hard isolation per topic, dispatch
> agent sessions explicitly via the Manager — those are per-thread.

---

## 5. Connect

1. Settings → Telegram → **Connect**.
2. Status pill flips through `connecting…` → `connected`. The tray menu
   shows the same status.
3. Send a message to your bot. The `typing…` indicator appears, the Manager
   replies, the reply lands in the same chat (and topic).

If `connecting…` flips to `error`, check the gateway log — most failures are
either an invalid token (`auth failed`) or another process already polling
the same bot (`409 Conflict`). The latter resolves itself when the other
consumer disconnects.

---

## 6. Updating settings live

- **Trusted Chat ID** — saving updates the running gateway immediately, no
  reconnect required.
- **Bot Token** — saving writes the new value to disk, but the running
  client keeps the old token. Click **Disconnect** then **Connect** to swap.

---

## 7. Disabling

Either:

```bash
rm ~/.stratos/telegram.json
```

(removes the UI section entirely on next restart) or just click
**Disconnect** in Settings (gateway stops, settings are kept).

---

## Troubleshooting

| Symptom                                           | Likely cause                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bot ignores you, log says `blocked: chat <id>`    | Trusted Chat ID doesn't match — copy the ID from the log.                                                     |
| Status stuck on `connecting…`                     | Another process is long-polling the same token (cfo, another Stratos worktree). Kill it or use a fresh token. |
| `409 Conflict` in log                             | Same as above — Telegram only allows one polling consumer per bot.                                            |
| Replies land in **General** instead of your topic | You're on an old Stratos build that pre-dates the topic fix; rebuild and restart.                             |
| Manager replies are slow / never come             | The Manager is busy with a previous turn; check the main UI for an active stream.                             |
