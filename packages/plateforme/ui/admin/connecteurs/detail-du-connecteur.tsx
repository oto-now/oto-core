// Le détail d'un connecteur (écran Connecteurs), dans un tiroir ouvert par l'adresse : son état et le geste qui le
// répare, qui y a accès, ce que l'assistant peut y faire, sa connexion, le journal de ses partages et sa désactivation.
// Rendu par le serveur : les gestes sont des îlots clients qui ne reçoivent que des données. Le tiroir est celui du
// journal (`TiroirDeConversation`, un `<dialog>` natif : Échap et le bouton le ferment, le focus revient au lien qui l'a
// ouvert). L'écran masque un geste, le service le décide : rien de ce qui est réservé à qui gère le compte ne s'offre
// sous le niveau `manage`.
import type { ReactNode } from "react"
import type { AccountView, ConnectorAccountForm, OrgConnector } from "../../../schemas"
import { ActionPlateforme } from "../../components/action-plateforme"
import { Avatar } from "../../ds/react/primitives"
import { Stat } from "../../ds/react/stat"
import type { SujetsDeRegle } from "../../equipes/types"
import { dateLisible } from "../../format/dates"
import { TiroirDeConversation } from "../../journal/tiroir-de-conversation"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { questionDeDesactivationDuCompte } from "../textes"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { ANCRE_DE_L_ETAT, connexionDe, estAMoi, etatDuCompte, type EtatDuCompte } from "./etat-du-compte"
import { JournalDesPartages } from "./journal-des-partages"
import { actionsParClasse, NIVEAUX_DU_COMPTE, TON_DU_NIVEAU } from "./libelles-des-partages"
import type { PartagesDuCompte } from "./lignes-des-connecteurs"
import { OuvrirLePartage, PartageDuConnecteur, PorteeDuPartage } from "./partage-du-connecteur"
import { SaisieDuCompte } from "./saisie-du-compte"

