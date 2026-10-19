// @vitest-environment node
// Le dictionnaire et la porte de la pseudonymisation, sans base (`pseudonymisation.md` § Le jeton, § Référence fournie
// par l'hôte, § Le dictionnaire et la détection, J2) : normalisation et table de positions, formes d'une personne,
// jeton HMAC de 64 bits en base32 de Crockford, référence fournie par l'hôte et ses garde-fous, collision, forme
// partagée en jeton de valeur, mentions remplacées dans un texte et dans toute chaîne d'une valeur JSON.
import { afterEach, describe, expect, it } from "vitest"
import { registerSensitiveEntities, type SensitiveEntity, type SensitiveKind } from "../../packages/plateforme/server/pseudonym/declaration"
import { buildDictionary, DictionaryError, type Dictionary } from "../../packages/plateforme/server/pseudonym/dictionary"
import { entityForms, phoneDigits, titledName } from "../../packages/plateforme/server/pseudonym/forms"
import { pseudonymizedJson, pseudonymizedText } from "../../packages/plateforme/server/pseudonym/gate"
import { normalized } from "../../packages/plateforme/server/pseudonym/normalize"
import { entityBody, keyWitness, orgKey, pseudonymKey, TOKEN_PATTERN } from "../../packages/plateforme/server/pseudonym/token"

const MASTER = Buffer.alloc(32, 7)
const KEY = orgKey(MASTER, "org-1", "salt-of-the-organisation")
const ORG = { id: "org-1", slug: "acme" }

const CAMILLE: SensitiveEntity = {
  id: "c-1",
  values: { firstNames: "Camille Hélène", lastName: "Dupré", emails: ["camille.dupre@valbrune.test"], phones: ["06 12 34 56 78"], addresses: ["12 rue des Lilas, 69003 Lyon"], aliases: ["Dupré Conseil"] },
}
const JEAN: SensitiveEntity = { id: "c-2", values: { firstNames: "Jean", lastName: "Morin" } }

function kind(entities: readonly SensitiveEntity[], options: Partial<SensitiveKind> = {}): SensitiveKind {
  return { kind: "client", list: async () => entities, read: async () => null, ...options }
}

async function dictionary(entities: readonly SensitiveEntity[] = [CAMILLE, JEAN], options: Partial<SensitiveKind> = {}): Promise<Dictionary> {
  return buildDictionary([kind(entities, options)], ORG, KEY)
}

const tokenOf = (id: string) => `⟦client:${entityBody(KEY, "client", id)}⟧`

afterEach(() => registerSensitiveEntities(null))

