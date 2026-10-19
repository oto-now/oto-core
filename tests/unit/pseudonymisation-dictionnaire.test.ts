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
import { normalized, normalizedText } from "../../packages/plateforme/server/pseudonym/normalize"
import { entityBody, HMAC_BODY_SOURCE, keyWitness, orgKey, pseudonymKey, token, tokenSource, TOKEN_PATTERN, valueBody } from "../../packages/plateforme/server/pseudonym/token"

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

const tokenOf = (id: string) => token("client", entityBody(KEY, "client", id))
/** Un jeton de valeur `name`, de corps HMAC, seul dans le texte. */
const NAME_TOKEN = tokenSource("name", HMAC_BODY_SOURCE)
const valueOf = (detector: string, value: string) => token(detector, valueBody(KEY, detector, value))

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
    for (const form of ["camille helene dupre", "dupre camille helene", "camille dupre", "dupre camille", "c. dupre", "camille_dupre", "camille-dupre", "dupre", "camille.dupre@valbrune.test", "dupre conseil", "12 rue des lilas"]) {
      expect(forms).toContain(form)
    }
    // Le prénom seul n'est jamais masqué ; le nom seul l'est s'il a 3 lettres et n'est ni un mot commun ni un prénom courant.
    expect(forms).not.toContain("camille")
    const alone = (lastName: string) => entityForms({ firstNames: "Paul", lastName }).some((form) => form.form === normalizedText(lastName))
    expect([alone("Lefort"), alone("Moreau"), alone("Brun"), alone("Martin"), alone("Rose"), alone("Ba")]).toEqual([true, true, false, false, false, false])
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
    expect([...`a ${token("client", body)} b ${token("client", "c-12")}`.matchAll(TOKEN_PATTERN)].map((match) => match[2])).toEqual([body, "c-12"])
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
    expect(shared).toMatch(new RegExp(`^${NAME_TOKEN} called\\.$`, "u"))
    expect(pseudonymizedText(built, "Mme Dupré")).toMatch(new RegExp(`^${NAME_TOKEN}$`, "u"))
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
    expect(pseudonymizedText(built, "Jean Morin et Camille Dupré")).toBe(`${token("client", "c-7k2")} et ${token("client", "x-91")}`)
    expect(built.byToken.get(token("client", "c-7k2"))).toEqual({ kind: "client", id: "c-2" })
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
    // Une civilité, avec ou sans point, devant le nom ; le nom seul se masque aussi sans elle.
    expect(pseudonymizedText(built, "Me. Dupré, Dr Morin, M.Morin, Mme Durand, X-Mme Dupré")).toBe(`${camille}, ${jean}, M.${jean}, Mme Durand, X-Mme ${camille}`)
    // Un nom qui est un mot commun ne se masque qu'avec une civilité : pas devant un autre mot, ni collée par un tiret.
    const paul = (await dictionary([{ id: "c-4", values: { firstNames: "Paul", lastName: "Brun" } }]))
    expect(pseudonymizedText(paul, "Mme Brun, un manteau brun, M.Brun, X-Mme Brun")).toBe(`${tokenOf("c-4")}, un manteau brun, M.Brun, X-Mme Brun`)
    expect(pseudonymizedText(built, "Écrire à camille.dupre@valbrune.test ou au 06.12.34.56.78, +33 6 12 34 56 78."))
      .toBe(`Écrire à ${camille} ou au ${camille}, ${camille}.`)
    expect(pseudonymizedText(built, "Page clients/camille_dupre/notes")).toBe(`Page clients/${camille}/notes`)
    expect(pseudonymizedText(built, "Au 12 rue des Lilas, chez Dupré Conseil")).toBe(`Au ${camille}, chez ${camille}`)
    // Ni dans un mot plus long, ni dans un jeton déjà posé ; dans un prénom composé, le nom seul ; un courriel non déclaré
    // qui le contient, entier, par son détecteur.
    expect(pseudonymizedText(built, "Jean Morinière, Marie-Jean Morin, anne.camille.dupre@valbrune.test")).toBe(`Jean Morinière, Marie-Jean ${jean}, ${valueOf("email", "anne.camille.dupre@valbrune.test")}`)
    expect(pseudonymizedText(built, `${jean} et Jean Morin`)).toBe(`${jean} et ${jean}`)
    // Le nom seul (J3) et la forme d'une adresse web ; le prénom seul reste en clair.
    expect(pseudonymizedText(built, "Vente Morin / Dupré, Camille seule, https://crm.test/fiche/camille-dupre")).toBe(`Vente ${jean} / ${camille}, Camille seule, https://crm.test/fiche/${camille}`)
  })

  it("should pseudonymize every string of a JSON value, keys untouched", async () => {
    const built = await dictionary()
    const value = { "Jean Morin": ["Jean Morin", 3, null, { note: "vu J. Morin" }], when: "today" }
    expect(pseudonymizedJson(built, value)).toEqual({ "Jean Morin": [tokenOf("c-2"), 3, null, { note: `vu ${tokenOf("c-2")}` }], when: "today" })
  })
})

