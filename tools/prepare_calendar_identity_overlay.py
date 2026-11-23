"""Prepare a private, REVIEW-ONLY overlay for an existing isolated owner checkout.

Never deploys, reads credentials, changes existing files or creates projects.
Preserves the owner's current session policy and unrelated GAS modules.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_SCRIPT_ID = '1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL'
ANCHOR = 'const body=JSON.parse(e.postData.contents);securityEnvironmentGuard_(body);'
HOOK = "\n  if(body.action==='calendarPrivateIdentityV1')return handleCalendarIdentityV1_(body);"


def prepare(owner_dir, output):
    owner, output = Path(owner_dir).resolve(), Path(output).resolve()
    if owner == output or owner in output.parents or ROOT == output or ROOT in output.parents:
        raise ValueError('USE_SEPARATE_PRIVATE_OUTPUT_OUTSIDE_CHECKOUT')
    if output.exists():
        raise ValueError('NEW_PRIVATE_OUTPUT_REQUIRED')
    if not owner.is_dir():
        raise ValueError('OWNER_ENVIRONMENT_NOT_CONNECTED')
    # Read only the target identifier and isolated bridge, never auth/secret files.
    config = json.loads((owner / '.clasp.json').read_text())
    script_id = config.get('scriptId')
    if not isinstance(script_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,200}', script_id) or script_id == PRODUCTION_SCRIPT_ID:
        raise ValueError('EXISTING_ISOLATED_PROJECT_REQUIRED')
    bridge = owner / 'StagingBridge.gs'
    content = bridge.read_text()
    if f"NH_STAGING_SCRIPT_ID='{script_id}'" not in content or 'function stagingProjectGuard_()' not in content or "APP_ENV')!=='nh-staging'" not in content or 'function securityLegacyDoPost_(e)' not in content:
        raise ValueError('ISOLATED_BRIDGE_IDENTITY_MISMATCH')
    if content.count(ANCHOR) != 1 or 'calendarPrivateIdentityV1' in content:
        raise ValueError('BRIDGE_REVIEW_REQUIRED_NO_AUTOMATIC_REPATCH')
    updated = content.replace(ANCHOR, ANCHOR + HOOK)
    assert updated.replace(HOOK, '', 1) == content
    plan = {'status': 'PREPARED_REVIEW_ONLY', 'deploymentAttempted': False,
            'originalBridgeSha256': hashlib.sha256(bridge.read_bytes()).hexdigest(),
            'candidateBridgeSha256': hashlib.sha256(updated.encode()).hexdigest(),
            'changedModules': ['StagingBridge', 'CalendarIdentityBridge'],
            'existingFilesChanged': False, 'authSessionPolicyChanged': False,
            'reportCredentialsIncluded': False, 'privateSourceArtifact': True, 'newProject': False,
            'requiredGates': ['compare current deployed module bytes before any update',
                              'preserve and recompute existing runtime revision/source metadata',
                              'configure identity keys privately in isolated environment only',
                              'verify new private identity action and unchanged 60-minute policy',
                              'wire private storage/runtime without replacing active Worker code']}
    output.mkdir(mode=0o700, parents=True)
    (output / 'StagingBridge.gs').write_text(updated)
    (output / 'CalendarIdentityBridge.gs').write_bytes((ROOT / 'tests/staging/CalendarIdentityBridge.gs').read_bytes())
    (output / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    for path in output.iterdir():
        path.chmod(0o600)
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.owner_dir, args.output)))
    except (ValueError, OSError, json.JSONDecodeError):
        # No exception path/value/source dumps from a private owner directory.
        print(json.dumps({'status': 'NOT_RUN', 'code': 'OWNER_OVERLAY_REVIEW_REQUIRED',
                          'deploymentAttempted': False, 'credentialsIncluded': False}))
        raise SystemExit(1)
