#!/usr/bin/env bash

set -e

if [ ! -t 0 ]; then
  echo "Please run this script directly in a terminal (not via pipe or redirect)."
  exit 1
fi

### ===== CONFIG =====
REPO_URL="https://github.com/logicblade/foxngBOT.git"
APP_NAME="FoxNGBot"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME.service"
RUN_COMMAND="bun run start"
BUILD_COMMAND="bun run build"
### ==================

echo "========================================="
echo "      $APP_NAME Installer"
echo "========================================="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo)."
  exit 1
fi

# ---- Check Git ----
if ! command -v git &> /dev/null; then
  echo "Installing git..."
  apt update
  apt install -y git
fi

# ---- Check Curl ----
if ! command -v curl &> /dev/null; then
  echo "Installing curl..."
  apt update
  apt install -y curl
fi

# ---- Install Bun if missing ----
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "Bun already installed."
fi

BUN_BIN="$(command -v bun)"
if [ -z "$BUN_BIN" ]; then
  echo "Bun installation completed but the bun executable was not found."
  exit 1
fi

# ---- Clone Repo ----
if [ -d "$INSTALL_DIR" ]; then
  echo "Directory exists. Removing..."
  rm -rf "$INSTALL_DIR"
fi

echo "Cloning repository..."
git clone "$REPO_URL" "$INSTALL_DIR"

cd "$INSTALL_DIR"

# ---- Install Dependencies ----
echo "Installing dependencies..."
"$BUN_BIN" install

# ---- Build (if exists) ----
if "$BUN_BIN" run | grep -q build; then
  echo "Running build..."
  "$BUN_BIN" run build
fi

# ---- Ask for ENV values ----
echo
echo "Configure environment variables:"
read -p "  BOT_TOKEN: Your Telegram bot token (from BotFather): " BOT_TOKEN
read -p "  ADMIN_ID: Your Telegram user ID (bot owner, full access): " ADMIN_ID
read -p "  SUPPORT_ID: Support contact shown to users (default @foxngsup): " SUPPORT_ID
SUPPORT_ID=${SUPPORT_ID:-@foxngsup}

# Write .env reliably
cat > "$INSTALL_DIR/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
OWNER_ID=${ADMIN_ID}
ADMIN_ID=${ADMIN_ID}
SUPPORT_ID=${SUPPORT_ID}
EOF

chmod 600 "$INSTALL_DIR/.env"

echo "Environment variables saved to $INSTALL_DIR/.env"

# ---- Create systemd service ----
echo "Creating systemd service..."

cat > "/etc/systemd/system/$SERVICE_NAME" <<EOF
[Unit]
Description=$APP_NAME Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$BUN_BIN run start
Restart=on-failure
RestartSec=5
EnvironmentFile=$INSTALL_DIR/.env
User=root

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

# ---- Enable + Start ----
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

echo
echo "========================================="
echo " Installation Complete!"
echo "========================================="
echo
echo "Check status:"
echo "  systemctl status $SERVICE_NAME"
echo
echo "View logs:"
echo "  journalctl -u $SERVICE_NAME -f"