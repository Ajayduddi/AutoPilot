# Chat-First Automation Platform

A conversational control center for automations, agents, and workflows using n8n for execution.

## Setup
1. Copy `.env.example` to `.env`
2. Install dependencies: `bun install`
3. Generate DB migrations: `bun --filter backend run db:generate`
4. Run DB migrations: `bun --filter backend run db:push`
5. Seed database: `bun --filter backend run db:seed`
6. Run services locally: `bun run dev`
