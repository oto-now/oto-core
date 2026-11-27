"use client"

// Un bloc `mermaid` dessiné (1.1.3) : à la lecture (page, page publique, visionneuse, par `RenduDUnBloc`) et dans
// l'éditeur, hors du focus, par le même rendu (1.1.4, `champ-au-repos.tsx`, `DiagrammeAuRepos`). Le serveur rend le texte (légende et code) : sans
// JavaScript, ou tant que le dessin n'est pas prêt, on le lit ; un texte que mermaid ne lit pas le garde et dit « Diagramme invalide », sans
// casser la page. Dessiné, le texte reste sous le dessin, derrière « Voir le code ».
//
// Mermaid se charge par `import()` au premier diagramme monté : une page sans diagramme ne le télécharge pas. Le texte
// vient des assistants et des membres, donc non fiable (`security-patterns.md § XSS Prevention`) : `securityLevel`
// `"strict"` interdit scripts, gestionnaires `click` et liens `javascript:`, et passe le SVG produit par DOMPurify avant de
// le rendre ; une directive du texte ne peut changer ni ce niveau ni `startOnLoad` (clés `secure` de mermaid). Le SVG est
// inséré tel que mermaid le rend, comme sa documentation le prescrit.
//
// Le thème suit la nuit de la coque (`.dark` sur un ancêtre, ADR-008 § 3) : `neutral` le jour, `dark` la nuit ; un
// changement de mode redessine.
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { DIAGRAMME } from "./libelles"

type Etat = { genre: "texte" } | { genre: "invalide" } | { genre: "dessin"; svg: string }

/** Le nom lu d'un titre (`title:` ou `accTitle:`), sinon de la première ligne qui n'est ni directive ni délimiteur. */
function nomDuDiagramme(texte: string): string {
  const lignes = texte
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "" && ligne !== "---" && !ligne.startsWith("%%"))
  const titre = lignes.find((ligne) => /^(acc)?title\s*:/i.test(ligne))
  const choisie = titre === undefined ? (lignes[0] ?? "") : titre.slice(titre.indexOf(":") + 1).trim()
  return choisie.slice(0, 120)
}

/**
 * Sans mise en page SVG (`getBBox`), mermaid ne mesure aucun libellé et lève même sur un texte valide : le texte
 * reste, sans « Diagramme invalide » qui mentirait.
 */
function dessinable(): boolean {
  return typeof SVGGraphicsElement === "function" && "getBBox" in SVGGraphicsElement.prototype
}

/** Le SVG du texte ; `null` si mermaid ne se charge pas (réseau) : le texte reste, sans se dire invalide. */
async function dessiner(cible: string, texte: string, sombre: boolean): Promise<string | null> {
  const charge = await import("mermaid").catch(() => null)
  if (charge === null) return null
  const mermaid = charge.default
  // Réglages globaux de mermaid, relus par chaque `render` : posés avant chacun, au thème de ce dessin.
  // `suppressErrorRendering` : un texte invalide lève sans laisser dans `<body>` le dessin d'erreur de mermaid.
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: sombre ? "dark" : "neutral" })
  const { svg } = await mermaid.render(cible, texte)
  return svg
}

type Props = { id?: string; texte: string; children: ReactNode }

/** `children` : le texte rendu par le serveur (légende et code), montré tel quel tant que rien n'est dessiné, puis sous « Voir le code ». */
export function DiagrammeMermaid({ id, texte, children }: Props) {
  const racine = useRef<HTMLDivElement>(null)
  // `useId` porte des caractères qu'un sélecteur CSS refuse ; mermaid s'en sert pour cibler son `<style>`.
  const prefixe = `mermaid-${useId().replace(/[^\w-]/g, "")}`
  const [etat, setEtat] = useState<Etat>({ genre: "texte" })

  useEffect(() => {
    const noeud = racine.current
    if (noeud === null || !dessinable()) return
    let tour = 0
    let sombre: boolean | null = null
    const suivre = (): void => {
      const maintenant = noeud.closest(".dark") !== null
      if (maintenant === sombre) return
      sombre = maintenant
      // Un id par dessin : mermaid retire du document tout élément qui porte l'id qu'il dessine, le dessin affiché compris.
      const ce = ++tour
      dessiner(`${prefixe}-${ce}`, texte, maintenant).then(
        (svg) => {
          if (ce === tour && svg !== null) setEtat({ genre: "dessin", svg })
        },
        () => {
          if (ce === tour) setEtat({ genre: "invalide" })
        },
      )
    }
    suivre()
    const observateur = new MutationObserver(suivre)
    observateur.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] })
    return () => {
      tour = -1
      observateur.disconnect()
    }
  }, [prefixe, texte])

  return (
    <div id={id} ref={racine} className={etat.genre === "dessin" ? "mb-3.5" : undefined}>
      {etat.genre === "dessin" ? (
        <>
          {/* Assaini par mermaid (`securityLevel: "strict"`, DOMPurify), voir l'en-tête. */}
          <div role="img" aria-label={DIAGRAMME.nom(nomDuDiagramme(texte))} className="oto-diagramme-dessin" dangerouslySetInnerHTML={{ __html: etat.svg }} />
          <details className="oto-diagramme-code">
            <summary className="oto-caption rounded-sm focus-visible:ring-2 focus-visible:ring-ink">{DIAGRAMME.voirLeCode}</summary>
            {children}
          </details>
        </>
      ) : (
        <>
          {etat.genre === "invalide" && <p className="oto-caption">{DIAGRAMME.invalide}</p>}
          {children}
        </>
      )}
    </div>
  )
}
