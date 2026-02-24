SHELL := /bin/bash
DOCKER_COMPOSE ?= docker compose

.PHONY: help setup up down logs clean reset status restart test-l1 test-l2 deps download init start-op-stack start-op-stack-force

help: ## Show available commands
	@echo "OP Stack L2 rollup management commands:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-18s %s\n", $$1, $$2}'

setup: ## Deploy L1 contracts and generate local config
	@mkdir -p deployer
	@if [ ! -f op-deployer ]; then \
		echo "Error: op-deployer not found. Run 'make download' first."; \
		exit 1; \
	fi
	@if [ ! -f .env ]; then \
		echo "Error: .env not found. Copy .env.example to .env and configure it."; \
		exit 1; \
	fi
	@./scripts/setup-rollup.sh

up: ## Start all services
	@$(DOCKER_COMPOSE) up -d --wait
	@$(MAKE) test-l2

down: ## Stop all services
	@$(DOCKER_COMPOSE) down

logs: ## Follow all service logs
	@$(DOCKER_COMPOSE) logs -f

logs-%: ## Follow logs for one service (example: make logs-op-node)
	@$(DOCKER_COMPOSE) logs -f $*

status: ## Show service status
	@$(DOCKER_COMPOSE) ps

restart: ## Restart all services
	@$(DOCKER_COMPOSE) restart

restart-%: ## Restart one service (example: make restart-op-batcher)
	@$(DOCKER_COMPOSE) restart $*

clean: ## Remove containers, volumes, and orphans
	@mkdir -p batcher proposer challenger sequencer
	@echo "# Minimal env for cleanup" > batcher/.env 2>/dev/null || true
	@echo "# Minimal env for cleanup" > proposer/.env 2>/dev/null || true
	@echo "# Minimal env for cleanup" > challenger/.env 2>/dev/null || true
	@$(DOCKER_COMPOSE) down -v --remove-orphans 2>/dev/null || true

reset: ## Remove generated data and redeploy from scratch
	@echo "This will reset local rollup deployment artifacts."
	@read -r -p "Continue? (y/N) " confirm && [ "$$confirm" = "y" ] || exit 1
	@$(MAKE) clean
	@rm -rf deployer sequencer batcher proposer challenger dispute-mon
	@echo "Reset complete. Run 'make setup' to redeploy."

test-l2: ## Check L2 RPC reachability
	@echo "Testing L2 RPC connection..."
	@curl -s -X POST -H "Content-Type: application/json" \
		--data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
		http://localhost:8545 | jq -r '.result' 2>/dev/null >/dev/null && \
		echo "L2 connection successful" || echo "L2 connection failed"

test-l1: ## Check L1 RPC reachability
	@echo "Testing L1 RPC connection..."
	@if [ -f .env ]; then set -a; source .env; set +a; fi; \
	curl -s -X POST -H "Content-Type: application/json" \
		--data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
		"$$L1_RPC_URL" | jq -r '.result' 2>/dev/null >/dev/null && \
		echo "L1 connection successful" || echo "L1 connection failed"

deps: ## Install tools declared in mise.toml (optional)
	@mise install

download: ## Download op-deployer binary
	@./scripts/download-op-deployer.sh

init: ## Download op-deployer and bootstrap .env
	@./scripts/download-op-deployer.sh
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example. Please edit it."; \
	else \
		echo ".env already exists, skipping copy"; \
	fi
	@echo "Next: make setup"

start-op-stack: ## Start OP Stack services (setup-if-needed)
	@./scripts/start-op-stack.sh

start-op-stack-force: ## Start OP Stack with forced full setup/redeploy
	@./scripts/start-op-stack.sh --force-setup
