import { describe, expect, it } from "vitest"
import type { AccountView, ConnectorAccountForm } from "@otomata_tech/oto_platform/schemas"
import { etatDuCompte } from "../../packages/plateforme/ui/admin/connecteurs/etat-du-compte"
import { adresseDeLaVue, comptesAuxPartagesLus, lignesDesConnecteurs, vueDesConnecteurs, type VueDesConnecteurs } from "../../packages/plateforme/ui/admin/connecteurs/lignes-des-connecteurs"

// L'état d'un compte et les lignes de la liste de l'écran Connecteurs : fonctions pures, sur des comptes en mémoire.

const MOI = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const PAUL = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ICI = "/admin/connectors"

const CLE: ConnectorAccountForm = { connector: "crm", label: "Crm Pro", ownerKinds: ["org", "team", "user"], probe: { available: true, balance: false }, fields: [{ name: "api_key", label: "Clé d'API", secret: true }], settings: [] }
const CONSENTEMENT: ConnectorAccountForm = { connector: "microsoft", label: "Microsoft 365", consent: true, ownerKinds: ["user"], probe: { available: false, balance: false }, fields: [], settings: [] }
const RATTACHE: ConnectorAccountForm = { connector: "reseau", label: "Réseau", hosted: { ready: true }, ownerKinds: ["user"], probe: { available: false, balance: false }, fields: [], settings: [] }

let rang = 0
function compte(champs: Partial<AccountView>): AccountView {
  rang += 1
  return { id: `00000000-0000-4000-8000-${String(rang).padStart(12, "0")}`, label: `Compte ${rang}`, connector: "crm", owner: { kind: "org" }, mode: "reel", status: "active", secret: { fields: ["api_key"], updatedAt: "2026-11-02T09:00:00.000Z" }, viewerLevel: "manage", description: null, lastProbe: null, ...champs }
}

const A_MOI: AccountView["owner"] = { kind: "user", userId: MOI, userName: "Léa Bernard" }
const A_PAUL: AccountView["owner"] = { kind: "user", userId: PAUL, userName: "Paul Durand" }

