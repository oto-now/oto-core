import { describe, expect, it } from "vitest"
import type { AccountOwnerChoices, ConnectorAccountForm, OrgConnector } from "@otomata_tech/oto_platform/schemas"
import { cleDeLOutil, nomLibre, outilsAAjouter, outilsCherches } from "../../packages/plateforme/ui/admin/connecteurs/catalogue-des-connecteurs"

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
    const lus = (choix: AccountOwnerChoices) => outilsAAjouter(CONNECTEURS, FORMULAIRES, choix).map((outil) => [outil.libelle, outil.facon, outil.proprietaires, outil.ferme])
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
      // Un outil connecté chez le tiers ne se connecte que pour soi ; un outil fermé le dit.
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

  it("should create the account in the mode the connector admits", () => {
    const modes = outilsAAjouter(CONNECTEURS, FORMULAIRES, ADMINISTRATEUR).map((outil) => [outil.connecteur, outil.mode])
    expect(modes).toContainEqual(["mail", "simule"])
    expect(modes).toContainEqual(["crm", "reel"])
  })
})

describe("outilsAAjouter, connecteur à plusieurs accès", () => {
  const console = connecteur("console", "Search Console")
  const FORMULAIRES_DE_LA_CONSOLE = [
    formulaire("console", { label: "Search Console", access: { name: "service_account", label: "Service account of the organization" }, consent: false, ownerKinds: ["org", "team"], fields: [{ name: "service_account_key", label: "Clé", secret: true }] }),
    formulaire("console", { label: "Search Console", access: { name: "google_account", label: "Sign-in of a person" }, consent: true, ownerKinds: ["user"] }),
  ]

  it("should give one tool per access, said by how one connects and for whom, never by the label of the access: a key to enter for the organisation, and Connect my account", () => {
    const outils = outilsAAjouter([console], FORMULAIRES_DE_LA_CONSOLE, ADMINISTRATEUR)
    expect(outils.map((outil) => [cleDeLOutil(outil), outil.acces, outil.facon, outil.proprietaires])).toEqual([
      ["console:google_account", { nom: "google_account", libelle: "Avec mon compte Search Console" }, "consentement", ["user"]],
      ["console:service_account", { nom: "service_account", libelle: "Avec une clé, pour l'organisation" }, "saisie", ["org", "team"]],
    ])
  })

  it("should say a key for oneself, a key for anyone, and tell apart by their label two accesses that would read the same", () => {
    const cle = (name: string, label: string, ownerKinds: ConnectorAccountForm["ownerKinds"]) => formulaire("console", { label: "Search Console", access: { name, label }, ownerKinds, fields: [{ name: "key", label: "Clé", secret: true }] })
    const dites = (formulaires: ConnectorAccountForm[]) => outilsAAjouter([console], formulaires, ADMINISTRATEUR).map((outil) => outil.acces?.libelle)
    expect([
      dites([cle("personal", "Personal key", ["user"]), cle("shared", "Any key", ["org", "team", "user"])]),
      dites([cle("api_key", "API key", ["org", "team"]), cle("service_account", "Service account", ["org", "team"])]),
    ]).toEqual([
      ["Avec ma clé", "Avec une clé"],
      ["Avec une clé, pour l'organisation (API key)", "Avec une clé, pour l'organisation (Service account)"],
    ])
  })

  it("should give a member only the access that admits a personal account", () => {
    expect(outilsAAjouter([console], FORMULAIRES_DE_LA_CONSOLE, MEMBRE).map(cleDeLOutil)).toEqual(["console:google_account"])
  })

  it("should keep the tool of a connector with a single access without access, keyed by its connector", () => {
    const [crm] = outilsAAjouter([connecteur("crm", "Crm Pro")], [formulaire("crm", {})], ADMINISTRATEUR)
    expect([cleDeLOutil(crm), "acces" in crm]).toEqual(["crm", false])
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
})
