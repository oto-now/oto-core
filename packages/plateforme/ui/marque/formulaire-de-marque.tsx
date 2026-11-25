"use client"

// Formulaire de marque (E09-S01, AC6 à AC10) : huit thèmes et adresse du logo, envoyés
// à `PATCH /api/platform/brand` sur le schéma partagé avec l'API (`schemas/brand.ts`). E05-S13 (AC-3,
// HN-E05S13-2) : plus de « Nom affiché », le nom de l'entreprise est celui de « L'entreprise » ; l'envoi retire
// l'ancien (`display_name: null`), que `readBrand` ne lit plus ; l'îlot devient « Le logo ». Après un
// succès, la page se recharge (`?saved=1`) : le layout de l'hôte reprend alors le thème, et
// `ui/` n'importe aucun routeur.
//
// Porté d'oto-frontend (`routes/settings.appearance.lazy.tsx`, `ThemePicker` de
// `design-system/components/react/product.jsx`, `components/settings/company-identity.tsx`), E05-S09
// partie d2. Repris : deux îlots, « Le logo » puis « La couleur » (ordre d'E05-S11, AC-22 : le
// formulaire est monté dans « Organisation », sous « L'entreprise »), la couleur étant celle de tout compte sans
// choix (AC-4) ; les huit thèmes en cartes
// (`oto-card`, quatre colonnes), la pastille dans la portée de son thème (`.oto[data-oto-theme]`, sur la
// pastille seule), le nom puis la famille en capitales mono, la carte choisie marquée (`data-selected`) ;
// les champs du design system ; l'échec en `Alert`, choisi sur le code ; le bouton en cours d'envoi.
// Changé : les thèmes sont des radios natifs dans un `<fieldset>` (E09-S01, AC6 : les flèches, le nom et la
// famille lus), là où `ThemePicker` pose des boutons `role="radio"`. Retiré : TanStack Query, `useZodForm`,
// `localStorage`, styles en ligne.
import { useId, type ReactNode } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FormProvider, useForm, useFormContext, useFormState, useWatch } from "react-hook-form"
import { brandInputSchema, OTO_THEMES, THEME_LABELS, type BrandInput, type Theme } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { Alert, Button } from "../ds/react/primitives"
import { LogoDOrganisation } from "./logo-d-organisation"
import { StatutDEnregistrement } from "./statut-d-enregistrement"
import type { MarqueDOrganisation } from "./types"

/** Un thème proposé, en carte : un radio natif, masqué à l'œil mais qui prend le focus, que la carte montre. */
function CarteDeTheme({ theme, choisi }: { theme: Theme; choisi: boolean }) {
  const id = useId()
  const { register } = useFormContext<BrandInput>()
  const [nom, famille] = THEME_LABELS[theme]
  return (
    <label
      className="oto-card cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink"
      data-interactive=""
      data-selected={choisi ? "" : undefined}
    >
      <input type="radio" value={theme} className="sr-only" aria-labelledby={`${id}-nom`} aria-describedby={`${id}-famille`} {...register("theme")} />
      <span className="flex items-center gap-2">
        {/* Une `.oto` du thème proposé, sur la pastille seule : `bg-primary` y lit le primaire de ce thème, de jour comme de nuit. */}
        <span aria-hidden="true" className="oto h-5 w-5 shrink-0 rounded-full bg-primary ring-1 ring-island-bd ring-inset" data-oto-theme={theme} />
        <span className="min-w-0 text-start">
          <span id={`${id}-nom`} className="block text-sm font-semibold">
            {nom}
          </span>
          <span id={`${id}-famille`} className="oto-stat-label">
            {famille}
          </span>
        </span>
      </span>
    </label>
  )
}

