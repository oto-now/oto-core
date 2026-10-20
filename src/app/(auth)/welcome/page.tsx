import type { Metadata } from "next"
import { use } from "react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { CoquilleOto, EcranDAuthentification } from "@otomata_tech/oto_platform/ui"
import { marqueDeLAdresse } from "@/lib/plateforme/marque-de-l-adresse"
import { oidcEnabled } from "@/lib/plateforme/oidc-client"
import { fournisseursActives, type FournisseursActives } from "@/lib/supabase/fournisseurs"
import { createClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/utils/safe-next-path"
import { LIEN } from "@/app/(auth)/classes-oto"
import { BoutonsDeFournisseurs } from "../login/boutons-de-fournisseurs"
import { FormulaireNouveauMotDePasse } from "../reset-password/formulaire-nouveau-mot-de-passe"

// L'accueil d'une personne qui vient d'entrer par le lien de son invitation (2026-10-20, demande de JB) : elle a une
// session, mais ni mot de passe ni rien qui lui dise comment revenir. L'îlot lui propose de choisir un mot de passe
// (`resetPasswordAction`, qui ramène à `next`), ou, si l'instance les a, Google ou Microsoft à la même adresse ; « Plus
// tard » mène à la page demandée, et un lien de connexion par email suffira pour revenir. Sans elle, l'invitée entrait
// par « Continuer » sans savoir comment se reconnecter. Propre à Supabase Auth : en mode OIDC, la page n'existe pas.

export const metadata: Metadata = {
  title: "Bienvenue",
}

type WelcomePageProps = { searchParams?: Promise<{ next?: string | string[] }> }

/** Google ou Microsoft, si l'instance les a : « ou » entre deux filets, puis leurs boutons, qui ramènent à `retour`. */
function Fournisseurs({ fournisseurs, retour }: { fournisseurs: Promise<FournisseursActives>; retour: string }) {
  const { google, azure } = use(fournisseurs)
  if (!google && !azure) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="h-px flex-1 bg-hair" />
        <p className="oto-caption">ou</p>
        <div aria-hidden="true" className="h-px flex-1 bg-hair" />
      </div>
      <BoutonsDeFournisseurs google={google} azure={azure} retour={retour === "/" ? undefined : retour} />
    </div>
  )
}

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  if (oidcEnabled()) notFound()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const demande = (await searchParams)?.next
  const suite = safeNextPath(typeof demande === "string" ? demande : undefined)
  const marque = await marqueDeLAdresse()
  const fournisseurs = fournisseursActives()

  return (
    <CoquilleOto theme={marque?.theme} pleinePage>
      <EcranDAuthentification
        marque={marque}
        legende={
          <Link href={suite} className={LIEN}>
            Plus tard
          </Link>
        }
      >
        <FormulaireNouveauMotDePasse
          titre={marque ? `Bienvenue dans ${marque.nomAffiche}` : "Bienvenue"}
          retour={suite}
          intro={
            <p className="text-sm text-mute">
              {`Pour revenir avec ${user.email ?? "cette adresse"}, choisissez un mot de passe. Sans lui, un lien de connexion reçu par email suffira toujours.`}
            </p>
          }
          complement={<Fournisseurs fournisseurs={fournisseurs} retour={suite} />}
        />
      </EcranDAuthentification>
    </CoquilleOto>
  )
}
