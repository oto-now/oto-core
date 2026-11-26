import { describe, expect, it } from "vitest"
import type { AccountOwnerChoices, ConnectorAccountForm, OrgConnector } from "@otomata_tech/oto_platform/schemas"
import { nomLibre, outilsAAjouter, outilsCherches } from "../../packages/plateforme/ui/admin/connecteurs/catalogue-des-connecteurs"

// Le catalogue de la fenêtre « Ajouter un connecteur » : fonctions pures, sur des connecteurs en mémoire.

function connecteur(nom: string, label: string, champs: Partial<OrgConnector> = {}): OrgConnector {
  return { connector: nom, label, state: "active", activatedAt: null, activatedBy: null, functions: [], closedBy: null, accountModes: ["reel"], ...champs }
}

function formulaire(nom: string, champs: Partial<ConnectorAccountForm>): ConnectorAccountForm {
  return { connector: nom, label: nom, ownerKinds: ["org", "team", "user"], probe: { available: true, balance: false }, fields: [], settings: [], ...champs }
}

const CONNECTEURS = [
  connecteur("mail", "mail", { accountModes: ["simule"] }),
  connecteur("crm", "Crm Pro"),
  connecteur("paie", "Paie", { state: "inactive", closedBy: { userId: "u", name: null } }),
  connecteur("microsoft", "Microsoft 365"),
  connecteur("reseau", "Réseau"),
  connecteur("messagerie", "Messagerie"),
  connecteur("ecritures", "Écritures"),
]

const FORMULAIRES = [
  formulaire("crm", {}),
  formulaire("paie", { ownerKinds: ["org", "team"] }),
  formulaire("microsoft", { consent: true, ownerKinds: ["user"] }),
  formulaire("reseau", { hosted: { ready: false }, ownerKinds: ["user"] }),
  formulaire("messagerie", { hosted: { ready: true }, ownerKinds: ["user"] }),
  formulaire("ecritures", { ownerKinds: ["user"] }),
]

const EQUIPE = { id: "equipe", name: "Ventes" }
const MEMBRE: AccountOwnerChoices = { user: true, org: false, teams: [] }
const RESPONSABLE: AccountOwnerChoices = { user: true, org: false, teams: [EQUIPE] }
const ADMINISTRATEUR: AccountOwnerChoices = { user: true, org: true, teams: [EQUIPE] }

describe("outilsAAjouter", () => {
  it("should give a member the tools that admit a personal account, by name, a team lead the teams' too, and an administrator the organisation's", () => {
    const lus = (choix: AccountOwnerChoices) => outilsAAjouter(CONNECTEURS, FORMULAIRES, choix).map((outil) => [outil.libelle, outil.facon, outil.proprietaires, outil.bloquePar !== null])
    expect({ membre: lus(MEMBRE), responsable: lus(RESPONSABLE), administrateur: lus(ADMINISTRATEUR) }).toEqual({
      // Ni « mail » (sans formulaire) ni « Paie » (organisation et équipes seulement) ; « Réseau » n'a pas son port.
      membre: [
        ["Crm Pro", "saisie", ["user"], false],
        ["Écritures", "saisie", ["user"], false],
        ["Messagerie", "branchement", ["user"], false],
        ["Microsoft 365", "consentement", ["user"], false],
      ],
      // Qui dirige une équipe ajoute pour elle, jamais pour l'organisation.
      responsable: [
        ["Crm Pro", "saisie", ["user", "team"], false],
        ["Écritures", "saisie", ["user"], false],
        ["mail", "sans_cle", ["team"], false],
        ["Messagerie", "branchement", ["user"], false],
        ["Microsoft 365", "consentement", ["user"], false],
        ["Paie", "saisie", ["team"], true],
      ],
      // Un outil connecté chez le tiers ne se connecte que pour soi ; un outil bloqué le dit.
      administrateur: [
        ["Crm Pro", "saisie", ["user", "org", "team"], false],
        ["Écritures", "saisie", ["user"], false],
        ["mail", "sans_cle", ["org", "team"], false],
        ["Messagerie", "branchement", ["user"], false],
        ["Microsoft 365", "consentement", ["user"], false],
        ["Paie", "saisie", ["org", "team"], true],
      ],
    })
  })

  it("should count the person's own connectors of each tool, those that work apart, and say who blocked a closed tool", () => {
    const mes = [
      { id: "c1", connecteur: "crm", libelle: "Crm Pro", fonctionne: true },
      { id: "c2", connecteur: "crm", libelle: "Crm Pro 2", fonctionne: false },
      { id: "e1", connecteur: "ecritures", libelle: "Écritures", fonctionne: true },
    ]
    const lus = outilsAAjouter(CONNECTEURS, FORMULAIRES, ADMINISTRATEUR, mes).map((outil) => [outil.connecteur, outil.miens, outil.connectes, outil.bloquePar])
    expect(lus.filter(([connecteur]) => ["crm", "ecritures", "mail", "paie"].includes(String(connecteur)))).toEqual([
      ["crm", ["Crm Pro", "Crm Pro 2"], 1, null],
      ["ecritures", ["Écritures"], 1, null],
      ["mail", [], 0, null],
      ["paie", [], 0, { userId: "u", name: null }],
    ])
  })

  it("should create the account in the mode the connector admits", () => {
    const modes = outilsAAjouter(CONNECTEURS, FORMULAIRES, ADMINISTRATEUR).map((outil) => [outil.connecteur, outil.mode])
    expect(modes).toContainEqual(["mail", "simule"])
    expect(modes).toContainEqual(["crm", "reel"])
  })
})

