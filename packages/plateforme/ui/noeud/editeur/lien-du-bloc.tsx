"use client"

// Modifier un lien d'un bloc dans un panneau (E11-S06, lot b ; retour de démo, fiche D132) : le curseur posé dans un
// lien, ou un clic sur un lien rendu au repos, ouvre sous le champ le panneau « Lien » : libellé, destination (une page
// de la plateforme ou une adresse web), « Appliquer », « Retirer le lien », « Ouvrir ». La personne ne lit plus la
// source `[[chemin|libellé]]` pour la changer. Le champ garde la source pendant la frappe (HN-E11S06-1) ; un clic
// simple sur un lien au repos ouvre le panneau, Ctrl, ⌘ ou le bouton du milieu le suivent (HN-E11S06-2).
//
// Le lien écrit passe par `gestes.citer`, comme « @ » : une frappe, qui part comme toute frappe. Il est relu par la
// fonction de l'écran (`liensDuTexte`) avant d'être écrit : un lien qui ne se relirait pas tel quel, ou une adresse
// autre que `https://`, n'est jamais écrit (`security-patterns.md § XSS Prevention`). Le panneau vit dans le flux,
// dans la rangée, comme la liste de « @ » : un portail sortirait le focus de la rangée et retirerait un bloc neuf.
//
// E11-S15 : un clic sur un lien au repos le suit ; le menu contextuel (clic droit, touche Menu, Maj+F10) ouvre le
// panneau (AC-b9, remplace AC-b2 et HN-E11S06-2). Ses champs de texte ne sont pas relus par le correcteur (AC-b7).
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react"
import { LABEL_MAX } from "../../../schemas/link-syntax"
import type { SearchMatch } from "../../../schemas/search"
import { useRechercheDeContenus } from "../../api/use-recherche-de-contenus"
import { Field, Input } from "../../ds/react/forms"
import { Button } from "../../ds/react/primitives"
import { SegmentedControl } from "../../ds/react/segmented-control"
import { nombreLisible } from "../../format/nombres"
import { caracteres, cibleDe, liensDuTexte, titreDuLien, type CiblesDesLiens, type LienDuTexte } from "../en-ligne"
import { LIEN_DU_BLOC } from "../libelles"
import type { LiensDesBlocs } from "./champ-de-bloc"
import { idDOption, lienVers, ListeACiter, useOptionActive } from "./citer"
import { useGestes } from "./gestes"
import { placeDansLeChamp } from "./liens-masques"

/**
 * Un lien ouvert dans le panneau : lu dans le texte, sa source à l'ouverture, où rendre le curseur au champ, et
 * `parLigne` : lu dans sa ligne (l'élément d'une liste, comme la copie le rend), sinon dans le texte entier.
 */
type LienOuvert = { lu: LienDuTexte; source: string; origine: "curseur" | "clic"; curseur: number; parLigne: boolean }

/** Ce que le panneau écrit : une page (`null` : aucune choisie), sa clé gardée si elle ne change pas (HN-E11S06-6) ; ou une adresse web. */
export type LienVoulu = { vers: "page"; chemin: string | null; reference: string | null; libelle: string } | { vers: "web"; adresse: string; libelle: string }

type RefusDuLien = "libelleLong" | "adresse" | "page" | "change" | "illisible"

/** Le texte écrit, et le curseur posé juste après ce qui a remplacé le lien. */
type Ecrit = { texte: string; curseur: number }

/**
 * Les liens lus comme le rendu les lit, bornes dans le texte entier : dans une liste, ceux de la ligne (l'élément)
 * qui contient `place`, comme la copie et le clic ; ailleurs, ceux du texte entier. Un span de code ouvert sur une
 * ligne ne masque pas un lien de la suivante dans une liste.
 */
function liensAutourDe(texte: string, place: number, parLigne: boolean): LienDuTexte[] {
  if (!parLigne) return liensDuTexte(texte)
  const depart = place === 0 ? 0 : texte.lastIndexOf("\n", place - 1) + 1
  const arrivee = texte.indexOf("\n", place)
  return liensDuTexte(texte.slice(depart, arrivee === -1 ? texte.length : arrivee)).map((lu) => ({ ...lu, debut: lu.debut + depart, fin: lu.fin + depart }))
}

/** Le libellé tel qu'il part (AC-b4) : `[`, `]` et les sauts de ligne en espaces, sans blancs de bord, comme `lienVers`. */
const libelleEcrit = (libelle: string) => libelle.replace(/[[\]\r\n]/gu, " ").trim()

