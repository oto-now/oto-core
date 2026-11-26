// Le détail d'un connecteur (écran Connecteurs), dans un tiroir ouvert par l'adresse. En tête : la tuile de l'outil,
// l'outil et la façon de s'y connecter, puis pour qui le gère les gestes courants (« Partager », « Modifier le nom »),
// et l'état, avec son geste (« Tester », « Reconnecter »). Puis qui peut s'en servir, comment s'en servir pour qui le
// reçoit en partage, ce que l'assistant peut y faire (les groupes que son niveau ouvre), la connexion et sa clé, et à
// part, en bas, « Arrêter » : désactiver ou réactiver le connecteur, et pour un administrateur bloquer ou débloquer son
// outil pour toute l'organisation.
// Rendu par le serveur : les gestes sont des îlots clients qui ne reçoivent que des données. Le tiroir est celui du
// journal en large (`TiroirDeConversation`, `taille="lg"`, un `<dialog>` natif : Échap et le bouton le ferment, le focus revient au lien qui l'a
// ouvert). L'écran masque un geste, le service le décide : rien de ce qui est réservé à qui gère le compte ne s'offre
// sous le niveau `manage`, rien de la gouvernance de l'outil à qui n'administre pas.
import type { ReactNode } from "react"
import type { AccountView, ConnectorAccountForm, DeactivationImpact, OrgConnector } from "../../../schemas"
import { ActionPlateforme } from "../../components/action-plateforme"
import { Avatar } from "../../ds/react/primitives"
import type { SujetsDeRegle } from "../../equipes/types"
import { dateLisible } from "../../format/dates"
import { TiroirDeConversation } from "../../journal/tiroir-de-conversation"
import { EtiquetteDeLigne } from "../../noeud/partage-visuel"
import { questionDeDesactivationDuCompte } from "../textes"
import { BlocageDeLOutil, DeblocageDeLOutil } from "./blocage-de-l-outil"
import { ConnexionParConsentement } from "./connexion-par-consentement"
import { ANCRE_DE_L_ETAT, connexionDe, echecDuDernierTest, estAMoi, etatDuCompte, type BloqueurDeLOutil as Blocage, type EtatDuCompte } from "./etat-du-compte"
import { classesDuNiveau, FonctionsDuConnecteur } from "./fonctions-du-connecteur"
import { JournalDesPartages } from "./journal-des-partages"
import { actionsParClasse, NIVEAUX_DU_COMPTE, nomDe, TON_DU_NIVEAU } from "./libelles-des-partages"
import type { PartagesDuCompte } from "./lignes-des-connecteurs"
import { ModificationDuConnecteur } from "./modification-du-connecteur"
import { OuvrirLePartage, PartageDuConnecteur, PorteeDuPartage } from "./partage-du-connecteur"
import { REFUS_DE_LA_REACTIVATION } from "./refus-des-connecteurs"
import { SaisieDuCompte } from "./saisie-du-compte"
import { DetailDuTest, TestDuConnecteur } from "./test-de-connexion"
import { TuileDeLOutil } from "./tuile-de-l-outil"

function Section({ titre, children, zone = false }: { titre: string; children: ReactNode; zone?: boolean }) {
  return (
    <>
      <hr className="oto-separator" data-orientation="horizontal" />
      <section className={`flex flex-col gap-3 ${zone ? "rounded-lg bg-desk p-4" : ""}`}>
        <h3 className="text-base font-bold text-ink">{titre}</h3>
        {children}
      </section>
    </>
  )
}

type Detail = { compte: AccountView; formulaire: ConnectorAccountForm | undefined; etat: EtatDuCompte; ici: string }

