## [2026-11-27] — Import CSV : l'en-tête d'origine gardé comme libellé de colonne (#228)
**Quoi :** un CSV importé de l'écran dans un tableau nouveau donne à chaque colonne son en-tête d'origine pour `label`, rogné, quand il diffère du nom tiré (« Montant estimé » → `montant_estime`, libellé « Montant estimé ») et tient en 1 à 100 caractères ; un en-tête égal au nom, vide ou plus long ne pose rien. La colonne `ligne` générée n'en prend pas. L'import dans un tableau existant ne change pas.
**Pourquoi :** issue #228 : depuis #225 une colonne porte un libellé, et l'import le perdait.
**Problèmes :** `table.import` (MCP) et le dépôt d'un CSV par lien construisent leur en-tête côté service (`inferredHeader`) et ne posent pas encore de libellé. Aucune migration.
**Fichiers :** `packages/plateforme/ui/coque/envoi-d-import.ts`, `packages/plateforme/schemas/tables.ts` (`COLUMN_LABEL_MAX` exporté), `tests/integration/components/import-de-fichier.test.tsx`.