/** Une adresse que l'écran relit seule, entière, en adresse web : `https://` seulement (HN-E11S06-4), ni blanc ni guillemet. */
function adresseLue(adresse: string): boolean {
  if (!adresse.startsWith("https://")) return false
  const lus = liensDuTexte(adresse)
  return lus.length === 1 && lus[0].debut === 0 && lus[0].fin === adresse.length && lus[0].lien.genre === "web" && lus[0].lien.adresse === adresse
}

/** La source du lien voulu, libellé déjà écrit ; `null` : aucune page choisie. */
function sourceDu(voulu: LienVoulu, libelle: string): string | null {
  if (voulu.vers === "web") return libelle ? `[${libelle}](${voulu.adresse})` : voulu.adresse
  if (voulu.chemin === null) return null
  return lienVers({ path: voulu.reference === null ? voulu.chemin : `${voulu.chemin}#${voulu.reference}`, title: libelle })
}

/** Le lien relu entre `debut` et `fin` du texte écrit, lu comme le rendu le lit, est celui voulu, libellé écrit : même chemin et clé ou même adresse, même libellé. */
function relu(texte: string, { debut, fin }: { debut: number; fin: number }, voulu: LienVoulu, parLigne: boolean): boolean {
  const lu = liensAutourDe(texte, debut, parLigne).find((un) => un.debut === debut)
  if (!lu || lu.fin !== fin) return false
  const { lien } = lu
  const { libelle } = voulu
  if (voulu.vers === "page") return lien.genre === "lien" && lien.chemin === voulu.chemin && lien.reference === voulu.reference && lien.libelle === libelle
  return lien.genre === "web" && lien.adresse === voulu.adresse && (libelle === "" ? lu.forme === "web-nu" : lu.forme === "web-libelle" && lien.libelle === libelle)
}

/** Le lien est encore à sa place, tel qu'il était à l'ouverture. */
const enPlace = (texte: string, ouvert: Pick<LienOuvert, "lu" | "source">) => texte.slice(ouvert.lu.debut, ouvert.lu.fin) === ouvert.source

/**
 * « Appliquer » (AC-b4, AC-b5) : le texte où seul le lien ouvert devient le lien voulu, le reste à l'octet près ; ou le
 * refus, rien n'étant écrit. Le lien construit est relu par `liensDuTexte` dans le texte écrit.
 */
export function avecLeLien(texte: string, ouvert: Pick<LienOuvert, "lu" | "source" | "parLigne">, voulu: LienVoulu): Ecrit | { refus: RefusDuLien } {
  if (!enPlace(texte, ouvert)) return { refus: "change" }
  const libelle = libelleEcrit(voulu.libelle)
  if (caracteres(libelle) > LABEL_MAX) return { refus: "libelleLong" }
  if (voulu.vers === "web" && !adresseLue(voulu.adresse)) return { refus: "adresse" }
  const source = sourceDu(voulu, libelle)
  if (source === null) return { refus: "page" }
  const { debut, fin } = ouvert.lu
  const ecrit = `${texte.slice(0, debut)}${source}${texte.slice(fin)}`
  return relu(ecrit, { debut, fin: debut + source.length }, { ...voulu, libelle }, ouvert.parLigne) ? { texte: ecrit, curseur: debut + source.length } : { refus: "illisible" }
}

/** Ce que montre un lien : son libellé, sinon le titre de sa page (`titreDuLien`), sinon, nue, son domaine. */
const texteMontre = (lu: LienDuTexte, cibles?: CiblesDesLiens) => (lu.lien.genre === "lien" ? titreDuLien(lu.lien, cibles) : lu.lien.libelle)

/** « Retirer le lien » (AC-b6) : le lien remplacé par le texte qu'il montre. */
export function sansLeLien(texte: string, ouvert: Pick<LienOuvert, "lu" | "source">, cibles?: CiblesDesLiens): Ecrit | { refus: "change" } {
  if (!enPlace(texte, ouvert)) return { refus: "change" }
  const montre = texteMontre(ouvert.lu, cibles)
  return { texte: `${texte.slice(0, ouvert.lu.debut)}${montre}${texte.slice(ouvert.lu.fin)}`, curseur: ouvert.lu.debut + montre.length }
}

/** « Ouvrir » (AC-b7) : une page à sa place connue (déplacée : la nouvelle), clé comprise ; une adresse web relue. */
function adresseDOuverture(voulu: LienVoulu, liens: LiensDesBlocs): string | RefusDuLien {
  if (voulu.vers === "web") return adresseLue(voulu.adresse) ? voulu.adresse : "adresse"
  if (voulu.chemin === null) return "page"
  const ancre = voulu.reference === null ? "" : `#${encodeURIComponent(voulu.reference)}`
  return `${liens.prefixe}${cibleDe(liens.cibles, voulu.chemin)?.chemin ?? voulu.chemin}${ancre}`
}

