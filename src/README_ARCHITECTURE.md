# Architecture

Frontend (static dashboard)
↓
Fastify API
↓
Campaign Service
↓
PostgreSQL persistence
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

Production-ready with PostgreSQL persistence and connection pooling. The worker loop can also be extended with Redis/BullMQ if distributed queuing across clusters is desired.
