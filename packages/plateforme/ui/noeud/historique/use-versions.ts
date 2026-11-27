"use client"

// La liste des versions du tiroir : lue à l'ouverture et à chaque changement de portée (page ou bloc), page par page
// (« Voir les versions plus anciennes » ajoute la suivante), relue sur demande (après un échec, après un retour à une
// version). Une réponse arrivée après un changement de portée est ignorée. Sans lui, le tiroir mêlerait ses lectures à
// son rendu.
import { useCallback, useEffect, useRef, useState } from "react"
import type { HistoryEntry, NodeHistoryView } from "../../../schemas/node-history"
import { messageDErreur } from "../../api/messages"
import { lireLHistorique } from "./api"

export type LectureDesVersions =
  | { etat: "chargement" }
  | { etat: "echec"; message: string }
  | { etat: "pret"; vue: NodeHistoryView; versions: HistoryEntry[]; suite: "aucune" | "prete" | "en-cours" | "echec" }

export function useVersions(chemin: string, bloc: string | undefined, actif: boolean) {
  const [lecture, setLecture] = useState<LectureDesVersions>({ etat: "chargement" })
  const [tour, setTour] = useState(0)
  const portee = useRef<string | null>(null)

  useEffect(() => {
    if (!actif) return
    let courant = true
    // Une autre portée repart du chargement ; une relecture de la même garde la liste montrée jusqu'à la réponse.
    const cle = `${chemin} ${bloc ?? ""}`
    if (portee.current !== cle) setLecture({ etat: "chargement" })
    portee.current = cle
    void lireLHistorique(chemin, bloc).then((reponse) => {
      if (!courant) return
      if (reponse.erreur) setLecture({ etat: "echec", message: messageDErreur(reponse.erreur) })
      else setLecture({ etat: "pret", vue: reponse.data, versions: reponse.data.entries, suite: reponse.data.next === null ? "aucune" : "prete" })
    })
    return () => {
      courant = false
    }
  }, [chemin, bloc, actif, tour])

  const relire = useCallback(() => setTour((n) => n + 1), [])

  const plus = useCallback(() => {
    if (lecture.etat !== "pret" || lecture.vue.next === null) return
    const { vue, versions } = lecture
    setLecture({ ...lecture, suite: "en-cours" })
    void lireLHistorique(chemin, bloc, vue.next ?? undefined).then((reponse) => {
      setLecture((avant) => {
        if (avant.etat !== "pret" || avant.vue !== vue) return avant
        if (reponse.erreur) return { ...avant, suite: "echec" }
        return { etat: "pret", vue: { ...vue, next: reponse.data.next }, versions: [...versions, ...reponse.data.entries], suite: reponse.data.next === null ? "aucune" : "prete" }
      })
    })
  }, [lecture, chemin, bloc])

  return { lecture, relire, plus }
}
