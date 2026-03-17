#!/usr/bin/env bash
# migrate-global-lifetime-stats.sh
# Aggregate all per-instance lifetime stats into the _global key.
# Safe to run multiple times (uses exact values, not increments).
#
# Usage: bash scripts/migrate-global-lifetime-stats.sh [redis-container-name]

set -euo pipefail

CONTAINER="${1:-sentinai-redis}"
PREFIX="sentinai:experience:lifetime"
GLOBAL_KEY="${PREFIX}:_global"

echo "=== Lifetime Stats Migration ==="
echo "Container: $CONTAINER"
echo "Global key: $GLOBAL_KEY"
echo ""

# Collect all per-instance keys (exclude _global itself)
KEYS=$(docker exec "$CONTAINER" redis-cli KEYS "${PREFIX}:*" | grep -v ':_global$' || true)

if [ -z "$KEYS" ]; then
  echo "No per-instance lifetime stats found. Nothing to migrate."
  exit 0
fi

echo "Found instance keys:"
echo "$KEYS"
echo ""

# Initialize accumulators
declare -A SUMS
FIRST_SEEN=""
LAST_SEEN=""

for KEY in $KEYS; do
  echo "--- Reading: $KEY ---"

  # Read all fields as key-value pairs
  mapfile -t FIELDS < <(docker exec "$CONTAINER" redis-cli HGETALL "$KEY")

  i=0
  while [ $i -lt ${#FIELDS[@]} ]; do
    FIELD="${FIELDS[$i]}"
    VALUE="${FIELDS[$((i+1))]}"
    i=$((i+2))

    case "$FIELD" in
      firstSeenAt)
        if [ -z "$FIRST_SEEN" ] || [[ "$VALUE" < "$FIRST_SEEN" ]]; then
          FIRST_SEEN="$VALUE"
        fi
        ;;
      lastSeenAt)
        if [ -z "$LAST_SEEN" ] || [[ "$VALUE" > "$LAST_SEEN" ]]; then
          LAST_SEEN="$VALUE"
        fi
        ;;
      totalOps|successCount|failureCount|partialCount|totalResolutionMs|cat:*)
        CURRENT="${SUMS[$FIELD]:-0}"
        SUMS[$FIELD]=$((CURRENT + VALUE))
        ;;
    esac
  done
done

echo ""
echo "=== Aggregated values ==="
for FIELD in "${!SUMS[@]}"; do
  echo "  $FIELD = ${SUMS[$FIELD]}"
done
echo "  firstSeenAt = $FIRST_SEEN"
echo "  lastSeenAt  = $LAST_SEEN"
echo ""

# Check if _global already exists
EXISTING=$(docker exec "$CONTAINER" redis-cli EXISTS "$GLOBAL_KEY")
if [ "$EXISTING" = "1" ]; then
  EXISTING_OPS=$(docker exec "$CONTAINER" redis-cli HGET "$GLOBAL_KEY" totalOps)
  echo "WARNING: _global key already exists (totalOps=$EXISTING_OPS). Overwriting."
fi

# Build HSET command
HSET_ARGS=("HSET" "$GLOBAL_KEY")
for FIELD in "${!SUMS[@]}"; do
  HSET_ARGS+=("$FIELD" "${SUMS[$FIELD]}")
done
HSET_ARGS+=("firstSeenAt" "$FIRST_SEEN")
HSET_ARGS+=("lastSeenAt" "$LAST_SEEN")

# Execute
docker exec "$CONTAINER" redis-cli "${HSET_ARGS[@]}"

echo ""
echo "=== Verification ==="
docker exec "$CONTAINER" redis-cli HGETALL "$GLOBAL_KEY"

echo ""
echo "Migration complete."
