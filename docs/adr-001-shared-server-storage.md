# ADR-001: Shared server storage without Cosmos DB

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** GXO Loadout product owner

## Context

Inspectors use many warehouse devices and must see the same inspections, photos,
sites, inspectors, staging locations, and inventory. Device-local persistence is
still required during network loss, but it cannot be the system of record. Cosmos
DB is explicitly out of scope. The application and API are already hosted in Azure
Static Web Apps.

## Decision

- Azure Table Storage is the authoritative store for JSON records.
- Private Azure Blob Storage is the authoritative store for inspection photos.
- IndexedDB/localStorage are offline caches only.
- Every mutation is written locally first and added to a durable sync queue.
- The API applies optimistic concurrency using `updatedAt`/`lastEditedAt`; a newer
  server record wins and is returned to the client for reconciliation.
- Deletes are tombstones so an offline device cannot resurrect deleted records.
- The browser never receives storage account credentials. Photo upload/download
  goes through the same-origin Function proxy.
- Shared record and photo routes require an authenticated Microsoft Entra session
  through Azure Static Web Apps; anonymous visitors cannot read warehouse data.

## Options Considered

### Azure Table Storage + Blob Storage

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Low |
| Scalability | High for this workload |
| Azure fit | Strong |

**Pros:** No database server, JSON-friendly, inexpensive, Blob Storage is designed
for photos, works with the existing Azure hosting model.

**Cons:** Limited querying; cross-site reports aggregate in the Function or client.

### Azure SQL + Blob Storage

**Pros:** Rich queries, constraints, reporting.

**Cons:** More provisioning, migrations, connection management, and cost than the
current inspection workload requires.

### Device-only IndexedDB

**Pros:** Excellent offline behavior and no backend cost.

**Cons:** Fails the core multi-device sharing requirement and risks device loss.

## Consequences

- All devices converge on shared server state while continuing to work offline.
- A Storage account connection string must be configured in Azure as
  `LOADOUT_STORAGE_CONNECTION_STRING`, or the existing `STORAGE_ACCOUNT_NAME`
  and `STORAGE_ACCOUNT_KEY` settings can be retained.
- The server is authoritative; local changes can be rejected when another device
  has already saved a newer version.
- Table scans are acceptable at current scale; a future high-volume analytics need
  may justify moving metadata to Azure SQL without changing the client contract.

## Action Items

1. Implement shared record/photo API routes.
2. Restore the durable offline sync queue and server pull.
3. Synchronize reference data and inventory.
4. Add multi-device conflict and deletion tests.
5. Configure the production Storage connection string and verify two-device use.
