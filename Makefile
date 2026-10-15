PYTHON ?= python3
VENV := backend/.venv

.PHONY: setup dev test build check smoke package reset help
help:
	@echo "TicketSenpai: make setup | make dev | make test | make build | make check"
	@echo "Reset demo data: make reset CONFIRM=reset (stop make dev first)"
	@echo "Submission ZIP: make package"

setup:
	$(PYTHON) scripts/setup.py

dev:
	$(PYTHON) scripts/dev.py

test:
	npm test
	cd backend && .venv/bin/python -m unittest discover -s tests -v

build:
	npm --prefix frontend run build

smoke:
	$(PYTHON) scripts/verify_workflow.py

check: test build

package:
	$(PYTHON) scripts/package_submission.py

reset:
	@test "$(CONFIRM)" = "reset" || (echo "Use make reset CONFIRM=reset to delete local demo data."; exit 1)
	$(VENV)/bin/python scripts/reset.py
