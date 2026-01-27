#!/bin/bash
# ============================================================================
# ITTY BITY CITY - Watchdog Script
# ============================================================================
# Keeps the game server and cloudflared tunnel running
# Run this with: nohup ./watchdog.sh &

GAME_DIR="/home/ubuntu/clawd/ittybitycity-game"
LOG_FILE="/tmp/ittybitycity-watchdog.log"
URL_FILE="/tmp/ittybitycity-url.txt"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

start_server() {
    log "Starting game server..."
    cd "$GAME_DIR"
    node server.js >> /tmp/ittybitycity-server.log 2>&1 &
    sleep 2
    if pgrep -f "node server.js" > /dev/null; then
        log "Game server started successfully"
    else
        log "ERROR: Game server failed to start"
    fi
}

start_tunnel() {
    log "Starting cloudflared tunnel..."
    cloudflared tunnel --url http://localhost:3000 2>&1 | tee -a /tmp/ittybitycity-tunnel.log &
    sleep 8
    
    # Extract the URL from the tunnel output
    NEW_URL=$(grep -o 'https://[^ ]*trycloudflare.com' /tmp/ittybitycity-tunnel.log | tail -1)
    if [ -n "$NEW_URL" ]; then
        echo "$NEW_URL" > "$URL_FILE"
        log "Tunnel started: $NEW_URL"
    else
        log "WARNING: Could not extract tunnel URL"
    fi
}

check_server() {
    if ! pgrep -f "node server.js" > /dev/null; then
        log "Game server is DOWN - restarting..."
        start_server
    fi
}

check_tunnel() {
    if ! pgrep -f "cloudflared tunnel" > /dev/null; then
        log "Tunnel is DOWN - restarting..."
        start_tunnel
    fi
}

# Main loop
log "=========================================="
log "Watchdog started"
log "=========================================="

# Initial startup
check_server
sleep 2
check_tunnel

# Monitor loop - check every 30 seconds
while true; do
    check_server
    check_tunnel
    sleep 30
done
