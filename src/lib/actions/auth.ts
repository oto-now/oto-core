"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect, unstable_rethrow } from "next/navigation"
import { oidcEnabled } from "@/lib/plateforme/oidc-client"
import { endOidcSession } from "@/lib/plateforme/oidc-session"
import { acceptPendingInvitations, getRequestOrigin } from "@/lib/plateforme/session"
import {
  confirmerLienSchema,
  forgotPasswordSchema,
  loginSchema,
  magicLinkSchema,
  oauthSignInSchema,
  resetPasswordSchema,
  safeRedirect,
} from "@/lib/schemas/auth"
import { createClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/utils/safe-next-path"
import type { ActionResult } from "@/types"

/**
 * Les messages d'erreur d'auth sont des CONSTANTES, jamais `error.message`.
 * Relayer le message de Supabase au client donne un oracle d'énumération de comptes : ne
 * jamais distinguer « email inconnu » de « mot de passe faux ».
 * Pas d'action d'inscription : on entre par invitation (FR-CONN-01, E02-S01).
 */
const GENERIC_ERROR = "Une erreur est survenue. Réessayez."
const INVALID_CREDENTIALS = "Email ou mot de passe incorrect."
const RESET_CONFIRMATION = "Si un compte existe, un email vous a été envoyé."
const MAGIC_LINK_CONFIRMATION =
  "Si une invitation ou un compte existe pour cette adresse, un lien de connexion vient de partir."
const LINK_ERROR_PATH = "/login?error=auth_callback_error"
/** L'accueil d'une personne qui vient d'entrer par une invitation : un mot de passe, un fournisseur, ou plus tard. */
const WELCOME_PATH = "/welcome"
const PROVIDER_UNAVAILABLE = "Ce mode de connexion n'est pas disponible."
const PROVIDER_START_FAILED = "La connexion avec ce fournisseur n'a pas pu démarrer. Réessayez."

export async function loginAction(formData: FormData): Promise<ActionResult<void>> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: INVALID_CREDENTIALS }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password })
  if (error) return { error: INVALID_CREDENTIALS }

  // Une personne qui a déjà un compte et qu'une invitation attend entre à la connexion (N3).
  await acceptPendingInvitations(data.session)
  revalidatePath("/", "layout")
  // La page demandée avant la connexion (consentement OAuth, E02-S02), sinon `/`.
  redirect(safeRedirect(parsed.data.redirect))
}

