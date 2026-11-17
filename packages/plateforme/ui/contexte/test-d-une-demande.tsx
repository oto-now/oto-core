// « Tester une demande » sur l'écran « Contexte » : la personne écrit une demande, et lit ce que son assistant
// recevrait pour elle : la procédure retenue et les procédures proches (le bloc `code`, que la vue ne montre pas, les
// porte), puis le texte exact envoyé, à la lettre. Un formulaire GET : l'état reste dans l'adresse de l'hôte
// (`state-management.md § URL State`), la page relit tout à l'envoi, sans JavaScript. Server Component. Sans lui, la
// personne ne peut pas vérifier ce que reçoit son assistant, ni que rien n'est coupé.
import { CONTEXT_REQUEST_MAX } from "../../schemas"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { Field, Input } from "../ds/react/forms"
import { Island, IslandBody } from "../ds/react/island"
import { LinkedContent } from "../ds/react/linked-content"
import { Button } from "../ds/react/primitives"
import { nombreLisible } from "../format/nombres"
import type { DonneesDeLApercu } from "./apercu-du-contexte"
import { TEST_D_UNE_DEMANDE } from "./libelles"

type Navigation = { prefixeDesPages: string; Lien: LienDeLHote }

/** Le champ et son bouton, sur une ligne ; sous eux, la demande testée et le retour à l'écran sans demande. */
export function TesterUneDemande({ ici, demande, Lien }: { ici: string; demande: string | undefined; Lien: LienDeLHote }) {
  return (
    <div className="flex flex-col gap-2">
      <form method="get" action={ici} className="flex flex-wrap items-end gap-3">
        <Field id="contexte-demande" label={TEST_D_UNE_DEMANDE.champ} className="min-w-0 flex-1">
          {/* `key` : le champ reprend la demande de l'adresse à chaque navigation. */}
          <Input key={demande ?? ""} type="text" name="q" defaultValue={demande ?? ""} placeholder={TEST_D_UNE_DEMANDE.indice} maxLength={CONTEXT_REQUEST_MAX} />
        </Field>
        <Button type="submit" variant="secondary">
          {TEST_D_UNE_DEMANDE.tester}
        </Button>
      </form>
      {demande !== undefined && (
        <p className="break-words text-sm text-ink">
          {TEST_D_UNE_DEMANDE.legende(demande)}{" "}
          <Lien href={ici} className={LIEN}>
            {TEST_D_UNE_DEMANDE.revenir}
          </Lien>
        </p>
      )}
    </div>
  )
}

type Candidat = NonNullable<DonneesDeLApercu["candidates"]>[number]

/** Une procédure, par son titre (son chemin sans titre), puis son score. */
function Procedure({ candidat, prefixeDesPages, Lien }: Navigation & { candidat: Pick<Candidat, "path" | "title" | "score"> }) {
  return (
    <>
      <Lien href={`${prefixeDesPages}${candidat.path}`} className={LIEN}>
        {candidat.title || candidat.path}
      </Lien>
      {` — ${TEST_D_UNE_DEMANDE.score(candidat.score)}`}
    </>
  )
}

const TITRE_DU_ROUTAGE = "routage-de-la-demande"

/** Ce que le routage a trouvé pour la demande : la procédure retenue, ou qu'aucune ne l'est, puis les proches. */
export function RoutageDeLaDemande({ apercu, ...navigation }: Navigation & { apercu: DonneesDeLApercu }) {
  const candidats = apercu.candidates ?? []
  const retenue = apercu.served ? { ...apercu.served, title: candidats.find((candidat) => candidat.path === apercu.served?.path)?.title ?? "" } : null
  const proches = candidats.filter((candidat) => candidat.path !== retenue?.path)
  return (
    <section aria-labelledby={TITRE_DU_ROUTAGE} className="flex flex-col gap-2">
      <h2 id={TITRE_DU_ROUTAGE} className="text-base font-semibold text-ink">
        {TEST_D_UNE_DEMANDE.routage}
      </h2>
      <Island as="div">
        <IslandBody>
          <div className="flex flex-col gap-3 text-sm text-ink">
            <p>
              {retenue ? (
                <>
                  {`${TEST_D_UNE_DEMANDE.retenue} : `}
                  <Procedure candidat={retenue} {...navigation} />
                </>
              ) : (
                TEST_D_UNE_DEMANDE.aucune
              )}
            </p>
            {proches.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p id={`${TITRE_DU_ROUTAGE}-proches`} className="font-medium text-ink">
                  {TEST_D_UNE_DEMANDE.proches}
                </p>
                <ul aria-labelledby={`${TITRE_DU_ROUTAGE}-proches`} className="flex flex-col gap-1.5">
                  {proches.map((candidat) => (
                    <li key={candidat.path}>
                      <Procedure candidat={candidat} {...navigation} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </IslandBody>
      </Island>
    </section>
  )
}

/** Le texte envoyé à l'assistant, à la lettre, et sa taille dans le plafond ; ouvert quand une demande est testée. */
export function TexteExact({ apercu, ouvert }: { apercu: DonneesDeLApercu; ouvert: boolean }) {
  const taille = TEST_D_UNE_DEMANDE.taille(nombreLisible(apercu.text.length), nombreLisible(apercu.budget))
  return (
    // Un `<details>` a le rôle `group` sans nom propre : il prend celui de son titre.
    <LinkedContent
      open={ouvert}
      aria-label={TEST_D_UNE_DEMANDE.texteExact}
      title={
        <>
          {TEST_D_UNE_DEMANDE.texteExactCourt}
          <span className="max-sm:hidden">{TEST_D_UNE_DEMANDE.texteExactSuite}</span>
        </>
      }
      summary={taille}
    >
      <pre className="oto-code whitespace-pre-wrap break-words p-3">{apercu.text}</pre>
    </LinkedContent>
  )
}
