// La demande testée sur l'écran « Contexte » : le paramètre `q` de son adresse, aux bornes de la phrase de l'outil
// `context` (2 000 caractères). Un seul schéma pour la page de l'hôte, qui le valide, et pour le champ de l'écran, qui
// en prend la borne. Sans lui, une adresse écrite à la main ferait partir au routage une demande sans borne.
import * as z from "zod/v4"

/** Caractères au plus d'une demande, comme la phrase de `context`. */
export const CONTEXT_REQUEST_MAX = 2_000

/** Les paramètres de l'adresse de l'écran : `q`, la demande à tester ; absente, vide ou trop longue, rien n'est testé. */
export const contextRequestQuerySchema = z.object({
  q: z.string().trim().min(1).max(CONTEXT_REQUEST_MAX).optional(),
})
