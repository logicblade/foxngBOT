# sh-bot

A Telegram bot that connects to you 3X-UI v2ray VPN panel and let's you automate you misery.

Usage:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/logicblade/sh-bot/refs/heads/main/install.sh)
```

This will install the bot and ask you for your Telegram bot token and your telegram user ID for admin purposes.

To update, you can use:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/logicblade/sh-bot/refs/heads/main/update.sh)
```

**IMPORTANT**
Be sure to check the generated .env file.

```text
BOT_TOKEN=Your-Telegram-Bot-Token-From-BotFather
OWNER_ID=Your-Telegram-User-ID        # full access: stats, broadcast, backup, add admin
ADMIN_ID=Your-Telegram-User-ID        # legacy alias, also treated as owner
SUPPORT_ID=@foxngsup                  # support contact shown to users
CARD_NUMBER=5029081059314381          # payment card shown in the receipt step
CARD_OWNER=Card Holder Name
```

### Roles

- **OWNER** (`OWNER_ID` / `ADMIN_ID`): full access, can add/remove admins, broadcasts, subscriber
  broadcast, database backup, statistics, and receipt review (approve/reject).
- **ADMIN** (added by the owner through «➕ افزودن ادمین», stored in the `admins` table): can only
  review receipts and approve/reject orders.
- **USER**: subscription purchase/renewal, volume status and support only.

All protected callback handlers re-check the caller's role server-side, so hiding buttons is not the
only protection.

## Configuration

Remember to start the conversation with your bot as admin to add your 3X-UI panel URL and information.

### Development

To install dependencies:

```bash
bun install
```

To run locally:

```bash
bun run dev
```

To run in production environment:

```bash
bun run start
```
