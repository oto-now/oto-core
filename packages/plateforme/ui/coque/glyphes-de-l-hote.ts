// Les glyphes qu'un écran de l'hôte peut porter dans le rail (`AdressesDuRail.ecransDeLHote`, décision du
// 2026-10-14) : une table fermée, chaque glyphe sous son nom Phosphor. Aucune fonction ni aucun composant ne
// traverse la frontière serveur-client (`types.ts`) : la page serveur de l'hôte nomme le glyphe, le rail le lit ici.
// Elle reste courte : chaque glyphe entre dans le JS client de toute page sous la coque (budget de `packed-host-build`) ;
// la plupart sont déjà ceux du rail. Un glyphe de plus s'ajoute à cette table ; elle ne se retire pas (ADR-006).
import { AppWindow } from "@phosphor-icons/react/dist/csr/AppWindow"
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase"
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings"
import { Calendar } from "@phosphor-icons/react/dist/csr/Calendar"
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar"
import { ChatCircleText } from "@phosphor-icons/react/dist/csr/ChatCircleText"
import { CreditCard } from "@phosphor-icons/react/dist/csr/CreditCard"
import { Envelope } from "@phosphor-icons/react/dist/csr/Envelope"
import { FileText } from "@phosphor-icons/react/dist/csr/FileText"
import { Folder } from "@phosphor-icons/react/dist/csr/Folder"
import { Gear } from "@phosphor-icons/react/dist/csr/Gear"
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt"
import { Table } from "@phosphor-icons/react/dist/csr/Table"
import { Users } from "@phosphor-icons/react/dist/csr/Users"
import type { Glyphe } from "../ds/react/icon"

export const GLYPHES_DE_L_HOTE = {
  AppWindow,
  Briefcase,
  Buildings,
  Calendar,
  ChartBar,
  ChatCircleText,
  CreditCard,
  Envelope,
  FileText,
  Folder,
  Gear,
  Info,
  Receipt,
  Table,
  Users,
} as const satisfies Record<string, Glyphe>

/** Le nom d'un glyphe de la table, celui de Phosphor (« ChartBar »). */
export type GlypheDeLHote = keyof typeof GLYPHES_DE_L_HOTE

/** Le glyphe d'un écran de l'hôte qui n'en nomme aucun : une fenêtre d'application. */
export const GLYPHE_DE_L_HOTE_PAR_DEFAUT: GlypheDeLHote = "AppWindow"
