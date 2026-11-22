"""Explicit calendar development preview on top of the native Codex builder.
Single builder owns the public asset list, CSP, revision and metadata.
No deployment, GAS/Sheets, Google credentials or brokerage calls.
"""
from pathlib import Path

from build_dev_pages import (
    ROOT, CALENDAR_MODULES, CALENDAR_CLIENT_RE, build
)

FILES = CALENDAR_MODULES
GOOGLE_CLIENT_RE = CALENDAR_CLIENT_RE

def build_calendar_review(output, *, root=ROOT, relay_endpoint=None,
                          google_client_id=None):
    return build(
        Path(output), root=root, relay_endpoint=relay_endpoint,
        use_public_config=False, include_calendar=True,
        google_calendar_client_id=google_client_id
    )
