"""Install a pinned official cloudflared binary, verified before execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import tempfile
import urllib.request

VERSION = '2026.11.0'
SHA256 = '51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd'
URL = 'https://github.com/cloudflare/cloudflared/releases/download/' + VERSION + '/cloudflared-linux-amd64'


def install(output):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64' or output.is_symlink():
        raise ValueError('DEV_BINARY_PLATFORM_OR_PATH')
    if output.exists():
        if hashlib.sha256(output.read_bytes()).hexdigest() != SHA256:
            raise ValueError('DEV_BINARY_EXISTING_MISMATCH')
        output.chmod(0o700)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as f:
            temporary = Path(f.name)
            with urllib.request.urlopen(URL, timeout=60) as response:
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:break
                    total += len(chunk)
                    if total > 128 * 1024 * 1024:raise ValueError('DEV_BINARY_SIZE')
                    f.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            raise ValueError('DEV_BINARY_CHECKSUM')
        temporary.chmod(0o700)
        # Refuse to overwrite an unrelated file even if created during download.
        os.link(temporary, output)
    finally:
        if temporary:temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        install(args.output)
        print(json.dumps({'status': 'PASS', 'version': VERSION, 'checksum': 'PASS'}))
    except Exception:
        print(json.dumps({'status': 'FAIL', 'code': 'DEV_BINARY_INSTALL_STOP'}))
        raise SystemExit(2)
