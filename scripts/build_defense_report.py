"""Print docs/defense-report.html to Defense_Report.pdf with headless Chrome."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'docs/defense-report.html'
OUT = ROOT / 'Defense_Report.pdf'
CANDIDATES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']


def chrome():
    for candidate in [os.environ.get('CHROME'), *CANDIDATES]:
        if candidate and (Path(candidate).is_file() or shutil.which(candidate)):
            return candidate
    raise SystemExit('Google Chrome not found; set CHROME to its executable path.')


def main():
    if 'class="todo"' in SOURCE.read_text():
        raise SystemExit(f'{SOURCE.relative_to(ROOT)} still contains a highlighted [placeholder]; fill it in first.')
    with tempfile.TemporaryDirectory(prefix='defense-report-') as profile:
        subprocess.run([chrome(), '--headless', '--disable-gpu', f'--user-data-dir={profile}',
                        '--no-pdf-header-footer', f'--print-to-pdf={OUT}', SOURCE.as_uri()],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(OUT)


if __name__ == '__main__':
    main()
