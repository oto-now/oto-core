import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { readOrgView } from "@otomata_tech/oto_platform/api"
import { FEEDBACK_VISIBLE } from "@otomata_tech/oto_platform/schemas"
import { isOrgAdmin, listFlags, listShares, loadNode, previewContext, readBrand } from "@otomata_tech/oto_platform/server"
import { EcranOrganisation, reserveAuxAdministrateurs, resultatDe, type EcranOrganisationProps } from "@otomata_tech/oto_platform/ui"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { ADRESSES } from "../adresses"

// « Organisation » (E08-S03) : réservée à qui administre l'organisation de l'adresse, décidé ici par
// `isOrgAdmin` avant tout appel (AC1, N1) ; `updateOrg` et `updateBrand` le redécident à l'écriture. La page lit
// la vue avec le jeton de la session ; l'écran écrit par `PATCH /api/platform/admin/org` et, pour la marque
// (E05-S11, AC-22), par `PATCH /api/platform/brand`, puis revient ici avec `?saved=1`. La marque vient de
// l'identité, qui la porte déjà (`readBrand`) : aucune requête de plus (E05-S09 partie d2).
export const metadata: Metadata = {
  title: "Organisation",
  robots: { index: false },
}

const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const
const ICI = "/admin/organization"
/** Le Contexte de Tout le monde (P39) : son îlot le lit, « Modifier » ouvre sa page. */
const CONTEXTE = "contexte"

export default async function OrganisationPage({ searchParams }: { searchParams: Promise<{ saved?: string | string[] }> }) {
  // La session et l'appartenance se revérifient ici, hors de tout `try` : le layout n'est pas une
  // frontière (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`).
  const identite = await getPlatformIdentitySafely("admin/organization")
  if (identite?.error?.code === "unauthenticated") redirect("/login")
  if (identite?.error) redirect("/no-organization")

  const administre = identite ? isOrgAdmin(identite.data.identity) : false
  let resultat: EcranOrganisationProps["resultat"] = ECHEC
  let liensPublics: EcranOrganisationProps["liensPublics"]
  let contexte: EcranOrganisationProps["contexte"]
  let retoursVisibles: EcranOrganisationProps["retoursVisibles"]
  if (identite && !administre) resultat = { error: reserveAuxAdministrateurs(identite.data.identity.org.name) }
  else if (identite) {
    const { db } = identite.data.session
    const { identity } = identite.data
    // Les liens publics (E05-S10, AC-d7) et le Contexte de Tout le monde (E05-S11, AC-24) partent avant la vue et
    // ne sont pas attendus : leurs îlots les attendent sous leur `<Suspense>`. `listShares` redécide
    // l'administrateur ; `loadNode`, le droit de lire le Contexte, et n'en rend que les blocs publiés ; l'aperçu de
    // `context` (E05-S13, AC-4), les listes que son texte servi porte, lues avec les droits de la personne.
    liensPublics = { lecture: resultatDe(listShares(db, identity)), prefixeDesPages: ADRESSES.pages }
    contexte = {
      lecture: resultatDe(loadNode(db, identity, { path: CONTEXTE }).then((vue) => vue.blocks)),
      apercu: resultatDe(previewContext(db, identity, {})),
      prefixeDesPages: ADRESSES.pages,
    }
    // L'option « Retours visibles » (1.4.13), lue avec la vue : `setFlag` la redécide à l'écriture.
    ;[resultat, retoursVisibles] = await Promise.all([
      resultatDe(readOrgView(db, identity)),
      resultatDe(listFlags(db, identity).then((drapeaux) => drapeaux.some((drapeau) => drapeau.name === FEEDBACK_VISIBLE && drapeau.enabled))),
    ])
  }
  const marque = identite && administre ? readBrand(identite.data.identity.org) : null
  const { saved } = await searchParams
  return (
    <EcranOrganisation
      resultat={resultat}
      Lien={Link}
      ici={ICI}
      hrefGuide={`${ADRESSES.pages}${CONTEXTE}`}
      marque={marque ? { theme: marque.theme, logo: marque.logoUrl, nomAffiche: marque.displayName } : undefined}
      enregistre={saved === "1"}
      fil={{ adresses: ADRESSES, administre }}
      liensPublics={liensPublics}
      contexte={contexte}
      retoursVisibles={retoursVisibles}
    />
  )
}