describe("normalisation, forms and tokens", () => {
  it("should fold accents, case, ligatures, apostrophes and blanks, and keep the place of each character", () => {
    const text = "  Mme  HÉLÈNE d’Œuvre-Straße "
    const norm = normalized(text)
    expect(norm.text).toBe("mme helene d'oeuvre-strasse")
    const start = norm.text.indexOf("helene")
    expect(text.slice(norm.starts[start], norm.ends[start + "helene".length - 1])).toBe("HÉLÈNE")
    expect(text.slice(norm.starts[norm.text.indexOf("oeuvre")], norm.ends[norm.text.indexOf("oeuvre") + 1])).toBe("Œ")
  })

  it("should give a person's names in both orders, with the first given name, the initial, a civility, a path and the street line", () => {
    const forms = entityForms(CAMILLE.values).map((form) => form.form)
    for (const form of ["camille helene dupre", "dupre camille helene", "camille dupre", "dupre camille", "c. dupre", "camille_dupre", "camille.dupre@valbrune.test", "dupre conseil", "12 rue des lilas"]) {
      expect(forms).toContain(form)
    }
    // Le nom seul attend la liste des mots courants (J3) ; le prénom seul n'est jamais masqué.
    expect(forms).not.toContain("dupre")
    expect(forms).not.toContain("camille")
    expect(titledName(CAMILLE.values)).toBe("dupre")
    expect(titledName({ lastName: "Dupré" })).toBeNull()
    expect(phoneDigits("06 12 34 56 78")).toBe("+33612345678")
    expect(phoneDigits("+33 6 12 34 56 78")).toBe("+33612345678")
    expect(phoneDigits("0033612345678")).toBe("+33612345678")
    expect(phoneDigits("12 34")).toBeNull()
  })

  it("should make a 64-bit HMAC body of 13 Crockford characters, stable, distinct by kind, organisation and salt", () => {
    const body = entityBody(KEY, "client", "c-1")
    expect(body).toMatch(/^[0-9a-hjkmnp-tv-z]{13}$/u)
    expect(entityBody(KEY, "client", "c-1")).toBe(body)
    expect(entityBody(KEY, "person", "c-1")).not.toBe(body)
    expect(entityBody(orgKey(MASTER, "org-2", "salt-of-the-organisation"), "client", "c-1")).not.toBe(body)
    expect(entityBody(orgKey(MASTER, "org-1", "another-salt-value"), "client", "c-1")).not.toBe(body)
    expect([...`a ⟦client:${body}⟧ b ⟦client:c-12⟧`.matchAll(TOKEN_PATTERN)].map((match) => match[2])).toEqual([body, "c-12"])
  })

  it("should read the master key from the environment, refuse a missing or malformed one, and name its witness", () => {
    expect(pseudonymKey({ PLATFORM_PSEUDONYM_KEY: MASTER.toString("base64") })).toEqual(MASTER)
    expect(() => pseudonymKey({})).toThrow("PLATFORM_PSEUDONYM_KEY is missing")
    expect(() => pseudonymKey({ PLATFORM_PSEUDONYM_KEY: "c2hvcnQ=" })).toThrow("not a 32-byte key")
    expect(keyWitness(MASTER)).toMatch(/^[A-Za-z0-9_-]{8}$/u)
  })
})

describe("the dictionary", () => {
  it("should map each token back to its entity, and a form shared by two people to a one-way value token", async () => {
    const homonym: SensitiveEntity = { id: "c-3", values: { firstNames: "Camille", lastName: "Dupré" } }
    const built = await dictionary([CAMILLE, JEAN, homonym])
    expect(built.byToken.get(tokenOf("c-1"))).toEqual({ kind: "client", id: "c-1" })
    expect(built.entities).toBe(3)
    const shared = pseudonymizedText(built, "Camille Dupré called.")
    expect(shared).toMatch(/^⟦name:[0-9a-hjkmnp-tv-z]{13}⟧ called\.$/u)
    expect(pseudonymizedText(built, "Mme Dupré")).toMatch(/^⟦name:[0-9a-hjkmnp-tv-z]{13}⟧$/u)
    expect(built.byToken.get(shared.split(" ")[0])).toEqual({ oneWay: true })
    // Le nom complet avec le second prénom reste à Camille seule.
    expect(pseudonymizedText(built, "Camille Hélène Dupré")).toBe(tokenOf("c-1"))
  })

  it("should refuse a source that fails or returns a malformed entity, and the same id twice", async () => {
    await expect(buildDictionary([kind([], { list: async () => { throw new Error("down") } })], ORG, KEY)).rejects.toThrow("down")
    await expect(dictionary([{ id: "", values: {} }])).rejects.toThrow(DictionaryError)
    await expect(dictionary([{ id: "c-9", values: { emails: "x@y.test" as unknown as string[] } }])).rejects.toThrow("emails must be a list of strings")
    await expect(dictionary([JEAN, JEAN])).rejects.toThrow("token collision")
  })

  it("should take the host's reference as the body, and refuse a missing, malformed, duplicated or revealing one", async () => {
    const reference = (ref: string | undefined, entity = JEAN): SensitiveEntity => ({ ...entity, reference: ref })
    const built = await dictionary([reference("c-7k2"), reference("x-91", CAMILLE)], { tokens: "reference" })
    expect(pseudonymizedText(built, "Jean Morin et Camille Dupré")).toBe("⟦client:c-7k2⟧ et ⟦client:x-91⟧")
    expect(built.byToken.get("⟦client:c-7k2⟧")).toEqual({ kind: "client", id: "c-2" })
    await expect(dictionary([reference(undefined)], { tokens: "reference" })).rejects.toThrow("has no reference")
    await expect(dictionary([reference("C-12")], { tokens: "reference" })).rejects.toThrow("has no reference")
    await expect(dictionary([reference("c-1"), reference("c-1", CAMILLE)], { tokens: "reference" })).rejects.toThrow("given twice")
    await expect(dictionary([reference("morin-1")], { tokens: "reference" })).rejects.toThrow("contains a form of the entity")
    await expect(dictionary([reference("t-123456", CAMILLE)], { tokens: "reference" })).rejects.toThrow("contains a form of the entity")
    await expect(dictionary([reference("cam-dupreconseil", CAMILLE)], { tokens: "reference" })).rejects.toThrow("contains a form of the entity")
  })
})

