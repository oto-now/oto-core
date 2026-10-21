// L'adresse d'un fichier, joint ou en transit (fichiers et stockage, § Adresse unique) : `/f/<id>`, la seule qu'un
// assistant voit et qu'une page cite. La porte du paquet la sert, hors de son préfixe : la même route que
// `/api/platform/*`, donc le même jeton de session, la même vérification et les mêmes fonctions de l'ERP inscrites.
export { GET } from "../../api/platform/[...route]/route"
