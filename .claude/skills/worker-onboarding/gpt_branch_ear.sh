#!/usr/bin/env bash
# EAR on the GPT branch. Operator-ordered 2026-08-12, 2s poll.
#
# Emits one line when the branch head MOVES. Every stdout line becomes a chat
# notification, which is the whole point: a log file with a heartbeat is not an
# ear. Transient network failures are swallowed so throttling cannot kill it.
#
# CD IS LOAD-BEARING AND WAS A MEASURED DEFECT: the monitor's shell starts in
# C:\Users\tonio\Projects\trading-forge, which is NOT a git repository, so a
# bare `git ls-remote origin` resolved to nothing and the first arming reported
# `@ <absent>` -- an ear that could never have fired. Never rely on inherited cwd.
#
# $1 = repo dir  $2 = remote  $3 = ref  $4 = poll seconds  $5 = max iters (0=inf)

REPO="${1:?repo dir required}"
REMOTE="${2:-origin}"
REF="${3:-refs/heads/external-advisor/gpt-rulings}"
POLL="${4:-2}"
MAX="${5:-0}"

cd "$REPO" || { echo "EAR REFUSED: cannot cd to $REPO"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "EAR REFUSED: $REPO is not a git repository"; exit 2; }

last="$(git ls-remote "$REMOTE" "$REF" 2>/dev/null | cut -f1)"
if [ -z "$last" ]; then
  # FAIL-CLOSED: an ear armed on an absent ref is indistinguishable from a quiet
  # one. Refuse loudly instead of pretending to watch.
  echo "EAR REFUSED: ${REMOTE} ${REF} resolves to NOTHING from ${REPO}"
  exit 3
fi
echo "EAR ARMED on ${REMOTE} ${REF} @ ${last} (poll ${POLL}s, cwd ${REPO})"

i=0
while true; do
  sleep "$POLL"
  cur="$(git ls-remote "$REMOTE" "$REF" 2>/dev/null | cut -f1)"
  if [ -n "$cur" ] && [ "$cur" != "$last" ]; then
    echo "GPT BRANCH MOVED: ${last} -> ${cur}"
    last="$cur"
  fi
  i=$((i + 1))
  if [ "$MAX" -gt 0 ] && [ "$i" -ge "$MAX" ]; then
    echo "EAR EXIT after ${i} polls"
    exit 0
  fi
done
