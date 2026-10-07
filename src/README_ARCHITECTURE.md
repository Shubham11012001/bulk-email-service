# Architecture

Frontend (static dashboard)
↓
Fastify API
↓
Campaign Service
↓
SQLite persistence
↓
Worker / queue loop
↓
EmailProvider abstraction
↓
Webhook endpoint
↓
Event processor
↓
KPI/report service

For a production deployment, SQLite can be replaced by PostgreSQL and the worker loop by Redis/BullMQ without changing the UI/API contracts substantially.