/**
 * Le lien sous le curseur du champ, ou cliqué au repos (AC-b1, AC-b2, AC-b8) : l'ouverture, la fermeture, `Échap`,
 * `Alt+Entrée`, et le refus d'un lien qui a changé. `actif` : le champ écrit des liens (ni code, ni appel, ni conflit) ;
 * `parLigne` : le champ est une liste, dont chaque ligne se lit seule.
 */
export function useLienAuCurseur(texte: string, champ: RefObject<HTMLTextAreaElement | null>, actif: boolean, parLigne: boolean) {
  const [ouvert, setOuvert] = useState<LienOuvert | null>(null)
  const [perdu, setPerdu] = useState(false)
  // Le début du lien fermé par Échap : le panneau n'y revient qu'après que le curseur en est sorti (AC-b8).
  const ecarte = useRef<number | null>(null)
  const libelle = useRef<HTMLInputElement>(null)
  const aFocaliser = useRef(false)
  // Ouvert au clic, le panneau prend le focus dans « Libellé » (AC-b2), une fois monté.
  useEffect(() => {
    if (!ouvert || !aFocaliser.current) return
    aFocaliser.current = false
    libelle.current?.focus()
  }, [ouvert])

  const ouvrir = (lu: LienDuTexte, origine: LienOuvert["origine"], curseur: number) => {
    setPerdu(false)
    setOuvert({ lu, source: texte.slice(lu.debut, lu.fin), origine, curseur, parLigne })
  }
  const ecarter = () => {
    ecarte.current = ouvert?.lu.debut ?? null
    setOuvert(null)
  }
  return {
    ouvert,
    perdu,
    libelle,
    fermer: () => setOuvert(null),
    /** Le curseur du champ, vide et strictement dans un lien, ouvre le panneau ; hors de lui, le ferme (AC-b1). */
    suivre(valeur: string, debut: number, fin: number) {
      if (!actif) return
      const lu = debut === fin ? liensAutourDe(valeur, debut, parLigne).find((un) => un.debut < debut && debut < un.fin) : undefined
      if (lu?.debut !== ecarte.current) ecarte.current = null
      if (!lu || ecarte.current !== null) return setOuvert(null)
      setPerdu(false)
      setOuvert({ lu, source: valeur.slice(lu.debut, lu.fin), origine: "curseur", curseur: debut, parLigne })
    },
    /** Le clavier du champ, panneau affiché : Échap le ferme, le focus restant ; Alt+Entrée y mène (AC-b8). `true` : la touche est prise. */
    toucher(evenement: KeyboardEvent<HTMLTextAreaElement>, affiche: boolean): boolean {
      if (!affiche) return false
      if (evenement.key === "Escape") {
        evenement.preventDefault()
        ecarter()
        return true
      }
      if (evenement.key !== "Enter" || !evenement.altKey) return false
      evenement.preventDefault()
      libelle.current?.focus()
      return true
    },
    /**
     * Le menu contextuel d'un lien rendu au repos (E11-S15, AC-b9, qui remplace le clic simple d'AC-b2) : clic droit,
     * touche Menu ou Maj+F10 sur le lien ; le menu du navigateur ne s'ouvre pas, le panneau s'ouvre. Un clic suit le lien.
     */
    menuContextuel(evenement: MouseEvent<HTMLElement>) {
      if (!actif) return
      const ancre = evenement.target instanceof Element ? evenement.target.closest("a[data-lien]") : null
      if (!ancre || !evenement.currentTarget.contains(ancre)) return
      // Le rang d'un lien se compte dans le texte rendu : l'élément d'une liste, ou le texte entier d'un autre bloc.
      const element = ancre.closest("[data-debut]")
      const depart = element && evenement.currentTarget.contains(element) ? Number(element.getAttribute("data-debut")) : 0
      const lu = liensAutourDe(texte, depart, parLigne)[Number(ancre.getAttribute("data-lien"))]
      if (!lu) return
      evenement.preventDefault()
      aFocaliser.current = true
      ouvrir(lu, "clic", lu.fin)
    },
    /** Le focus quitte la rangée : le panneau se ferme sans rien écrire ; du champ au panneau, il reste (AC-b8). */
    quitter(evenement: FocusEvent<HTMLElement>) {
      const vers = evenement.relatedTarget
      if (vers instanceof Node && evenement.currentTarget.closest("[data-cle]")?.contains(vers)) return
      setOuvert(null)
    },
    /** Échap dans le panneau : il se ferme, le focus revient au champ, curseur là où il était (après le lien, ouvert au clic). */
    rendreLeFocus() {
      const curseur = ouvert?.curseur ?? null
      ecarter()
      const element = champ.current
      element?.focus()
      if (curseur === null || !element) return
      const place = placeDansLeChamp(element, curseur)
      element.setSelectionRange(place, place)
    },
    /** Le lien n'est plus à sa place (AC-b5) : le panneau se ferme, le message reste sous le champ. */
    perdre() {
      ecarter()
      setPerdu(true)
      champ.current?.focus()
    },
  }
}