describe("the gate", () => {
  it("should replace every form of a declared person in a text, at word boundaries, and keep the rest", async () => {
    const built = await dictionary()
    const camille = tokenOf("c-1")
    const jean = tokenOf("c-2")
    expect(pseudonymizedText(built, "Rendez-vous de MME DUPRE avec jean morin.")).toBe(`Rendez-vous de ${camille} avec ${jean}.`)
    // Une civilité, avec ou sans point, devant le nom ; pas devant un autre mot, ni collée par un tiret.
    expect(pseudonymizedText(built, "Me. Dupré, Dr Morin, M.Morin, Mme Durand, X-Mme Dupré")).toBe(`${camille}, ${jean}, M.Morin, Mme Durand, X-Mme Dupré`)
    expect(pseudonymizedText(built, "Écrire à camille.dupre@valbrune.test ou au 06.12.34.56.78, +33 6 12 34 56 78."))
      .toBe(`Écrire à ${camille} ou au ${camille}, ${camille}.`)
    expect(pseudonymizedText(built, "Page clients/camille_dupre/notes")).toBe(`Page clients/${camille}/notes`)
    expect(pseudonymizedText(built, "Au 12 rue des Lilas, chez Dupré Conseil")).toBe(`Au ${camille}, chez ${camille}`)
    // Ni dans un mot plus long, ni dans un nom composé, ni dans un courriel plus long, ni dans un jeton déjà posé.
    expect(pseudonymizedText(built, "Jean Morinière, Marie-Jean Morin, anne.camille.dupre@valbrune.test")).toBe("Jean Morinière, Marie-Jean Morin, anne.camille.dupre@valbrune.test")
    expect(pseudonymizedText(built, `${jean} et Jean Morin`)).toBe(`${jean} et ${jean}`)
    expect(pseudonymizedText(built, "Morin seul, Camille seule")).toBe("Morin seul, Camille seule")
  })

  it("should pseudonymize every string of a JSON value, keys untouched", async () => {
    const built = await dictionary()
    const value = { "Jean Morin": ["Jean Morin", 3, null, { note: "vu J. Morin" }], when: "today" }
    expect(pseudonymizedJson(built, value)).toEqual({ "Jean Morin": [tokenOf("c-2"), 3, null, { note: `vu ${tokenOf("c-2")}` }], when: "today" })
  })
})

describe("the declaration", () => {
  it("should refuse a malformed, reserved or duplicated kind, and a missing source", () => {
    const valid = kind([])
    expect(() => registerSensitiveEntities([{ ...valid, kind: "Client" }])).toThrow(TypeError)
    expect(() => registerSensitiveEntities([{ ...valid, kind: "email" }])).toThrow("reserved")
    expect(() => registerSensitiveEntities([valid, valid])).toThrow("declared twice")
    expect(() => registerSensitiveEntities([{ ...valid, tokens: "plain" as "hmac" }])).toThrow('tokens is "hmac" or "reference"')
    expect(() => registerSensitiveEntities([{ ...valid, read: undefined as unknown as SensitiveKind["read"] }])).toThrow("both required")
    expect(() => registerSensitiveEntities([valid])).not.toThrow()
  })
})
