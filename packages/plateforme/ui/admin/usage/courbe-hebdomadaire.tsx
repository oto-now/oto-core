// La courbe hebdomadaire de l'onglet Statistiques (1.4.13) : personnes actives et conversations, une valeur par semaine
// de la fenêtre, en SVG dessiné par le serveur, sans bibliothèque de graphiques. Deux séries distinguées par le trait
// (plein, tirets) et par leur légende, jamais par la couleur seule ; l'image est nommée par son résumé, et le tableau
// des semaines qui la suit en donne chaque valeur (`accessibility-patterns.md § Couleurs & Contraste`). Sans elle, la
// tendance se lisait ligne à ligne dans le tableau.
import type { UsageStatistics, UsageWeek } from "../../../schemas"
import { dateCourte } from "../../format/dates"
import { nombreLisible } from "../../format/nombres"

const LARGEUR = 640
const HAUTEUR = 180
const MARGE = { haut: 12, droite: 12, bas: 28, gauche: 36 }

type Semaine = UsageStatistics["adoption"]["weeks"][number]

/** « 14/09 » : le lundi d'une semaine, lu à midi pour rester ce jour-là à Paris. */
const jourCourt = (week: UsageWeek) => (dateCourte(`${week}T12:00:00.000Z`) ?? week).slice(0, 5)

/** Les points d'une série : l'abscisse de chaque semaine, l'ordonnée sur l'échelle commune. */
function points(semaines: readonly Semaine[], valeur: (semaine: Semaine) => number, maximum: number): string {
  const largeur = LARGEUR - MARGE.gauche - MARGE.droite
  const hauteur = HAUTEUR - MARGE.haut - MARGE.bas
  const pas = semaines.length > 1 ? largeur / (semaines.length - 1) : 0
  return semaines
    .map((semaine, rang) => {
      const x = MARGE.gauche + (semaines.length > 1 ? rang * pas : largeur / 2)
      const y = MARGE.haut + hauteur - (maximum === 0 ? 0 : (valeur(semaine) / maximum) * hauteur)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}

/** « Sur 3 semaines : 4 personnes actives et 12 conversations au plus par semaine. » */
function resume(semaines: readonly Semaine[]): string {
  const personnes = Math.max(0, ...semaines.map((semaine) => semaine.people))
  const conversations = Math.max(0, ...semaines.map((semaine) => semaine.conversations))
  return `Activité par semaine, sur ${semaines.length} ${semaines.length > 1 ? "semaines" : "semaine"} : ${nombreLisible(personnes)} personnes actives et ${nombreLisible(conversations)} conversations au plus.`
}

function Legende() {
  return (
    <div className="flex flex-wrap gap-4 oto-caption" aria-hidden="true">
      <span className="flex items-center gap-2">
        <svg width="24" height="8" className="text-primary">
          <line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth="2" />
        </svg>
        Conversations
      </span>
      <span className="flex items-center gap-2">
        <svg width="24" height="8" className="text-ink">
          <line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        Personnes actives
      </span>
    </div>
  )
}

export function CourbeHebdomadaire({ semaines }: { semaines: readonly Semaine[] }) {
  const maximum = Math.max(1, ...semaines.map((semaine) => Math.max(semaine.people, semaine.conversations)))
  const bas = HAUTEUR - MARGE.bas
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} role="img" aria-label={resume(semaines)} className="w-full h-auto">
        <line x1={MARGE.gauche} y1={bas} x2={LARGEUR - MARGE.droite} y2={bas} stroke="currentColor" className="text-hair" />
        <text x={MARGE.gauche - 6} y={MARGE.haut + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-mute">
          {nombreLisible(maximum)}
        </text>
        <text x={MARGE.gauche - 6} y={bas} textAnchor="end" fontSize="11" fill="currentColor" className="text-mute">
          0
        </text>
        <polyline points={points(semaines, (semaine) => semaine.conversations, maximum)} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
        <polyline points={points(semaines, (semaine) => semaine.people, maximum)} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" className="text-ink" />
        {semaines.map((semaine, rang) => {
          const x = MARGE.gauche + (semaines.length > 1 ? (rang * (LARGEUR - MARGE.gauche - MARGE.droite)) / (semaines.length - 1) : (LARGEUR - MARGE.gauche - MARGE.droite) / 2)
          return (
            <text key={semaine.week} x={x} y={HAUTEUR - 8} textAnchor="middle" fontSize="11" fill="currentColor" className="text-mute">
              {jourCourt(semaine.week)}
            </text>
          )
        })}
      </svg>
      <Legende />
    </figure>
  )
}
