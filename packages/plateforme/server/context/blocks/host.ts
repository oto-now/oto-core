// Bloc « fonctions de l'hôte » de `context` (`fonctions-d-un-hote.md` § Index) : ce que la personne voit de l'API de
// l'hôte de son organisation, borné à 3 000 caractères (`host-api/index-view.ts`), servi juste après les règles. Aucun
// bloc sans API servie ni fonction visible ; une liste indisponible en dit la raison. Sans lui, l'assistant ignorerait
// les fonctions de l'hôte tant qu'il ne lit pas le catalogue.
import { visibleOrgFunctions } from "../../catalog/org-catalog"
import type { PlatformDb } from "../../db"
import { hostIndexBlock } from "../../host-api/index-view"
import type { HostViewer } from "../../host-api/visibility"
import type { Identity } from "../../identity"
import type { ContextBlock } from "../engine"

/** Le bloc pour la demande `phrase`, ou `null` : rien ne s'affiche alors. */
export async function hostFunctionsBlock(db: PlatformDb, identity: Identity, viewer: HostViewer, phrase: string | undefined): Promise<ContextBlock | null> {
  const { host, visibility } = await visibleOrgFunctions(db, identity, viewer)
  const block = hostIndexBlock(visibility, host, phrase, identity.org.prefix)
  return block === null ? null : { name: "host functions", text: block.text, ...(block.cut ? { cut: true } : {}) }
}
