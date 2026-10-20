import { redirect } from "next/navigation"
import { Content, CoquilleOto, Desk, RailApplication, resultatDe, type AdressesDuRail } from "@otomata_tech/oto_platform/ui"
import { isOrgAdmin, listMyOrganisations, preferredTheme, readBrand } from "@otomata_tech/oto_platform/server"
import { lireLArbre, lireLesEquipes } from "@/lib/plateforme/lectures"
import { getPlatformIdentitySafely } from "@/lib/plateforme/session"
import { FournisseurDeRafraichissement } from "./fournisseur-de-rafraichissement"

// Route group principal — renommer selon le projet (ex: (app), (admin), etc.)
// IMPORTANT : un route group avec layout DOIT avoir au moins un page.tsx,
// sinon le build Next.js échoue (missing client-reference-manifest).
//
// Ce layout n'est PAS une frontière d'autorisation (nextjs-patterns.md § Layouts) : il n'est
// pas rejoué à la navigation client. La redirection vers « aucune organisation » est de confort :
// chaque page.tsx vérifie la session, chaque service du paquet revérifie l'appartenance.
//
// Une seule coque (ADR-008 point 7, E05-S09) : le bureau du paquet, son rail et le contenu, sous la
// seule racine `.oto` des pages du groupe, au thème de la personne, sinon de l'organisation (E05-S11, AC-4 :
// `preferredTheme`, choisi dans Profil) — l'hôte ne pose aucune autre
// navigation. Le rail lit l'arbre et les équipes avec le jeton de la session, en parallèle, chacun par
// `resultatDe` : une panne se dit dans le rail, et la page reste ouverte. Lus une fois par rendu
// (`lectures.ts`) : la page d'un nœud reprend les mêmes (E05-S10, partie c).

/**
 * Les écrans de l'hôte que le rail range dans ses menus et sa palette. « Activité » à l'adresse du journal (1.4.13),
 * ses Statistiques pour qui administre, la page le décide ; les Retours pour qui administre l'organisation, décidé sur
 * l'identité seule, sans requête (1.4.13 : la page des retours dit l'option « Retours visibles » éteinte), ajoutés par
 * `adressesDe`.
 */
const ADRESSES: AdressesDuRail = {
  pages: "/n/",
  accueil: "/",
  journal: "/journal",
  equipes: "/teams",
  brancher: "/connect",
  organisation: "/admin/organization",
  connecteurs: "/admin/connectors",
  corbeille: "/trash",
  profil: "/profile",
  // E11-S10 (AC-e1) : la vue « Contexte », en tête du menu du compte.
  contexte: "/context",
}

/** Les adresses du rail de la personne : les Retours à qui administre l'organisation (`isOrgAdmin`). */
function adressesDe(retours: boolean): AdressesDuRail {
  return retours ? { ...ADRESSES, retours: "/admin/feedback" } : ADRESSES
}

/** Une lecture impossible sans identité (panne de sa résolution) : le rail la dit à sa place. */
const ECHEC = { error: "Une erreur est survenue. Réessayez." } as const

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // L'organisation est celle de l'adresse (ADR-004) ; `unknown_org` et `not_member` sont rendus,
  // pas levés : la redirection reste hors de tout `try`. Une panne (`null`) dégrade le rail — sans
  // nom d'organisation ni arbre — au lieu de faire tomber chaque page du groupe.
  const resultat = await getPlatformIdentitySafely("(dashboard) layout")
  if (resultat?.error?.code === "unknown_org" || resultat?.error?.code === "not_member") {
    redirect("/no-organization")
  }
  const lu = resultat?.data
  const identity = lu?.identity
  // La marque vient de l'identité (`org_by_host` la rend) : aucune requête de plus.
  const brand = identity ? readBrand(identity.org) : null
  const [arbre, equipes, organisations] = lu
    ? await Promise.all([
        resultatDe(lireLArbre(lu.session.db, lu.identity)),
        // Des équipes, le rail ne lit que le dossier et le nom : l'annuaire (membres, emails, rôles) ne
        // part pas dans chaque page rendue.
        resultatDe(lireLesEquipes(lu.session.db, lu.identity).then((lues) => lues.map(({ slug, name }) => ({ slug, name })))),
        // Les organisations de la personne, pour la bascule du menu de l'entreprise ; leur panne ne montre pas de bascule.
        listMyOrganisations(lu.session.db, lu.identity, lu.session.host).catch(() => undefined),
      ])
    : [ECHEC, ECHEC, undefined]

  return (
    // La seule racine `.oto` des pages du groupe (ADR-008 § 3) : une page qui en poserait une autre
    // écraserait le thème de la personne.
    <CoquilleOto theme={identity ? preferredTheme(identity) : undefined} pleinePage>
      {/* Les îlots relisent la page par `router.refresh()` après une mutation (E05-S03) ; le rail navigue par le lien de l'hôte. */}
      <FournisseurDeRafraichissement>
        <Desk>
          <RailApplication
            entreprise={brand ? { nom: brand.displayName, logo: brand.logoUrl } : null}
            arbre={arbre}
            equipes={equipes}
            handle={identity?.member.profile.handle ?? null}
            compte={identity ? (identity.member.profile.name ?? identity.user.name) : null}
            // Les entrées d'administration pour qui administre l'organisation (E08-S03 N9) : du confort,
            // chaque page `/admin/*` revérifie l'accès.
            administre={identity ? isOrgAdmin(identity) : false}
            adresses={adressesDe(identity ? isOrgAdmin(identity) : false)}
            organisations={organisations}
          />
          <Content>{children}</Content>
        </Desk>
      </FournisseurDeRafraichissement>
    </CoquilleOto>
  )
}
