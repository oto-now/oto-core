"use client"

// Le premier temps de « Ajouter un connecteur » (écran Connecteurs) : la recherche, puis une carte par outil que la
// personne peut ajouter (`outilsAAjouter`), son nom, « Connecté » quand un connecteur à elle en sert déjà (la carte
// reste ouverte : elle en ajoute un de plus), et ce que l'outil fait ; pour un administrateur, le blocage de l'outil
// pour l'organisation, révélé sur la carte (`BlocageDeLOutil`). Les outils bloqués viennent en bas, grisés, avec qui les
// a bloqués et, pour un administrateur, « Débloquer ». Sans ce module, ajout et gouvernance vivaient dans deux listes
// de l'écran, et la fenêtre d'ajout dépassait sa taille.
import { useEffect, useRef, useState } from "react"
import { Check } from "@phosphor-icons/react/dist/csr/Check"
import { Lock } from "@phosphor-icons/react/dist/csr/Lock"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import type { DeactivationImpact } from "../../../schemas"
import { Icon } from "../../ds/react/icon"
import { InputAffix } from "../../ds/react/input-affix"
import { Tooltip } from "../../ds/react/tooltip"
import { LogoDOrganisation } from "../../marque/logo-d-organisation"
import { BlocageDeLOutil, DeblocageDeLOutil } from "./blocage-de-l-outil"
import { outilsCherches, type OutilAAjouter } from "./catalogue-des-connecteurs"
import type { BloqueurDeLOutil as Blocage } from "./etat-du-compte"
import { fonctions } from "./libelles-des-partages"

const RECHERCHER = "Rechercher un outil"

/** Le titre du catalogue : le focus y va au retour d'une fiche, et quand un blocage emporte sa carte. */
export const ANCRE_DU_CATALOGUE = "catalogue-des-connecteurs"

/** Ce qu'un administrateur lit pour bloquer ou débloquer un outil ; absent pour un membre. */
export type GouvernanceDesOutils = { impacts: Partial<Record<string, DeactivationImpact>> }

/** « Connecté », ou « Connecté : 2 connecteurs à vous » : seuls ceux de la personne qui servent comptent. */
export const motDuConnecte = (nombre: number) => (nombre > 1 ? `Connecté : ${nombre} connecteurs à vous` : "Connecté")

/** Qui a bloqué l'outil, dit à qui regarde : « vous », son nom, ou « un administrateur » quand il n'est plus membre. */
export const quiABloque = (par: NonNullable<Blocage>, moi: string) => (par.userId === moi ? "vous" : (par.name ?? "un administrateur"))

function Connecte({ nombre }: { nombre: number }) {
  const mot = motDuConnecte(nombre)
  return (
    <Tooltip content={mot}>
      <span role="img" aria-label={mot} className="oto-etat flex size-5 flex-none items-center justify-center" data-state="ok">
        <Icon as={Check} size="xs" />
      </span>
    </Tooltip>
  )
}

/** Ce qu'une carte dit sous le nom : le nombre de ses fonctions, même pour un outil qui se connecte de plusieurs façons. */
function Precision({ outil }: { outil: OutilAAjouter }) {
  // Payé par la clé de l'application, pas encore adopté : la fiche dit pourquoi rien ne s'ajoute, et qui l'adopte.
  if (outil.aAdopter) return <span className="oto-caption">À adopter par un administrateur</span>
  if (outil.fonctions.length === 0) return null
  return <span className="oto-caption">{fonctions(outil.fonctions.length)}</span>
}

type CarteProps = { outil: OutilAAjouter; choisir: (cle: string) => void; gouvernance: GouvernanceDesOutils | undefined }

function Carte({ outil, choisir, gouvernance }: CarteProps) {
  return (
    <li className="group relative">
      {/* `.oto-card[data-interactive]` pose `display: block` : la rangée en flex vit dans un enfant. */}
      <button type="button" data-interactive="" className="oto-card h-full cursor-pointer text-ink focus-visible:ring-2 focus-visible:ring-ink" onClick={() => choisir(outil.connecteur)}>
        <span className="flex items-start gap-3">
          <LogoDOrganisation nom={outil.libelle} logo={outil.logo} taille={40} tuile />
          <span className={`flex min-w-0 flex-1 flex-col gap-0.5 ${gouvernance ? "pr-8" : ""}`}>
            <span className="flex items-center justify-between gap-2 font-semibold">
              <span className="min-w-0">{outil.libelle}</span>
              {outil.connectes > 0 && <Connecte nombre={outil.connectes} />}
            </span>
            <Precision outil={outil} />
          </span>
        </span>
      </button>
      {gouvernance && (
        <span className={`absolute top-2 ${outil.connectes > 0 ? "right-9" : "right-2"}`}>
          <BlocageDeLOutil connecteur={outil.connecteur} outil={outil.libelle} impact={gouvernance.impacts[outil.connecteur]} actif={outil.actif} presentation="icone" ancre={ANCRE_DU_CATALOGUE} />
        </span>
      )}
    </li>
  )
}

