// `paidByHostKey` (`adoption.ts`) suit la décision du moteur, jamais la forme d'une déclaration : un connecteur dont un
// accès ajoute la clé de l'hôte à ses appels (`readHostFields`, un champ `holder: host`) attend son adoption, quelle que
// soit la forme qui le déclare (un accès ou plusieurs, `platform` ou un mode où le compte apporte sa clé, compte
// rattaché ou non). Chaque forme est jouée deux fois : la règle de l'adoption, et ce que le moteur ajoute vraiment.
import { afterEach, describe, expect, it } from "vitest"
import { declaredConnectors } from "../../packages/plateforme/server/catalog/connector-source"
import { paidByHostKey } from "../../packages/plateforme/server/connectors/adoption"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { readHostFields } from "../../packages/plateforme/server/connectors/host-fields"
import { consentConnector, describedConnector, hostedConnector, keyOrSignInConnector, TEST_APPLICATION } from "../factories/described-connector"

const ORG = { id: "org-1", slug: "acme", name: "Acme", prefix: "acme" } as never
const HOST_KEY = { host_key: "host-secret" }

/** Ce que le moteur ajoute à un appel de chaque accès : la clé de l'hôte, ou rien. */
const engineAdds = (connector: string) =>
  declaredConnectors()
    .find((candidate) => candidate.definition.name === connector)
    ?.accesses.map((access) => Object.keys(readHostFields(access, ORG)).length > 0) ?? []

const HOST_FIELD = { name: "host_key", label: "Host key", secret: true, holder: "host" as const }
const ACCOUNT_FIELD = { name: "api_key", label: "API key", secret: true, holder: "account" as const }

/** Chaque forme de déclaration, et si un appel sort sur la clé de l'hôte. */
const FORMS: { forme: string; definition: ConnectorDefinition; paid: boolean }[] = [
  {
    forme: "one access, platform mode, the host's key only",
    definition: { ...describedConnector("forme_a"), auth: { kind: "api_key", in: "header", name: "X-Key", key: "host_key" }, credential: [HOST_FIELD], modes: ["platform"] },
    paid: true,
  },
  {
    forme: "one access where the account brings its key, the host's key beside it (no platform mode)",
    definition: { ...describedConnector("forme_b"), auth: { kind: "api_key", in: "header", name: "X-Key", key: "api_key" }, credential: [ACCOUNT_FIELD, HOST_FIELD], modes: ["byo_org"] },
    paid: true,
  },
  {
    forme: "several accesses, the host's key on one only",
    definition: (() => {
      const two = keyOrSignInConnector("forme_c")
      const [signIn, key] = two.accesses ?? []
      // La clé d'une organisation, sans mode `platform`, avec la clé de l'hôte à côté ; la connexion d'une personne, sans.
      return { ...two, accesses: [signIn, { ...key, credential: [...(key.credential ?? []), HOST_FIELD], modes: ["byo_org"] }] } as ConnectorDefinition
    })(),
    paid: true,
  },
  {
    forme: "linked account (accountIdentity) on the host's key",
    definition: { ...hostedConnector("forme_d"), credential: [HOST_FIELD], auth: { kind: "api_key", in: "header", name: "X-Api-Key", key: "host_key" } } as ConnectorDefinition,
    paid: true,
  },
  { forme: "one access, the account's own key", definition: describedConnector("forme_e"), paid: false },
  { forme: "a person's consent with the host's OAuth application", definition: consentConnector("forme_f"), paid: false },
  { forme: "open data, no key", definition: { ...describedConnector("forme_g"), auth: { kind: "none" }, credential: [], probe: undefined }, paid: false },
]

afterEach(() => registerConnectors([]))

describe("paidByHostKey follows the engine, whatever the form of the declaration", () => {
  it.each(FORMS)("$forme", ({ definition, paid }) => {
    const name = definition.name
    registerConnectors([definition], {
      ...(paid ? { hostCredentials: { [name]: () => HOST_KEY } } : {}),
      ...(name === "forme_c" || name === "forme_f" ? { oauthApplications: { [name]: TEST_APPLICATION } } : {}),
      ...(name === "forme_d" ? { hostedLinks: { [name]: { createLink: async () => ({ url: "" }), listAccounts: async () => [], probe: async () => ({ state: "dead" as const }) } } } : {}),
    })
    expect(paidByHostKey(name)).toBe(paid)
    // La même réponse que le moteur : un accès au moins sort sur la clé de l'hôte, ou aucun.
    expect(engineAdds(name).some(Boolean)).toBe(paid)
  })
})