describe("the detectors by shape", () => {
  it("should give an undeclared email or phone a one-way value token, the same whatever its writing, and a declared one its entity's", async () => {
    const built = await dictionary()
    const camille = tokenOf("c-1")
    const lea = valueOf("email", "lea.roux@ailleurs.test")
    const phone = valueOf("phone", "+33698765432")
    expect(pseudonymizedText(built, "Copie à Lea.Roux@Ailleurs.test et à camille.dupre@valbrune.test.")).toBe(`Copie à ${lea} et à ${camille}.`)
    expect(pseudonymizedText(built, "06 98 76 54 32, 06.98.76.54.32, 0698765432, +33 6 98 76 54 32, +33 (0)6 98 76 54 32, 0033 6 98 76 54 32"))
      .toBe([phone, phone, phone, phone, phone, phone].join(", "))
    expect(pseudonymizedText(built, "Tél. : +44 20 7946 0958 ; fax 01-23-45-67-89")).toBe(`Tél. : ${valueOf("phone", "+442079460958")} ; fax ${valueOf("phone", "+33123456789")}`)
    expect(pseudonymizedText(built, "au 06 12 34 56 78 ou +33 6 12 34 56 78")).toBe(`au ${camille} ou ${camille}`)
    // Une organisation sans entité déclarée garde les détecteurs ; la clé de l'organisation fait le jeton.
    expect(pseudonymizedText(await dictionary([]), "lea.roux@ailleurs.test")).toBe(lea)
    expect(pseudonymizedText(await buildDictionary([kind([])], ORG, orgKey(MASTER, "org-2", "salt")), "lea.roux@ailleurs.test")).not.toBe(lea)
  })

  it("should leave numbers, dates, anchors, handles and a value token as they are", async () => {
    const built = await dictionary([])
    for (const text of [
      "1914-1918, 01.02.2024 10:30, 01 02 2024, 75001 Paris, 2 873 000 habitants, +3,5 %, +1 234 567",
      "SIRET 123 456 789 00012, ISBN 978-2-07-036024-5, IBAN FR76 3000 6000 0112 3456 7890 189",
      "réf. A0612345678, 0612345678B, 06 12 34 56 7, version 1.2.3.4",
      "@otomata_tech/oto_platform, git@host, user@localhost, https://crm.test/guide#installation, a@b.c",
      `voir ${valueOf("email", "x@y.test")} et ${valueOf("phone", "+33600000000")}`,
    ]) expect(pseudonymizedText(built, text)).toBe(text)
    // La forme d'un jeton ne cache pas un numéro : il est trouvé derrière.
    expect(pseudonymizedText(built, "phone#0033612345678")).toBe(`phone#${valueOf("phone", "+33612345678")}`)
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
