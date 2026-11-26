import { describe, expect, it } from "vitest"
import { nomDuConnecteur, type Nommage } from "../../packages/plateforme/ui/admin/connecteurs/catalogue-des-connecteurs"
import { partageDeDepart, proprietaireDuPartage, type PartageDeLAjout } from "../../packages/plateforme/ui/admin/connecteurs/partage-a-l-ajout"

// À la création d'un connecteur, le partage décide de son propriétaire, et le nom proposé suit ce propriétaire.

const VENTES = { id: "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70", name: "Ventes" }
const FINANCE = { id: "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f71", name: "Finance" }
const equipe = ({ id, name }: { id: string; name: string }) => ({ sujet: { kind: "team" as const, id, nom: name }, niveau: "read" as const })
const NADIA = { sujet: { kind: "user" as const, id: "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03", nom: "Nadia Roux" }, niveau: "read" as const }
const partage = (general: PartageDeLAjout["general"], ...regles: PartageDeLAjout["regles"]): PartageDeLAjout => ({ general, regles })

describe("proprietaireDuPartage", () => {
  it("should give the organisation to who may endow it, the one team shared to who may endow it, and keep the connector personal otherwise", () => {
    const tous = ["user", "org", "team"] as const
    const cas = {
      organisationOuverte: proprietaireDuPartage(partage("read", equipe(VENTES)), tous, [VENTES]),
      organisationSansLeDroit: proprietaireDuPartage(partage("read"), ["user", "team"], [VENTES]),
      uneEquipeDotee: proprietaireDuPartage(partage(null, equipe(VENTES), NADIA), tous, [VENTES]),
      uneEquipeNonDotee: proprietaireDuPartage(partage(null, equipe(FINANCE)), tous, [VENTES]),
      deuxEquipes: proprietaireDuPartage(partage(null, equipe(VENTES), equipe(FINANCE)), tous, [VENTES, FINANCE]),
      equipeNonAdmise: proprietaireDuPartage(partage(null, equipe(VENTES)), ["user", "org"], [VENTES]),
      personne: proprietaireDuPartage(partage(null, NADIA), tous, [VENTES]),
      rien: proprietaireDuPartage(partage(null), tous, [VENTES]),
      sansPersonneAdmise: proprietaireDuPartage(partage(null, equipe(VENTES), equipe(FINANCE)), ["org", "team"], [VENTES, FINANCE]),
    }
    expect(cas).toEqual({
      organisationOuverte: { owner_kind: "org" },
      organisationSansLeDroit: { owner_kind: "user" },
      uneEquipeDotee: { owner_kind: "team", team_id: VENTES.id, nom: "Ventes" },
      uneEquipeNonDotee: { owner_kind: "user" },
      deuxEquipes: { owner_kind: "user" },
      equipeNonAdmise: { owner_kind: "user" },
      personne: { owner_kind: "user" },
      rien: { owner_kind: "user" },
      sansPersonneAdmise: null,
    })
    // Un outil qu'aucune personne ne porte part ouvert à l'organisation, à défaut à la première équipe dotée.
    expect([partageDeDepart(tous, [VENTES]), partageDeDepart(["org", "team"], [FINANCE]), partageDeDepart(["team"], [FINANCE, VENTES])]).toEqual([partage(null), partage("read"), partage(null, equipe(FINANCE))])
  })
})

describe("nomDuConnecteur", () => {
  it("should propose a name by owner, numbered after the connectors of the tool that owner already has, and say how to tell them apart", () => {
    const outil = { connecteur: "pennylane", libelle: "Pennylane" }
    const nommage: Nommage = {
      prenom: "Nadia",
      organisation: "Mortier & Co",
      comptes: [
        { connecteur: "pennylane", libelle: "Pennylane · Mortier & Co", proprietaire: "org" },
        { connecteur: "pennylane", libelle: "Pennylane · Mortier & Co (2)", proprietaire: "org" },
        // D'un autre outil : il ne compte pas, mais son nom reste pris.
        { connecteur: "crm", libelle: "Pennylane · Ventes", proprietaire: "team:Ventes" },
        // À une autre équipe : il ne compte pas pour Ventes.
        { connecteur: "pennylane", libelle: "Pennylane · Finance", proprietaire: "team:Finance" },
      ],
    }
    const equipeVentes = { owner_kind: "team" as const, team_id: VENTES.id, nom: "Ventes" }
    expect({
      personnel: nomDuConnecteur(outil, { owner_kind: "user" }, nommage),
      sansPrenom: nomDuConnecteur(outil, { owner_kind: "user" }, { ...nommage, prenom: null }).nom,
      equipe: nomDuConnecteur(outil, equipeVentes, nommage),
      organisation: nomDuConnecteur(outil, { owner_kind: "org" }, nommage),
      organisationSansNom: nomDuConnecteur(outil, { owner_kind: "org" }, { ...nommage, organisation: null, comptes: [] }).nom,
    }).toEqual({
      personnel: { nom: "Pennylane de Nadia", aide: "C'est ce nom que vous direz à votre assistant.", deja: 0 },
      sansPrenom: "Pennylane",
      equipe: { nom: "Pennylane · Ventes (2)", aide: "C'est ce nom que l'équipe dira à son assistant.", deja: 0 },
      organisation: { nom: "Pennylane · Mortier & Co (3)", aide: "L'organisation en a déjà 2. Remplacez « (3) » par ce qui les distingue, par exemple « Pennylane · Filiale ABC ».", deja: 2 },
      organisationSansNom: "Pennylane de l'organisation",
    })
  })
})
