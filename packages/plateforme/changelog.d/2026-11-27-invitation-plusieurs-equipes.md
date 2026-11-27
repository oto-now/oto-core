### Assistants
- `member.add` puts a pending person in several teams; they join all of them at their first sign-in (the one-team refusal `pending_single_team` is gone).
- `member.set_teams` replaces the teams of a pending person without replacing them: `member_id` stays; a lead changes only the teams they lead.

### Hosts
- Migrations: apply `20261127150000_platform_equipes_d_une_invitation.sql` with the package: the table `platform.invitation_teams` (the teams of an invitation), a trigger that copies `invitations.team_id` into it, and `accept_invitations`, which adds the person to all of them. Additive; the package without it fails on inviting and listing invitations.
- Schemas: `inviteSchema` takes `teamIds` (several teams, none for an administrator); `teamId` is still read, and comes first.
- Server: `inviteMember` and `listInvitations` give `teamIds` (the teams the caller sees: all for an administrator, those they lead for a lead) next to `teamId`, now the first of them.
- UI: « Inviter quelqu'un » offers « Équipes », one box per team, and the design system gains `CheckboxGroup` and `FieldError`.
- UI: the people table shows every team of a pending person, and its « + » adds or removes one, as for a member.
- API: `POST` and `DELETE invitations/<id>/teams/<teamId>` add a team to a pending person or remove it, without replacing the invitation; served by the existing `/api/platform/[...route]` route, nothing to mount.
- Server: `changeInvitationTeams` (`server/pending-members.ts`) refuses an id that is not a UUID (`invalid_arguments`) before any query, then decides each team (all for an administrator, those they lead for a lead).