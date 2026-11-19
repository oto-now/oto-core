// Fonctions métier de l'ERP, inscrites au catalogue de la plateforme (H108, FR-INST-06) : elles se
// trouvent par <préfixe>_find, se lisent par <préfixe>_read et s'exécutent par <préfixe>_call comme les
// fonctions natives, sans outil de plus. Un besoin nouveau de l'ERP devient une fonction de cette liste.
// L'application de base n'a pas d'ERP : sa liste est vide.
//
// Ce fichier est importé, pour son effet, en tête de chaque route qui monte une porte du paquet
// (`src/app/api/mcp/route.ts`, `src/app/api/platform/[...route]/route.ts`,
// `src/app/api/mcp-admin/route.ts`) et par chaque page qui lit les connecteurs déclarés
// (`src/app/(dashboard)/admin/connectors/page.tsx`) : l'état d'un module vit dans chaque bundle serverless, et une
// route ou une page qui ne l'importe pas sert un catalogue sans ces fonctions ni ces connecteurs (garde :
// `tests/unit/fonctions-metier-imports.test.ts`). `registerFunctions` remplace toute la liste à chaque
// appel ; une fonction mal déclarée lève au chargement de la route, avant de servir un contrat faux.
//
// Exemple : lire un client dans une table de l'ERP (schéma `public`), sous le jeton de l'appelant, donc
// sous la RLS de l'ERP. `ctx.db` est le client du schéma `platform` : jamais pour les données de l'ERP,
// seulement pour appeler un service du paquet avec `ctx.identity`.
//
//   import { createClient } from "@supabase/supabase-js"
//   import * as z from "zod/v4"
//   import { defineErpFunction, fromDatabaseError, PlatformError, registerFunctions } from "@otomata_tech/oto_platform/server"
//
//   const lookupCustomer = defineErpFunction({
//     name: "erp.lookup_customer",
//     class: "read",
//     description: "Reads a customer of the ERP by its code: name and city. Use it before creating an invoice.",
//     schema: z.strictObject({ code: z.string().min(1).describe("Customer code, e.g. C-001.") }),
//     examples: [{ code: "C-001" }],
//     refusals: ["Unknown customer: no customer has this code."],
//     run: async (ctx, args) => {
//       const erp = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
//         global: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
//         auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
//       })
//       const { data, error } = await erp.from("customers").select("code, name, city").eq("code", args.code).maybeSingle()
//       // Une écriture que la RLS de l'ERP refuse devient `forbidden`, un jeton refusé `unauthorized`
//       // (session à reprendre), le reste une panne ; le code part au log, jamais le message de la base.
//       if (error) throw fromDatabaseError(error, "erp.lookup_customer: customers")
//       if (!data) throw new PlatformError("not_found", `Unknown customer ${args.code}.`)
//       return { text: `Customer ${data.code}: ${data.name}, ${data.city}.`, data }
//     },
//   })
//
//   registerFunctions([lookupCustomer])
//
// Une fonction `sensitive` (envoyer, supprimer, payer) déclare aussi `summarize` : le récapitulatif montré
// avant l'accord de la personne, sans rien exécuter. Le contrat d'une fonction servie ne se durcit pas en
// place : une fonction dont les arguments changent s'inscrit sous un autre nom.
//
// Les connecteurs décrits que l'hôte utilise se déclarent ici aussi, avant ses fonctions, par `registerConnectors` :
// des connecteurs partagés (les définitions générées par la fabrique du dépôt `connectors`, dont l'hôte dépend par un
// commit épinglé) et ses connecteurs propres, écrits à la main dans la même forme (`ConnectorDefinition`). Leurs
// fonctions entrent au catalogue de `call` (origine `connecteur`) ; le paquet tient lui-même la liste
// `platform.connectors` et ne demande aucun SQL. L'application de base n'en utilise aucun : sa liste est vide.
//
//   import { notion, pennylane } from "<sortie TypeScript du dépôt connectors>"
//   registerConnectors([notion.connector, pennylane.connector])
import { registerConnectors, registerFunctions } from "@otomata_tech/oto_platform/server"

registerConnectors([])
registerFunctions([])
