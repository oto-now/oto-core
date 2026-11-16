# Story — Commentaires d'une page : un email groupé, un par heure au plus

## Meta

| Champ | Valeur |
|-------|--------|
| **Épic** | Commenter les pages, entre personnes et avec l'assistant |
| **Parcours** | 5.4 Concevoir, organiser, partager |
| **Statut** | 🔵 In Progress |
| **Priorité** | Should |
| **Référence UI** | Maquette interactive validée par JB le 12/11/2026 (aperçu de l'email groupé, encadré d'une mention) |
| **Conventions** | database, supabase, security, deploy, testing |
| **Estimation** | M |
| **Porteuse de migration** | oui (suivi des envois, additive) |
| **Dépend de** | commentaires-ecran |

## Contexte

Un commentaire qui attend une personne doit lui parvenir sans qu'elle ouvre la page. Décision de JB (12/11/2026) :
un email, mais **un seul par personne et par heure au plus**, qui réunit tout ce qui est arrivé depuis le précédent,
pour ne pas recevoir dix messages en dix minutes.

**Périmètre**
- Qui est prévenu : la personne mentionnée ; l'auteur d'un fil auquel on répond ; les participants du fil ; le
  responsable de l'équipe propriétaire pour un nouveau fil sur une page de son équipe. Jamais l'auteur du
  commentaire lui-même, jamais une personne qui ne lit plus la page.
- L'email groupé : objet « n nouveaux commentaires sur vos pages », une ligne par commentaire (page, auteur, extrait
  de 200 caractères), un lien par ligne qui ouvre la page, sans ancre de fil.
- L'encadré du champ de commentaire qui annonce l'email à la mention d'une personne.

**Hors périmètre**
- Un réglage par personne (se désabonner, changer la fréquence) : V2, avec les préférences de notification.
- Toute autre notification (publication, partage) : autre sujet.

## Questions tranchées

- **Ce qui déclenche l'envoi.** Le paquet n'a aucune tâche planifiée. Deux voies : une commande
  `oto-platform comments notify` que l'hôte appelle chaque heure (un cron de l'hôte, comme la purge du journal), ou un
  envoi au passage d'une requête quand la dernière fenêtre est échue. Retenu : la commande de l'hôte,
  seule à tenir « un par heure » sans dépendre du trafic.
- **Le relais.** `server/mail.ts` n'envoie aujourd'hui que les invitations du mode OIDC, par `PLATFORM_SMTP_URL`.
  Retenu : le même relais dans les deux modes (`PLATFORM_SMTP_URL`, `PLATFORM_MAIL_FROM`) ; sans relais
  configuré, aucun email, et l'écran ne l'annonce pas.

## Critères d'acceptation

- [ ] **AC1** **Given** trois commentaires qui concernent une personne en quarante minutes **Then** elle reçoit un
  seul email qui les réunit ; un quatrième, dix minutes après cet email, attend l'envoi suivant, une heure après le
  précédent, à cinq minutes près (la tolérance de la fenêtre).
- [ ] **AC2** **Given** un commentaire supprimé, ou un fil résolu, avant l'envoi **Then** il n'est pas dans l'email ;
  un envoi sans ligne ne part pas.
- [ ] **AC3** **Given** une personne qui a perdu la lecture de la page avant l'envoi **Then** rien de cette page ne
  lui est envoyé.
- [ ] **AC4** **Given** un hôte sans relais configuré **Then** aucun email ne part, aucune erreur ne remonte à qui
  commente, et le champ de commentaire n'annonce pas d'email.
- [ ] **AC5** **Given** un envoi en échec **Then** les commentaires restent à envoyer au passage suivant, et
  l'échec est nommé au journal d'administration, sans adresse en clair.
- [ ] **AC6** **Given** le texte d'un commentaire **Then** l'email n'en porte qu'un extrait, en texte ; aucun
  contenu de la page n'y figure.

## Implémentation

- **migrations/** : l'état d'envoi par personne (dernier envoi) et par commentaire (envoyé à qui), additive.
- **cli/** : la logique vit en `.mjs` sous `cli/`, la commande tournant en Node natif : `cli/comments-mail.mjs`
  (destinataires, fenêtre d'une heure, modèle de l'email à la marque de l'organisation), `cli/comments-notify.mjs`
  (`oto-platform comments notify` : lecture de la base, envoi, état), `cli/mail.mjs` (le relais, que `server/mail.ts`
  reprend pour les invitations).
- **docs/** : `docs/exploitation/` (la tâche horaire de l'hôte), `docs/conception/commentaires.md`.

## Rayon d'impact

À remplir avant le passage à 🟢 Ready, les deux questions tranchées.

## Tests attendus

- [ ] Unitaires : destinataires d'un commentaire ; regroupement ; fenêtre d'une heure.
- [ ] Intégration : transport de capture ; envoi rejoué sans doublon ; personne sortie de la page.

## Actions JB

- Poser la tâche horaire et le relais d'envoi sur les hôtes.
