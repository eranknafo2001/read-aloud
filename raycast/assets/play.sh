#!/bin/bash
# Plays one audio file and keeps Spotify quiet while it plays.
#   play.sh <audio file> <speed> <percent of Spotify's volume to keep> <here|always>
# 100 percent leaves Spotify alone. "here" changes the volume only while Spotify is producing sound
# on this Mac; "always" changes it whenever the Spotify app is open (it may be playing elsewhere).
# It runs detached from Raycast, so the command that started it can end at once.
# Stop it early with SIGTERM: it stops the voice and puts Spotify's volume back.

audio="$1"
speed="$2"
keep="$3"
when="${4:-here}"
player=""
original=""

spotify() { osascript -e "tell application \"Spotify\" to $1" 2>/dev/null; }

# True if the Spotify app itself is sending sound to this Mac's output right now. macOS lists, per
# app, a "keep awake" entry from coreaudiod while that app plays audio; the next line names the app.
plays_here() {
  local pid
  pid=$(pgrep -x Spotify | head -1)
  [ -n "$pid" ] && pmset -g assertions | awk -v pid="$pid" '
    /coreaudiod/ { audio = 1; next }
    audio && /Created for PID/ { if ($0 ~ ("PID: " pid "\\.")) found = 1 }
    { audio = 0 }
    END { exit !found }'
}

restore() {
  [ -n "$original" ] || return
  spotify "set sound volume to $original"
  # Spotify sometimes lands one below the requested value, so nudge until it matches.
  now=$(spotify "get sound volume")
  if [ -n "$now" ] && [ "$now" -lt "$original" ]; then
    spotify "set sound volume to $((original + original - now))"
  fi
  original=""
}

finish() {
  [ -n "$player" ] && kill "$player" 2>/dev/null
  restore
  exit 0
}
trap finish TERM INT

# The voice starts first, so talking to Spotify never delays it.
afplay -q 1 -r "$speed" "$audio" &
player=$!

if [ "$keep" -lt 100 ] && pgrep -xq Spotify && { [ "$when" = always ] || plays_here; }; then
  original=$(spotify "get sound volume")
  [ -n "$original" ] && spotify "set sound volume to $((original * keep / 100))"
fi

wait "$player"
finish