type AuCurseur = ReturnType<typeof useLienAuCurseur>

type Page = { chemin: string; titre: string }

/** La page actuelle, puis la recherche d'une autre (AC-b3) : les résultats de « @ », flèches et Entrée dans le champ de recherche. */
function ChoixDeLaPage({ page, choisir, erreur }: { page: Page | null; choisir: (page: Page) => void; erreur: ReactNode }) {
  const recherche = useRechercheDeContenus()
  const [requete, setRequete] = useState("")
  const id = useId()
  const trouves = recherche.resultat.etat === "lue" ? recherche.resultat.trouves : []
  const option = useOptionActive(trouves)
  const ouverte = requete.trim() !== ""
  const prendre = (trouve: SearchMatch) => {
    choisir({ chemin: trouve.path, titre: trouve.title })
    setRequete("")
    recherche.chercher("")
  }
  const toucher = (evenement: KeyboardEvent<HTMLInputElement>) => {
    if (option.toucher(evenement, ["Enter"], prendre)) return
    // Entrée sans résultat ne choisit rien : la touche reste prise.
    if (evenement.key === "Enter") evenement.preventDefault()
  }
  return (
    <>
      <p className="oto-lien-page">
        {page ? page.titre : LIEN_DU_BLOC.aucunePage}
        {page && <span className="oto-caption">{page.chemin}</span>}
      </p>
      <Field label={LIEN_DU_BLOC.chercher} error={erreur}>
        <Input
          size="sm"
          autoComplete="off"
          spellCheck={false}
          value={requete}
          aria-autocomplete="list"
          aria-controls={ouverte ? id : undefined}
          aria-activedescendant={ouverte && trouves.length > 0 ? idDOption(id, option.actif) : undefined}
          onChange={(evenement) => {
            setRequete(evenement.target.value)
            option.remettre()
            recherche.chercher(evenement.target.value)
          }}
          onKeyDown={toucher}
        />
      </Field>
      {ouverte && <ListeACiter id={id} resultat={recherche.resultat} actif={option.actif} choisir={prendre} />}
    </>
  )
}

const DESTINATIONS = [
  { value: "page", label: LIEN_DU_BLOC.page },
  { value: "web", label: LIEN_DU_BLOC.web },
]

/** Le message de chaque refus, sous le champ qu'il concerne (AC-b5) ; la borne du libellé lue de `schemas/`. */
const MESSAGES: Record<"libelle" | "adresse" | "page", Partial<Record<RefusDuLien, string>>> = {
  libelle: { libelleLong: LIEN_DU_BLOC.libelleLong(nombreLisible(LABEL_MAX)), illisible: LIEN_DU_BLOC.illisible },
  adresse: { adresse: LIEN_DU_BLOC.adresseRefusee },
  page: { page: LIEN_DU_BLOC.choisirUnePage },
}

/** Le refus d'un champ, en alerte sous lui ; rien s'il ne le concerne pas. */
function alerteDu(refus: RefusDuLien | null, champ: keyof typeof MESSAGES): ReactNode {
  const message = refus === null ? undefined : MESSAGES[champ][refus]
  return message ? <span role="alert">{message}</span> : null
}

/**
 * Les champs du panneau, préremplis par le lien ouvert (AC-b3), et le lien qu'ils veulent. Le libellé d'un lien qui
 * n'en a pas d'écrit reste `null` tant que la personne n'en écrit pas un : « Libellé » montre le titre de la page
 * choisie, et « Appliquer » écrit le lien sans libellé, qui se lit par le titre de sa page.
 */