describe("outilsAAjouter, connecteur à plusieurs accès", () => {
  const console = connecteur("console", "Search Console")
  const FORMULAIRES_DE_LA_CONSOLE = [
    formulaire("console", { access: { name: "service_account", label: "Compte de service" }, consent: false, ownerKinds: ["org", "team"], fields: [{ name: "service_account_key", label: "Clé", secret: true }] }),
    formulaire("console", { access: { name: "google_account", label: "Compte Google" }, consent: true, ownerKinds: ["user"] }),
  ]

  it("should give one tool per connector, the first way of its ways open to the person, oneself first, each said by how it connects and for whom", () => {
    const lus = (choix: AccountOwnerChoices) =>
      outilsAAjouter([console], FORMULAIRES_DE_LA_CONSOLE, choix).map((outil) => ({
        outil: [outil.connecteur, outil.acces?.nom, outil.facon],
        facons: (outil.facons ?? []).map((facon) => [facon.acces.nom, facon.facon, facon.proprietaires, facon.phrase]),
      }))
    expect({ administrateur: lus(ADMINISTRATEUR), responsable: lus(RESPONSABLE), membre: lus(MEMBRE) }).toEqual({
      administrateur: [
        {
          outil: ["console", "google_account", "consentement"],
          facons: [
            ["google_account", "consentement", ["user"], "Avec mon compte Search Console"],
            ["service_account", "saisie", ["org", "team"], "Avec une clé, pour l'organisation"],
          ],
        },
      ],
      responsable: [
        {
          outil: ["console", "google_account", "consentement"],
          facons: [
            ["google_account", "consentement", ["user"], "Avec mon compte Search Console"],
            ["service_account", "saisie", ["team"], "Avec une clé, pour une équipe"],
          ],
        },
      ],
      // Un membre n'a que la façon qui admet un compte personnel : une seule, sans choix.
      membre: [{ outil: ["console", "google_account", "consentement"], facons: [["google_account", "consentement", ["user"], "Avec mon compte Search Console"]] }],
    })
  })

  it("should say a key for oneself, for oneself and others, and add the declared label to two ways that would read the same", () => {
    const deuxCles = [
      formulaire("console", { access: { name: "cle_perso", label: "Personal key" }, ownerKinds: ["user"] }),
      formulaire("console", { access: { name: "cle_partagee", label: "Shared key" }, ownerKinds: ["user", "org"] }),
      formulaire("console", { access: { name: "cle_org", label: "Organization key" }, ownerKinds: ["org"] }),
      formulaire("console", { access: { name: "cle_org_bis", label: "Second organization key" }, ownerKinds: ["org", "team"] }),
    ]
    const [outil] = outilsAAjouter([console], deuxCles, ADMINISTRATEUR)
    expect((outil.facons ?? []).map((facon) => facon.phrase)).toEqual([
      "Avec ma clé",
      "Avec une clé",
      "Avec une clé, pour l'organisation (Organization key)",
      "Avec une clé, pour l'organisation (Second organization key)",
    ])
  })

  it("should keep the tool of a connector with a single access without access nor ways, keyed by its connector", () => {
    const [crm] = outilsAAjouter([connecteur("crm", "Crm Pro")], [formulaire("crm", {})], ADMINISTRATEUR)
    expect([crm.connecteur, "acces" in crm, "facons" in crm]).toEqual(["crm", false, false])
  })
})

describe("outilsCherches", () => {
  it("should keep the tools whose name holds the text, without case nor accent, and all of them for an empty text", () => {
    const outils = outilsAAjouter(CONNECTEURS, FORMULAIRES, ADMINISTRATEUR)
    const noms = (q: string) => outilsCherches(outils, q).map((outil) => outil.libelle)
    expect([noms("CRM"), noms("ecrit"), noms("reseau"), noms("  ").length]).toEqual([["Crm Pro"], ["Écritures"], [], 6])
  })
})

describe("nomLibre", () => {
  it("should propose the name of the tool, or the first free rank after it, whatever the case", () => {
    expect([nomLibre("Crm Pro", []), nomLibre("Crm Pro", ["crm pro"]), nomLibre("Crm Pro", ["Crm Pro", "CRM PRO 2", "Autre"])]).toEqual(["Crm Pro", "Crm Pro 2", "Crm Pro 3"])
  })

  it("should number a further connector of a tool after those the person already has, even named otherwise", () => {
    expect([nomLibre("Compta", ["Compta · Atelier", "Compta · SCI"], 3), nomLibre("Compta", ["Compta 3"], 3)]).toEqual(["Compta 3", "Compta 4"])
  })
})
