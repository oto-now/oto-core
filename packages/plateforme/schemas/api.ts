// Le préfixe de l'API des écrans, contrat de montage entre l'hôte et le paquet (E11-S07, HN-E11S07-10) : la porte
// (`api/handler.ts`), le client des écrans (`ui/api/client.ts`) et les adresses d'API que les services écrivent
// (fichiers, dépôt par lien) le lisent ici. Sans lui, chaque littéral se renommerait à la main.

/** L'hôte monte la porte du paquet sous ce préfixe : `src/app/api/platform/[...route]/route.ts`. */
export const PLATFORM_API_PREFIX = "/api/platform/"

/**
 * L'adresse d'un fichier, joint ou en transit : `/f/<id>`, la seule qu'un assistant voit et qu'une page cite (fichiers et
 * stockage, § Adresse unique). L'hôte la monte hors du préfixe de la porte, par `src/app/f/[id]/route.ts`, qui réexporte le
 * `GET` de sa route `/api/platform/[...route]` ; `handlePlateforme` la reconnaît à ce chemin.
 */
export const FILE_ADDRESS = "/f"