describe("etatDuCompte", () => {
  it("should say each state in one word, with the gesture that repairs it for whoever may make it, and none for the others", () => {
    const marque = { reason: "credential_rejected", at: "2026-11-05T09:00:00.000Z" } as const
    const cas: [string, AccountView, ConnectorAccountForm | undefined][] = [
      ["sain", compte({}), CLE],
      ["simulé", compte({ connector: "mail", mode: "simule", secret: { fields: [], updatedAt: null } }), undefined],
      ["sans clé, géré", compte({ secret: { fields: [], updatedAt: null } }), CLE],
      ["sans clé, lu", compte({ secret: { fields: [], updatedAt: null }, viewerLevel: "write" }), CLE],
      ["jamais connecté, à moi", compte({ connector: "microsoft", owner: A_MOI, secret: { fields: [], updatedAt: null } }), CONSENTEMENT],
      ["jamais connecté, à un autre", compte({ connector: "microsoft", owner: A_PAUL, secret: { fields: [], updatedAt: null }, viewerLevel: "read" }), CONSENTEMENT],
      ["à reconnecter, à moi", compte({ connector: "microsoft", owner: A_MOI, status: "error" }), CONSENTEMENT],
      ["à reconnecter, à un autre", compte({ connector: "microsoft", owner: A_PAUL, status: "error", viewerLevel: "read" }), CONSENTEMENT],
      ["à reconnecter, rattaché", compte({ connector: "reseau", owner: A_MOI, status: "error" }), RATTACHE],
      ["à reconnecter, rattaché sans port", compte({ connector: "reseau", owner: A_MOI, status: "error" }), { ...RATTACHE, hosted: { ready: false } }],
      ["clé refusée, géré", compte({ mark: marque }), CLE],
      ["clé refusée, lu", compte({ mark: marque, viewerLevel: "sensitive" }), CLE],
      ["refusé, à consentement", compte({ connector: "microsoft", owner: A_MOI, mark: marque }), CONSENTEMENT],
      ["refusé puis reconnecté", compte({ connector: "microsoft", owner: A_MOI, mark: marque, secret: { fields: [], updatedAt: "2026-11-05T09:00:01.000Z" } }), CONSENTEMENT],
      ["clé refusée puis remplacée", compte({ mark: marque, secret: { fields: ["api_key"], updatedAt: "2026-11-05T09:00:01.000Z" } }), CLE],
      ["clé refusée à l'instant de sa saisie", compte({ mark: marque, secret: { fields: ["api_key"], updatedAt: marque.at } }), CLE],
      ["crédits épuisés", compte({ mark: { reason: "quota_exhausted", at: "2026-11-05T09:00:00.000Z" } }), CLE],
      ["désactivé", compte({ status: "disabled", mark: marque }), CLE],
    ]
    const lus = cas.map(([nom, un, formulaire]) => {
      const { mot, precision, geste, demandeUnGeste } = etatDuCompte(un, formulaire, MOI)
      return [nom, mot, precision, geste, demandeUnGeste]
    })
    expect(lus).toEqual([
      ["sain", "Non testé", null, null, false],
      ["simulé", "Non testé", "Connecteur simulé : rien ne sort du serveur.", null, false],
      ["sans clé, géré", "À terminer", "Aucune clé saisie.", "saisir", true],
      ["sans clé, lu", "À terminer", "Aucune clé saisie.", null, true],
      ["jamais connecté, à moi", "À terminer", "Pas encore connecté au service.", "connecter", true],
      ["jamais connecté, à un autre", "À terminer", "Pas encore connecté au service.", null, true],
      ["à reconnecter, à moi", "À reconnecter", "La connexion au service est à refaire.", "reconnecter", true],
      ["à reconnecter, à un autre", "À reconnecter", "Demandez à Paul Durand de le reconnecter.", null, true],
      ["à reconnecter, rattaché", "À reconnecter", "La connexion au service est à refaire.", "reconnecter", true],
      ["à reconnecter, rattaché sans port", "À reconnecter", "La connexion au service est à refaire.", null, true],
      ["clé refusée, géré", "Clé refusée", "Refusée par le service le 5 novembre 2026.", "remplacer", true],
      ["clé refusée, lu", "Clé refusée", "Refusée par le service le 5 novembre 2026.", null, true],
      ["refusé, à consentement", "À reconnecter", "La connexion au service est à refaire.", "reconnecter", true],
      ["refusé puis reconnecté", "Non testé", null, null, false],
      ["clé refusée puis remplacée", "Non testé", null, null, false],
      ["clé refusée à l'instant de sa saisie", "Clé refusée", "Refusée par le service le 5 novembre 2026.", "remplacer", true],
      ["crédits épuisés", "Crédits épuisés", "Depuis le 5 novembre 2026. La clé reste bonne.", null, true],
      ["désactivé", "Désactivé", null, null, false],
    ])
  })
})

