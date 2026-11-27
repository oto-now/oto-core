import pkg from "../../package.json"
import { PackageVersion } from "../components/package-version"
import { ScreenHeader } from "../ds/react/screen-header"

const version: string = pkg.version

export function PlateformeHome() {
  return (
    <>
      {/* `data-entete-empile` : la phrase passe sous le titre, au lieu de le chevaucher à droite à 375 px. */}
      <ScreenHeader title="Plateforme" meta={<span data-entete-empile="">Ce socle est servi par le paquet @otomata_tech/oto_platform.</span>} />
      <PackageVersion version={version} />
    </>
  )
}
