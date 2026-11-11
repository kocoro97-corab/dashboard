#!/usr/bin/env bash
set -euo pipefail

# Local authorization helper only: never pushes source or changes deployments.
# OAuth credentials are stored by clasp in the user's home directory, not this folder.
auth_dir="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-gas-auth.XXXXXX")"
trap 'rm -rf -- "$auth_dir"' EXIT

node - "$auth_dir" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const folder = process.argv[2];
fs.writeFileSync(path.join(folder, '.clasp.json'), JSON.stringify({
  scriptId: '1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL',
  rootDir: '.'
}));
fs.writeFileSync(path.join(folder, 'appsscript.json'), JSON.stringify({
  timeZone: 'Asia/Seoul',
  runtimeVersion: 'V8',
  oauthScopes: [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.deployments',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ]
}, null, 2));
NODE

cd "$auth_dir"
echo 'Authorize Google using the URL printed below.'
echo 'Paste the resulting localhost URL into this terminal, never into chat.'
npx --yes @google/clasp@3.4.1 login --no-localhost --use-project-scopes
