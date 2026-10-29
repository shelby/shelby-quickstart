# Each target loads .env when it exists. Variables already exported in your shell
# (or set as CI secrets) work too.
SHELL := /bin/bash
LOAD_ENV := set -a; [ -f .env ] && . ./.env; set +a;
JS := clients/javascript

.DEFAULT_GOAL := help
.PHONY: help doctor aws-cli python javascript rclone duckdb all lint

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-11s %s\n", $$1, $$2}'

doctor: ## Check credentials, bucket, clock and installed tools
	@$(LOAD_ENV) bash doctor/doctor.sh

aws-cli: ## AWS CLI example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) bash clients/aws-cli/quickstart.sh $(ARGS)

python: ## Python (boto3) example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) uv run --quiet clients/python/quickstart.py $(ARGS)

javascript: $(JS)/node_modules ## JavaScript (AWS SDK v3) example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) node $(JS)/quickstart.ts $(ARGS)

rclone: ## rclone example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) bash clients/rclone/quickstart.sh $(ARGS)

duckdb: ## DuckDB example (ARGS=--large adds a multipart write)
	@$(LOAD_ENV) bash clients/duckdb/quickstart.sh $(ARGS)

all: doctor aws-cli python javascript rclone duckdb ## doctor, then every example

lint: $(JS)/node_modules ## Static checks (shellcheck, ruff, tsc)
	shellcheck doctor/*.sh clients/*/*.sh
	uvx ruff check clients
	uvx ruff format --check clients
	npm --prefix $(JS) run --silent typecheck

$(JS)/node_modules: $(JS)/package-lock.json
	npm --prefix $(JS) ci --silent --no-audit --no-fund
	@touch $@
