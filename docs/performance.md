# Query performance notes

## Local PostgreSQL measurement

Measured on 2026-11-04 with PostgreSQL 16 in a disposable loopback-only container after streaming the selected local ProtonDB snapshots into it: 460,240 reports, 36,884 games, and 36,884 compatibility summaries. Each query was run three times with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`; the table reports the median execution time from those runs. This is a local query comparison, not a production latency or Core Web Vitals claim.

| Query                                                                   |     Median | Shared blocks read | Shared blocks hit |
| ----------------------------------------------------------------------- | ---------: | -----------------: | ----------------: |
| Previous homepage totals (`COUNT(DISTINCT games)` plus all report rows) | 536.330 ms |             63,665 |            14,210 |
| Current grouped totals from `compatibility_summaries`                   |   3.572 ms |                  0 |                41 |
| Popular games, ordered from precomputed summaries                       |  23.408 ms |                  0 |             1,947 |
| Title search using full-text and trigram conditions                     |   2.691 ms |                  0 |               451 |
| Per-game report count with completed-import visibility checks           |   0.662 ms |                  0 |               701 |

The homepage now reads totals from the precomputed compatibility summary table and caches the grouped result in-process for 60 seconds. Full imports update summaries in the same database transaction that marks the batch complete, so reports and summaries become visible together. The popular-game sort remains a small summary-table scan; the measured run completed in 23.408 ms, so no new service or index was justified by this dataset.

Search and report queries use the existing PostgreSQL full-text, trigram, app/date, GPU, distribution, Proton, verdict, and batch indexes. The local results show query plans and timings for one dataset and one machine; production hardware, connection pooling, concurrency, cache hit rate, and end-user rendering still need measurement after deployment.
