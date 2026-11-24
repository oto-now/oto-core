// Les mots de la page de connexion d'un connecteur (`/connect/<connecteur>`, `connexion-par-l-agent.md` § Page). Une
// seule table, lue par l'écran et ses îlots (`portage-ecrans.md § 6`).

export const CONNEXION_D_UN_CONNECTEUR = {
  titre: (outil: string) => `Connecter ${outil}`,
  description: "Votre assistant vous a envoyé ici : un seul geste, et il pourra s'en servir.",
  ilot: "La connexion",
  impossible: "Connexion impossible",
  /** Le titre qu'on annonce : l'ancre du focus après l'activation. */
  ancre: "connexion-d-un-connecteur-titre",
  /** Le succès, sans le nom que porte l'adresse : un lien forgé l'écrirait. */
  reussi: "Le compte est connecté.",
  /** Le compte que le service vient de créer, nommé par sa réponse (jamais par l'adresse). */
  compteConnecte: (compte: string) => `« ${compte} » est connecté.`,
  revenir: "Vous pouvez revenir à votre assistant et lui demander de reprendre.",
  consentement: (outil: string) => `Autorisez l'accès à ${outil} chez son éditeur : vous y partez, puis vous revenez ici.`,
  autoriser: (outil: string) => `Autoriser ${outil}`,
  branchement: (outil: string) => `Connectez votre compte ${outil} chez son éditeur : vous y partez, puis vous revenez ici.`,
  brancher: (outil: string) => `Connecter mon compte ${outil}`,
  /** Le compte hébergé déjà relié ailleurs : le clic le relie ici, sans repasser chez le tiers. */
  ailleurs: (outil: string, organisations: string) =>
    `Votre compte ${outil} est déjà utilisé dans ${organisations}. Le bouton le relie aussi à cette organisation.`,
  relier: (outil: string) => `Relier mon compte ${outil}`,
  /** Une organisation où le compte est relié, dont la personne ne lit plus le nom (elle l'a quittée). */
  autreOrganisation: "une autre organisation",
  reessayer: "Réessayer",
  cle: (outil: string) => `Collez la clé de ${outil} ; elle part chiffrée, et ne se réaffiche jamais.`,
  cleDuCompte: (outil: string, compte: string) =>
    `Collez la clé de ${outil} du compte « ${compte} » ; elle remplace l'ancienne, part chiffrée, et ne se réaffiche jamais.`,
  cleEnregistree: (compte: string) => `La clé de « ${compte} » est enregistrée.`,
  activation: (outil: string) => `${outil} n'est pas activé dans l'organisation. En tant qu'administrateur, confirmez son activation : ses fonctions deviendront disponibles, puis vous connecterez un compte.`,
  activer: (outil: string) => `Activer ${outil}`,
  administrateurs: (outil: string, noms: string) =>
    `Seul un administrateur de l'organisation peut activer ${outil} ou y connecter ce compte${noms ? ` : ${noms}` : ""}. Transmettez-lui ce lien :`,
  lien: "le lien de connexion",
  /** Un connecteur à plusieurs accès : la personne choisit le sien, jamais pris à sa place. */
  choisir: (outil: string) => `${outil} se connecte de plusieurs façons. Choisissez la vôtre :`,
  autres: "Ou connectez-vous autrement :",
  listeDesAcces: "Les façons de se connecter",
  geste: { oauth: "autoriser l'accès chez l'éditeur", key: "coller une clé", hosted_link: "connecter votre compte chez l'éditeur" },
} as const
