import { describe, expect, it } from "vitest"
import { FILE_MAX_BYTES, ORG_QUOTA_BYTES, TEXT_FILE_MAX_BYTES } from "../../packages/plateforme/schemas"
import { tailleLisible } from "../../packages/plateforme/ui/format/nombres"
import { accepteDe, admis, blocDuFichier, limitesDe, messageDEnvoi, nommer } from "../../packages/plateforme/ui/noeud/editeur/envoi-de-fichier"
import { FICHIERS } from "../../packages/plateforme/ui/noeud/libelles-des-fichiers"

// L'envoi d'un fichier depuis l'éditeur (E10-S02, lot b) : chaque refus du service dit en français par son code, le
// quota par sa raison, le nom refusé et le fichier vide par le fichier envoyé (AC-b4) ; les limites dites avant le
// choix, depuis `schemas/files.ts` ; le bloc écrit à la confirmation (AC-b1, AC-b2) ; une image collée sans extension,
// nommée par son type.

describe("messageDEnvoi (AC-b4)", () => {
  const rapport = { name: "rapport.pdf", size: 1200 }
  it("should translate each refusal by its code, the quota by its reason, a refused name and an empty file by the file sent", () => {
    const cas: [string, string, string | undefined, { name: string; size: number }, string][] = [
      ["type refused", "invalid_arguments", undefined, { name: "setup.exe", size: 3 }, FICHIERS.typeRefuse("png, jpeg, jpg, gif, webp, svg, pdf, csv, txt, md, html, json, docx, xlsx, pptx, odt, ods, zip, mp3, wav, m4a, ogg")],
      // Une extension admise : le service a refusé le nom, pas le type.
      ["name refused", "invalid_arguments", undefined, { name: `rapport${String.fromCodePoint(1)}.pdf`, size: 3 }, FICHIERS.nomRefuse],
      ["too large", "too_large", undefined, { name: "gros.pdf", size: 60_000_000 }, FICHIERS.tropLourd("50 Mo", "4 Mo")],
      ["empty", "too_large", undefined, { name: "vide.pdf", size: 0 }, FICHIERS.vide],
      ["quota", "too_large", "quota", rapport, FICHIERS.quota("10 Go")],
      ["forbidden", "forbidden", undefined, rapport, FICHIERS.interdit],
      ["not enabled", "not_enabled", undefined, rapport, FICHIERS.desactives],
      ["conflict", "conflict", undefined, rapport, FICHIERS.different],
      ["internal", "internal", undefined, rapport, FICHIERS.stockage],
    ]
    const verdicts = Object.fromEntries(cas.map(([nom, code, raison, fichier]) => [nom, messageDEnvoi({ code, raison, statut: 400 }, fichier, [])]))
    expect(verdicts).toEqual(Object.fromEntries(cas.map(([nom, , , , attendu]) => [nom, attendu])))
  })

  it("should name the host types in a refused type, and take a refused host type for a refused name (lot 1b)", () => {
    const refus = { code: "invalid_arguments", statut: 400 }
    expect(messageDEnvoi(refus, { name: "setup.exe", size: 3 }, ["dxf"])).toBe(FICHIERS.typeRefuse("png, jpeg, jpg, gif, webp, svg, pdf, csv, txt, md, html, json, docx, xlsx, pptx, odt, ods, zip, mp3, wav, m4a, ogg, dxf"))
    expect(messageDEnvoi(refus, { name: "plan.dxf", size: 3 }, ["dxf"])).toBe(FICHIERS.nomRefuse)
  })

  it("should say the quota the host posed, carried in bytes by the refusal (E12-S02, AC-6)", () => {
    expect(messageDEnvoi({ code: "too_large", raison: "quota", statut: 413, details: { reason: "quota", max: 1_073_741_824 } }, rapport, [])).toBe(FICHIERS.quota("1 Go"))
  })
})

describe("limitesDe (AC-b4)", () => {
  it("should say the admitted types and the limits of schemas/files.ts, never written in figures", () => {
    expect([tailleLisible(FILE_MAX_BYTES), tailleLisible(TEXT_FILE_MAX_BYTES), tailleLisible(ORG_QUOTA_BYTES)]).toEqual(["50 Mo", "4 Mo", "10 Go"])
    expect(limitesDe("image", ["dxf"])).toBe(FICHIERS.limitesImage(".png, .jpeg, .jpg, .gif, .webp, .svg", "50 Mo"))
    expect(limitesDe("fichier", [])).toBe(FICHIERS.limitesFichier(".png, .jpeg, .jpg, .gif, .webp, .svg, .pdf, .csv, .txt, .md, .html, .json, .docx, .xlsx, .pptx, .odt, .ods, .zip, .mp3, .wav, .m4a, .ogg", "50 Mo", "4 Mo"))
  })

  it("should admit and offer the types the host readers open, after those of the package, and only them (lot 1b)", () => {
    expect([admis("Plan RDC.DXF", ["dxf"]), admis("plan.dxf", []), admis("plan.dwg", ["dxf"]), admis("rapport.pdf", [])]).toEqual([true, false, false, true])
    expect(limitesDe("fichier", ["dxf", "stl"])).toBe(FICHIERS.limitesFichier(".png, .jpeg, .jpg, .gif, .webp, .svg, .pdf, .csv, .txt, .md, .html, .json, .docx, .xlsx, .pptx, .odt, .ods, .zip, .mp3, .wav, .m4a, .ogg, .dxf, .stl", "50 Mo", "4 Mo"))
    expect([accepteDe("fichier", ["dxf"]).endsWith(".zip,.mp3,.wav,.m4a,.ogg,.dxf"), accepteDe("image", ["dxf"])]).toEqual([true, ".png,.jpeg,.jpg,.gif,.webp,.svg"])
  })
})

describe("blocDuFichier (AC-b1, AC-b2)", () => {
  it("should write an image by its file alone, and any other admitted type as a file block with its row's metadata", () => {
    const id = "f1000000-0000-4000-8000-000000000001"
    expect(blocDuFichier({ id, name: "Plan.PNG", size: 12, mime: "image/png" })).toEqual({ type: "image", text: null, data: { file_id: id }, key: null })
    expect(blocDuFichier({ id, name: "Rapport.pdf", size: 1200, mime: "application/pdf" })).toEqual({ type: "file", text: null, data: { file_id: id, name: "Rapport.pdf", size: 1200, mime: "application/pdf" }, key: null })
  })
})

describe("nommer (AC-b1)", () => {
  it("should name a pasted image without extension by its type, and leave a named file as it is", () => {
    expect(nommer(new File(["x"], "blob", { type: "image/png" })).name).toBe("image.png")
    const nomme = new File(["x"], "capture.jpg", { type: "image/jpeg" })
    expect(nommer(nomme)).toBe(nomme)
  })
})
