import { describe, expect, it } from "vitest"
import { aDuBalisage, estUnTableau, libelleDUneAdresse, segmentsEnLigne, texteLu, titreDuLien, type Segment } from "../../packages/plateforme/ui/noeud/en-ligne"
import { readingRatio } from "../helpers/temps-lineaire"

// Le texte en ligne d'un bloc (E05-S02, AC5) et le tableau markdown d'un paragraphe (AC4). Les liens et
// le code se lisent par `schemas/link-syntax.ts`, comme la publication les lit (M15) : le test de parité
// avec `extractLinks` (HN-E05S02-26) est retiré, les deux lecteurs n'en faisant plus qu'un. E05-S11 (retour 11,
// fiche D107) : un lien se lit par son titre, une adresse par le texte de son lien ou, nue, par son domaine.
// Les marques en ligne d'E10-S04 (AC-c1) : barré, échappements, `<br>`, une marque dans une marque d'un autre
// caractère sur deux niveaux, `<https://…>` ; tout autre HTML reste du texte, que React échappe ; `texteLu`
// les retire. Ces segments se lisent par une écriture compacte (`vu`) : le découpage du texte en segments
// voisins n'est pas le sujet.

/** Les segments en une ligne : `<s>`, `<b>`, `<i>`, `<code>`, `<web adresse|libellé>`, `<br>`, le texte tel quel. */
function vu(segments: readonly Segment[]): string {
  return segments
    .map((segment) => {
      if (segment.genre === "barre") return `<s>${vu(segment.contenu)}</s>`
      if (segment.genre === "gras") return `<b>${vu(segment.contenu)}</b>`
      if (segment.genre === "italique") return `<i>${vu(segment.contenu)}</i>`
      if (segment.genre === "saut") return "<br>"
      if (segment.genre === "code") return `<code>${segment.texte}</code>`
      if (segment.genre === "web") return `<web ${segment.adresse}|${segment.libelle}>`
      if (segment.genre === "lien") return `<lien ${segment.chemin}>`
      return segment.texte
    })
    .join("")
}

// La borne d'un paragraphe (`blocks.text`, 100 000 caractères) : chaque texte hostile en temps linéaire
// (`security-patterns.md § Validation des inputs`, revue 1 d'E05-S10).
const BORNE = 100_000
const jusquA = (motif: string) => (taille: number) => motif.repeat(Math.floor(taille / motif.length))

/** `linear`, ou ce que la lecture de `texte` à la borne a coûté. */
function tempsDeLecture(lire: (texte: string) => unknown, texte: (taille: number) => string): string {
  const { whole, ratio, linear } = readingRatio(lire, texte(BORNE / 4), texte(BORNE))
  return linear ? "linear" : `${whole.toFixed(0)} ms for ${BORNE} characters, ${ratio.toFixed(1)} times the time of a quarter`
}

