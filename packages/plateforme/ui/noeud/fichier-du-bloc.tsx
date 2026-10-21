"use client"

// Un fichier joint dans la page (E10-S02, lot b : AC-b1 à AC-b3, AC-b8) : l'image, à sa largeur, qu'un clic agrandit
// dans le dialogue du design system (`Dialog`), et la carte d'un autre fichier (icône du type, nom, taille lisible,
// « Voir » pour ce qui se lit sans télécharger, « Télécharger »). Aucun fichier n'est rendu ni exécuté dans la page :
// la carte ne mène qu'à la route de lecture, qui fixe type et disposition (ADR-016 § 5). Un fichier que le stockage ne
// sert plus dit « Fichier indisponible », sans casser la page. Servi à la lecture (`rendu-des-blocs.tsx`) comme à
// l'éditeur ; client pour le dialogue, l'erreur d'une image et la vérification de la carte. Sans lui, un fichier joint ne se
// verrait ni ne se téléchargerait.
//
// Lot c (AC-c1, AC-c5) : « Voir » mène aux routes d'un lien public sur la page publique (`routeDesFichiers`), où la carte
// ne relit pas la disponibilité : sa route exige une session.
import { useEffect, useState, type ReactNode } from "react"
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple"
import { Eye } from "@phosphor-icons/react/dist/csr/Eye"
import { File as FichierQuelconque } from "@phosphor-icons/react/dist/csr/File"
import { FileCsv } from "@phosphor-icons/react/dist/csr/FileCsv"
import { FileDoc } from "@phosphor-icons/react/dist/csr/FileDoc"
import { FileHtml } from "@phosphor-icons/react/dist/csr/FileHtml"
import { FileImage } from "@phosphor-icons/react/dist/csr/FileImage"
import { FileMd } from "@phosphor-icons/react/dist/csr/FileMd"
import { FilePdf } from "@phosphor-icons/react/dist/csr/FilePdf"
import { FilePpt } from "@phosphor-icons/react/dist/csr/FilePpt"
import { FileTxt } from "@phosphor-icons/react/dist/csr/FileTxt"
import { FileXls } from "@phosphor-icons/react/dist/csr/FileXls"
import { FileZip } from "@phosphor-icons/react/dist/csr/FileZip"
import type { ImageWidth } from "../../schemas/blocks"
import { FILE_ADDRESS } from "../../schemas/api"
import { filePath, fileTypeOf, IMAGE_TYPES, type FileType } from "../../schemas/files"
import { fichierDisponible } from "../api/client"
import { Dialog } from "../ds/react/dialog"
import { Icon, type Glyphe } from "../ds/react/icon"
import { tailleLisible } from "../format/nombres"
import { FICHIERS } from "./libelles-des-fichiers"

/** Ce qui se lit sans télécharger (AC-b2) : « Voir » (lot c). */
const VUS: readonly FileType[] = ["html", "md", "pdf", "txt", "csv"]

/** Ceux que le navigateur affiche seul, depuis le stockage (AC-c1, HN-E10S02-5) ; `html` et `md` vont à la visionneuse. */
const AFFICHES_PAR_LE_NAVIGATEUR: readonly FileType[] = ["pdf", "txt", "csv"]

const GLYPHES: Partial<Record<FileType, Glyphe>> = {
  pdf: FilePdf,
  csv: FileCsv,
  html: FileHtml,
  md: FileMd,
  txt: FileTxt,
  zip: FileZip,
  docx: FileDoc,
  odt: FileDoc,
  xlsx: FileXls,
  ods: FileXls,
  pptx: FilePpt,
}

const LARGEURS: Record<ImageWidth, string> = { small: "max-w-[33%]", medium: "max-w-[66%]", full: "max-w-full" }

/**
 * Une image garde ses proportions à toute largeur (E11-S15, AC-b3) : sa hauteur suit sa largeur (`h-auto`), et si une
 * feuille de l'hôte fixait ses deux dimensions, l'image tiendrait dans sa boîte sans être déformée (`object-contain`).
 */
const PROPORTIONS = "h-auto max-w-full object-contain"

/**
 * L'adresse de « Voir » (AC-c1) : un PDF, un `txt` ou un `csv` à la route de lecture, `inline` ; un `html` ou un `md` à
 * la visionneuse, l'adresse de la page où l'on est suivie de `?view=<id>` (relative : `/n/<chemin>` comme `/p/<jeton>/…`) ;
 * `null` pour ce qui ne se voit pas. `route` : les routes d'un lien public (AC-c5), l'adresse d'un fichier (`/f`) sinon.
 */
export function adresseDeVue(id: string, type: FileType | null, route: string = FILE_ADDRESS): string | null {
  if (type === null || !VUS.includes(type)) return null
  return AFFICHES_PAR_LE_NAVIGATEUR.includes(type) ? `${filePath(id, route)}?disposition=inline` : `?view=${encodeURIComponent(id)}`
}

