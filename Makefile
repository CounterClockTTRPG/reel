.PHONY: install build test e2e ui ci run service

install:
	npm ci
	npx playwright install chromium

build:
	npm run build

test:
	npm test

e2e: build
	npm run test:e2e

ui: build
	npm run test:ui

ci: build
	npm run typecheck
	npm test
	npm run test:e2e
	npm run test:ui

run: build
	node dist/cli/main.js serve

service: build
	install -Dm644 deploy/reel.service $(HOME)/.config/systemd/user/reel.service
	systemctl --user daemon-reload
	systemctl --user enable reel.service
	systemctl --user restart reel.service
	systemctl --user --no-pager status reel.service | head -5
