# Each target loads .env when it exists. Variables already exported in your shell
# (or set as CI secrets) work too.
SHELL := /bin/bash
LOAD_ENV := set -a; [ -f .env ] && . ./.env; set +a;

.DEFAULT_GOAL := help
.PHONY: help doctor aws-cli python all lint

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

doctor: ## Check credentials, bucket, clock and installed tools
	@$(LOAD_ENV) bash doctor/doctor.sh

aws-cli: ## AWS CLI example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) bash clients/aws-cli/quickstart.sh $(ARGS)

python: ## Python (boto3) example (ARGS=--large adds a multipart upload)
	@$(LOAD_ENV) uv run --quiet clients/python/quickstart.py $(ARGS)

all: doctor aws-cli python ## doctor, then every example

lint: ## Static checks (shellcheck, ruff)
	shellcheck doctor/*.sh clients/*/*.sh
	uvx ruff check clients
	uvx ruff format --check clients
