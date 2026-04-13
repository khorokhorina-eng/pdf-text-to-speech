# pdf-text-to-speech

Standalone repo for the PDF Text To Speech browser extension.

## Remotes

- `origin`: `git@github.com:themaslov/pdf-text-to-speech.git`
- `upstream`: `git@github.com:khorokhorina-eng/FocusTrace.git`

## Workflow

Sync latest changes from upstream into local `main`:

```sh
./scripts/sync-upstream.sh
```

Push the current branch to your repo:

```sh
./scripts/push-origin.sh
```

Typical flow:

```sh
./scripts/sync-upstream.sh
git checkout -b my-change
# make changes
git add .
git commit -m "Describe change"
./scripts/push-origin.sh
```
