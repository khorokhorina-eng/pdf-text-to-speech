#!/usr/bin/env bash

set -euo pipefail

git fetch upstream
git checkout main
git merge --ff-only upstream/main

echo "Local main is now aligned with upstream/main."
