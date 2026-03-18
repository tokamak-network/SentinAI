# Agent Marketplace Browse Registry Pagination Design

**Goal:** Add query-driven pagination to the live `BROWSE REGISTRY` surface so the public marketplace can scale past a single page of discovered instances without changing the current server-rendered model.

## Scope

This phase adds:

- `page` query support on `/marketplace?tab=registry&page=N`
- paginated row slicing in the server-side registry browse library
- `PREV / NEXT` navigation in the public registry tab

This phase does not add:

- client-side pagination state
- infinite scroll
- a dedicated registry API

## Recommended Approach

Keep pagination query-driven and server-rendered.

Why:

- `/marketplace` already uses query-driven tabs
- deep-linkable pagination fits the current testing model
- no client state or API indirection is needed

## Data Model

The browse result should expose:

- `rows` for the current page
- `totalRows`
- `page`
- `pageSize`
- `totalPages`
- `hasPreviousPage`
- `hasNextPage`

Summary cards should use `totalRows`, not current page row count.

## Pagination Policy

- default page size: 5
- minimum page: 1
- invalid page values fall back to 1
- out-of-range page values clamp to the last available page

## Cache Interaction

Keep the current 30-second cache on the full browse result.

Pagination should slice after loading the cached full result so:

- page navigation does not trigger a new registry scan within TTL
- cache shape stays simple

## Testing

- browse library returns correct page metadata
- invalid page falls back to page 1
- page 2 renders only later rows
- navigation links preserve `tab=registry`
