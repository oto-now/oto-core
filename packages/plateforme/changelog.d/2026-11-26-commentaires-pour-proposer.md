### Assistants
- A write refused to a user who reads the page first proposes the change by the exact `comment.add` call, then access; `read` says « access: read (suggest changes with comment.add) ».
- `comment.list {path, under: true}` serves the threads of every page under a folder that the user reads, grouped by page, 50 at most with the count of the rest.
- Threads served by `read` and `comment.list` say that a comment changes nothing until a writer applies it.
- A new thread is followed in `context` by those who manage the page (administrators, team leads, the owner of a space, full access), no longer by the team leads alone.

### Hosts
- CLI: `comments notify` emails a new thread to those who manage the page: administrators for Tout le monde, leads of a team folder, the person of a space, anyone with full access.
- UI: the `manage` level reads « Accès complet - Responsable », « Modifie, partage, déplace, supprime et reçoit les nouveaux commentaires. »
