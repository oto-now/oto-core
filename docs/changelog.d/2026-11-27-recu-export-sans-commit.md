## [2026-11-27] — Reçu d'un export : un fichier supprimé ne ralentit plus l'empreinte
**Quoi :** dans un export sans commit, un fichier indexé puis supprimé compte comme supprimé dans l'empreinte du reçu, au lieu de faire échouer le hachage groupé.
**Pourquoi :** le repli fichier par fichier prenait deux minutes par empreinte, et les tests du reçu (`hooks.test.ts`, `long-run.test.ts`) dépassaient leur délai à chaque `pnpm verify` d'un export qui supprime un fichier.
**Fichiers :** `scripts/verify-receipt.mjs`.
