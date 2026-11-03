# Diagnostics

Node-only package for local, content-free operational records. A `DiagnosticLog` instance owns its bounded serial write queue and file descriptor; its Host profile or server instance owns the writer lease and calls `close()` before releasing that lease. There are no import-time listeners, timers or network requests.

`record()` accepts only the strict versioned metadata schema. Messages, tool arguments/results, paths, URLs, environment variables, error messages and credentials are excluded. Error codes use a fixed vocabulary; unrecognized codes become `UNCLASSIFIED_ERROR` through `diagnosticCode()`. Runtime events are projected field by field, never spread into logs. Queue overflow, invalid records and write failures are observable in `status`; the owner receives `DISK_FULL` to stop work when storage fills up. Logging is not a Session persistence acknowledgement.

Defaults: 50 MiB per private JSONL file, five files, fourteen days and 256 queued records. Expiration is checked at startup and on writes, including writes to the current file; an idle or stopped client does not run a cleanup daemon. Read-only export excludes expired files, scans at most 1000 directory entries and reads at most 2 MiB under a ten-second deadline. Its JSON output contains at most 5000 records and is bounded to 2 MiB, with truncation and excluded-row counts. Export does not rewrite active logs or modify Session history.

`exportDiagnostics()` returns an in-memory snapshot for the desktop RPC. `saveDiagnosticExport()` is an explicit maintenance action that writes a unique private JSON file to an existing destination directory. Exports revalidate every line to avoid copying damaged or unknown payloads. Unix file descriptors use `O_NOFOLLOW`; the application data directory must remain under the account's control. These maintenance APIs are not model tools.

Behavior is covered by `tests/diagnostics*.test.ts` and the real HTTP/CLI integrations. OS file permissions and runtime support still require validation on each release target.
