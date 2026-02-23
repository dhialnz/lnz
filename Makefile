.PHONY: dev test lint format migrate makemigration clean seed help

help:
	@echo "LNZ – Portfolio Analytics"
	@echo ""
	@echo "Usage:"
	@echo "  make dev              Start all services (postgres + api + web)"
	@echo "  make test             Run backend pytest suite"
	@echo "  make lint             Lint Python (ruff) + TypeScript (eslint)"
	@echo "  make format           Format Python (black + ruff) + TS (prettier)"
	@echo "  make migrate          Apply pending Alembic migrations"
	@echo "  make makemigration    Generate new migration  (name=<label>)"
	@echo "  make seed             Generate sample Excel file into apps/api/uploads/"
	@echo "  make clean            Tear down containers and volumes"

dev:
	docker compose up --build

test:
	docker compose run --rm api pytest tests/ -v --tb=short

lint:
	docker compose run --rm api ruff check app/ tests/ scripts/
	cd apps/web && npm run lint

format:
	docker compose run --rm api black app/ tests/ scripts/
	docker compose run --rm api ruff check --fix app/ tests/ scripts/
	cd apps/web && npx prettier --write "src/**/*.{ts,tsx}"

migrate:
	docker compose run --rm api alembic upgrade head

makemigration:
	docker compose run --rm api alembic revision --autogenerate -m "$(name)"

seed:
	docker compose run --rm api python scripts/generate_sample_excel.py

clean:
	docker compose down -v --remove-orphans