function Section({ titre, id, action, children }: { titre: string; id?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} tabIndex={id ? -1 : undefined} className="oto-label">
          {titre}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

type Detail = {
  compte: AccountView
  formulaire: ConnectorAccountForm | undefined
  etat: EtatDuCompte
  ici: string
}

/** L'état en un mot, sa précision, et le geste chez le tiers quand il revient à la personne. */
function Etat({ compte, formulaire, etat, ici }: Detail) {
  const chezLeTiers = etat.geste === "connecter" || etat.geste === "reconnecter"
  return (
    <Section titre="État" id={ANCRE_DE_L_ETAT}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 font-medium">
            <span className="oto-dot" data-state={etat.point} aria-hidden="true" />
            {etat.mot}
          </span>
          {etat.precision && <span className="oto-caption">{etat.precision}</span>}
        </div>
        {chezLeTiers && (
          <ConnexionParConsentement
            ressource={connexionDe(formulaire) === "branchement" ? "hosted-link" : "connector-consent"}
            connecteur={compte.connector}
            libelle={etat.geste === "connecter" ? "Connecter" : "Reconnecter"}
            retour={ici}
          />
        )}
      </div>
    </Section>
  )
}

/** Le niveau d'une ligne, en pastille : le mot écrit, la couleur en plus. */
function Niveau({ niveau }: { niveau: AccountView["viewerLevel"] | "none" }) {
  return (
    <span className="oto-share-level" data-niveau={TON_DU_NIVEAU[niveau]}>
      <span className="oto-share-pill">{NIVEAUX_DU_COMPTE[niveau]}</span>
    </span>
  )
}

function LigneDAcces({ nom, etiquette, fin }: { nom: string; etiquette?: ReactNode; fin: ReactNode }) {
  return (
    <li className="oto-pop-row">
      <Avatar name={nom} size="sm" aria-hidden="true" />
      <span className="oto-share-name">
        {nom}
        {etiquette}
      </span>
      {fin}
    </li>
  )
}

/** À qui est le compte : la personne, l'équipe ou l'organisation. */
function proprietaire(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return `Équipe ${owner.teamName ?? "inconnue"}`
  if (owner.kind === "org") return "Toute l'organisation"
  return owner.userName ?? "Une personne qui n'est plus membre"
}

/** Qui gère le compte, pour qui ne le gère pas : la phrase dit à qui demander. */
function gerePar(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return `Géré par les responsables de l'équipe ${owner.teamName ?? "inconnue"}.`
  if (owner.kind === "org") return "Géré par les administrateurs de l'organisation."
  return `Géré par ${owner.userName ?? "une personne qui n'est plus membre"}.`
}

function Partages({ partages }: { partages: PartagesDuCompte }) {
  return (
    <>
      {partages.general && <LigneDAcces nom="Toute l'organisation" fin={<Niveau niveau={partages.general.level} />} />}
      {partages.rules.map((regle) => (
        <LigneDAcces key={regle.id} nom={regle.subject.kind === "team" ? `Équipe ${regle.subject.name}` : regle.subject.name} fin={<Niveau niveau={regle.level} />} />
      ))}
    </>
  )
}

type AccesProps = { compte: AccountView; partages: PartagesDuCompte | undefined; moi: string }

/** Qui a accès : le propriétaire, puis les partages pour qui gère ; pour les autres, leur niveau et qui gère. */
function Acces({ compte, partages, moi }: AccesProps) {
  const gere = compte.viewerLevel === "manage"
  const aMoi = estAMoi(compte, moi)
  const prive = gere && compte.owner.kind === "user" && partages !== undefined && !partages.general && partages.rules.length === 0
  return (
    <Section titre="Accès" action={gere && partages ? <OuvrirLePartage libelle="Gérer les accès" nomAccessible={`Gérer les accès de ${compte.label}`} /> : undefined}>
      <ul className="flex flex-col">
        <LigneDAcces nom={proprietaire(compte.owner)} etiquette={aMoi ? <EtiquetteDeLigne accent>vous</EtiquetteDeLigne> : undefined} fin={<span className="oto-pop-meta">Propriétaire</span>} />
        {gere && partages && <Partages partages={partages} />}
      </ul>
      {prive && <p className="oto-caption">Privé : vous seul l&apos;utilisez tant que vous ne le partagez pas.</p>}
      {!gere && <p className="oto-caption">{`Votre accès : ${NIVEAUX_DU_COMPTE[compte.viewerLevel]}. ${gerePar(compte.owner)}`}</p>}
    </Section>
  )
}

const CLASSES = [
  { classe: "read", titre: "Lecture" },
  { classe: "write", titre: "Écriture" },
  { classe: "sensitive", titre: "Sensibles" },
] as const

function FonctionsDUneClasse({ titre, noms }: { titre: string; noms: string[] }) {
  if (noms.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="oto-caption">{titre}</span>
      <ul className="flex flex-col">
        {noms.map((nom) => (
          <li key={nom} className="font-mono text-sm text-ink">
            {nom}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Ce que l'assistant peut faire : les fonctions du connecteur comptées par classe, et leur liste dépliable. */
function Actions({ fonctions }: { fonctions: OrgConnector["functions"] }) {
  if (fonctions.length === 0) {
    return (
      <Section titre="Ce que l'assistant peut faire">
        <p className="oto-caption">Les actions de cet outil ne sont pas décrites dans cette version de la plateforme.</p>
      </Section>
    )
  }
  const parClasse = actionsParClasse(fonctions)
  return (
    <Section titre="Ce que l'assistant peut faire">
      <div className="flex flex-wrap gap-6">
        <Stat value={parClasse.read} label={parClasse.read > 1 ? "actions de lecture" : "action de lecture"} />
        <Stat value={parClasse.write} label={parClasse.write > 1 ? "actions d'écriture" : "action d'écriture"} />
        <Stat value={parClasse.sensitive} label={parClasse.sensitive > 1 ? "actions sensibles" : "action sensible"} />
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-ink underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ink">Voir les fonctions</summary>
        <div className="mt-2 flex flex-col gap-3">
          {CLASSES.map(({ classe, titre }) => (
            <FonctionsDUneClasse key={classe} titre={titre} noms={fonctions.filter((fonction) => fonction.class === classe).map((fonction) => fonction.name)} />
          ))}
        </div>
      </details>
    </Section>
  )
}

/** Ce que le détail dit de la connexion, jamais la clé : sa date, ou son absence. */
function phraseDeConnexion(compte: AccountView, formulaire: ConnectorAccountForm | undefined): string {
  if (compte.mode !== "reel") return "Connecteur simulé : rien ne sort du serveur."
  const connexion = connexionDe(formulaire)
  const date = dateLisible(compte.secret?.updatedAt)
  if (connexion === "branchement") return "Relié chez le service."
  if (connexion === "consentement") return date ? `Connecté au service le ${date}.` : "Pas encore connecté au service."
  return date ? `Clé posée le ${date}. Jamais réaffichée, jamais transmise à l'assistant.` : "Aucune clé posée."
}

/** La connexion, et pour qui gère un compte réel à clé, la saisie qui la pose ou la remplace. */
function Connexion({ compte, formulaire, etat }: Omit<Detail, "ici">) {
  const aCle = formulaire !== undefined && connexionDe(formulaire) === "saisie" && formulaire.fields.length + formulaire.settings.length > 0
  const saisissable = compte.viewerLevel === "manage" && compte.mode === "reel" && compte.status !== "disabled" && aCle
  return (
    <Section titre="Connexion">
      <p className="text-sm text-ink">{phraseDeConnexion(compte, formulaire)}</p>
      {saisissable && <SaisieDuCompte compte={compte} formulaire={formulaire} libelle={etat.geste === "saisir" ? "Saisir la clé" : "Remplacer la clé"} ouverte={etat.geste === "saisir" || etat.geste === "remplacer"} />}
    </Section>
  )
}

type DetailDuConnecteurProps = {
  compte: AccountView
  /** Le formulaire de son connecteur, quand l'hôte le déclare réel. */
  formulaire: ConnectorAccountForm | undefined
  /** Le nom lisible de l'outil. */
  outil: string
  fonctions: OrgConnector["functions"]
  /** Ses partages, lus par la page pour qui le gère. */
  partages: PartagesDuCompte | undefined
  sujets: SujetsDeRegle
  moi: string
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
  /** L'adresse de la liste sans ce détail : fermer le tiroir y mène. */
  fermer: string
}

export function DetailDuConnecteur({ compte, formulaire, outil, fonctions, partages, sujets, moi, ici, fermer }: DetailDuConnecteurProps) {
  const etat = etatDuCompte(compte, formulaire, moi)
  const gere = compte.viewerLevel === "manage"
  return (
    <TiroirDeConversation titre={compte.label} fermer={fermer}>
      <PorteeDuPartage>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-mute">
              <Avatar name={outil} size="sm" aria-hidden="true" />
              {outil}
            </span>
            {gere && partages && <OuvrirLePartage libelle="Partager" nomAccessible={`Partager ${compte.label}`} variante="primary" />}
          </div>
          <Etat compte={compte} formulaire={formulaire} etat={etat} ici={ici} />
          <Acces compte={compte} partages={partages} moi={moi} />
          <Actions fonctions={fonctions} />
          <Connexion compte={compte} formulaire={formulaire} etat={etat} />
          {gere && <JournalDesPartages compte={compte} />}
          {gere && compte.status !== "disabled" && (
            <ActionPlateforme
              libelle="Désactiver"
              nomAccessible={`Désactiver ${compte.label}`}
              requete={{ methode: "POST", ressource: `admin/accounts/${encodeURIComponent(compte.id)}/disable`, corps: {} }}
              confirmation={{ question: questionDeDesactivationDuCompte(compte.label), libelleConfirmer: "Désactiver" }}
              ancre={ANCRE_DE_L_ETAT}
            />
          )}
        </div>
        {gere && partages && <PartageDuConnecteur compte={{ id: compte.id, label: compte.label, owner: compte.owner }} partages={partages} sujets={sujets} actions={fonctions.length > 0 ? actionsParClasse(fonctions) : null} moi={moi} />}
      </PorteeDuPartage>
    </TiroirDeConversation>
  )
}
