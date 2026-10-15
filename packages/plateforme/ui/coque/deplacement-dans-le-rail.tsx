"use client"

// Déplacer et ranger depuis le rail (E05-S10, parties b et b2, AC-b7, AC-b9) : une ligne se glisse-dépose
// sur une autre et devient son enfant, ses sous-contenus avec elle ; déposée entre deux lignes (le quart haut
// ou bas d'une ligne), elle prend cette place parmi ses frères, pour tout le monde. Au clavier, le « ⋯ »
// propose « Déplacer » (le choix du « Déplacer » de l'en-tête, `FormulaireDeDeplacement`), « Monter » et
// « Descendre ». Changer de parent passe par l'envoi de l'en-tête (`POST /api/platform/nodes/move`), après
// l'aperçu du service (`GET nodes/impact`) : quand le déplacement change qui voit le contenu, un
// `ConfirmDialog` le dit avant l'envoi, sinon il part sans question ; ranger passe par `POST nodes/position`
// (après le déplacement, quand le dépôt change aussi de parent : deux appels, HN-E05S10e-11). Droits décidés
// par le service, refus dit dans le rail. Déposer sur la ligne d'un Contexte range sous lui, comme son « + »
// (fiche D110 a) ; sur son quart bas, juste après lui, en tête de sa section. Une fois déplacé, le nœud s'ouvre : le rail le montre, déplié jusqu'à lui et sélectionné
// (`use-depliage-du-rail.ts`) ; une fois rangé, la page se relit. Sans lui, le rail ne range rien.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown"
import { ArrowsOutCardinal } from "@phosphor-icons/react/dist/csr/ArrowsOutCardinal"
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp"
import { placeNodeSchema, type TreeNode } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { destinationsDuDeplacement, PERSO, RACINE } from "../arbre/depuis-l-arbre"
import { Dialog } from "../ds/react/dialog"
import { AnimatedIcon } from "../ds/react/icon"
import type { MenuItem } from "../ds/react/overlays"
import { Alert } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { useRafraichir } from "../hote/rafraichir"
import { cheminSous, envoyerLeDeplacement, FormulaireDeDeplacement, type RefusDuDeplacement } from "../noeud/deplacement-du-noeud"
import { sectionDuChemin } from "../noeud/fil"
import { aplatir, freresParParent, parentDe, placeDuDepot, placeDuPas, zoneDuPointeur, type Place, type Zone } from "./freres"
import { ligneDuRail } from "./gestes-du-rail"
import { ConfirmationDuDeplacement, lireLImpact, type DemandeConfirmee } from "./impact-du-deplacement"
import { DEPLACEMENT_RAIL } from "./libelles"
import type { EquipeDuRail } from "./types"

/** Le glisser-déposer que lit chaque ligne du rail (`LigneDuRail`) : le nœud d'une adresse, ce qui se glisse, ce qui reçoit. */
export type GlisserDuRail = {
  cheminDe: (adresse: string) => string | null
  peutGlisser: (chemin: string) => boolean
  commencer: (chemin: string) => void
  finir: () => void
  /** La zone de la ligne sous le pointeur, de la fraction de sa hauteur (0 en haut). */
  zoneDe: (cible: string, fraction: number) => Zone
  /** Vrai quand le nœud glissé peut se déposer dans cette zone de cette ligne. */
  accepte: (cible: string, zone: Zone) => boolean
  deposer: (cible: string, zone: Zone) => void
}

export const GlisserDansLeRail = createContext<GlisserDuRail | null>(null)

export const useGlisserDansLeRail = () => useContext(GlisserDansLeRail)

/** Un déplacement demandé : le nœud, son nouveau chemin, son nom, ses sous-contenus, les espaces ; `place` : son rang sous le nouveau parent. */
type Demande = Omit<DemandeConfirmee, "impact"> & { chemin: string; nouveau: string; place?: Place }

/** `POST nodes/position` (AC-b9) : `null` quand le nœud est rangé, sinon le refus du service, dit. */
async function envoyerLeRangement(chemin: string, place: Place): Promise<RefusDuDeplacement | null> {
  const corps = placeNodeSchema.safeParse({ path: chemin, after: place.after })
  if (!corps.success) return { message: messageDErreur({ code: "invalid_arguments", statut: 400 }), disparu: false }
  const reponse = await appelerPlateforme({ methode: "POST", ressource: "nodes/position", corps: corps.data })
  if (!reponse.erreur) return null
  return { message: messageDErreur(reponse.erreur, DEPLACEMENT_RAIL.refusDuRangement), disparu: reponse.erreur.code === "not_found" }
}

