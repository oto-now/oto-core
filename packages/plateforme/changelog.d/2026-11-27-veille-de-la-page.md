### Hosts
- UI: an open page keeps itself up to date: `EcranDeNoeud` rereads its published revision every 30 seconds while the tab is visible and refreshes through the host's `useRafraichir`, or offers « Recharger la page » in one `Alert` line under the meta while the person is writing.
- API: `GET /api/platform/nodes/revision?path=` renders a node's published revision alone (`{path, revision}`), a read without a journal line.
