"""Build and verify a source-only coursework ZIP from explicit project paths."""
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/TicketSenpai_Milestone1.zip'
PREFIX = 'TicketSenpai_Milestone1/'
FILES = ['README.md', 'Makefile', '.gitignore', '.gitattributes', 'package.json',
         'ticketing-platform-design.html', 'waiting-room-explainer.html']
TREES = ['backend', 'frontend', 'scripts', 'docs', 'src', 'test', 'web']
SKIP = {'node_modules', '.next', '.venv', 'venv', 'instance', '__pycache__', '.git'}

def include(path):
    return not (set(path.parts) & SKIP or path.name == '.DS_Store'
                or path.name.startswith('.env')
                or path.suffix in {'.pyc', '.pyo', '.db', '.sqlite3', '.log'})

def main():
    pdf = ROOT / 'output/pdf/PROJECT_SUMMARY.pdf'
    if not pdf.is_file():
        pdf = ROOT / 'PROJECT_SUMMARY.pdf'
    if not pdf.is_file():
        raise SystemExit('Missing PROJECT_SUMMARY.pdf. Run scripts/build_summary.py with ReportLab first.')
    entries = {name: ROOT / name for name in FILES}
    for tree in TREES:
        for path in (ROOT / tree).rglob('*'):
            rel = path.relative_to(ROOT)
            if path.is_file() and include(rel):
                if path.is_symlink():
                    raise SystemExit(f'Refusing source symlink: {rel}')
                entries[rel.as_posix()] = path
    entries['PROJECT_SUMMARY.pdf'] = pdf
    for name, path in entries.items():
        if not path.is_file():
            raise SystemExit(f'Missing required source: {name}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, path in sorted(entries.items()):
                archive.write(path, PREFIX + name)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('ZIP CRC verification failed')
            for name, path in entries.items():
                if archive.read(PREFIX + name) != path.read_bytes():
                    raise RuntimeError(f'ZIP content differs: {name}')
        temporary.replace(OUT)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    OUT.with_suffix('.zip.sha256').write_text(f'{digest}  {OUT.name}\n')
    print(f'{OUT}\n{len(entries)} files; {OUT.stat().st_size:,} bytes; verified contents and CRC')

if __name__ == '__main__':
    main()