type BloqueProps = { outil: OutilAAjouter & { bloquePar: NonNullable<Blocage> }; moi: string; gouvernance: GouvernanceDesOutils | undefined }

function Bloque({ outil, moi, gouvernance }: BloqueProps) {
  // « vous » pour l'administrateur qui l'a bloqué ; un membre lit toujours un nom.
  const qui = gouvernance ? quiABloque(outil.bloquePar, moi) : (outil.bloquePar.name ?? "un administrateur")
  return (
    <li className="oto-card flex h-full flex-col items-start gap-3">
      <span className="flex w-full items-start gap-3">
        <span className="opacity-60">
          <LogoDOrganisation nom={outil.libelle} logo={outil.logo} taille={40} tuile />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center justify-between gap-2 font-semibold text-mute">
            {outil.libelle}
            <span aria-hidden="true" className="oto-etat flex" data-state="failed">
              <Icon as={Lock} size="xs" />
            </span>
          </span>
          <span className="oto-caption">{`Bloqué par ${qui}.${gouvernance ? "" : " Demandez à un administrateur si vous en avez besoin."}`}</span>
        </span>
      </span>
      {gouvernance && <DeblocageDeLOutil connecteur={outil.connecteur} outil={outil.libelle} ancre={ANCRE_DU_CATALOGUE} />}
    </li>
  )
}

const estBloque = (outil: OutilAAjouter): outil is OutilAAjouter & { bloquePar: NonNullable<Blocage> } => outil.bloquePar !== null

/** Les outils bloqués, une carte par outil : on bloque un outil, pas une façon de s'y connecter. */
function Bloques({ outils, moi, gouvernance }: { outils: OutilAAjouter[]; moi: string; gouvernance: GouvernanceDesOutils | undefined }) {
  const uns = outils.filter(estBloque)
  if (uns.length === 0) return null
  return (
    <section aria-labelledby="outils-bloques" className="flex flex-col gap-2">
      <h4 id="outils-bloques" className="oto-section-title">
        Bloqués pour l&apos;organisation
      </h4>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {uns.map((outil) => (
          <Bloque key={outil.connecteur} outil={outil} moi={moi} gouvernance={gouvernance} />
        ))}
      </ul>
    </section>
  )
}

function Ouverts({ outils, choisir, gouvernance }: { outils: OutilAAjouter[]; choisir: (cle: string) => void; gouvernance: GouvernanceDesOutils | undefined }) {
  const ouverts = outils.filter((outil) => outil.bloquePar === null)
  if (ouverts.length === 0) return null
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ouverts.map((outil) => (
        <Carte key={outil.connecteur} outil={outil} choisir={choisir} gouvernance={gouvernance} />
      ))}
    </ul>
  )
}

type CatalogueDeLAjoutProps = {
  outils: OutilAAjouter[]
  choisir: (cle: string) => void
  /** Revenu d'une fiche : le focus va au titre du catalogue. */
  auRetour: boolean
  /** L'identifiant de qui regarde : « Bloqué par vous ». */
  moi: string
  gouvernance: GouvernanceDesOutils | undefined
}

export function CatalogueDeLAjout({ outils, choisir, auRetour, moi, gouvernance }: CatalogueDeLAjoutProps) {
  const [q, setQ] = useState("")
  const titre = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (auRetour) titre.current?.focus()
  }, [auRetour])
  const trouves = outilsCherches(outils, q)
  const sansReponse = outils.length > 0 && trouves.length === 0
  return (
    <div className="flex flex-col gap-4">
      <h3 ref={titre} id={ANCRE_DU_CATALOGUE} tabIndex={-1} className="oto-sr-only">
        Choisir un outil
      </h3>
      {outils.length > 0 && (
        <InputAffix
          type="search"
          aria-label={RECHERCHER}
          placeholder={`${RECHERCHER}…`}
          start={<Icon as={MagnifyingGlass} size="sm" />}
          value={q}
          onChange={(evenement) => setQ(evenement.target.value)}
        />
      )}
      {outils.length === 0 && <p>Aucun outil à ajouter pour l&apos;instant. Un administrateur peut ajouter un connecteur et le partager avec vous.</p>}
      {/* Montée d'emblée : une recherche sans réponse s'y annonce. */}
      <div role="status" className={sansReponse ? "flex flex-col gap-1 py-4 text-center" : undefined}>
        {sansReponse && (
          <>
            <span className="font-semibold text-ink">{`Aucun outil ne correspond à « ${q.trim()} ».`}</span>
            {!gouvernance && <span className="oto-caption">Un outil manque ? Dites-le à un administrateur de l&apos;organisation.</span>}
          </>
        )}
      </div>
      <Ouverts outils={trouves} choisir={choisir} gouvernance={gouvernance} />
      <Bloques outils={trouves} moi={moi} gouvernance={gouvernance} />
      <hr className="oto-separator" data-orientation="horizontal" />
      <p className="oto-caption">
        Ces connecteurs servent votre assistant à travers Oto, dans toutes vos conversations.
        {!gouvernance && !sansReponse && " Un outil manque ? Dites-le à un administrateur."}
      </p>
    </div>
  )
}
