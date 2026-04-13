#!/usr/bin/env bash

set -euo pipefail

git fetch upstream
git checkout main
git rebase upstream/main

echo "Local main was rebased onto upstream/main."
