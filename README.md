# Cosmos Health

## Description

This is a simple health check tool for Cosmos SDK based blockchains. It is designed to be used as an ongoing worker process. It monitors some metrics and dispatches events to notifier channels.

## Features

- Monitors block generation and alerts on chain halt
- Monitors block speed and alerts on slow blocks
- Monitors validators status and alerts on downtime, missed signatures, etc.
- Sends Slack notifications on alerts

## Usage

```bash
npm install
npm run build
cp .env.example .env
# edit .env
npm run start
```
