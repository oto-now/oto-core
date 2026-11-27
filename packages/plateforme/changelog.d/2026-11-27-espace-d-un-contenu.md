### Assistants
- `admin_node transfer_owner` gives a node only to a space the caller writes in (own private space, a team, the organisation); never to another person's private space.

### Hosts
- Migrations: `20261127150000_platform_equipes_d_une_invitation.sql` also recreates `nodes_gesture_guard`: a changed owner of a node needs the caller's write level in the space that receives it (the root, the team folder, the parent for an inherited owner; their own private space only). Apply it with the package.
- Server: `transferOwner` and `describeTransfer` (`server/admin/nodes.ts`) refuse `forbidden` before any write when the caller does not write in the destination space, administrators included.
