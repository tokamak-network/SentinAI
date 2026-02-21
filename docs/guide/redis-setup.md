# Redis State Persistence Guide

> ⚠️ **Redis is optional.** Only required when using daily reports and cost analysis.

---

## Quick start

### 🟢 Redis setup (daily report + cost analysis)

#### Step 1: Start Redis with Docker Compose

```bash
docker-compose up redis -d
```

**check:**
```bash
docker-compose ps redis
# Status: Up X seconds (healthy)

docker-compose exec redis redis-cli ping
# PONG
```

#### Step 2: Add to .env.local

```bash
# For local development
REDIS_URL=redis://localhost:6379

# Automatically set inside Docker Compose:
# REDIS_URL=redis://redis:6379
```

#### Step 3: Restart the development server

```bash
npm run dev
```

**Check in log:**
```
[State Store] Using Redis: redis://localhost:6379
```

---

## Redis dependency analysis

**When do you need Redis?**

| Features | Is Redis required? | Description |
|------|----------|------|
| **Daily Report** | 🔴 Required | 24-hour metric snapshot accumulation (48-hour TTL) |
| **Cost Optimizer** | 🔴 Required | 7-day cumulative vCPU usage (cost analysis) |
| **Real-time scaling** | 🟢 Select | InMemory buffer is sufficient (may be lost on restart) |
| **Anomaly Detection** | 🟢 Select | Event history only (for UI display) |
| **Predictive Scaling** (Predictive Scaler) | 🟢 Select | Predictive tracking (no functionality impact) |
| **NLOps Chat** | 🟢 Select | Redis not used |

**conclusion:**
- **Redis required**: For daily report OR cost analysis
- **No need for Redis**: If you only need real-time monitoring + scaling

---

## Remove Redis

### 🔴 Stop and uninstall Redis

#### Step 1: Remove settings

**Remove Redis-related settings from .env.local:**

```bash
# Comment out or delete this line
# REDIS_URL=redis://localhost:6379
```

**Disable Reports & Cost Analysis (Optional):**

```bash
COST_TRACKING_ENABLED=false
```

#### Step 2: Stop Redis in Docker Compose

```bash
# Stop only the Redis container
docker-compose stop redis

# or remove completely (delete data too)
docker-compose down redis
# or remove all containers & volumes
docker-compose down -v
```

#### Step 3: Restart the development server

```bash
npm run dev
```

**Check in log:**
```
[State Store] Using InMemory (set REDIS_URL for persistence)
```

---

## InMemory vs Redis comparison

### InMemory (no Redis)

**merit:**
- ✅ Simple to set up (ready to use right away)
- ✅ No external dependencies
- ✅ Memory efficient (development environment)

**disadvantage:**
- ❌ All data is lost when server restarts
- ❌ Daily report incomplete (24-hour accumulation not possible)
- ❌ Inaccurate cost analysis (loss of 7-day history)
- ❌ No metric history

### Redis (recommended)

**merit:**
- ✅ All data persistence
- ✅ Daily report works properly
- ✅ Accurate cost analysis
- ✅ Data retained even after server restart

**disadvantage:**
- ❌ Additional Docker settings required
- ❌ Use additional memory
- ❌ Redis server is required in production

---

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.

### Deploy Docker Compose (recommended)

```bash
# Full SentinAI + Redis deployment
docker-compose up -d

# Deploy with or without Redis
docker-compose up -d sentinai
# However, REDIS_URL must be removed from .env.local
```

**docker-compose.yml settings:**

```yaml
services:
  sentinai:
    environment:
- REDIS_URL=redis://redis:6379 # Use internal DNS
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
```

### EC2 deployment (Redis installed separately)

If you install Redis on a separate server:

```bash
# Install Redis on EC2
sudo yum install redis -y
sudo systemctl start redis-server

# .env.local settings
REDIS_URL=redis://redis-server-ip:6379
```

---

## Monitoring Redis

### Redis CLI connection

```bash
# Redis CLI in Docker container
docker-compose exec redis redis-cli

# or install locally Redis
redis-cli -h localhost -p 6379
```

### Main commands

```bash
# Check Redis status
PING
# PONG

# Check all stored keys
KEYS *

# Check specific data
GET metrics:buffer
HGETALL scaling:state
LRANGE scaling:history 0 5

# Check the number of data
DBSIZE

# memory usage
INFO memory
```

### Data initialization

```bash
# Delete all data (Caution!)
FLUSHALL

# Delete only specific keys
DEL metrics:buffer scaling:state
```

---

## Troubleshooting

### Redis connection failure

**Symptom:** `[State Store] Using InMemory` message appears

**solve:**

```bash
# 1. Check whether Redis is running
docker-compose ps redis

# 2. Start Redis if it is not running
docker-compose up redis -d

# 3. Check REDIS_URL in .env.local
grep REDIS_URL .env.local

# 4. Restart the development server
npm run dev
```

### Redis port conflict

**증상:** `Address already in use: :::6379`

**solve:**

```bash
# 1. Stop an existing Redis container
docker-compose stop redis

#2. Check if another process is using 6379
lsof -i :6379

# 3. Use a different port if necessary
# Change ports in docker-compose.yml to 6380:6379
# and .env.local: REDIS_URL=redis://localhost:6380
```

### Check Redis container health

**Symptom:** Does not continue in `health: starting` state

**solve:**

```bash
# Check container log
docker-compose logs redis

# Restart container
docker-compose restart redis

# or force reset the state
docker-compose down redis && docker-compose up redis -d
```

---

## Data Backup

### Redis RDB (snapshot) backup

```bash
# Check RDB file in Docker container
docker-compose exec redis ls -la /data/

# Copy locally
docker cp sentinai-redis:/data/dump.rdb ./redis-backup.rdb
```

### Export Redis data

```bash
# Export all data in text format
docker-compose exec redis redis-cli --rdb /tmp/dump.rdb
docker cp sentinai-redis:/tmp/dump.rdb ./redis-dump.rdb
```

---

## Recommended settings

### Development environment

**If you want daily report + cost analysis:**

```bash
REDIS_URL=redis://localhost:6379
COST_TRACKING_ENABLED=true
```

**If you only need real-time monitoring:**

```bash
# Remove REDIS_URL (using InMemory)
COST_TRACKING_ENABLED=false
```

### Production environment

**Recommended:**

```bash
# Use Redis defined in docker-compose.yml
REDIS_URL=redis://redis:6379
COST_TRACKING_ENABLED=true

# Redis memory limits (adjust as needed)
# command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

**High Availability (Optional):**

- Redis Cluster or Sentinel configuration
- Regular backup (RDB or AOF)
- Redis monitoring (prometheus-exporter)

---

## reference

- **docker-compose.yml**: Redis service definition (lines 24-37)
- **redis-store.ts**: InMemory/Redis selection logic (lines 1050-1067)
- **daily-accumulator.ts**: Collect 24-hour snapshots
- **usage-tracker.ts**: 7-day cost data collection
- **CLAUDE.md**: Project setup guide
