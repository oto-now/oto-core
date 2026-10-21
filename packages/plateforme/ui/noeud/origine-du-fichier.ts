// L'origine d'un fichier, en une ligne discrète (fichiers et stockage, § Origine d'un fichier) : à côté de la taille,
// sur la carte d'un fichier joint (`fichier-du-bloc.tsx`) et dans l'en-tête de la visionneuse (`visionneuse-de-fichier.tsx`).
import type { FileOriginView } from "../../schemas/files"
import { dateLisible } from "../format/dates"
import { FICHIERS } from "./libelles-des-fichiers"

/** « Rendu par 3cx.recording le 21 octobre 2026 · Claire · copié le 22 octobre 2026 » ; rien pour un fichier d'avant. */
export function ligneDOrigine(origine: FileOriginView | null | undefined): string | undefined {
  if (!origine) return undefined
  const date = dateLisible(origine.at) ?? ""
  const quoi = origine.kind === "function" ? FICHIERS.renduPar(origine.function ?? "", date) : origine.kind === "link" ? FICHIERS.deposeParLien(date) : origine.kind === "upload" ? FICHIERS.depose(date) : FICHIERS.origineInconnue
  const qui = origine.by?.name ? FICHIERS.auteur(origine.by.name) : ""
  const copie = origine.copied_at ? ` · ${FICHIERS.copie(dateLisible(origine.copied_at) ?? "")}` : ""
  return `${quoi}${qui}${copie}`
}
