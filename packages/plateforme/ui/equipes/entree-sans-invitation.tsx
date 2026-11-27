"use client"

// L'entrée sans invitation de l'organisation (`open_entry`), dans l'onglet « Membres », pour qui administre : une case,
// les domaines d'email admis, et la phrase qui dit ce que l'ouverture permet. Envoyé à `PATCH /api/platform/admin/open-entry`
// après le schéma partagé avec l'API (`openEntrySchema`) : au moins un domaine pour ouvrir. Dans un ERP monté sur le
// paquet, l'annuaire est celui de l'ERP : sans ce réglage, chaque compte devrait être réinvité par email.
import { useState, type FormEvent } from "react"
import { OPEN_ENTRY_DOMAINS_MAX, openEntrySchema, type OpenEntry } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Checkbox } from "../ds/react/checkbox"
import { Field, Input } from "../ds/react/forms"
import { Button } from "../ds/react/primitives"
import { useRafraichir } from "../hote/rafraichir"

const TITRE = "Entrée sans invitation"
const DOMAINES_INVALIDES = `Écrivez un à ${OPEN_ENTRY_DOMAINS_MAX} domaines d'email, séparés par une virgule, sans @ (acme.fr, acme.com).`
const DOMAINE_REQUIS = "Nommez au moins un domaine d'email pour ouvrir l'entrée."

/** « acme.fr, acme.com » → ses domaines, sans vide. */
function domainesDe(saisie: string): string[] {
  return saisie.split(/[\s,;]+/).filter(Boolean)
}

export type EntreeSansInvitationProps = {
  /** Le réglage servi (`readOpenEntry`). */
  reglage: OpenEntry
  nomOrganisation: string
}

export function EntreeSansInvitation({ reglage, nomOrganisation }: EntreeSansInvitationProps) {
  const rafraichir = useRafraichir()
  const [ouverte, setOuverte] = useState(reglage.enabled)
  const [saisie, setSaisie] = useState(reglage.email_domains.join(", "))
  const [erreur, setErreur] = useState<{ champ: boolean; message: string } | null>(null)
  const [enregistre, setEnregistre] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  function changer(action: () => void) {
    action()
    setErreur(null)
    setEnregistre(false)
  }

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault()
    if (envoi) return
    const corps = { enabled: ouverte, email_domains: domainesDe(saisie) }
    if (!openEntrySchema.safeParse(corps).success) {
      return setErreur({ champ: true, message: corps.enabled && corps.email_domains.length === 0 ? DOMAINE_REQUIS : DOMAINES_INVALIDES })
    }
    setEnvoi(true)
    const reponse = await appelerPlateforme<{ open_entry: OpenEntry }>({ methode: "PATCH", ressource: "admin/open-entry", corps })
    setEnvoi(false)
    if (reponse.erreur) return setErreur({ champ: false, message: messageDErreur(reponse.erreur) })
    setSaisie(reponse.data.open_entry.email_domains.join(", "))
    setEnregistre(true)
    rafraichir()
  }

  return (
    <section aria-label={TITRE} className="flex flex-col gap-3 pt-2">
      <h3 className="oto-section-title">{TITRE}</h3>
      <p className="text-sm text-mute">
        {`Ouverte, toute personne qui a un compte vérifié sur cette application, avec un email d'un de ces domaines, entre dans ${nomOrganisation} comme membre, sans équipe, à sa première connexion ou au premier appel de son assistant. Une personne que vous retirez ne rentre plus, sauf si vous l'invitez de nouveau.`}
      </p>
      <form noValidate onSubmit={(evenement) => void enregistrer(evenement)} className="flex flex-col gap-3">
        <Checkbox checked={ouverte} onChange={(e) => changer(() => setOuverte(e.target.checked))} label="Ouvrir l'entrée sans invitation" />
        <Field label="Domaines d'email admis" hint="Séparés par une virgule : acme.fr, acme.com." error={erreur?.champ ? erreur.message : undefined}>
          <Input type="text" autoComplete="off" value={saisie} onChange={(e) => changer(() => setSaisie(e.target.value))} />
        </Field>
        {erreur && !erreur.champ && <p role="alert">{erreur.message}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={envoi} aria-busy={envoi}>
            {envoi ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {/* Montée vide : l'enregistrement s'y écrit, et s'annonce. */}
          <span role="status" className="text-sm text-mute">
            {enregistre ? "Enregistré." : ""}
          </span>
        </div>
      </form>
    </section>
  )
}