describe("lignesDesConnecteurs", () => {
  const prive = compte({ label: "Écritures", owner: A_MOI })
  const partage = compte({ label: "Banque", owner: A_MOI })
  const dePaul = compte({ label: "Agenda de Paul", owner: A_PAUL, viewerLevel: "read" })
  const dEquipe = compte({ label: "Zoho Ventes", owner: { kind: "team", teamName: "Ventes" }, viewerLevel: "write" })
  const dOrganisation = compte({ label: "Annuaire", owner: { kind: "org" }, viewerLevel: "sensitive" })
  const aTerminer = compte({ label: "Zèbre", owner: { kind: "org" }, secret: { fields: [], updatedAt: null } })
  const desactive = compte({ label: "Ancien", owner: A_MOI, status: "disabled" })
  // Écrits hors de l'ordre attendu : le tri, pas la lecture, range la liste.
  const comptes = [dOrganisation, desactive, aTerminer, prive, dEquipe, partage, dePaul]
  const partages = {
    [partage.id]: {
      general: { id: "r0", level: "read" as const },
      rules: [
        { id: "r1", subject: { kind: "team" as const, id: "t1", name: "Finance" }, level: "read" as const },
        { id: "r2", subject: { kind: "user" as const, id: PAUL, name: "Paul Durand" }, level: "write" as const },
      ],
    },
    [prive.id]: { general: null, rules: [] },
  }
  const sources = { comptes, formulaires: [CLE], partages, moi: MOI, ici: ICI }
  const vue = (champs: Partial<VueDesConnecteurs> = {}): VueDesConnecteurs => ({ filtre: "all", q: "", compte: null, ...champs })
  const libelles = (une: VueDesConnecteurs) => lignesDesConnecteurs(sources, une).lignes.map((ligne) => ligne.libelle)

  it("should put first the accounts waiting for a gesture, then the others by label, the disabled ones last", () => {
    expect(libelles(vue())).toEqual(["Zèbre", "Agenda de Paul", "Annuaire", "Banque", "Écritures", "Zoho Ventes", "Ancien"])
  })

  it("should keep the person's own accounts under « À moi », every other under « Partagés avec moi », and count each filter before the search", () => {
    expect(libelles(vue({ filtre: "mine" }))).toEqual(["Banque", "Écritures", "Ancien"])
    expect(libelles(vue({ filtre: "shared" }))).toEqual(["Zèbre", "Agenda de Paul", "Annuaire", "Zoho Ventes"])
    expect(lignesDesConnecteurs(sources, vue({ filtre: "mine", q: "banque" })).comptes).toEqual({ tous: 7, moi: 3, partages: 4 })
  })

  it("should search the label and the readable name of the tool, without case nor accent", () => {
    expect(libelles(vue({ q: "ecrit" }))).toEqual(["Écritures"])
    expect(libelles(vue({ q: "ZÈBRE" }))).toEqual(["Zèbre"])
    expect(libelles(vue({ q: "crm pro" }))).toHaveLength(7)
    expect(libelles(vue({ q: "introuvable" }))).toEqual([])
  })

  it("should say who has access: private, the first subject then the count, who shares it, the team or the whole organisation, with the person's level", () => {
    const acces = Object.fromEntries(lignesDesConnecteurs(sources, vue()).lignes.map((ligne) => [ligne.libelle, [ligne.acces, ligne.niveau]]))
    expect(acces).toEqual({
      Écritures: ["Privé", "Vous seul"],
      Banque: ["Toute l'organisation +2", "Partagé par vous"],
      Ancien: ["Privé", "Vous seul"],
      "Agenda de Paul": ["Partagé par Paul Durand", "Lecture seule"],
      "Zoho Ventes": ["Équipe Ventes", "Lecture et écriture"],
      Annuaire: ["Toute l'organisation", "Toutes les actions"],
      Zèbre: ["Toute l'organisation", "Gestion"],
    })
  })

  it("should give a line the readable name of its tool, one gesture at most, and the address that opens its detail with the view kept", () => {
    const [premiere, ...autres] = lignesDesConnecteurs(sources, vue({ filtre: "shared", q: "z" })).lignes
    expect(premiere).toMatchObject({ libelle: "Zèbre", outil: "Crm Pro", geste: { genre: "detail", libelle: "Saisir la clé" }, ouverture: `${ICI}?filter=shared&q=z&connector=${aTerminer.id}` })
    expect(autres.map((ligne) => ligne.geste)).toEqual([null])
  })
})

describe("vueDesConnecteurs", () => {
  it("should read the filter, the search and the open account from the query, and fall back on an unknown value", () => {
    expect(vueDesConnecteurs({ filter: "mine", q: "  crm ", connector: "abc" })).toEqual({ filtre: "mine", q: "crm", compte: "abc" })
    expect(vueDesConnecteurs({ filter: "autre", q: ["a", "b"] })).toEqual({ filtre: "all", q: "", compte: null })
    expect(adresseDeLaVue(ICI, { filtre: "all", q: "", compte: null })).toBe(ICI)
  })

  it("should read the shares of the person's own accounts and of the open account they manage, never of another", () => {
    const mien = compte({ owner: A_MOI })
    const gere = compte({ owner: { kind: "org" } })
    const lu = compte({ owner: A_PAUL, viewerLevel: "read" })
    const ids = (ouvert: string | null) => comptesAuxPartagesLus([mien, gere, lu], MOI, ouvert).map((un) => un.id)
    expect(ids(null)).toEqual([mien.id])
    expect(ids(gere.id)).toEqual([mien.id, gere.id])
    expect(ids(lu.id)).toEqual([mien.id])
  })
})
