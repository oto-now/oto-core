import { describe, expect, it } from "vitest"
import type { ConnectorAccountForm, OrgConnector } from "@otomata_tech/oto_platform/schemas"
import { nomLibre, outilsAAjouter, outilsCherches } from "../../packages/plateforme/ui/admin/connecteurs/catalogue-des-connecteurs"

// Le catalogue de la fenêtre « Ajouter un connecteur » : fonctions pures, sur des connecteurs en mémoire.

function connecteur(nom: string, label: string, champs: Partial<OrgConnector> = {}): OrgConnector {
  return { connector: nom, label, state: "active", activatedAt: null, activatedBy: null, functions: [], closedBy: null, ...champs }
}

function formulaire(nom: string, champs: Partial<ConnectorAccountForm>): ConnectorAccountForm {
  return { connector: nom, label: nom, ownerKinds: ["org", "team", "user"], probe: { available: true, balance: false }, fields: [], settings: [], ...champs }
}

const CONNECTEURS = [
  connecteur("mail", "mail"),
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

describe("outilsAAjouter", () => {
  it("should give a member the tools that admit a personal account, by name, and an administrator the organisation's and the teams' too", () => {
    const lus = (administre: boolean) => outilsAAjouter(CONNECTEURS, FORMULAIRES, administre).map((outil) => [outil.libelle, outil.facon, outil.proprietaires, outil.ferme])
    expect({ membre: lus(false), administrateur: lus(true) }).toEqual({
      // Ni « mail » (sans formulaire) ni « Paie » (organisation et équipes seulement) ; « Réseau » n'a pas son port.
      membre: [
        ["Crm Pro", "saisie", ["user"], false],
        ["Écritures", "saisie", ["user"], false],
        ["Messagerie", "branchement", ["user"], false],
        ["Microsoft 365", "consentement", ["user"], false],
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
})

describe("outilsCherches", () => {
  it("should keep the tools whose name holds the text, without case nor accent, and all of them for an empty text", () => {
    const outils = outilsAAjouter(CONNECTEURS, FORMULAIRES, true)
    const noms = (q: string) => outilsCherches(outils, q).map((outil) => outil.libelle)
    expect([noms("CRM"), noms("ecrit"), noms("reseau"), noms("  ").length]).toEqual([["Crm Pro"], ["Écritures"], [], 6])
  })
})

describe("nomLibre", () => {
  it("should propose the name of the tool, or the first free rank after it, whatever the case", () => {
    expect([nomLibre("Crm Pro", []), nomLibre("Crm Pro", ["crm pro"]), nomLibre("Crm Pro", ["Crm Pro", "CRM PRO 2", "Autre"])]).toEqual(["Crm Pro", "Crm Pro 2", "Crm Pro 3"])
  })
})
