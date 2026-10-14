"use client"

// L'envoi d'un fichier joint depuis l'éditeur (E10-S02, lot b : AC-b1, AC-b2, AC-b4, AC-b7 ; ADR-016 § 4) : la demande
// (`POST files`), l'envoi direct au stockage par l'URL présignée (`XMLHttpRequest`, pour sa progression), la
// confirmation (`POST files/<id>/complete`), l'annulation (`AbortController`) ; l'état du stockage, appris par
// `GET files` au premier geste qui en a besoin (HN-E10S02-6) ; l'état des envois et des dialogues de l'éditeur. Les
// octets ne passent jamais par le paquet ; le bloc n'est écrit qu'après la confirmation (HN-E10S02-8). Sans lui, un
// fichier ne se joint pas à une page.
import { useEffect, useRef, useState } from "react"
import { FILE_MAX_BYTES, FILE_TYPES, fileTypeOf, IMAGE_TYPES, ORG_QUOTA_BYTES, TEXT_FILE_MAX_BYTES, type FileReady, type FileStorageState, type FileUpload } from "../../../schemas"
import { appelerPlateforme, type ErreurPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { tailleLisible } from "../../format/nombres"
import { FICHIERS } from "../libelles-des-fichiers"
import type { BlocEdite } from "./modele"

/** Le type d'un bloc local en cours d'envoi : ni écrit, ni servi ; il devient le bloc du fichier à la confirmation. */
export const EN_DEPOT = "depot-local"

export const enDepot = (bloc: Pick<BlocEdite, "type">) => bloc.type === EN_DEPOT

/** Ce que l'on joint : une image, rendue dans la page, ou un fichier, en carte (AC-b1, AC-b2). */
export type Genre = "image" | "fichier"

/** Une image par son extension ; tout autre type admis est un fichier (HN-E10S02-36). */
export function genreDe(nom: string): Genre {
  const type = fileTypeOf(nom)
  return type !== null && IMAGE_TYPES.includes(type) ? "image" : "fichier"
}

const extensions = (types: readonly string[]) => types.map((type) => `.${type}`)

/** Ce que propose le sélecteur du système, par genre. */
export const ACCEPTES: Record<Genre, string> = { image: extensions(IMAGE_TYPES).join(","), fichier: extensions(Object.keys(FILE_TYPES)).join(",") }

/** Les types et les limites, dits avant la sélection (AC-b4), depuis `schemas/files.ts`. */
export const LIMITES: Record<Genre, string> = {
  image: FICHIERS.limitesImage(extensions(IMAGE_TYPES).join(", "), tailleLisible(FILE_MAX_BYTES)),
  fichier: FICHIERS.limitesFichier(extensions(Object.keys(FILE_TYPES)).join(", "), tailleLisible(FILE_MAX_BYTES), tailleLisible(TEXT_FILE_MAX_BYTES)),
}

/** Les refus du service, traduits par leur code ; le quota par sa raison (AC-b4). */
const REFUS = {
  quota: FICHIERS.quota(tailleLisible(ORG_QUOTA_BYTES)),
  too_large: FICHIERS.tropLourd(tailleLisible(FILE_MAX_BYTES), tailleLisible(TEXT_FILE_MAX_BYTES)),
  invalid_arguments: FICHIERS.typeRefuse(Object.keys(FILE_TYPES).join(", ")),
  forbidden: FICHIERS.interdit,
  not_enabled: FICHIERS.desactives,
  conflict: FICHIERS.different,
  internal: FICHIERS.stockage,
}

/**
 * Le refus d'un envoi dit en français. Un même code a deux causes, que le service ne dit qu'en anglais : l'écran la
 * retrouve par le fichier qu'il envoie. `invalid_arguments` sur une extension admise : le nom est refusé, pas le type ;
 * `too_large` d'un fichier de 0 octet : il est vide, il ne dépasse rien.
 */
export function messageDEnvoi(erreur: ErreurPlateforme, fichier: Pick<File, "name" | "size">): string {
  if (erreur.code === "invalid_arguments" && fileTypeOf(fichier.name) !== null) return FICHIERS.nomRefuse
  if (erreur.code === "too_large" && erreur.raison === undefined && fichier.size < 1) return FICHIERS.vide
  // Le quota de l'organisation, posé par l'hôte (E12-S02), que le refus porte en octets ; 10 Go sinon.
  const quota = erreur.details?.max
  if (erreur.raison === "quota" && typeof quota === "number") return FICHIERS.quota(tailleLisible(quota))
  return messageDErreur(erreur, REFUS)
}

/**
 * Une image collée sans extension reconnue (le presse-papiers nomme souvent `image.png`, parfois rien) : nommée par son
 * type, pour que le service, qui lit le type à l'extension, l'admette.
 */
export function nommer(fichier: File): File {
  if (fileTypeOf(fichier.name) !== null) return fichier
  const extension = IMAGE_TYPES.find((type) => FILE_TYPES[type] === fichier.type)
  return extension ? new File([fichier], `image.${extension}`, { type: fichier.type }) : fichier
}

/** Le bloc d'un fichier confirmé : une image par son `file_id`, ou un bloc `file` (AC-b1, AC-b2). */
export function blocDuFichier(pret: FileReady): BlocEdite {
  if (genreDe(pret.name) === "image") return { type: "image", text: null, data: { file_id: pret.id }, key: null }
  return { type: "file", text: null, data: { file_id: pret.id, name: pret.name, size: pret.size, mime: pret.mime }, key: null }
}

/** L'envoi des octets au stockage, par l'URL présignée : sa progression, son annulation ; `ok`, `annule`, ou le refus. */
function envoyerAuStockage(upload: FileUpload["upload"], fichier: File, progresser: (part: number) => void, signal: AbortSignal): Promise<"ok" | "annule" | ErreurPlateforme> {
  return new Promise((resolve) => {
    const requete = new XMLHttpRequest()
    requete.open("PUT", upload.url)
    for (const [nom, valeur] of Object.entries(upload.headers)) requete.setRequestHeader(nom, valeur)
    requete.upload.onprogress = (evenement) => {
      if (evenement.lengthComputable) progresser(evenement.loaded / evenement.total)
    }
    // Un refus du stockage est une panne pour la personne : « Le stockage des fichiers ne répond pas. »
    requete.onload = () => resolve(requete.status >= 200 && requete.status < 300 ? "ok" : { code: "internal", statut: requete.status })
    requete.onerror = () => resolve({ code: "reseau", statut: 0 })
    requete.onabort = () => resolve("annule")
    signal.addEventListener("abort", () => requete.abort(), { once: true })
    requete.send(fichier)
  })
}

export type IssueDEnvoi = { pret: FileReady } | { erreur: ErreurPlateforme } | { annule: true }

/**
 * Un fichier joint à la page `chemin` (AC-b1, AC-b2) : demande, envoi, confirmation. Annulé, il s'arrête où il en est ;
 * une ligne `pending` laissée derrière est purgée par le service (AC-a6).
 */
export async function envoyerUnFichier(chemin: string, fichier: File, progresser: (part: number) => void, signal: AbortSignal): Promise<IssueDEnvoi> {
  const demande = await appelerPlateforme<FileUpload>({ methode: "POST", ressource: "files", corps: { node: chemin, name: fichier.name, mime: fichier.type, size: fichier.size } })
  if (signal.aborted) return { annule: true }
  if (demande.erreur) return { erreur: demande.erreur }
  const envoi = await envoyerAuStockage(demande.data.upload, fichier, progresser, signal)
  if (envoi === "annule") return { annule: true }
  if (envoi !== "ok") return { erreur: envoi }
  const confirmation = await appelerPlateforme<FileReady>({ methode: "POST", ressource: `files/${demande.data.id}/complete`, corps: {} })
  if (signal.aborted) return { annule: true }
  return confirmation.erreur ? { erreur: confirmation.erreur } : { pret: confirmation.data }
}

/**
 * L'état du stockage (AC-a7, HN-E10S02-6), appris une fois, au premier geste qui en a besoin : l'approche du « + », un
 * collage, un dépôt. Une lecture en échec n'est pas retenue : le geste suivant relit.
 */
function useStockage() {
  const [actif, setActif] = useState(false)
  const lecture = useRef<Promise<boolean> | null>(null)
  const connaitre = (): Promise<boolean> => {
    lecture.current ??= appelerPlateforme<FileStorageState>({ methode: "GET", ressource: "files" }).then((lu) => {
      if (lu.erreur) {
        lecture.current = null
        return false
      }
      setActif(lu.data.enabled)
      return lu.data.enabled
    })
    return lecture.current
  }
  return { actif, connaitre }
}

/** Un envoi en cours, montré dans son bloc local : le fichier, sa progression (0 à 1), le refus traduit. */
export type Depot = { fichier: File; genre: Genre; progression: number; erreur: string | null }

/** Ce que l'éditeur ouvre pour un fichier : le choix d'un fichier (« + »), le choix au dépôt (AC-b5), l'import d'un CSV (AC-b5, AC-b6). */
export type DialogueDeFichier =
  | { genre: "choisir"; cle: string; quoi: Genre }
  | { genre: "depot"; cle: string; fichier: File; extension: "md" | "csv" }
  | { genre: "import"; cle: string; fichier: File }
  // 1.4.3 : l'adresse d'un cadre intégré, neuf après la rangée, ou celui de la rangée à changer.
  | { genre: "integration"; cle: string; modifier: boolean; adresse: string }

/** L'état des fichiers de l'éditeur : le stockage, les envois par rangée locale, le dialogue ouvert. Quitter l'écran annule les envois. */
export function useFichiersDeLEditeur() {
  const stockage = useStockage()
  const [depots, setDepots] = useState<Readonly<Record<string, Depot>>>({})
  const [dialogue, setDialogue] = useState<DialogueDeFichier | null>(null)
  const controleurs = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const enCours = controleurs.current
    return () => {
      for (const controleur of enCours.values()) controleur.abort()
    }
  }, [])
  return { stockage, depots, setDepots, dialogue, setDialogue, controleurs }
}

export type FichiersDeLEditeur = ReturnType<typeof useFichiersDeLEditeur>