function useFormulaireDuLien(ouvert: LienOuvert, cibles?: CiblesDesLiens) {
  const { lien, forme } = ouvert.lu
  const [ecrit, setLibelle] = useState<string | null>(forme === "web-nu" || (lien.genre === "lien" && lien.libelle === "") ? null : lien.libelle)
  const [vers, setVers] = useState<LienVoulu["vers"]>(lien.genre === "lien" ? "page" : "web")
  const [page, setPage] = useState<Page | null>(lien.genre === "lien" ? { chemin: lien.chemin, titre: titreDuLien({ chemin: lien.chemin, libelle: "" }, cibles) } : null)
  const [adresse, setAdresse] = useState(lien.genre === "web" ? lien.adresse : "")
  const [refus, setRefus] = useState<RefusDuLien | null>(null)
  const reference = lien.genre === "lien" && page?.chemin === lien.chemin ? lien.reference : null
  const libelle = ecrit ?? (vers === "page" && page ? page.titre : "")
  const voulu: LienVoulu = vers === "page" ? { vers, chemin: page?.chemin ?? null, reference, libelle: ecrit ?? "" } : { vers, adresse: adresse.trim(), libelle: ecrit ?? "" }
  return { libelle, setLibelle, vers, setVers, page, setPage, adresse, setAdresse, refus, setRefus, voulu }
}

type PanneauDuLienProps = {
  cle: string
  texte: string
  ouvert: LienOuvert
  liens: LiensDesBlocs
  /** L'`id` de la phrase qui décrit le lien, que le champ désigne (AC-b1). */
  idDescription: string
  lien: AuCurseur
}

/** Le panneau « Lien », dans le flux sous le champ, dans la rangée (AC-b3 à AC-b8). */
export function PanneauDuLien({ cle, texte, ouvert, liens, idDescription, lien }: PanneauDuLienProps) {
  const gestes = useGestes()
  const formulaire = useFormulaireDuLien(ouvert, liens.cibles)
  const ecrire = (ecrit: Ecrit | { refus: RefusDuLien }) => {
    if ("refus" in ecrit) return ecrit.refus === "change" ? lien.perdre() : formulaire.setRefus(ecrit.refus)
    lien.fermer()
    gestes.citer(cle, ecrit.texte, ecrit.curseur)
  }
  const appliquer = () => ecrire(avecLeLien(texte, ouvert, formulaire.voulu))
  const entree = (evenement: KeyboardEvent<HTMLInputElement>) => {
    if (evenement.key !== "Enter") return
    evenement.preventDefault()
    appliquer()
  }
  const ouvrir = () => {
    const adresse = adresseDOuverture(formulaire.voulu, liens)
    if (adresse === "adresse" || adresse === "page") return formulaire.setRefus(adresse)
    formulaire.setRefus(null)
    window.open(adresse, "_blank", "noopener,noreferrer")
  }
  return (
    <div
      role="group"
      aria-label={LIEN_DU_BLOC.groupe}
      // Un clic sur le fond du panneau garde le focus dans la rangée : le panneau ne se ferme pas sous le pointeur.
      tabIndex={-1}
      className="oto-pop oto-lien"
      onBlur={lien.quitter}
      onKeyDown={(evenement) => {
        if (evenement.key !== "Escape") return
        evenement.preventDefault()
        lien.rendreLeFocus()
      }}
    >
      <p id={idDescription} className="oto-caption">
        {LIEN_DU_BLOC.decrit(texteMontre(ouvert.lu, liens.cibles))}
      </p>
      <Field label={LIEN_DU_BLOC.libelle} error={alerteDu(formulaire.refus, "libelle")}>
        <Input ref={lien.libelle} size="sm" spellCheck={false} value={formulaire.libelle} onChange={(evenement) => formulaire.setLibelle(evenement.target.value)} onKeyDown={entree} />
      </Field>
      <SegmentedControl label={LIEN_DU_BLOC.destination} options={DESTINATIONS} value={formulaire.vers} onChange={(valeur) => formulaire.setVers(valeur === "web" ? "web" : "page")} />
      {formulaire.vers === "page" ? (
        <ChoixDeLaPage page={formulaire.page} choisir={formulaire.setPage} erreur={alerteDu(formulaire.refus, "page")} />
      ) : (
        <Field label={LIEN_DU_BLOC.adresse} error={alerteDu(formulaire.refus, "adresse")}>
          <Input type="url" size="sm" value={formulaire.adresse} onChange={(evenement) => formulaire.setAdresse(evenement.target.value)} onKeyDown={entree} />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={appliquer}>
          {LIEN_DU_BLOC.appliquer}
        </Button>
        {ouvert.lu.forme !== "web-nu" && (
          <Button size="sm" onClick={() => ecrire(sansLeLien(texte, ouvert, liens.cibles))}>
            {LIEN_DU_BLOC.retirer}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={ouvrir}>
          {LIEN_DU_BLOC.ouvrir}
        </Button>
      </div>
    </div>
  )
}