/** L'état en un mot et sa précision, le geste chez le tiers quand il revient à la personne, et le test pour qui gère. */
function Etat({ compte, formulaire, etat, ici }: Detail) {
  const chezLeTiers = etat.geste === "connecter" || etat.geste === "reconnecter"
  const gereUnReel = compte.viewerLevel === "manage" && compte.mode === "reel" && formulaire !== undefined && etat.code !== "bloque"
  const echec = echecDuDernierTest(compte)
  // L'outil bloqué : qui l'a bloqué et ce que ça arrête tiennent une phrase entière, sur sa ligne.
  const surSaLigne = etat.code === "bloque"
  return (
    // Une bande : l'état et sa précision sur une ligne, le geste à droite. Elle reçoit le focus quand un geste emporte le sien.
    <div id={ANCRE_DE_L_ETAT} tabIndex={-1} role="group" aria-label="État" className="flex flex-col gap-2 rounded-lg bg-card p-3 focus-visible:ring-2 focus-visible:ring-ink">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="oto-etat inline-flex items-center gap-2 font-medium" data-state={etat.point}>
            <span className="oto-dot" data-state={etat.point} aria-hidden="true" />
            {etat.mot}
          </span>
          {etat.precision && !surSaLigne && <span className="oto-caption">{`· ${etat.precision.charAt(0).toLowerCase()}${etat.precision.slice(1)}`}</span>}
        </p>
        {chezLeTiers && (
          <ConnexionParConsentement
            ressource={connexionDe(formulaire) === "branchement" ? "hosted-link" : "connector-consent"}
            connecteur={compte.connector}
            acces={compte.access}
            libelle={etat.geste === "connecter" ? "Connecter" : "Reconnecter"}
            retour={ici}
          />
        )}
        {gereUnReel && formulaire.probe.available && etat.code !== "a_terminer" && <TestDuConnecteur compte={{ id: compte.id, label: compte.label }} />}
      </div>
      {etat.precision && surSaLigne && <p className="oto-caption">{etat.precision}</p>}
      {echec && <DetailDuTest raison={echec} />}
      {gereUnReel && !formulaire.probe.available && connexionDe(formulaire) === "saisie" && <p className="oto-caption">Pas de test automatique pour cet outil : essayez-le dans votre assistant.</p>}
    </div>
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

function LigneDAcces({ nom, vous = false, fin }: { nom: string; vous?: boolean; fin: ReactNode }) {
  return (
    <li className="oto-pop-row">
      <Avatar name={nom} size="sm" aria-hidden="true" />
      <span className="oto-share-name">
        {nom}
        {vous && <EtiquetteDeLigne accent>vous</EtiquetteDeLigne>}
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

/** Qui gère le compte, pour qui ne le gère pas : à qui demander. */
function gestionnaire(owner: AccountView["owner"]): string {
  if (owner.kind === "team") return `un responsable de l'équipe ${owner.teamName ?? "inconnue"}`
  if (owner.kind === "org") return "un administrateur de l'organisation"
  return owner.userName ?? "une personne qui n'est plus membre"
}

type AccesProps = { compte: AccountView; partages: PartagesDuCompte | undefined; moi: string; nomDeMoi: string }

/** Qui peut s'en servir : le propriétaire, puis les partages pour qui gère ; pour les autres, leur propre niveau. */
function Acces({ compte, partages, moi, nomDeMoi }: AccesProps) {
  const gere = compte.viewerLevel === "manage"
  const aMoi = estAMoi(compte, moi)
  const partage = partages !== undefined && (partages.general !== null || partages.rules.length > 0)
  return (
    <Section titre="Qui peut s'en servir">
      <ul className="flex flex-col">
        <LigneDAcces nom={proprietaire(compte.owner)} vous={aMoi} fin={<span className="oto-pop-meta">Propriétaire</span>} />
        {gere && partages?.general && <LigneDAcces nom="Toute l'organisation" fin={<Niveau niveau={partages.general.level} />} />}
        {gere &&
          partages?.rules.map((regle) => (
            <LigneDAcces key={regle.id} nom={regle.subject.kind === "team" ? `Équipe ${regle.subject.name}` : regle.subject.name} vous={regle.subject.id === moi} fin={<Niveau niveau={regle.level} />} />
          ))}
        {!gere && <LigneDAcces nom={nomDeMoi} vous fin={<Niveau niveau={compte.viewerLevel} />} />}
      </ul>
      {gere && aMoi && !partage && <p className="oto-caption">Privé : vous seul l&apos;utilisez tant que vous ne le partagez pas.</p>}
      {gere && aMoi && partage && <p className="oto-caption">Ceux avec qui vous le partagez s&apos;en servent en le nommant ; leur assistant y agit en votre nom.</p>}
      {!gere && <p className="oto-caption">{`Géré par ${gestionnaire(compte.owner)}.`}</p>}
      {gere && <JournalDesPartages compte={compte} />}
    </Section>
  )
}

/** Pour qui reçoit en partage le connecteur personnel d'un autre : le nommer, et au nom de qui il agit. */
function CommentVousEnServir({ compte, formulaire }: { compte: AccountView; formulaire: ConnectorAccountForm | undefined }) {
  const qui = compte.owner.userName ?? "une personne qui n'est plus membre"
  const chezLeTiers = connexionDe(formulaire) !== "saisie"
  return (
    <Section titre="Comment vous en servir">
      <p className="text-sm text-ink">{`Nommez « ${compte.label} » quand vous demandez quelque chose à votre assistant : un connecteur partagé ne sert que nommé.`}</p>
      <p className="oto-caption">
        {chezLeTiers
          ? `Ce que votre assistant y fait passe par le compte de ${qui}, en son nom. S'il faut le reconnecter, seule cette personne peut le faire.`
          : `Ce que votre assistant y fait passe par la clé de ${qui}, qui reste cachée.`}
      </p>
    </Section>
  )
}

/** Sous les fonctions, pour qui ne gère pas et n'a pas tout : le niveau qu'il lui faudrait, et à qui le demander. */
function NiveauAManquer({ compte }: { compte: AccountView }) {
  if (compte.viewerLevel === "manage" || compte.viewerLevel === "sensitive") return null
  const suivant = compte.viewerLevel === "read" ? "write" : "sensitive"
  const pour = compte.viewerLevel === "read" ? "créer ou modifier" : "envoyer ou supprimer"
  return <p className="oto-caption">{`Niveau « ${NIVEAUX_DU_COMPTE[compte.viewerLevel]} ». Pour ${pour}, demandez « ${NIVEAUX_DU_COMPTE[suivant]} » à ${gestionnaire(compte.owner)}.`}</p>
}

/**
 * Sous le nom : l'outil, la façon de s'y connecter, et la date de la clé ou de la connexion, jamais la clé ; à qui
 * appartient un compte connecté chez le tiers.
 */
function contexte(compte: AccountView, formulaire: ConnectorAccountForm | undefined, outil: string, moi: string): string {
  if (compte.mode !== "reel") return `${outil} · simulé, rien ne sort du serveur`
  const connexion = connexionDe(formulaire)
  const date = dateLisible(compte.secret?.updatedAt)
  if (connexion === "saisie") return `${outil} · ${date ? `clé posée le ${date}` : "aucune clé posée"}`
  const compteDe = estAMoi(compte, moi) ? "votre compte" : compte.owner.kind === "user" ? `compte de ${compte.owner.userName ?? "une personne qui n'est plus membre"}` : "compte relié"
  if (connexion === "branchement") return `${outil} · ${compteDe}, relié chez le service`
  return `${outil} · ${compteDe}, ${date ? `connecté le ${date}` : "pas encore connecté"}`
}

/**
 * Pour qui gère un compte réel à clé : la saisie qui la pose ou la remplace ; un compte désactivé la garde, pour poser
 * une nouvelle clé et la tester avant de le réactiver.
 */
function Cle({ compte, formulaire, etat }: Omit<Detail, "ici">) {
  const aCle = formulaire !== undefined && connexionDe(formulaire) === "saisie" && formulaire.fields.length + formulaire.settings.length > 0
  if (compte.viewerLevel !== "manage" || compte.mode !== "reel" || !aCle) return null
  return <SaisieDuCompte compte={compte} formulaire={formulaire} libelle={etat.geste === "saisir" ? "Saisir la clé" : "Remplacer la clé"} ouverte={etat.geste === "saisir" || etat.geste === "remplacer"} />
}

function Ligne({ titre, texte, children }: { titre: string; texte: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-ink">{titre}</span>
        <span className="oto-caption">{texte}</span>
      </div>
      {children}
    </div>
  )
}

/** Ce qu'un administrateur lit et fait de l'outil d'un connecteur : son blocage pour toute l'organisation. */
export type GouvernanceDeLOutil = { impact: DeactivationImpact | undefined; actif: boolean }

type ArreterProps = { compte: AccountView; outil: string; bloquePar: Blocage; gouvernance: GouvernanceDeLOutil | undefined }

/** « Arrêter », à part, en bas : le connecteur pour qui le gère, son outil pour un administrateur. */
function Arreter({ compte, outil, bloquePar, gouvernance }: ArreterProps) {
  const gere = compte.viewerLevel === "manage"
  if (!gere && !gouvernance) return null
  const ressource = `admin/accounts/${encodeURIComponent(compte.id)}`
  return (
    <Section titre="Arrêter" zone>
      {gere && compte.status !== "disabled" && (
        <Ligne titre="Désactiver ce connecteur" texte="Plus aucun assistant ne s'en sert. Vous pourrez le réactiver.">
          <ActionPlateforme
            libelle="Désactiver"
            nomAccessible={`Désactiver ${compte.label}`}
            requete={{ methode: "POST", ressource: `${ressource}/disable`, corps: {} }}
            confirmation={{ question: questionDeDesactivationDuCompte(compte.label), libelleConfirmer: "Désactiver" }}
            ancre={ANCRE_DE_L_ETAT}
          />
        </Ligne>
      )}
      {gere && compte.status === "disabled" && (
        <Ligne titre="Réactiver ce connecteur" texte="Les assistants s'en servent de nouveau, avec sa clé ou sa connexion.">
          <ActionPlateforme libelle="Réactiver" nomAccessible={`Réactiver ${compte.label}`} requete={{ methode: "POST", ressource: `${ressource}/enable`, corps: {} }} messages={REFUS_DE_LA_REACTIVATION} ancre={ANCRE_DE_L_ETAT} />
        </Ligne>
      )}
      {gouvernance && bloquePar === null && (
        <Ligne titre={`Bloquer ${outil} pour l'organisation`} texte={`Tous les connecteurs ${outil} de l'organisation cessent de répondre.`}>
          <BlocageDeLOutil connecteur={compte.connector} outil={outil} impact={gouvernance.impact} actif={gouvernance.actif} presentation="bouton" ancre={ANCRE_DE_L_ETAT} />
        </Ligne>
      )}
      {gouvernance && bloquePar !== null && (
        <Ligne titre={`Débloquer ${outil} pour l'organisation`} texte="Ses connecteurs repartent tels quels.">
          <DeblocageDeLOutil connecteur={compte.connector} outil={outil} ancre={ANCRE_DE_L_ETAT} />
        </Ligne>
      )}
    </Section>
  )
}

type DetailDuConnecteurProps = {
  compte: AccountView
  /** Le formulaire de son connecteur, quand l'hôte le déclare réel. */
  formulaire: ConnectorAccountForm | undefined
  /** Le nom lisible de l'outil. */
  outil: string
  /** L'adresse du logo de l'outil (`logoDe`), `null` sans domaine déclaré. */
  logo: string | null
  fonctions: OrgConnector["functions"]
  /** Qui a bloqué son outil pour l'organisation (`bloquePar`) ; `null` : il ne l'est pas. */
  bloquePar: Blocage
  /** Pour un administrateur : bloquer ou débloquer l'outil. Absent pour un membre. */
  gouvernance?: GouvernanceDeLOutil
  /** Ses partages, lus par la page pour qui le gère. */
  partages: PartagesDuCompte | undefined
  sujets: SujetsDeRegle
  moi: string
  /** L'adresse de l'écran : un consentement y revient. */
  ici: string
  /** L'adresse de la liste sans ce détail : fermer le tiroir y mène. */
  fermer: string
  /** Le partage s'ouvre d'emblée : un partage choisi avant la connexion n'a pas pu se poser. */
  partagerDAbord?: boolean
}

export function DetailDuConnecteur({ compte, formulaire, outil, logo, fonctions, bloquePar, gouvernance, partages, sujets, moi, ici, fermer, partagerDAbord = false }: DetailDuConnecteurProps) {
  const etat = etatDuCompte(compte, formulaire, moi, bloquePar)
  const gere = compte.viewerLevel === "manage"
  // Un connecteur éteint (désactivé, outil bloqué) ne sert à personne : ni mode d'emploi, ni niveau à demander.
  const eteint = etat.code === "desactive" || etat.code === "bloque"
  const recu = !gere && compte.owner.kind === "user" && !eteint
  const titre = (
    <span className="flex min-w-0 items-center gap-3">
      <TuileDeLOutil nom={outil} logo={logo} />
      <span className="min-w-0">{compte.label}</span>
    </span>
  )
  return (
    <TiroirDeConversation titre={titre} fermer={fermer} taille="lg">
      <PorteeDuPartage ouvert={partagerDAbord && compte.viewerLevel === "manage" && partages !== undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-ink">{contexte(compte, formulaire, outil, moi)}</span>
            {compte.description && <p className="oto-caption">{compte.description}</p>}
          </div>
          {gere && (
            <ModificationDuConnecteur
              compte={{ id: compte.id, label: compte.label, description: compte.description }}
              avant={partages ? <OuvrirLePartage libelle="Partager" nomAccessible={`Partager ${compte.label}`} variante="primary" /> : undefined}
            />
          )}
          <Etat compte={compte} formulaire={formulaire} etat={etat} ici={ici} />
          <Cle compte={compte} formulaire={formulaire} etat={etat} />
          <Acces compte={compte} partages={partages} moi={moi} nomDeMoi={nomDe(sujets, moi)} />
          {recu && <CommentVousEnServir compte={compte} formulaire={formulaire} />}
          <hr className="oto-separator" data-orientation="horizontal" />
          <FonctionsDuConnecteur titre="Ce que votre assistant peut faire" fonctions={fonctions} classes={classesDuNiveau(compte.viewerLevel)} pied={!gere && !eteint && <NiveauAManquer compte={compte} />} />
          <Arreter compte={compte} outil={outil} bloquePar={bloquePar} gouvernance={gouvernance} />
        </div>
        {gere && partages && (
          <PartageDuConnecteur
            compte={{ id: compte.id, label: compte.label, owner: compte.owner }}
            partages={partages}
            sujets={sujets}
            actions={fonctions.length > 0 ? actionsParClasse(fonctions) : null}
            moi={moi}
            administre={gouvernance !== undefined}
            parAutorisation={connexionDe(formulaire) !== "saisie" && compte.owner.kind === "user"}
          />
        )}
      </PorteeDuPartage>
    </TiroirDeConversation>
  )
}
