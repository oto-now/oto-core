// Les mots de la page de connexion d'un connecteur (`/connect/<connecteur>`, `connexion-par-l-agent.md` § Page). Une
// seule table, lue par l'écran et ses îlots (`portage-ecrans.md § 6`).

export const CONNEXION_D_UN_CONNECTEUR = {
  titre: (outil: string) => `Connecter ${outil}`,
  description: "Votre assistant vous a envoyé ici : un seul geste, et il pourra s'en servir.",
  ilot: "La connexion",
  impossible: "Connexion impossible",
  /** Le titre qu'on annonce : l'ancre du focus après l'activation. */
  ancre: "connexion-d-un-connecteur-titre",
  reussi: (compte: string) => `« ${compte} » est connecté.`,
  revenir: "Vous pouvez revenir à votre assistant et lui demander de reprendre.",
  echec: (raison: string) => `La connexion n'a pas abouti${raison ? ` (${raison})` : ""}.`,
  reessayer: "Réessayer",
  cle: (outil: string) => `Collez la clé de ${outil} ; elle part chiffrée, et ne se réaffiche jamais.`,
  activation: (outil: string) => `${outil} n'est pas activé dans l'organisation. En tant qu'administrateur, confirmez son activation : ses fonctions deviendront disponibles, puis vous connecterez un compte.`,
  activer: (outil: string) => `Activer ${outil}`,
  administrateurs: (outil: string, noms: string) =>
    `Seul un administrateur de l'organisation peut activer ${outil} ou y connecter ce compte${noms ? ` : ${noms}` : ""}. Transmettez-lui ce lien :`,
  lien: "le lien de connexion",
} as const
