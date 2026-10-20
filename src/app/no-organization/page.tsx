import type { Metadata } from "next"
import { redirect } from "next/navigation"
import {
  AucuneOrganisation,
  CoquilleOto,
  EcranDAuthentification,
  type MarqueDOrganisation,
  type ResultatAucuneOrganisation,
} from "@otomata_tech/oto_platform/ui"
import { listOrganisationsOfPerson, normalizeHost, orgContact, resolveOrg } from "@otomata_tech/oto_platform/server"
import { logoutAction } from "@/lib/actions/auth"
import { marqueDOrganisation } from "@/lib/plateforme/marque-de-l-adresse"
import {
  getPlatformIdentitySafely,
  getPlatformSession,
  type PlatformIdentityResult,
  type PlatformSession,
} from "@/lib/plateforme/session"

// Hors du groupe `(dashboard)`, dont le layout redirige ici : dedans, la redirection bouclerait.
// L'état se calcule depuis l'hôte de la requête, aucun paramètre d'URL ne le décide (N12). L'écran
// est sur le gabarit des écrans d'authentification (E05-S07), dont la page pose la racine `.oto`.
export const metadata: Metadata = {
  title: "Aucune organisation",
  robots: { index: false },
}

const ERREUR = "Impossible de vérifier votre accès à cette organisation. Réessayez dans un instant."

type CodeDeRefus = NonNullable<PlatformIdentityResult["error"]>["code"]

/** Ce que l'écran affiche, et la marque de l'organisation de l'adresse quand elle est connue. */
type Etat = { resultat: ResultatAucuneOrganisation; marque: MarqueDOrganisation | null }

async function nonMembre(session: PlatformSession): Promise<Etat> {
  try {
    const org = await resolveOrg(session.db, session.host)
    const contact = await orgContact(session.db, org.id)
    return {
      resultat: {
        data: {
          email: session.user.email,
          hote: normalizeHost(session.host),
          organisation: { nom: org.name, contact: contact ? { nom: contact.name, email: contact.email } : null },
        },
      },
      // Thème et ligne de l'organisation que la page vient de résoudre : aucune lecture de plus.
      marque: marqueDOrganisation(org),
    }
  } catch (error) {
    console.error("no-organization: lecture de l'organisation impossible", error)
    return { resultat: { error: ERREUR }, marque: null }
  }
}

/** L'adresse d'entrée d'une organisation : `https`, sauf sur le poste local (`localhost`, `*.localhost`). */
const adresseDEntree = (host: string) => `${host === "localhost" || host.startsWith("localhost:") || host.includes(".localhost") ? "http" : "https"}://${host}`

/**
 * À une adresse qui n'en désigne aucune (l'adresse commune de l'hôte), les organisations de la personne, chacune à son
 * adresse (1.4.12) : sans elles, l'écran « Adresse inconnue » ne disait pas où aller. Une lecture en échec rend l'écran
 * d'avant, sans liste.
 */
async function sesOrganisations(session: PlatformSession): Promise<{ nom: string; adresse: string }[]> {
  try {
    const organisations = await listOrganisationsOfPerson(session.db, session.host)
    return organisations.flatMap((une) => (une.host ? [{ nom: une.name, adresse: adresseDEntree(une.host) }] : []))
  } catch (error) {
    console.error("no-organization: lecture des organisations de la personne impossible", error)
    return []
  }
}

async function etatPour(session: PlatformSession, code: CodeDeRefus | null): Promise<Etat> {
  if (code === "not_member") return nonMembre(session)
  if (code === "unknown_org") {
    return {
      resultat: { data: { email: session.user.email, hote: normalizeHost(session.host), organisation: null, organisations: await sesOrganisations(session) } },
      marque: null,
    }
  }
  return { resultat: { error: ERREUR }, marque: null }
}

export default async function AucuneOrganisationPage() {
  const session = await getPlatformSession()
  if (!session) redirect("/login")

  const identite = await getPlatformIdentitySafely("no-organization")
  // Membre de l'organisation de l'adresse : rien à faire ici.
  if (identite?.data) redirect("/")
  const { resultat, marque } = await etatPour(session, identite?.error?.code ?? null)

  return (
    <CoquilleOto theme={marque?.theme} pleinePage>
      <EcranDAuthentification marque={marque}>
        <AucuneOrganisation resultat={resultat} actionDeDeconnexion={logoutAction} />
      </EcranDAuthentification>
    </CoquilleOto>
  )
}