describe("segmentsEnLigne (AC5)", () => {
  const SEGMENTS: [string, ReturnType<typeof segmentsEnLigne>][] = [
    ["**gras** et *italique*", [{ genre: "gras", contenu: [{ genre: "texte", texte: "gras" }] }, { genre: "texte", texte: " et " }, { genre: "italique", contenu: [{ genre: "texte", texte: "italique" }] }]],
    ["_souligné_ puis `code **brut**`", [{ genre: "italique", contenu: [{ genre: "texte", texte: "souligné" }] }, { genre: "texte", texte: " puis " }, { genre: "code", texte: "code **brut**" }]],
    ["**Voir [[ventes/grille]]**", [{ genre: "gras", contenu: [{ genre: "texte", texte: "Voir " }, { genre: "lien", chemin: "ventes/grille", reference: null, libelle: "" }] }]],
    ["Bonjour {{first_name}}, 2 * 3 * 4", [{ genre: "texte", texte: "Bonjour {{first_name}}, 2 * 3 * 4" }]],
    ["Voir [[ventes/grille]].", [{ genre: "texte", texte: "Voir " }, { genre: "lien", chemin: "ventes/grille", reference: null, libelle: "" }, { genre: "texte", texte: "." }]],
    ["[[ventes/grille|la grille]]", [{ genre: "lien", chemin: "ventes/grille", reference: null, libelle: "la grille" }]],
    ["[[ventes/grille#tarifs]]", [{ genre: "lien", chemin: "ventes/grille", reference: "tarifs", libelle: "" }]],
    ["[[ventes/grille#tarifs|les tarifs]]", [{ genre: "lien", chemin: "ventes/grille", reference: "tarifs", libelle: "les tarifs" }]],
    // Ni HTML ni lien interne mal formé : le texte reste tel quel ; un lien markdown vers le web se lit par son texte (E05-S11).
    ["[[Ventes/Grille]] et [le site](https://exemple.test) <b>gras</b>", [{ genre: "texte", texte: "[[Ventes/Grille]] et " }, { genre: "web", adresse: "https://exemple.test", libelle: "le site" }, { genre: "texte", texte: " <b>gras</b>" }]],
    // Un lien markdown dans du code reste du code ; une adresse nue se lit par son domaine.
    ["`[a](https://a.fr)` puis https://www.b.fr/c", [{ genre: "code", texte: "[a](https://a.fr)" }, { genre: "texte", texte: " puis " }, { genre: "web", adresse: "https://www.b.fr/c", libelle: "https://www.b.fr/c" }]],
    // Une suite d'accents graves n'est fermée que par la suivante de même longueur, comme la publication la lit (N70, M15).
    ["``a`[[ventes/grille]]`", [{ genre: "texte", texte: "``a" }, { genre: "code", texte: "[[ventes/grille]]" }]],
  ]
  // Les marques d'E10-S04 (AC-c1), lues par `vu`.
  const MARQUES: [string, string][] = [
    ["~~barré~~ et ~~ pas~~", "<s>barré</s> et ~~ pas~~"],
    ["\\*pas italique\\* \\_ \\| \\` \\[ \\~ \\< \\\\*a*", "*pas italique* _ | ` [ ~ < \\<i>a</i>"],
    ["`\\*` reste \\*", "<code>\\*</code> reste *"],
    ["un<br>deux<br/>trois<br />quatre<BR>", "un<br>deux<br>trois<br>quatre<br>"],
    ["**gras _italique_**", "<b>gras <i>italique</i></b>"],
    ["_italique **gras**_", "<i>italique <b>gras</b></i>"],
    ["~~barré **gras**~~", "<s>barré <b>gras</b></s>"],
    ["**a _b ~~c~~_**", "<b>a <i>b ~~c~~</i></b>"],
    ["<https://www.exemple.test/a> et \\<https://b.test>", "<web https://www.exemple.test/a|https://www.exemple.test/a> et <<web https://b.test|https://b.test>>"],
    ["| a \\| b |", "| a | b |"],
    ["\\[[ventes/devis]] et [[ventes/suivi]]", "[[ventes/devis]] et <lien ventes/suivi>"],
  ]

  it("should read every inline text case", () => {
    const verdicts = Object.fromEntries([...SEGMENTS.map(([texte]) => [texte, segmentsEnLigne(texte)] as const), ...MARQUES.map(([texte]) => [texte, vu(segmentsEnLigne(texte))] as const)])
    expect(verdicts).toEqual(Object.fromEntries([...SEGMENTS, ...MARQUES]))
  })

  it("should keep other HTML as text, never as an element (HTML escaped)", () => {
    const segments = segmentsEnLigne("<img src=x onerror=alert(1)> <details> <u>souligné</u> <script>alert(1)</script>")
    expect(segments).toEqual([{ genre: "texte", texte: "<img src=x onerror=alert(1)> <details> <u>souligné</u> <script>alert(1)</script>" }])
  })

  it("should read the marks out of texteLu, a line break as a space", () => {
    expect(texteLu("~~vieux~~ **prix _net_**<br>\\*total\\* <https://www.exemple.test>")).toBe("vieux prix net *total* https://www.exemple.test")
  })

  // Les suites d'accents graves ou de crochets, où les expressions du service mettent des secondes ; les adresses web
  // (E05-S10, AC-a8) ; les liens markdown (E05-S11) : chaque classe exclut ce qui la ferme, et chaque adresse nue se
  // range parmi eux en un parcours ; les marques d'E10-S04. Avec, quand elle dit quelque chose, la lecture à la borne.
  const web = (segments: readonly Segment[]) => segments.filter((segment) => segment.genre === "web")
  const MOTIFS_DE_MARQUES = ["~~", "~", "**_", "_**", "\\", "\\*", "<br", "<https://a", "~~a **b _c"]
  const HOSTILES: { nom: string; texte: (taille: number) => string; lu?: (segments: readonly Segment[]) => unknown; attendu?: unknown }[] = [
    { nom: "backticks", texte: jusquA("`"), lu: (segments) => segments, attendu: [{ genre: "texte", texte: "`".repeat(BORNE) }] },
    { nom: "brackets", texte: jusquA("["), lu: (segments) => segments, attendu: [{ genre: "texte", texte: "[".repeat(BORNE) }] },
    { nom: "dots inside the address", texte: (taille) => `https://x.fr/${".".repeat(taille - 14)}a`, lu: (segments) => segments, attendu: [expect.objectContaining({ genre: "web", adresse: `https://x.fr/${".".repeat(BORNE - 14)}a` })] },
    { nom: "closing punctuation to the end", texte: (taille) => `https://x.fr/${").".repeat(Math.floor((taille - 13) / 2))}`, lu: (segments) => segments[0], attendu: { genre: "web", adresse: "https://x.fr/", libelle: "https://x.fr/" } },
    { nom: "one schema after another", texte: jusquA("https://"), lu: (segments) => segments.length, attendu: 1 },
    { nom: "schemas that never open", texte: jusquA("http:/"), lu: (segments) => segments, attendu: [{ genre: "texte", texte: jusquA("http:/")(BORNE) }] },
    { nom: "addresses between code spans", texte: jusquA("`a` https://a.fr "), lu: (segments) => web(segments).length, attendu: Math.floor(BORNE / 17) },
    { nom: "addresses between marks", texte: jusquA("*https://a.fr* _"), lu: (segments) => segments.length > 1, attendu: true },
    { nom: "markdown links that never close", texte: jusquA("[a](https://a.fr "), lu: (segments) => web(segments).length, attendu: Math.floor(BORNE / 17) },
    { nom: "markdown links one after another", texte: jusquA("[a](https://a.fr)"), lu: (segments) => segments.every((segment) => segment.genre === "web" && segment.libelle === "a"), attendu: true },
    { nom: "brackets without a closing one", texte: jusquA("[a"), lu: (segments) => segments, attendu: [{ genre: "texte", texte: jusquA("[a")(BORNE) }] },
    ...MOTIFS_DE_MARQUES.map((motif) => ({ nom: `marks ${motif}`, texte: jusquA(motif) })),
  ]

  it("should read every hostile text in linear time, to the bound of a paragraph", () => {
    const verdicts = Object.fromEntries(HOSTILES.map(({ nom, texte, lu }) => [nom, { temps: tempsDeLecture(segmentsEnLigne, texte), ...(lu ? { lu: lu(segmentsEnLigne(texte(BORNE))) } : {}) }] as const))
    expect(verdicts).toEqual(Object.fromEntries(HOSTILES.map(({ nom, lu, attendu }) => [nom, { temps: "linear", ...(lu ? { lu: attendu } : {}) }] as const)))
  })
})