/** Les huit thèmes nommés : on choisit un thème vérifié, jamais une couleur (ADR-008 § 3). */
function ChoixDuTheme() {
  const choisi = useWatch<BrandInput, "theme">({ name: "theme" })
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Thème</legend>
      <div className="oto-grid" data-cols="4">
        {OTO_THEMES.map((theme) => (
          <CarteDeTheme key={theme} theme={theme} choisi={theme === choisi} />
        ))}
      </div>
      <p className="oto-caption">La couleur de chaque compte qui n&apos;a pas choisi la sienne dans son profil.</p>
    </fieldset>
  )
}

type ChampProps = {
  nom: "logo_url"
  libelle: string
  /** Rendu à droite du champ (l'aperçu du logo actuel). */
  aCote?: ReactNode
}

/** Un champ du design system : son erreur sous lui, reliée par `aria-describedby`. */
function Champ({ nom, libelle, aCote }: ChampProps) {
  const id = useId()
  const { register } = useFormContext<BrandInput>()
  const erreur = useFormState<BrandInput>({ name: nom }).errors[nom]?.message
  return (
    <div className="oto-field">
      <label htmlFor={id} className="oto-field-label">
        {libelle}
      </label>
      <div className="flex items-center gap-3">
        <input id={id} type="url" className="oto-input" data-size="md" aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined} {...register(nom)} />
        {aCote}
      </div>
      {erreur && (
        <p id={`${id}-erreur`} className="oto-field-error">
          {erreur}
        </p>
      )}
    </div>
  )
}

type FormulaireDeMarqueProps = {
  marque: MarqueDOrganisation
  nomOrganisation: string
  /** La page revient d'un enregistrement : le statut le dit, une fois hydraté. */
  enregistre: boolean
}

export function FormulaireDeMarque({ marque, nomOrganisation, enregistre }: FormulaireDeMarqueProps) {
  const titreDeLaCouleur = useId()
  const titreDuLogo = useId()
  const form = useForm<BrandInput>({
    resolver: zodResolver(brandInputSchema),
    mode: "onBlur",
    // `values`, jamais `defaultValues` : les champs suivent la marque servie quand l'écran se relit sans
    // se remonter (`portage-ecrans.md § 2`), comme `FormulaireOrganisation`.
    values: {
      theme: marque.theme,
      logo_url: marque.logo ?? "",
      // Plus de nom affiché (E05-S13, AC-3) : l'enregistrement retire l'ancien, que `readBrand` ne lit plus.
      display_name: null,
    },
  })
  const { errors, isSubmitting } = form.formState

  async function enregistrer(valeurs: BrandInput) {
    const reponse = await appelerPlateforme<BrandInput>({ methode: "PATCH", ressource: "brand", corps: valeurs })
    if (reponse.erreur) {
      form.setError("root", { type: "server", message: messageDErreur(reponse.erreur) })
      return
    }
    // Rechargement complet voulu : la coque relit la couleur servie ; ui/ n'a pas de routeur (ADR-008 § 2).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${window.location.pathname}?saved=1`)
  }

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={(evenement) => void form.handleSubmit(enregistrer)(evenement)} className="flex flex-col gap-3">
        <Island aria-labelledby={titreDuLogo}>
          <IslandHead>
            <h2 id={titreDuLogo}>Le logo</h2>
          </IslandHead>
          <IslandBody className="flex flex-col gap-3">
            <Champ nom="logo_url" libelle="Adresse du logo (https)" aCote={<LogoDOrganisation nom={nomOrganisation} logo={marque.logo} taille={40} />} />
          </IslandBody>
        </Island>
        <Island aria-labelledby={titreDeLaCouleur}>
          <IslandHead>
            <h2 id={titreDeLaCouleur}>La couleur</h2>
          </IslandHead>
          <IslandBody className="flex flex-col gap-3">
            <ChoixDuTheme />
            {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
                {isSubmitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
              {/* Montée d'emblée, remplie après l'hydratation : une région de statut n'annonce que ce qui change après son montage. */}
              <StatutDEnregistrement message={enregistre ? "Marque enregistrée." : ""} />
            </div>
          </IslandBody>
        </Island>
      </form>
    </FormProvider>
  )
}
