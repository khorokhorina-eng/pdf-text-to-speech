#!/usr/bin/env bash

set -euo pipefail

current_branch="$(git branch --show-current)"

if [[ -z "${current_branch}" ]]; then
  echo "Could not determine current branch."
  exit 1
fi

git push -u origin "${current_branch}"
