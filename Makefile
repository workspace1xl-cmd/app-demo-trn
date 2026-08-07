.PHONY: up down logs test test-api build

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

test-api:
	cd backend && python -m pytest -q

build:
	npm run build

test: test-api build
