# Phase 1 status — September 9, 2026

Engineering and source-data audit implemented. Warehouse verification remains open; this is not approval of the one-flap-per-bag counting contract.

## Preserved and audited

- 145 source records, 580 side photos, and 163 identification close-ups backed up locally. All 743 images decode successfully.
- Every restored image was independently copied to the restore-check directory, decoded, and compared against its SHA-256. All 743 passed.
- The snapshot manifest hash is `1a5c3846b19af5b32baedeb390e1062b26c2b0a3d192bf1c7d8357b6829f3dd6`. Photo checksums are in checksums.json. Snapshot originals and checksum manifest have the Windows read-only attribute; the audit script also refuses changed snapshot bytes. This protects against accidental edits, not privileged modification or loss of the local disk.
- Full photos and the restore copy remain in `scratch/phase1-2026-09-09/`, outside Git. Source Azure photos and collector totals were not modified. No cloud object-lock or retention policy was changed.
- No missing side slots or arithmetic mismatches. Fifteen partial-count fields need the verifier to clarify their meaning.
- Twenty exact duplicate image pairs correspond to four pairs of submissions, each repeating all five photos. Eight additional near-duplicate pairs require visual adjudication. No records were deleted. evidence_groups.json assigns identical four-side evidence sets together for future split isolation; it does not assert physical verification.
- The 20-pallet development shortlist contains one record per identical evidence group. Contact sheets were visually checked for varied stack heights, partial/mixed stacks, wrap glare, folds, and background clutter. Full-resolution human counts remain pending.

## Console and API

- Repaired the undefined photo-role reference in Pull collected and load one selected pallet at a time instead of decoding the entire collection into memory.
- Four side photos are used by labeling and test imports. Old extra photos remain available as archival evidence. No top photo is required.
- Review warnings distinguish unusual partial metadata from missing photos/arithmetic mismatch. Historical unspecified quality is displayed as unspecified, not “good.”
- Added automatic local label persistence, reload recovery, a backup export, import of existing box labels, explicit face and pallet audit states, verifier/reason/method fields, and physical-pallet grouping.
- Added shared review storage separately from raw sample manifests. Saves use conditional revisions; stale sessions cannot silently overwrite a newer review. Shared endpoint failures leave local drafts intact.
- Existing collector queue and legacy `gxo-bag-labeling` database are preserved. The console detects the legacy database if the browser supports inventory; it does not migrate or erase it. Existing label exports on other people's devices remain an owner inventory item.
- Reviewed zero-flap faces can export. Unreviewed/unresolved/excluded faces and top/identification photos cannot enter the reviewed box export. An edit returns a face to unreviewed. A box export carries pallet grouping, source IDs, checksum, human count, and reviewer metadata; it does not claim to contain masks.
- Added a separate checked box-export preparation tool. It checks photo identity, dimensions, counts, bounds, roles, groups, and duplicate bytes against the preserved snapshot before writing an unsplit dataset. Existing SAM mask preparation remains separate.
- Standalone console assets are excluded from service-worker precaching and served with no-store headers to reduce stale deployed workflow behavior.

## Validation

- Web/root test run: 32 files, 235 tests passed, including the new persistence and shared-review checks.
- API-specific test run: 5 files, 29 tests passed. API TypeScript build passed.
- Box dataset conversion: two unittest cases passed, including valid zero-count export and failure cases for changed bytes, non-side roles, unsafe paths, and inconsistent counts.
- Isolated browser fixture: drew an annotation, saved local and shared reviews, reloaded, and recovered the saved annotation. A second browser origin with an empty local database loaded the same shared box, count, verifier, and reason.
- Browser-exported test JSON was converted against a real backed-up photo: one image and one box, exact bytes preserved, grouping retained, split unassigned. Synthetic test labels remain under scratch and never entered production training records.
- Production rollout evidence is recorded below when available.

## Warehouse actions still required

Goding Wal volunteered to perform the review. Start with WAREHOUSE_REVIEW.md, verifier-A.csv, verifier-B.csv, and physical-verification.csv. Keep the two face counts independent. If a second person is unavailable, record that limitation; a repeated count by one person is not an independent second verifier.

Resolve the 15 partial-field cases and duplicate candidates. Approve supported stack types only after comparing both face counts with independently established physical totals. For August pallets that no longer exist, use independently verified historical records or collect replacements. Do not infer actual totals from the same pictures being evaluated.

Phase 1 cannot be marked fully complete until that counting-contract approval and verification evidence are returned.

## Recovery and repeatability

Run `python detector-service/phase1_audit.py --api https://white-meadow-0dc31e50f.7.azurestaticapps.net --output scratch/phase1-2026-09-09` to recheck the original snapshot. It resumes the frozen manifest, never updates collector records, and refuses a changed manifest or existing checksummed image. Use a new output directory for a new snapshot. Pillow is required; the audit does not require a GPU.

Run `python detector-service/prepare_box_dataset.py --annotations <reviewed-box-export.json> --snapshot scratch/phase1-2026-09-09 --output <new-output-directory>` to resolve reviewed box labels to the preserved photos. The output is deliberately unsplit until Phase 2 freezes the groups.

For an accidental loss, use the preserved source photo tree and checksum inventory to restore bytes. Keep the full local backup on a separately managed backup volume as part of the warehouse's retention practice; the two directories on this computer do not provide geographic redundancy.
