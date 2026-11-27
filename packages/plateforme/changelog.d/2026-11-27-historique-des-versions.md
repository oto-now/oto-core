### Hosts
- API: `GET nodes/history`, `GET nodes/history/diff` and `POST nodes/restore` (the version history of a node, and going back to a version as a new revision); served by the existing `/api/platform/[...route]` route, nothing to mount.
- UI: `TiroirDHistorique` (`ui/noeud/historique/`), the « Historique des versions » drawer of the node screen; the design system gains `HistoryList`, `HistoryItem`, `DiffLine`, `Diff` and a non-modal `Drawer` (`modal={false}`).
- Server: `nodeHistory`, `nodeHistoryDiff` (`server/nodes/history.ts`) and `restoreRevision` (`server/nodes/restore.ts`); read rights are decided before any read, restoring needs write access and is refused on a table.