type Lecture = { arbre: TreeNode[]; equipes: EquipeDuRail[]; handle: string | null; prefixe: string; ouverts: ReadonlySet<string> }

/**
 * Les nœuds visibles par chemin, leurs frères rangés, et ce qui ne se déplace pas (E03-S07 AC9, P39) : racine,
 * `private`, un espace personnel, un Contexte, un dossier d'équipe.
 */
function useArbreLu({ arbre, equipes }: Pick<Lecture, "arbre" | "equipes">) {
  return useMemo(() => {
    const noeuds = aplatir(arbre)
    const parChemin = new Map(noeuds.map((noeud) => [noeud.path, noeud]))
    const slugs = new Set(equipes.map((equipe) => equipe.slug))
    const immobile = (chemin: string) =>
      chemin === RACINE || chemin === PERSO || parentDe(chemin) === PERSO || slugs.has(chemin) || parChemin.get(chemin)?.kind === "context"
    const sousContenus = (chemin: string) => noeuds.filter((noeud) => noeud.path.startsWith(`${chemin}/`)).length
    const freres = freresParParent(arbre, immobile)
    /** La ligne d'avant à l'écran : le frère d'avant, sinon le parent s'il est une ligne (un Contexte en est une), sinon le Contexte de l'espace. */
    const precedente = (chemin: string) => {
      const parent = parentDe(chemin)
      const avant = freres.get(parent) ?? []
      const rang = avant.indexOf(chemin)
      if (rang > 0) return avant[rang - 1]
      if (parChemin.has(parent) && (!immobile(parent) || parChemin.get(parent)?.kind === "context")) return parent
      return noeuds.find((noeud) => noeud.kind === "context" && parentDe(noeud.path) === parent)?.path ?? null
    }
    return { parChemin, immobile, sousContenus, freres, precedente }
  }, [arbre, equipes])
}

type ArbreLu = ReturnType<typeof useArbreLu>

/**
 * La place d'un dépôt avant ou après une ligne (AC-b9) : jamais sous le nœud glissé ni parmi les espaces personnels. Un
 * Contexte reste en tête de sa section (P39) : rien avant lui ; après lui, la tête de ses frères, seule place à côté de
 * lui quand la section n'a pas d'autre ligne.
 */
function placeEntre(lu: ArbreLu, source: string, cible: string, zone: Exclude<Zone, "dans">): Place | null {
  const parent = parentDe(cible)
  if (parent === PERSO || cible === source || cible.startsWith(`${source}/`)) return null
  const freres = lu.freres.get(parent) ?? []
  if (lu.parChemin.get(cible)?.kind === "context") return zone === "apres" && freres[0] !== source ? { after: null } : null
  return placeDuDepot(freres, source, cible, zone)
}

export type DeplacementDansLeRail = {
  /** Le glisser-déposer, à fournir aux lignes (`GlisserDansLeRail`). */
  glisser: GlisserDuRail
  /** Les items du « ⋯ » d'une ligne mobile : « Déplacer », « Monter », « Descendre » ; aucun pour une ligne qui ne se déplace pas. */
  itemsPour: (cible: { chemin: string; nom: string }) => MenuItem[]
  /** À rendre une fois : le choix au clavier, la confirmation, l'annonce et le refus. */
  retour: ReactNode
  /** Ce que les autres gestes d'une ligne lisent de l'arbre : s'il se déplace, ses sous-contenus, la ligne qui le précède. */
  arbre: Pick<ArbreLu, "sousContenus" | "precedente"> & { mobile: (chemin: string) => boolean }
}