type ImageProps = {
  source: string
  alt: string
  largeur: ImageWidth
  /** Une image jointe : le stockage qui ne la sert plus se dit (AC-b8) ; une adresse `https` externe reste telle quelle (AC-b7). */
  jointe: boolean
}

/**
 * Une image (AC-b3) : à sa largeur, bouton qui l'agrandit dans le dialogue du design system ; Échap le ferme et le
 * dialogue rend le focus à l'image. L'hôte de la source ne reçoit pas l'adresse de la page (`no-referrer`).
 */
export function ImageAgrandissable({ source, alt, largeur, jointe }: ImageProps) {
  const [ouverte, setOuverte] = useState(false)
  const [perdue, setPerdue] = useState(false)
  if (perdue) return <p className="text-sm text-ink">{FICHIERS.indisponible}</p>
  return (
    <>
      {/* Le bouton se nomme par son geste, texte alternatif compris : l'image qu'il porte ne le redit pas. */}
      <button
        type="button"
        aria-label={FICHIERS.agrandir(alt)}
        className={`block ${LARGEURS[largeur]} cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ink`}
        onClick={() => setOuverte(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- source d'un bloc (route du paquet ou hôte quelconque) : next/image exigerait de déclarer chaque hôte, et ui/ n'importe pas Next */}
        <img src={source} alt={alt} referrerPolicy="no-referrer" loading="lazy" className={`rounded-md ${PROPORTIONS}`} onError={jointe ? () => setPerdue(true) : undefined} />
      </button>
      {ouverte && (
        <Dialog open onClose={() => setOuverte(false)} title={FICHIERS.imageAgrandie(alt)} size="lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- même source que l'image de la page */}
          <img src={source} alt={alt} referrerPolicy="no-referrer" className={`mx-auto max-h-[75vh] ${PROPORTIONS}`} />
        </Dialog>
      )}
    </>
  )
}

/**
 * La carte demande à sa route, une fois montée, si le stockage sert encore le fichier (`?check`, AC-b8) : un fichier
 * perdu se dit, sans casser la page. Un `useEffect` admis (`state-management.md § Règle d'or`, HN-E10S02-43).
 */
function useDisponible(id: string, verifier: boolean): boolean {
  const [disponible, setDisponible] = useState(true)
  useEffect(() => {
    if (!verifier) return
    let courant = true
    void fichierDisponible(id).then((oui) => {
      if (courant) setDisponible(oui)
    })
    return () => {
      courant = false
    }
  }, [id, verifier])
  return disponible
}

/** Un lien au dessin d'un bouton fantôme du design system. */
function LienBouton({ href, nom, glyphe, children, nouvelOnglet }: { href: string; nom: string; glyphe: Glyphe; children: ReactNode; nouvelOnglet?: boolean }) {
  const onglet = nouvelOnglet ? { target: "_blank", rel: "noopener noreferrer" } : { download: "" }
  return (
    <a href={href} aria-label={nom} className="oto-btn" data-variant="ghost" data-size="sm" {...onglet}>
      <Icon as={glyphe} size="xs" />
      <span>{children}</span>
    </a>
  )
}

/** `routeDesFichiers` : celles d'un lien public (AC-c5) ; la carte ne relit alors pas sa disponibilité, dont la route exige une session. */
type CarteProps = { id: string; nom: string; taille: number; routeDesFichiers?: string }

/**
 * La carte d'un fichier joint (AC-b2) : l'icône de son type, son nom, sa taille lisible, « Voir » pour un `html`, un
 * `md`, un PDF, un `txt` ou un `csv`, et « Télécharger ». Indisponible, elle garde son nom et le dit (AC-b8).
 */
export function CarteDeFichier({ id, nom, taille, routeDesFichiers = FILE_ADDRESS }: CarteProps) {
  const adresse = filePath(id, routeDesFichiers)
  const type = fileTypeOf(nom)
  const vue = adresseDeVue(id, type, routeDesFichiers)
  const servi = useDisponible(id, routeDesFichiers === FILE_ADDRESS)
  const glyphe = type === null ? FichierQuelconque : (GLYPHES[type] ?? (IMAGE_TYPES.includes(type) ? FileImage : FichierQuelconque))
  return (
    // La ligne d'un fichier du design system (`oto-file`, E11-S15, AC-b2) : filet, rayon et surface de carte ; elle se replie sous ses boutons.
    <div className="oto-file flex-wrap">
      <Icon as={glyphe} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{nom}</p>
        <p className="text-xs text-mute">{servi ? tailleLisible(taille) : FICHIERS.indisponible}</p>
      </div>
      {servi && vue !== null && (
        <LienBouton href={vue} nom={FICHIERS.voirNom(nom)} glyphe={Eye} nouvelOnglet>
          {FICHIERS.voir}
        </LienBouton>
      )}
      {servi && (
        <LienBouton href={adresse} nom={FICHIERS.telechargerNom(nom)} glyphe={DownloadSimple}>
          {FICHIERS.telecharger}
        </LienBouton>
      )}
    </div>
  )
}
