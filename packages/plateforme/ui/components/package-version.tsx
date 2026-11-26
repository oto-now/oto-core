"use client"

import { useState } from "react"
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

  // Tokens du jeu Oto : l'écran est rendu sous la `CoquilleOto` du layout `(dashboard)` (E09-S01), où
  // l'anneau de focus du template prenait le `--ring` d'Oto, à 1,13:1 (`portage-ecrans.md § 3`).
  return (
    <div className="flex items-center gap-3 rounded-md bg-card p-3 text-ink ring-1 ring-mute">
      <code className="font-mono select-all">{version}</code>
      <Button type="button" variant="secondary" size="sm" onClick={copyVersion}>
        Copier la version
      </Button>
      <span role="status" aria-live="polite" className="text-sm text-mute">
        {status}
      </span>
    </div>
  )
}