/** Les envois d'un déplacement et d'un rangement, et ce qu'ils disent : l'état de la confirmation, de l'envoi, du refus. */
function useEnvoisDuRail({ equipes, handle, prefixe }: Pick<Lecture, "equipes" | "handle" | "prefixe">, lu: ArbreLu) {
  const { naviguer } = useHote()
  const rafraichir = useRafraichir()
  const [confirmation, setConfirmation] = useState<(Demande & DemandeConfirmee) | null>(null)
  // Ce que dit l'annonceur pendant un envoi : « Déplacement… » ou « Rangement… » ; `null` hors d'un envoi.
  const [enCours, setEnCours] = useState<string | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [annonce, setAnnonce] = useState("")
  // Après « Monter » ou « Descendre » : la relecture range la ligne ailleurs dans le rail et le focus, rendu à son
  // « ⋯ » par le menu, part avec le nœud déplacé ; il y revient une fois l'arbre relu (`avant` : l'arbre d'avant).
  const [aRefocaliser, setARefocaliser] = useState<{ chemin: string; avant: ArbreLu } | null>(null)
  const nomDe = (chemin: string) => lu.parChemin.get(chemin)?.title || chemin

  useEffect(() => {
    if (aRefocaliser === null || aRefocaliser.avant === lu) return
    ligneDuRail(prefixe, aRefocaliser.chemin)?.closest(".oto-rail-row")?.querySelector<HTMLElement>(".oto-rail-more")?.focus()
    setARefocaliser(null)
  }, [aRefocaliser, lu, prefixe])

  function refuser(refuse: RefusDuDeplacement) {
    setRefus(refuse.message)
    if (refuse.disparu) rafraichir()
  }

  async function envoyer(demande: Demande) {
    setEnCours(DEPLACEMENT_RAIL.enCours)
    const issue = await envoyerLeDeplacement(demande.chemin, demande.nouveau)
    // Déplacé, au chemin que rend le service (le premier libre si le demandé est pris, fiche D125) : le rang
    // sous le nouveau parent, s'il est demandé ; son refus se dit, le déplacement reste.
    const rangement = "chemin" in issue && demande.place ? await envoyerLeRangement(issue.chemin, demande.place) : null
    setEnCours(null)
    setConfirmation(null)
    if ("message" in issue) return refuser(issue)
    if (rangement) setRefus(rangement.message)
    naviguer(`${prefixe}${issue.chemin}`)
    rafraichir()
  }

  /** Un déplacement vers ce nouveau chemin : l'aperçu d'abord ; confirmé s'il change qui voit le contenu, envoyé sinon. */
  async function demander(chemin: string, nouveau: string, place?: Place) {
    const demande: Demande = {
      chemin,
      nouveau,
      place,
      nom: nomDe(chemin),
      sousContenus: lu.sousContenus(chemin),
      avant: sectionDuChemin(chemin, equipes, handle).titre,
      apres: sectionDuChemin(nouveau, equipes, handle).titre,
    }
    setRefus(null)
    setAnnonce("")
    setEnCours(DEPLACEMENT_RAIL.enCours)
    const lue = await lireLImpact(chemin, nouveau)
    if (!("impact" in lue)) {
      setEnCours(null)
      return refuser(lue)
    }
    if (!lue.impact.changes) return envoyer(demande)
    setEnCours(null)
    setConfirmation({ ...demande, impact: lue.impact })
  }

  /**
   * Un rangement parmi les mêmes frères (AC-b9) : aucune question, qui voit le contenu ne change pas. `auClavier` :
   * un pas du « ⋯ », dont le focus suit la ligne rangée.
   */
  async function ranger(chemin: string, place: Place, auClavier = false) {
    setRefus(null)
    setAnnonce("")
    setEnCours(DEPLACEMENT_RAIL.rangement)
    const refuse = await envoyerLeRangement(chemin, place)
    setEnCours(null)
    if (refuse) return refuser(refuse)
    setAnnonce(DEPLACEMENT_RAIL.range(nomDe(chemin)))
    if (auClavier) setARefocaliser({ chemin, avant: lu })
    rafraichir()
  }

  const retour = (
    <>
      {/* Montée vide : l'envoi, puis le rangement fait, s'annoncent sans rien montrer. */}
      <p role="status" className="oto-sr-only">
        {enCours ?? annonce}
      </p>
      {refus && <Alert tone="fail">{refus}</Alert>}
      {confirmation && (
        <ConfirmationDuDeplacement demande={confirmation} enCours={enCours !== null} confirmer={() => void envoyer(confirmation)} renoncer={() => setConfirmation(null)} />
      )}
    </>
  )
  return { demander, ranger, retour }
}