describe("titreDuLien (E05-S11, AC-27)", () => {
  it("should name a cited page by its written label, else the title the screen knows, else the last segment of its path, never the whole path", () => {
    const cibles = { "ventes/grille": { titre: "Grille tarifaire", chemin: "ventes/grille" }, "ventes/perdue": null }
    expect(titreDuLien({ chemin: "ventes/grille", libelle: "les tarifs" }, cibles)).toBe("les tarifs")
    expect(titreDuLien({ chemin: "ventes/grille", libelle: "" }, cibles)).toBe("Grille tarifaire")
    expect(titreDuLien({ chemin: "ventes/perdue", libelle: "" }, cibles)).toBe("perdue")
    expect(titreDuLien({ chemin: "ventes/inconnue", libelle: "" })).toBe("inconnue")
    // Un chemin qui porte le nom d'une propriété d'objet ne lit pas le prototype.
    expect(titreDuLien({ chemin: "constructor", libelle: "" }, cibles)).toBe("constructor")
  })

  it("should name a cited Contexte as the screen names it, under its stored title or no label, a hand-written label kept (E11-S15, AC-a9)", () => {
    const cibles = { "sav/contexte": { titre: "Contexte · SAV", chemin: "sav/contexte", titreEnregistre: "Contexte" } }
    expect(titreDuLien({ chemin: "sav/contexte", libelle: "Contexte" }, cibles)).toBe("Contexte · SAV")
    expect(titreDuLien({ chemin: "sav/contexte", libelle: "" }, cibles)).toBe("Contexte · SAV")
    expect(titreDuLien({ chemin: "sav/contexte", libelle: "notre SAV" }, cibles)).toBe("notre SAV")
  })
})

