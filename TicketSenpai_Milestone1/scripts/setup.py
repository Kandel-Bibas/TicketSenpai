"""Install the required stack and seed local data. Rerunning preserves data."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
if sys.version_info < (3, 10):
    sys.exit('TicketSenpai needs Python 3.10 or newer.')
for executable in ('node', 'npm'):
    if not shutil.which(executable):
        sys.exit(f'{executable} is missing. Install Node.js 22 or newer, then rerun make setup.')
major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'], text=True).strip())
if major < 22:
    sys.exit('TicketSenpai needs Node.js 22 or newer.')
subprocess.run([sys.executable, '-m', 'venv', 'backend/.venv'], check=True)
python = ROOT / 'backend/.venv/bin/python'
subprocess.run([str(python), '-m', 'pip', 'install', '-r', 'backend/requirements.txt'], check=True)
subprocess.run(['npm', 'ci', '--prefix', 'frontend'], check=True)
subprocess.run([str(python), '-c', 'from ticketsenpai import create_app; create_app()'], cwd=ROOT / 'backend', check=True)
print('\nTicketSenpai is ready. Run make dev, then open http://127.0.0.1:3000')
