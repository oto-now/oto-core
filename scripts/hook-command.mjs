/**
 * Lecture de la commande reçue par les hooks PreToolUse de `.claude/hooks/`, selon l'outil de
 * Claude Code qui la lance : `Bash` ou `PowerShell` (M09). Les deux hooks la partagent : une
 * lecture corrigée dans l'un seulement rouvrirait le trou dans l'autre.
 */

// Les chaînes de chaque shell : leur contenu est du texte, pas une commande.
// Bash : `'…'` sans échappement ; `"…"` où `\` échappe le caractère suivant.
// PowerShell : `'…'` où `''` vaut une apostrophe ; `"…"` où l'accent grave échappe le caractère
// suivant et où `""` vaut un guillemet ; les here-strings `@'…'@` et `@"…"@`, sur plusieurs lignes,
// que prennent les messages de commit. Lue avec la grammaire de Bash, `"C:\dossier\"` se
// prolongeait jusqu'au guillemet suivant et cachait ce qui les séparait, `--no-verify` compris.
const CHAINES = {
  Bash: [/'[^']*'/, /"(?:\\[\s\S]|[^"\\])*"/],
  PowerShell: [/@'\r?\n[\s\S]*?\r?\n'@/, /@"\r?\n[\s\S]*?\r?\n"@/, /'(?:''|[^'])*'/, /"(?:`[\s\S]|""|[^"`])*"/],
}

// Opérateur d'appel de PowerShell (ni `&&`, ni la redirection `>&`), suivi du programme appelé,
// cité ou non : `& "C:\Program Files\Git\cmd\git.exe" commit` lance git.
const APPEL = /(?<![&>])&(?!&)\s*/
const PROGRAMME = /[^\s"';|&<>(){}]+/

/** `"C:\Program Files\Git\cmd\git.exe"` → `git` : sans guillemets, dossier ni extension. */
const nomDuProgramme = (programme) =>
  programme
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, '')

/**
 * Parcourt la commande de gauche à droite, une chaîne entière à la fois : une apostrophe ou un `&`
 * écrits DANS une chaîne n'en ouvrent pas une autre. Deux passes successives, apostrophes puis
 * guillemets, appariaient l'apostrophe de `"l'agent"` avec la chaîne `'…'` suivante, et le texte
 * entre les deux disparaissait. `traiterChaine` décide du sort de chaque chaîne ; le programme
 * lancé par `&` est ramené à son nom.
 */
function parcourir(commande, outil, traiterChaine) {
  const chaine = (outil === 'PowerShell' ? CHAINES.PowerShell : CHAINES.Bash).map((motif) => motif.source).join('|')
  const lecture = new RegExp(`(${APPEL.source})(${chaine}|${PROGRAMME.source})|${chaine}`, 'g')
  return commande.replace(lecture, (texte, appel, programme) =>
    appel === undefined ? traiterChaine(texte) : `${appel}${nomDuProgramme(programme)}`
  )
}

/** Commande dont chaque chaîne est vidée : ce qui reste est ce que le shell exécute. */
export const neutraliser = (commande, outil) =>
  parcourir(commande, outil, (texte) => texte[texte[0] === '@' ? 1 : 0].repeat(2))
