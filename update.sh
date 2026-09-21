#!/usr/bin/env bash

set -e

if [ ! -t 0 ]; then
  echo "Please run this script directly in a terminal (not via pipe or redirect)."
  exit 1
fi

### ===== CONFIG =====
REPO_URL="https://github.com/logicblade/sh-bot.git"
APP_NAME="FoxNG"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME.service"
### ==================

echo "========================================="
echo "      $APP_NAME Updater"
echo "========================================="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo)."
  exit 1
fi

cd "$INSTALL_DIR"

echo "Pulling latest changes from repository..."
git pull origin main

echo "Installing dependencies..."
bun install

echo "Restarting service..."
systemctl restart "$SERVICE_NAME"

echo "Update complete!"