export async function magicLinkAction(formData: FormData): Promise<ActionResult<{ message: string }>> {
  // Même réponse pour toute adresse, invalide, inconnue ou refusée par le hook : aucune énumération.
  const confirmation = { data: { message: MAGIC_LINK_CONFIRMATION } }
  // Mode OIDC : on se connecte chez l'émetteur, Supabase Auth n'est pas l'annuaire (HN-E01S11b-12) ; rien n'est tenté.
  if (oidcEnabled()) return confirmation
  const parsed = magicLinkSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return confirmation

  // Le lien ramène à l'adresse d'où on le demande, si elle sert une organisation ou est l'adresse commune (N2) ;
  // sinon aucun lien ne part, et `getRequestOrigin` l'a journalisé.
  const origin = await getRequestOrigin()
  if (!origin) return confirmation
  // La page demandée avant la connexion (E02-S02), encodée : elle porte sa propre requête, et le
  // modèle d'email ajoute `&token_hash=…` à cette adresse, qui doit donc déjà avoir un `?`.
  const retour = safeRedirect(parsed.data.redirect)
  const next = retour === "/" ? "/" : encodeURIComponent(retour)
  const supabase = await createClient()
  // `shouldCreateUser` : une adresse invitée sans compte en reçoit un ; le hook refuse les autres (D1).
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm?next=${next}` },
  })
  if (error) console.error("magicLinkAction: signInWithOtp a échoué", error.status)

  return confirmation
}

/**
 * Démarre la connexion par Google ou Microsoft (E09-S03) : Supabase rend l'adresse du fournisseur, où
 * la personne part. Le retour se fait sur `/auth/callback` de l'adresse d'où elle part, parce que le
 * vérificateur PKCE est posé en cookie sur cet hôte. Un compte ne naît que si une invitation
 * l'attend : le hook « Before User Created » d'E02-S01 filtre aussi les fournisseurs.
 */
export async function connexionFournisseurAction(
  _state: ActionResult<void> | null,
  formData: FormData
): Promise<ActionResult<void>> {
  // Mode OIDC : on se connecte chez l'émetteur, les fournisseurs de Supabase Auth ne servent pas (HN-E01S11b-12).
  if (oidcEnabled()) return { error: PROVIDER_UNAVAILABLE }
  const parsed = oauthSignInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: PROVIDER_UNAVAILABLE }

  // Sans adresse de confiance, aucun retour n'est confié au fournisseur ; `getRequestOrigin` l'a journalisé.
  const origin = await getRequestOrigin()
  if (!origin) return { error: PROVIDER_START_FAILED }
  const provider = parsed.data.fournisseur
  // Le rappel ramène à la page demandée avant la connexion (E02-S02), sinon à `/` comme avant.
  const retour = safeRedirect(parsed.data.redirect)
  const redirectTo = retour === "/" ? `${origin}/auth/callback` : `${origin}/auth/callback?next=${encodeURIComponent(retour)}`
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    // Microsoft : Supabase exige le scope `email` (documentation « Login with Azure »).
    options: { redirectTo, ...(provider === "azure" ? { scopes: "email" } : {}) },
  })
  if (error || !data.url) {
    console.error("connexionFournisseurAction: signInWithOAuth a échoué", error?.status)
    return { error: PROVIDER_START_FAILED }
  }

  redirect(data.url)
}

/**
 * Vérifie le jeton du lien de l'email au clic sur « Continuer » de `/auth/confirm`, jamais à
 * l'ouverture du lien (fiche D11 : une passerelle de messagerie l'ouvrirait avant la personne). Une invitation
 * acceptée mène à l'accueil (`/welcome`), qui propose de choisir comment revenir, puis à la page demandée.
 */
export async function confirmerLienAction(formData: FormData): Promise<never> {
  const parsed = confirmerLienSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) redirect(LINK_ERROR_PATH)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: parsed.data.token_hash })
  if (error) redirect(LINK_ERROR_PATH)

  const rejointes = await acceptPendingInvitations(data.session)
  revalidatePath("/", "layout")
  const suite = safeNextPath(parsed.data.next)
  redirect(rejointes.length > 0 ? `${WELCOME_PATH}?next=${encodeURIComponent(suite)}` : suite)
}

export async function forgotPasswordAction(
  formData: FormData
): Promise<ActionResult<{ message: string }>> {
  // Message de succès même sur email invalide ou inconnu : l'existence d'un compte ne fuite pas.
  const confirmation = { data: { message: RESET_CONFIRMATION } }
  // Mode OIDC : le mot de passe est celui de l'émetteur, Supabase Auth n'a rien à réinitialiser (HN-E01S11b-12).
  if (oidcEnabled()) return confirmation
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return confirmation

  // Le lien ramène à l'adresse d'où on le demande (E09-S02) : l'organisation y est servie, et le
  // vérificateur PKCE, posé en cookie sur cet hôte, y attend le retour. Sans adresse de confiance,
  // aucun lien ne part, et `getRequestOrigin` l'a journalisé.
  const origin = await getRequestOrigin()
  if (!origin) return confirmation
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  })
  // Journalisé côté serveur, jamais renvoyé : la réponse reste identique.
  if (error) console.error("forgotPasswordAction: resetPasswordForEmail a échoué", error.status)

  return confirmation
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult<void>> {
  // Session posée par /auth/callback (lien de l'email) : sans elle, rien à réinitialiser.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Mot de passe invalide" }
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
    if (error) return { error: GENERIC_ERROR }

    revalidatePath("/", "layout")
    // Choisi à l'accueil d'une invitation, il ramène à la page demandée (`next`) ; à la réinitialisation, à `/`.
    redirect(safeNextPath(formData.get("next")))
  } catch (error) {
    // redirect() lève NEXT_REDIRECT : sans ce rethrow, le catch avalerait la redirection.
    unstable_rethrow(error)
    return { error: GENERIC_ERROR }
  }
}

export async function logoutAction(): Promise<never> {
  // Mode OIDC (E01-S11 b, AC-b4) : la session est le cookie de l'hôte, retiré ; puis la personne passe
  // chez l'émetteur, qui ferme la sienne, sans quoi la connexion suivante la rouvrirait sans un mot.
  if (oidcEnabled()) {
    const destination = await endOidcSession(await cookies(), await getRequestOrigin())
    revalidatePath("/", "layout")
    redirect(destination)
  }
  const supabase = await createClient()
  // `local` : seule la session de ce navigateur se ferme. Le défaut de supabase-js (`global`) révoque toutes les
  // sessions de la personne, celles de ses assistants comprises, qui redemandent alors une autorisation.
  const { error } = await supabase.auth.signOut({ scope: "local" })
  if (error) console.error("logoutAction: signOut a échoué", error.status)
  revalidatePath("/", "layout")
  redirect("/login")
}
