#!/bin/bash
# Exercise a COPY of cy-restart in a temporary state directory. Never write
# the real runner/state/restart-request.json or trigger the watchdog.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -f "$scratch/cy-restart" "$scratch/state/restart-request.json"; rmdir "$scratch/state" "$scratch"' EXIT
mkdir "$scratch/state"
cp "$here/cy-restart" "$scratch/cy-restart"

reason=$'deploy: "quoted" \\ path\nsecond line'
USER='owner "quoted"' bash "$scratch/cy-restart" "$reason" >/dev/null
python3 - "$scratch/state/restart-request.json" "$reason" <<'PY'
import datetime
import json
import pathlib
import sys
import time

path = pathlib.Path(sys.argv[1])
request = json.loads(path.read_text(encoding="utf-8"))
assert request["schema"] == "cy.restart-request"
assert request["version"] == 1
assert request["reason"] == sys.argv[2]
assert request["requestedBy"] == 'owner "quoted"'
timestamp = request["requestedAtMs"]
assert isinstance(timestamp, int) and len(str(timestamp)) == 13
assert 0 <= time.time_ns() // 1_000_000 - timestamp < 10_000
iso = datetime.datetime.fromisoformat(request["requestedAt"].replace("Z", "+00:00"))
assert iso.tzinfo is not None
assert request["requestedAt"].endswith("Z")
assert len(request["requestedAt"].split(".")[1].split("Z")[0]) == 3
assert int(iso.timestamp() * 1000) == timestamp
assert not list(path.parent.glob(".restart-request-*.tmp"))
PY

bash "$scratch/cy-restart" >/dev/null
python3 - "$scratch/state/restart-request.json" <<'PY'
import json
import pathlib
import sys

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert request["reason"] == "manual restart request"
PY

echo 'cy-restart.test.sh: timestamp, ISO date, JSON quoting, default reason and atomic cleanup passed'