describe("libelleDUneAdresse (E11-S15, AC-b10)", () => {
  const ADRESSES: [string, string][] = [
    // Jusqu'à 40 caractères, entière, requête comprise.
    ["https://exemple.fr/devis", "https://exemple.fr/devis"],
    ["https://www.exemple.fr/?q=devis", "https://www.exemple.fr/?q=devis"],
    // Sans chemin, rien à couper, quelle que soit sa longueur.
    ["https://un-sous-domaine-assez-long.exemple-de-domaine.fr", "https://un-sous-domaine-assez-long.exemple-de-domaine.fr"],
    // Au-delà : schéma, domaine, et les 12 derniers caractères du chemin.
    ["https://oto-steel.vercel.app/n/private/jean_baptiste/test_ctx", "https://oto-steel.vercel.app/…ste/test_ctx"],
    // La requête et le fragment d'une adresse coupée tombent : la fin du chemin nomme la ressource.
    ["http://docs.exemple.fr/document/d/1AbC/edit?usp=sharing", "http://docs.exemple.fr/…/d/1AbC/edit"],
    ["https://docs.exemple.fr/guide/installation#configuration", "https://docs.exemple.fr/…installation"],
    // Un chemin court se garde entier, l'ellipse dit ce qui tombe après lui.
    ["https://exemple.fr/devis?utm_source=lettre-du-mois-de-septembre", "https://exemple.fr/devis…"],
    // Une adresse à mot de passe se construit à l'exécution (testing-strategy.md § Anti-patterns : check:public).
    [`https://${["alice", "secret"].join(":")}@exemple.fr/`, "https://exemple.fr/"],
    [`https://${["alice", "secret"].join(":")}@docs.exemple.fr/document/d/1AbCdEfGh/edit`, "https://docs.exemple.fr/…bCdEfGh/edit"],
    // L'hôte montré est celui que le navigateur ouvre : une barre oblique inverse coupe l'autorité comme `/`.
    ["https://evil.example\\@good.example/chemin", "https://evil.example/…ample/chemin"],
    // Un domaine international en punycode, un chemin encodé lu en clair.
    ["https://bücher.example/katalog", "https://xn--bcher-kva.example/katalog"],
    ["https://exemple.fr/caf%C3%A9", "https://exemple.fr/café"],
  ]

  it("should show each address by its label", () => {
    expect(Object.fromEntries(ADRESSES.map(([adresse]) => [adresse, libelleDUneAdresse(adresse)]))).toEqual(Object.fromEntries(ADRESSES))
  })

  it("should read a hostile address of 100,000 characters in linear time", () => {
    for (const adresse of [`https://exemple.fr/${"a/".repeat(50_000)}`, `https://${"@".repeat(100_000)}`, `https://exemple.fr/${"?#".repeat(50_000)}`, `https://${"\\@".repeat(50_000)}`, `https://${"a".repeat(100_000)}`]) {
      const debut = performance.now()
      libelleDUneAdresse(adresse)
      expect(performance.now() - debut).toBeLessThan(1_000)
    }
  })
})

describe("estUnTableau (AC4)", () => {
  it("should see a markdown table in two lines or more that all start with |, never in one line", () => {
    expect(estUnTableau("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(true)
    expect(estUnTableau("| a | b |")).toBe(false)
    expect(estUnTableau("| a | b |\nune phrase")).toBe(false)
  })
})

// E11-S15 (AC-b6) : l'éditeur rend au repos tout texte dont le rendu diffère de sa source, marqué sans lien compris.
describe("aDuBalisage (E11-S15, AC-b6)", () => {
  const BALISAGES: [string, boolean][] = [
    ["Un **gras** ici", true],
    ["**tout**", true],
    ["*un* et _deux_", true],
    ["du `code`", true],
    ["~~barré~~", true],
    ["Voir [[ventes/tarifs]]", true],
    ["a\\*b", true],
    ["un<br>deux", true],
    ["Texte simple, 2 * 3 * 4", false],
    ["modele_relance et {{first_name}}", false],
    ["<b>gras en HTML</b>", false],
    ["", false],
  ]

  it("should say of each text whether it reads otherwise than its source", () => {
    expect(Object.fromEntries(BALISAGES.map(([texte]) => [texte, aDuBalisage(texte)]))).toEqual(Object.fromEntries(BALISAGES))
  })

  it("should read hostile texts in linear time", () => {
    const motifs = ["**", "*a", "_ ", "`", "~~a **b _c"]
    expect(Object.fromEntries(motifs.map((motif) => [motif, tempsDeLecture(aDuBalisage, jusquA(motif))]))).toEqual(Object.fromEntries(motifs.map((motif) => [motif, "linear"])))
  })
})
