"""Verify the packaged source in a fresh temporary checkout; leaves no servers."""
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / 'output/TicketSenpai_Milestone1.zip'
PREFIX = 'TicketSenpai_Milestone1'

with tempfile.TemporaryDirectory(prefix='ticketsenpai-submission-') as directory:
    with zipfile.ZipFile(ARCHIVE) as archive:
        for name in archive.namelist():
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or path.parts[0] != PREFIX:
                raise RuntimeError(f'Unsafe ZIP member: {name}')
            if set(path.parts) & {'node_modules', '.next', '.venv', 'instance', '__pycache__'}:
                raise RuntimeError(f'Generated data included: {name}')
        archive.extractall(directory)
    checkout = Path(directory) / PREFIX
    for target in ('setup', 'check', 'smoke', 'package'):
        subprocess.run(['make', target], cwd=checkout, check=True)
    print('PASS: extracted ZIP installs, passes both suites/build, starts/stops safely, and repackages.')
