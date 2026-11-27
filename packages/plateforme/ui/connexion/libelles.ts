// Les mots du guide de branchement (E11-S09), dans la fenêtre de l'accueil et sur `/connect` : deux temps,
// le même pour tous les assistants, et pour le connecteur les liens directs vers l'endroit où le faire. Constantes
// du paquet, jamais un texte venu du service (`portage-ecrans.md § 4`) ; les gestes sont ceux mesurés sur
// les bancs (`mcp-patterns.md § 8`, § 9).

export const GUIDE = {
  connecteur: "Ajoutez un connecteur personnalisé",
  preferences: "Collez cette phrase dans vos préférences personnelles",
  chatGpt: "ChatGPT : mode développeur requis (offres payantes), puis « Actualiser » sur la fiche de l'application.",
  nom: "Nom",
  adresse: "Adresse",
  copierNom: "le nom du connecteur",
  copierAdresse: "l'adresse du serveur",
  copierPhrase: "la phrase de préférences",
  /** Dit à la fin du nom d'un lien qui ouvre un autre site (AC-8). */
  nouvelOnglet: " (nouvel onglet)",
} as const

/** Le lien direct d'un assistant, nommé par l'assistant, ouvert dans un nouvel onglet (AC-8). */
export type LienDirect = { assistant: string; href: string }

/** Où ajouter le connecteur (HN-E11S09-3) : la page des connecteurs de chaque assistant. */
export const LIENS_CONNECTEURS: readonly LienDirect[] = [
  { assistant: "Claude", href: "https://claude.ai/plugins?filter=connectors-only" },
  { assistant: "ChatGPT", href: "https://chatgpt.com/plugins?directoryTab=personal" },
  { assistant: "Mistral", href: "https://chat.mistral.ai/connections" },
]