export function useDeplacementDansLeRail({ arbre, equipes, handle, prefixe, ouverts }: Lecture): DeplacementDansLeRail {
  const lu = useArbreLu({ arbre, equipes })
  const envois = useEnvoisDuRail({ equipes, handle, prefixe }, lu)
  const glisse = useRef<string | null>(null)
  const [choix, setChoix] = useState<{ chemin: string; nom: string } | null>(null)

  /** Un dépôt sur une ligne, Contexte compris : elle devient le parent, sauf si elle l'est déjà ou si elle est sous le nœud glissé. */
  function accepteDedans(source: string, cible: string): boolean {
    return cible !== parentDe(source) && cible !== source && !cible.startsWith(`${source}/`)
  }

  /** Un dépôt entre deux lignes : un rangement parmi les frères, précédé d'un déplacement quand le parent change. */
  function deposerEntre(source: string, cible: string, zone: Exclude<Zone, "dans">) {
    const place = placeEntre(lu, source, cible, zone)
    if (place === null) return
    const parent = parentDe(cible)
    if (parent === parentDe(source)) void envois.ranger(source, place)
    else void envois.demander(source, cheminSous(parent, source), place)
  }

  const glisser: GlisserDuRail = {
    cheminDe: (adresse) => (adresse.startsWith(prefixe) && adresse.length > prefixe.length ? adresse.slice(prefixe.length) : null),
    peutGlisser: (chemin) => lu.parChemin.has(chemin) && !lu.immobile(chemin),
    commencer: (chemin) => {
      glisse.current = chemin
    },
    finir: () => {
      glisse.current = null
    },
    zoneDe: (cible, fraction) => {
      const zone = zoneDuPointeur(fraction, ouverts.has(cible) && (lu.parChemin.get(cible)?.children.length ?? 0) > 0)
      // Le haut de la ligne d'un Contexte reçoit dedans : rien ne se range avant lui (P39).
      return lu.parChemin.get(cible)?.kind === "context" && zone === "avant" ? "dans" : zone
    },
    accepte: (cible, zone) => {
      const source = glisse.current
      if (source === null) return false
      return zone === "dans" ? accepteDedans(source, cible) : placeEntre(lu, source, cible, zone) !== null
    },
    deposer: (cible, zone) => {
      const source = glisse.current
      glisse.current = null
      if (source === null) return
      if (zone !== "dans") return deposerEntre(source, cible, zone)
      void envois.demander(source, cheminSous(cible, source))
    },
  }

  /** « Monter » et « Descendre » d'une ligne (AC-b9, au clavier), quand elle a un frère de ce côté. */
  function pas(chemin: string): MenuItem[] {
    const freres = lu.freres.get(parentDe(chemin)) ?? []
    const monter = placeDuPas(freres, chemin, -1)
    const descendre = placeDuPas(freres, chemin, 1)
    return [
      ...(monter ? [{ label: DEPLACEMENT_RAIL.monter, icon: <AnimatedIcon as={ArrowUp} size="xs" />, onSelect: () => void envois.ranger(chemin, monter, true) }] : []),
      ...(descendre ? [{ label: DEPLACEMENT_RAIL.descendre, icon: <AnimatedIcon as={ArrowDown} size="xs" />, onSelect: () => void envois.ranger(chemin, descendre, true) }] : []),
    ]
  }

  const retour = (
    <>
      {envois.retour}
      {choix && (
        <Dialog open onClose={() => setChoix(null)} title={DEPLACEMENT_RAIL.titre(choix.nom)} size="sm">
          <FormulaireDeDeplacement
            chemin={choix.chemin}
            destinations={destinationsDuDeplacement(arbre, choix.chemin)}
            sousPages={lu.sousContenus(choix.chemin)}
            deplacer={async (nouveau) => {
              setChoix(null)
              void envois.demander(choix.chemin, nouveau)
              return null
            }}
            annuler={() => setChoix(null)}
          />
        </Dialog>
      )}
    </>
  )

  return {
    glisser,
    itemsPour: (cible) =>
      lu.immobile(cible.chemin)
        ? []
        : [{ label: DEPLACEMENT_RAIL.action, icon: <AnimatedIcon as={ArrowsOutCardinal} size="xs" />, onSelect: () => setChoix(cible) }, ...pas(cible.chemin)],
    retour,
    arbre: { sousContenus: lu.sousContenus, precedente: lu.precedente, mobile: (chemin) => lu.parChemin.has(chemin) && !lu.immobile(chemin) },
  }
}
