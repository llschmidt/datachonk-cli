#!/bin/bash
# DataChonk CLI Installer for macOS/Linux
# Usage: curl -fsSL https://datachonk.dev/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
  echo -e "${BLUE}"
  echo "  ____        _        ____ _                 _    "
  echo " |  _ \\  __ _| |_ __ _/ ___| |__   ___  _ __ | | __"
  echo " | | | |/ _\` | __/ _\` | |   | '_ \\ / _ \\| '_ \\| |/ /"
  echo " | |_| | (_| | || (_| | |___| | | | (_) | | | |   < "
  echo " |____/ \\__,_|\\__\\__,_|\\____|_| |_|\\___/|_| |_|_|\\_\\"
  echo -e "${NC}"
  echo "  AI-powered dbt model generator"
  echo ""
}

info() {
  echo -e "${BLUE}INFO${NC} $1"
}

success() {
  echo -e "${GREEN}SUCCESS${NC} $1"
}

warn() {
  echo -e "${YELLOW}WARN${NC} $1"
}

error() {
  echo -e "${RED}ERROR${NC} $1"
  exit 1
}

check_node() {
  if ! command -v node &> /dev/null; then
    error "Node.js is required but not installed.

Install Node.js:
  macOS:   brew install node
  Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
  Windows: https://nodejs.org/en/download/
"
  fi
  
  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ is required. Current version: $(node -v)"
  fi
  
  info "Node.js $(node -v) detected"
}

check_npm() {
  if ! command -v npm &> /dev/null; then
    error "npm is required but not installed."
  fi
  info "npm $(npm -v) detected"
}

install_cli() {
  info "Installing @datachonk/cli from npm..."
  
  if npm install -g @datachonk/cli; then
    success "Installation complete!"
  else
    warn "Global install failed. Trying with sudo..."
    if sudo npm install -g @datachonk/cli; then
      success "Installation complete!"
    else
      error "Installation failed. Try running: sudo npm install -g @datachonk/cli"
    fi
  fi
}

verify_installation() {
  if command -v datachonk &> /dev/null; then
    echo ""
    success "DataChonk CLI installed successfully!"
    echo ""
    datachonk --version
    echo ""
    echo "Get started:"
    echo ""
    echo "  datachonk auth login    # Login to your account"
    echo "  datachonk init          # Initialize a dbt project"
    echo "  datachonk chat          # Chat with Chonk AI"
    echo "  datachonk --help        # See all commands"
    echo ""
  else
    error "Installation verification failed. Try opening a new terminal and running: datachonk --version"
  fi
}

main() {
  print_banner
  check_node
  check_npm
  install_cli
  verify_installation
}

main
