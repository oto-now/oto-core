"use client"

import { useState } from "react"
import { Island, IslandBody } from "../ds/react/island"
import { Button } from "../ds/react/primitives"

type PackageVersionProps = {
  version: string
}

export function PackageVersion({ version }: PackageVersionProps) {
  const [status, setStatus] = useState("")

  async function copyVersion() {
    try {
      await navigator.clipboard.writeText(version)
      setStatus("Copié")
    } catch {
      // Presse-papiers refusé (permission, contexte non sécurisé) : l'échec est annoncé, pas tu.
      setStatus("Copie impossible")
    }
  }

  // L'îlot du design system, sous la `CoquilleOto` du layout `(dashboard)` (E09-S01) : jamais une boîte
  // refaite en utilitaires (`portage-ecrans.md § 3`).
  return (
    <Island aria-label="Version du paquet">
      <IslandBody className="flex items-center gap-3 text-ink">
        <code className="font-mono select-all">{version}</code>
        <Button type="button" variant="secondary" size="sm" onClick={copyVersion}>
          Copier la version
        </Button>
        <span role="status" aria-live="polite" className="text-sm text-mute">
          {status}
        </span>
      </IslandBody>
    </Island>
  )
}
