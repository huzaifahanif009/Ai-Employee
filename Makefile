# Praxis — common tasks. Windows: run under Git Bash (bundled with Git for Windows).
SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help install build up down infra logs migrate seed health test lint fmt clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## npm install at the workspace root
	npm install

build: ## build all workspace packages/services
	npm run build:contracts
	npm run build

infra: ## start only infra containers (postgres, redis, temporal, minio, litellm, otel)
	$(COMPOSE) up -d postgres redis temporal temporal-ui minio minio-setup litellm otel-collector

up: ## start the full stack
	$(COMPOSE) up -d --build

down: ## stop the stack
	$(COMPOSE) down

logs: ## tail logs
	$(COMPOSE) logs -f --tail=100

migrate: ## run DB migrations inside the core container (falls back to local)
	$(COMPOSE) exec core node dist/database/run-migrations.js || npm run -w @praxis/core migration:run

seed: ## seed the demo tenant/project
	$(COMPOSE) exec core node dist/database/run-seed.js || npm run -w @praxis/core seed

health: ## check /healthz of every service
	@for p in 3000:core 8081:agent 4000:litellm; do \
	  port=$${p%%:*}; name=$${p##*:}; \
	  printf "%-14s " "$$name"; \
	  curl -fsS http://localhost:$$port/healthz 2>/dev/null || curl -fsS http://localhost:$$port/health/live 2>/dev/null || echo "DOWN"; \
	  echo; \
	done

test: ## run all tests
	npm test

lint: ## lint all
	npm run lint

fmt: ## format
	npx prettier --write "**/*.{ts,js,json,md,yml,yaml}"

clean: ## remove build output & volumes
	npm run clean --workspaces --if-present || true
	$(COMPOSE) down -v
