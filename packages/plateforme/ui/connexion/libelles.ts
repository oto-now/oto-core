// Les mots du guide de branchement (E11-S09), dans la fenêtre de l'accueil et sur `/connect` : un onglet
// par assistant, ses étapes, ses liens. Constantes du paquet, jamais un texte venu du service
// (`portage-ecrans.md § 4`) ; les gestes sont ceux mesurés sur les bancs (`mcp-patterns.md § 8`, § 9).

import type { AdresseDeConnexion } from "./types"

/** Un morceau de texte d'une étape ; `code` : une commande lue telle quelle (`/mcp`). */
export type Segment = string | { code: string }

export type EtapeDuGuide = {
  texte: (valeurs: AdresseDeConnexion) => readonly Segment[]
  /** Le lien direct vers la page de l'assistant, ouvert dans un nouvel onglet (AC-8). */
  lien?: { href: string; libelle: string }
  /** Les deux champs à renseigner : « Nom » (le nom, ou le préfixe là où les espaces sont refusés) et « Adresse ». */
  champs?: { nom: "nom" | "nomCli" }
  /** Une valeur à coller, avec ce que copie son bouton. */
  copie?: { valeur: (valeurs: AdresseDeConnexion) => string; cible: string }
  /** La dernière étape : « C'est branché. » en tête, puis les demandes à essayer (AC-7). */
  branche?: true
  note?: string
}

const texte =
  (...segments: Segment[]) =>
  () =>
    segments

/** Les onglets, dans l'ordre de la barre (AC-1) ; chaque clé est aussi le nom de la famille au journal (AC-2). */
export const ASSISTANTS = ["claude.ai", "ChatGPT", "Mistral", "Claude Code"] as const
export type Assistant = (typeof ASSISTANTS)[number]

export const GUIDE = {
  intro: (nom: string) => `Ajoutez ${nom} à votre assistant : il agira avec votre compte, dans la limite de vos droits.`,
  onglets: "Votre assistant",
  nom: "Nom",
  adresse: "Adresse",
  copierNom: "le nom du connecteur",
  copierAdresse: "l'adresse du serveur",
  branche: "C'est branché.",
  /** Dit à la fin du nom d'un lien qui ouvre un autre site (AC-8). */
  nouvelOnglet: " (nouvel onglet)",
  copierDemande: (demande: string) => `la demande « ${demande} »`,
} as const

/** Complètent les titres des procédures jusqu'à trois demandes, dans cet ordre (AC-7). */
export const EXEMPLES_GENERIQUES = ["Qu'est-ce que je peux te demander ici ?", "Quelles procédures puis-je lancer ?", "Résume ce qui a changé cette semaine."] as const

const CONNEXION = ({ nom }: AdresseDeConnexion) => [`Connectez-vous avec votre compte ${nom}, puis cliquez sur « Autoriser ».`]
const DEMANDES = "Ouvrez une nouvelle conversation et commencez par l'une de ces demandes :"
const DEUX_CHAMPS = "Renseignez ces deux champs :"

/**
 * Les liens directs (HN-E11S09-3) : claude.ai et Le Chat relevés dans leur aide ; celui de ChatGPT n'est
 * donné par aucune page d'OpenAI, à relire au banc.
 */
export const LIENS = {
  claudeAi: "https://claude.ai/customize/connectors",
  chatGpt: "https://chatgpt.com/#settings/Connectors",
  mistral: "https://chat.mistral.ai/connections",
} as const

export const ETAPES: Record<Assistant, readonly EtapeDuGuide[]> = {
  "claude.ai": [
    {
      texte: texte("Dans claude.ai, ouvrez Paramètres → Connecteurs, puis ajoutez un connecteur personnalisé."),
      lien: { href: LIENS.claudeAi, libelle: "Ouvrir les connecteurs de claude.ai" },
      note: "Le connecteur servira aussi dans Claude Desktop et l'application mobile.",
    },
    { texte: texte(DEUX_CHAMPS), champs: { nom: "nom" } },
    { texte: CONNEXION },
    {
      texte: texte("Ajoutez cette phrase à vos préférences personnelles de claude.ai :"),
      // Sans note pour qui a plusieurs Oto : la dernière ligne de la phrase ne fait charger que celui que la demande concerne.
      copie: { valeur: ({ phrase }) => phrase, cible: "la phrase de préférences" },
    },
    { texte: texte(DEMANDES), branche: true, note: "Le connecteur n'apparaît pas ? Rechargez la page." },
  ],
  ChatGPT: [
    {
      texte: texte("Dans ChatGPT, ouvrez Paramètres → Applications → Paramètres avancés, puis activez le mode développeur."),
      lien: { href: LIENS.chatGpt, libelle: "Ouvrir les paramètres de ChatGPT" },
      note: "Le mode développeur n'existe pas dans l'offre gratuite de ChatGPT.",
    },
    { texte: texte("Créez une application avec ces deux champs, authentification OAuth :"), champs: { nom: "nom" } },
    { texte: CONNEXION },
    { texte: texte("Sur la fiche de l'application, cliquez sur « Actualiser » : sans ce geste, aucun outil n'apparaît.") },
    {
      texte: ({ nom }) => [`Dans une nouvelle conversation, choisissez « Mode développeur » puis ${nom} dans le menu +, et commencez par l'une de ces demandes :`],
      branche: true,
    },
  ],
  Mistral: [
    {
      texte: texte("Dans Le Chat, ouvrez Connecteurs, cliquez sur « Ajouter un connecteur », puis choisissez l'onglet « Connecteur MCP personnalisé »."),
      lien: { href: LIENS.mistral, libelle: "Ouvrir les connecteurs de Le Chat" },
    },
    { texte: texte(DEUX_CHAMPS), champs: { nom: "nomCli" }, note: "Le Chat refuse les espaces dans un nom : gardez ce nom court." },
    { texte: ({ nom }) => [`Cliquez sur « Connecter », connectez-vous avec votre compte ${nom}, puis cliquez sur « Autoriser ».`] },
    { texte: texte(DEMANDES), branche: true },
  ],
  "Claude Code": [
    {
      texte: texte("Dans un terminal, ajoutez le serveur :"),
      copie: { valeur: ({ nomCli, url }) => `claude mcp add --transport http ${nomCli} ${url}`, cible: "la commande d'ajout du serveur" },
    },
    {
      texte: texte("Connectez-vous :"),
      copie: { valeur: ({ nomCli }) => `claude mcp login ${nomCli}`, cible: "la commande de connexion" },
      note: "Le navigateur s'ouvre pour la connexion et l'autorisation.",
    },
    {
      texte: texte("Ouvrez une nouvelle session (", { code: "/mcp" }, " montre l'état du serveur) et commencez par l'une de ces demandes :"),
      branche: true,
    },
  ],
}
