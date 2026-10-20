// « Organisation » du tableau de bord (E08-S03, AC2, AC3, AC12) : l'îlot « L'entreprise » — son logo et les
// réglages que l'administrateur écrit —, la marque (E05-S11, AC-22 : « Le logo », « La couleur »), les
// liens publics actifs (E05-S10, AC-d7), et, en annexe, le Contexte de Tout le monde (E05-S11, AC-24). Server
// Component : seuls les formulaires sont des îlots client ; la navigation vient de l'hôte.
//
// Porté d'oto-frontend (`routes/settings.company.lazy.tsx`, `components/settings/company-identity.tsx`,
// `company-logo.tsx`), E05-S09 partie d2. Repris : l'en-tête au nom de l'entreprise sous le fil des réglages,
// deux colonnes (`TwoColumns`), l'îlot « L'entreprise » (le logo, en image ou en initiale, puis le champ du nom),
// l'échec dit avec « Réessayer ». Retiré : route TanStack, `useCompany`, départ de l'entreprise, description,
// secteur, lieu, domaine de marque, mode lecture seule (la page est réservée aux administrateurs). E05-S11
// (AC-23) retire les annexes « Adresses et outils », « Contact » et « Marque et guide » : le service, l'API et
// `admin_org` les gardent. 1.4.13 : l'îlot « Retours des assistants » règle l'option « Retours visibles ».
import { Buildings } from "@phosphor-icons/react/dist/ssr/Buildings"
import type { OrgView } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { TwoColumns } from "../../ds/react/two-columns"
import { FormulaireDeMarque } from "../../marque/formulaire-de-marque"
import { LogoDOrganisation } from "../../marque/logo-d-organisation"
import type { MarqueDOrganisation } from "../../marque/types"
import { EnTeteDAdministration } from "../en-tete"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Chargement, Ilot } from "../ilot"
import type { FilDeLEcran, LienDeLAdministration } from "../types"
import { ContexteDeLEntreprise, type LectureDuContexte } from "./contexte-de-l-entreprise"
import { FormulaireOrganisation } from "./formulaire-organisation"
import { LiensPublics, type LiensPublicsDeLOrganisation } from "./liens-publics"
import { RetoursVisibles } from "./retours-visibles"

export type EcranOrganisationProps = {
  resultat: Resultat<OrgView>
  Lien: LienDeLAdministration
  /** L'adresse de l'écran dans l'hôte : « Réessayer » d'une lecture en échec y ramène. */
  ici: string
  /** Le Contexte de Tout le monde : « Modifier » de son îlot l'ouvre. */
  hrefGuide: string
  /**
   * La marque de l'organisation (`readBrand`) : son logo dans « L'entreprise », puis « Le logo » et
   * « La couleur », écrits par `PATCH brand` (E05-S11, AC-22) ; sans elle, l'initiale du nom et aucun de ces îlots.
   */
  marque?: MarqueDOrganisation
  /** La page revient d'un enregistrement de la marque (`?saved=1` de l'hôte). */
  enregistre?: boolean
  /** Le fil de l'en-tête : les adresses que l'hôte donne au rail et le droit de la personne ; sans lui, pas de fil. */
  fil?: FilDeLEcran
  /** Les liens publics actifs (E05-S10, AC-d7), sous « L'entreprise » ; sans eux, pas d'îlot. */
  liensPublics?: LiensPublicsDeLOrganisation
  /** La lecture du Contexte de Tout le monde (E05-S11, AC-24), en annexe ; sans elle, pas d'îlot. */
  contexte?: LectureDuContexte
  /** L'option « Retours visibles » de l'organisation (1.4.13), sous les liens publics ; sans elle, pas d'îlot. */
  retoursVisibles?: Resultat<boolean>
}

type OrganisationProps = Omit<EcranOrganisationProps, "resultat" | "fil"> & { organisation: OrgView }

function Organisation({ organisation, marque, enregistre = false, liensPublics, contexte, retoursVisibles, Lien, ici, hrefGuide }: OrganisationProps) {
  const annexe = contexte && (
    <ContexteDeLEntreprise lecture={contexte.lecture} apercu={contexte.apercu} prefixeDesPages={contexte.prefixeDesPages} Lien={Lien} ici={ici} hrefDuContexte={hrefGuide} />
  )
  return (
    <TwoColumns aside={annexe}>
      <Ilot id="organisation-reglages" titre="L’entreprise">
        <div className="flex flex-col gap-4">
          <LogoDOrganisation nom={organisation.name} logo={marque?.logo ?? null} taille={56} />
          <FormulaireOrganisation organisation={organisation} />
        </div>
      </Ilot>
      {marque && <FormulaireDeMarque marque={marque} nomOrganisation={organisation.name} enregistre={enregistre} />}
      {liensPublics && <LiensPublics liens={liensPublics} Lien={Lien} ici={ici} />}
      {retoursVisibles !== undefined && <RetoursVisibles lecture={retoursVisibles} />}
    </TwoColumns>
  )
}

export function EcranOrganisation({ resultat, fil, ...reste }: EcranOrganisationProps) {
  // Une lecture nourrit les îlots : son échec, ou la réserve d'un non-administrateur (AC1), se dit une fois.
  return (
    <>
      <EnTeteDAdministration courant="organisation" fil={fil} titre={resultat.data?.name ?? "Organisation"} glyphe={Buildings} />
      {resultat.error !== undefined ? (
        <ErreurDeLecture message={resultat.error} href={reste.ici} Lien={reste.Lien} />
      ) : (
        <Organisation organisation={resultat.data} {...reste} />
      )}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte (AC12). */
export function EcranOrganisationChargement() {
  return <Chargement texte="Chargement de l'organisation…" />
}
