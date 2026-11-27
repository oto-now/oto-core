// Un geste qu'une capacité de l'organisation ferme (E12-S02, ADR-022 § 7) : le bouton grisé, la limite dite dessous, et,
// pour un administrateur, le lien où l'hôte la fait relever. Les phrases servent aussi le refus du service
// (`api/messages.ts`) : l'écran et le refus disent la même limite. Server Component : rien ne s'y passe au clic. Sans
// lui, un geste refusé ne se saurait qu'après l'envoi.
import type { LimitState } from "../../schemas"
import { LIEN } from "../components/classes"
import { Button } from "../ds/react/primitives"

/** Les limites comptées que disent les écrans (`orgLimitsSchema`). */
export type NomDeLimite = "members_max" | "teams_max"

const MOTS: Record<NomDeLimite, [string, string]> = {
  members_max: ["membre", "membres"],
  teams_max: ["équipe", "équipes"],
}

const mot = (nom: NomDeLimite, nombre: number) => MOTS[nom][nombre > 1 ? 1 : 0]

/** Le refus du service dit en français, de sa limite et de son plafond ; `null` si le refus ne les porte pas. */
export function phraseDeLimite(nom: unknown, max: unknown): string | null {
  if ((nom !== "members_max" && nom !== "teams_max") || typeof max !== "number") return null
  if (nom === "teams_max" && max === 0) return "La création d'équipes n'est pas ouverte pour cette organisation."
  const suite = nom === "members_max" ? ", invitations en attente comprises" : ""
  return `L'organisation est limitée à ${max} ${mot(nom, max)}${suite}.`
}

/** « Limite atteinte : 1 équipe sur 1. », sous le geste grisé. */
export function limiteAtteinte(nom: NomDeLimite, etat: LimitState): string {
  if (nom === "teams_max" && etat.max === 0) return "La création d'équipes n'est pas ouverte pour cette organisation."
  const suite = nom === "members_max" ? ", invitations en attente comprises" : ""
  return `Limite atteinte : ${etat.used} ${mot(nom, etat.used)} sur ${etat.max}${suite}.`
}

/** Le lien de l'hôte, qui apprend quelle limite relever : `<raiseUrl>?capacity=<nom>`. */
export function lienDeLimite(lien: string, nom: NomDeLimite): string {
  return `${lien}${lien.includes("?") ? "&" : "?"}capacity=${nom}`
}

type LimiteAtteinteProps = {
  /** Le libellé du geste fermé, tel que l'écran le montrerait ouvert. */
  libelle: string
  nom: NomDeLimite
  etat: LimitState
  /** Où relever la limite (`raiseUrl` de l'hôte), montré aux seuls administrateurs ; `null` : pas de lien. */
  lien: string | null
}

export function LimiteAtteinte({ libelle, nom, etat, lien }: LimiteAtteinteProps) {
  const note = `limite-${nom}`
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" disabled aria-describedby={note}>
        {libelle}
      </Button>
      <p id={note} className="oto-caption text-right">
        {limiteAtteinte(nom, etat)}
        {lien && (
          <>
            {" "}
            <a href={lienDeLimite(lien, nom)} className={LIEN}>
              Relever la limite
            </a>
          </>
        )}
      </p>
    </div>
  )
}
