import { describe, expect, it } from "vitest"
import { messageDErreur } from "../../packages/plateforme/ui/api/messages"

// La table des messages des écrans (E02-S01, complétée par E05-S03) : un refus codé reçoit sa
// phrase, jamais le texte du serveur.

const refus = (code: string, raison?: string, details?: Record<string, unknown>) => ({ code, raison, statut: 409, details })

describe("messageDErreur, lines added by E05-S03", () => {
  it("should say each code and reason in French", () => {
    const lignes: [string, string, string][] = [
      ["conflict", "last_admin", "C'est le dernier administrateur de l'organisation : nommez-en un autre avant."],
      ["conflict", "name_taken", "Une équipe de l'organisation porte déjà ce nom."],
      ["conflict", "path_taken", "Une page porte déjà ce nom : choisissez-en un autre pour l'équipe."],
      ["conflict", "slug_taken", "Une autre équipe de l'organisation utilise déjà le chemin de ce nom : choisissez-en un autre."],
      ["conflict", "team_owns_objects", "L'équipe possède encore des nœuds ou des comptes : transférez-les ou supprimez-les avant."],
      ["invalid_arguments", "reserved_slug", "Ce nom est réservé : choisissez-en un autre."],
    ]
    expect(Object.fromEntries(lignes.map(([code, raison]) => [`${code} / ${raison}`, messageDErreur(refus(code, raison))]))).toEqual(
      Object.fromEntries(lignes.map(([code, raison, message]) => [`${code} / ${raison}`, message])),
    )
  })
})

describe("messageDErreur, codes of the API gate", () => {
  it("should tell someone removed while the screen was open that they are no longer part of the organisation", () => {
    // `handlePlateforme` rend `not_member` à tout geste d'une personne retirée entre-temps (AC9).
    expect(messageDErreur({ code: "not_member", statut: 403 })).toBe("Vous ne faites plus partie de cette organisation.")
  })

  it("should tell that the address no longer serves an organisation, where retrying fails the same way", () => {
    // `handlePlateforme` rend `unknown_org` avant le service : organisation supprimée, adresse détachée.
    expect(messageDErreur({ code: "unknown_org", statut: 404 })).toBe("Cette adresse ne sert plus d'organisation. Rechargez la page.")
  })
})

describe("messageDErreur, phrases of a gesture", () => {
  it("should prefer the phrase of the gesture for the reason, then for the code", () => {
    const propres = { last_admin: "C'est le dernier administrateur de Démo : nommez-en un autre avant.", not_found: "Déjà partie." }
    expect(messageDErreur(refus("conflict", "last_admin"), propres)).toBe(propres.last_admin)
    expect(messageDErreur(refus("not_found"), propres)).toBe("Déjà partie.")
    expect(messageDErreur(refus("conflict", "name_taken"), propres)).toBe("Une équipe de l'organisation porte déjà ce nom.")
  })

  // Un geste peut dire ce qu'un échec du réseau laisse en l'état (E08-S09, AC10) : `ecran-retours.test.tsx`.
  it("should keep the session message before any phrase of the gesture, and say a network failure by default", () => {
    expect(messageDErreur({ code: "reseau", statut: 0 })).toBe("La connexion au serveur a échoué. Réessayez.")
    expect(messageDErreur({ code: "forbidden", statut: 401 }, { forbidden: "x" })).toBe("Votre session a expiré. Reconnectez-vous.")
  })

  it("should list what a team still owns in place of {objets} (AC14)", () => {
    const details = { nodes: ["ventes/devis", "ventes/suivi_prospects"], accounts: ["Mail Ventes"], nodesTotal: 2, accountsTotal: 1 }
    const propres = { team_owns_objects: "Ventes possède encore : {objets}. Transférez-les ou supprimez-les avant de supprimer l'équipe." }
    expect(messageDErreur(refus("conflict", "team_owns_objects", details), propres)).toBe(
      "Ventes possède encore : ventes/devis, ventes/suivi_prospects (nœuds) ; Mail Ventes (compte). Transférez-les ou supprimez-les avant de supprimer l'équipe.",
    )
  })

  it("should name 20 objects at most, then count the others", () => {
    const nodes = Array.from({ length: 20 }, (_, rang) => `n${rang}`)
    const texte = messageDErreur(refus("conflict", "team_owns_objects", { nodes, nodesTotal: 23 }), { team_owns_objects: "{objets}" })
    expect(texte).toBe(`${nodes.join(", ")} et 3 autres (nœuds)`)
  })

  it("should say « des nœuds ou des comptes » when the refusal lists nothing", () => {
    expect(messageDErreur(refus("conflict", "team_owns_objects"), { team_owns_objects: "Ventes possède encore {objets}." })).toBe(
      "Ventes possède encore des nœuds ou des comptes.",
    )
  })
})

describe("messageDErreur, organisation limits (E12-S02)", () => {
  it("should say each limit in French", () => {
    const limites: [{ limit: string; max: number }, string][] = [
      [{ limit: "members_max", max: 5 }, "L'organisation est limitée à 5 membres, invitations en attente comprises."],
      [{ limit: "teams_max", max: 1 }, "L'organisation est limitée à 1 équipe."],
      [{ limit: "teams_max", max: 0 }, "La création d'équipes n'est pas ouverte pour cette organisation."],
      [{ limit: "connectors_max", max: 2 }, "L'organisation est limitée à 2 connecteurs actifs."],
    ]
    const nom = ({ limit, max }: { limit: string; max: number }) => `${limit} ${max}`
    expect(Object.fromEntries(limites.map(([details]) => [nom(details), messageDErreur(refus("forbidden", "limit", details))]))).toEqual(
      Object.fromEntries(limites.map(([details, message]) => [nom(details), message])),
    )
  })

  it("should fall back to the forbidden sentence when the refusal carries no known limit", () => {
    expect(messageDErreur(refus("forbidden", "limit", { limit: "other", max: 1 }))).toBe("Vous n'avez pas le droit de faire cela.")
  })
})
