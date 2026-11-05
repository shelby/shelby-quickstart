# Each target loads .env when it exists. Variables already exported in your shell
# (or set as CI secrets) work too.
SHELL := /bin/bash
LOAD_ENV := set -a; [ -f .env ] && . ./.env; set +a;
JS := clients/javascript
SHARE := recipes/share-files

.DEFAULT_GOAL := help
.PHONY: help doctor aws-cli python javascript rclone duckdb migrate-from-s3 ml-training share-files all lint

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

migrate-from-s3: ## Recipe: copy a public S3 dataset to Shelby, verify it, query it
	@$(LOAD_ENV) bash recipes/migrate-from-s3/migrate.sh

ml-training: ## Recipe: stream shards, checkpoint, resume on another "machine"
	@$(LOAD_ENV) uv run --quiet recipes/ml-training/train.py

share-files: $(SHARE)/node_modules ## Recipe: a server hands out file and folder links, opened without credentials
	@$(LOAD_ENV) node $(SHARE)/share.ts

all: doctor aws-cli python javascript rclone duckdb migrate-from-s3 ml-training share-files ## doctor, then every example and recipe

lint: $(JS)/node_modules $(SHARE)/node_modules ## Static checks (shellcheck, ruff, tsc)
	shellcheck doctor/*.sh clients/*/*.sh recipes/*/*.sh .github/scripts/*.sh
	uvx ruff check clients recipes .github/scripts
	uvx ruff format --check clients recipes .github/scripts
	npm --prefix $(JS) run --silent typecheck
	npm --prefix $(SHARE) run --silent typecheck

$(JS)/node_modules: $(JS)/package-lock.json
	npm --prefix $(JS) ci --silent --no-audit --no-fund
	@touch $@

$(SHARE)/node_modules: $(SHARE)/package-lock.json
	npm --prefix $(SHARE) ci --silent --no-audit --no-fund
	@touch $@
