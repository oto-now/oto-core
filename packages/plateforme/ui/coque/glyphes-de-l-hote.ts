// Les glyphes qu'un écran de l'hôte peut porter dans le rail (`AdressesDuRail.ecransDeLHote`, décision du
// 2026-10-14) : une table fermée, chaque glyphe sous son nom Phosphor. Aucune fonction ni aucun composant ne
// traverse la frontière serveur-client (`types.ts`) : la page serveur de l'hôte nomme le glyphe, le rail le lit ici.
// Un glyphe de plus s'ajoute à cette table ; elle ne se retire pas (ADR-006).
import { AppWindow } from "@phosphor-icons/react/dist/csr/AppWindow"
import { Bell } from "@phosphor-icons/react/dist/csr/Bell"
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen"
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase"
import { Calculator } from "@phosphor-icons/react/dist/csr/Calculator"
import { Calendar } from "@phosphor-icons/react/dist/csr/Calendar"
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar"
import { ChartLine } from "@phosphor-icons/react/dist/csr/ChartLine"
import { ChartPie } from "@phosphor-icons/react/dist/csr/ChartPie"
import { ChatCircleText } from "@phosphor-icons/react/dist/csr/ChatCircleText"
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText"
import { CurrencyEur } from "@phosphor-icons/react/dist/csr/CurrencyEur"
import { Database } from "@phosphor-icons/react/dist/csr/Database"
import { Envelope } from "@phosphor-icons/react/dist/csr/Envelope"
import { FileText } from "@phosphor-icons/react/dist/csr/FileText"
import { Folder } from "@phosphor-icons/react/dist/csr/Folder"
import { Gauge } from "@phosphor-icons/react/dist/csr/Gauge"
import { Gear } from "@phosphor-icons/react/dist/csr/Gear"
import { Globe } from "@phosphor-icons/react/dist/csr/Globe"
import { House } from "@phosphor-icons/react/dist/csr/House"
import { Kanban } from "@phosphor-icons/react/dist/csr/Kanban"
import { Lightning } from "@phosphor-icons/react/dist/csr/Lightning"
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks"
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin"
import { Package } from "@phosphor-icons/react/dist/csr/Package"
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt"
import { Scales } from "@phosphor-icons/react/dist/csr/Scales"
import { ShoppingCart } from "@phosphor-icons/react/dist/csr/ShoppingCart"
import { Star } from "@phosphor-icons/react/dist/csr/Star"
import { Table } from "@phosphor-icons/react/dist/csr/Table"
import { Tag } from "@phosphor-icons/react/dist/csr/Tag"
import { Truck } from "@phosphor-icons/react/dist/csr/Truck"
import { User } from "@phosphor-icons/react/dist/csr/User"
import { Users } from "@phosphor-icons/react/dist/csr/Users"
import { Wrench } from "@phosphor-icons/react/dist/csr/Wrench"
import type { Glyphe } from "../ds/react/icon"

export const GLYPHES_DE_L_HOTE = {
  AppWindow,
  Bell,
  BookOpen,
  Briefcase,
  Calculator,
  Calendar,
  ChartBar,
  ChartLine,
  ChartPie,
  ChatCircleText,
  ClipboardText,
  CurrencyEur,
  Database,
  Envelope,
  FileText,
  Folder,
  Gauge,
  Gear,
  Globe,
  House,
  Kanban,
  Lightning,
  ListChecks,
  MapPin,
  Package,
  Receipt,
  Scales,
  ShoppingCart,
  Star,
  Table,
  Tag,
  Truck,
  User,
  Users,
  Wrench,
} as const satisfies Record<string, Glyphe>

/** Le nom d'un glyphe de la table, celui de Phosphor (« ChartBar »). */
export type GlypheDeLHote = keyof typeof GLYPHES_DE_L_HOTE

/** Le glyphe d'un écran de l'hôte qui n'en nomme aucun : une fenêtre d'application. */
export const GLYPHE_DE_L_HOTE_PAR_DEFAUT: GlypheDeLHote = "AppWindow"
