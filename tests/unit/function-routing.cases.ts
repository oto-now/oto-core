// Le jeu de mesure des fonctions (`routage-et-recherche.md` § Mesure continue sans host) : des demandes en français, chacune
// avec la fonction servie attendue, rejouées sur le catalogue de `@otomata_tech/connectors` (version épinglée, tous les
// connecteurs que le paquet accepte, tous actifs) plus les fonctions du paquet (`function-routing.test.ts`).
// - `direct` : la demande porte les mots de la fonction (nom du service, mot anglais d'usage courant, mot de même
//   début) ; elle compte dans le taux de bonne reconnaissance.
// - `paraphrase` : la demande dit la même chose avec d'autres mots (« fichier » pour « file ») ; son taux est rapporté,
//   sans seuil : le pont du français vers l'anglais des descriptions n'est pas du ressort du classement.
// - `negative` : aucune fonction ne répond ; aucune ne doit être proposée.
// Source : `issue` (demande citée dans le chantier), `écrit` (écrite pour le jeu), `journal` (relevée au journal de
// production, relue et pseudonymisée hors du dépôt). Jamais un nom réel ni une donnée d'un client.

export type FunctionRoutingCase = {
  phrase: string
  /** Le nom servi attendu (`brevo_act.update_template`) ; `null` pour une négative. */
  expected: string | null
  kind: "direct" | "paraphrase" | "negative"
  source: "issue" | "écrit" | "journal"
}

const written = (kind: FunctionRoutingCase["kind"], pairs: [string, string | null][]): FunctionRoutingCase[] =>
  pairs.map(([phrase, expected]) => ({ phrase, expected, kind, source: "écrit" }))

export const FUNCTION_ROUTING_CASES: FunctionRoutingCase[] = [
  { phrase: "mets à jour mon template Brevo", expected: "brevo_act.update_template", kind: "direct", source: "issue" },
  { phrase: "modifie mon modèle d'email Brevo", expected: "brevo_act.update_template", kind: "paraphrase", source: "issue" },
  ...written("direct", [
    ["liste les templates Brevo", "brevo.list_templates"],
    ["crée un template Brevo", "brevo_act.create_template"],
    ["liste les campagnes Brevo", "brevo.list_campaigns"],
    ["liste les contacts Brevo", "brevo.list_contacts"],
    ["envoie un test de la campagne Brevo", "brevo_act.send_campaign_test"],
    ["quels sont les senders vérifiés de Brevo ?", "brevo.list_senders"],
    ["liste les deals du CRM Brevo", "brevo.crm_list_deals"],
    ["cherche un record dans le CRM HubSpot", "hubspot.search_objects"],
    ["liste les owners HubSpot", "hubspot.list_owners"],
    ["liste les propriétés des objets HubSpot", "hubspot.list_properties"],
    ["liste les transactions Qonto", "qonto.list_transactions"],
    ["liste les clients Qonto", "qonto.list_clients"],
    ["les transferts SEPA de Qonto", "qonto.list_sepa_transfers"],
    ["cherche dans le workspace Notion", "notion.search_workspace"],
    ["crée une page Notion", "notion_act.create_page"],
    ["ajoute un commentaire sur la page Notion", "notion_act.add_comment"],
    ["récupère le markdown de la page Notion", "notion.get_page_markdown"],
    ["poste un message sur Slack", "slack_act.post_message"],
    ["liste les channels Slack", "slack.list_channels"],
    ["ajoute une réaction au message Slack", "slack_act.add_reaction"],
    ["l'historique du channel Slack", "slack.history"],
    ["liste mes messages Gmail", "gmail.list_messages"],
    ["liste les labels Gmail", "gmail.list_labels"],
    ["envoie le draft Gmail", "gmail_act.send_draft"],
    ["crée un event dans Google Calendar", "google_calendar_act.create_event"],
    ["crée une issue Linear", "linear_act.create_issue"],
    ["mets à jour l'issue Linear", "linear_act.update_issue"],
    ["archive l'issue Linear", "linear_act.archive_issue"],
    ["liste les teams Linear", "linear.list_teams"],
    ["commente l'issue Linear", "linear_act.create_comment"],
    ["liste les demandes de signature Yousign", "yousign.list_signature_requests"],
    ["crée une demande de signature Yousign depuis un template", "yousign.create_signature_request_from_template"],
    ["les représentants d'une société sur Pappers", "pappers.search_representatives"],
    ["infos d'un établissement par son SIRET dans Sirene", "sirene.get_siret"],
    ["cherche une entreprise par son SIREN dans Sirene", "sirene.get_by_siren"],
    ["vérifie un email avec Hunter", "hunter_act.email_verifier"],
    ["liste les campagnes lemlist", "lemlist.list_campaigns"],
    ["mets en pause la campagne lemlist", "lemlist_act.pause_campaign"],
    ["crée un lead dans une campagne lemlist", "lemlist_act.create_lead"],
    ["les stats de la campagne lemlist", "lemlist.get_campaign_stats_v2"],
    ["exporte le FEC depuis Pennylane", "pennylane.create_fec_export"],
    ["la trial balance Pennylane", "pennylane.get_trial_balance"],
    ["liste les transactions bancaires Pennylane", "pennylane.list_transactions"],
    ["liste les journaux Pennylane", "pennylane.list_journals"],
    ["crée un produit dans Pennylane", "pennylane_act.create_product"],
    ["cherche des records Attio", "attio.search_records"],
    ["crée une note dans Attio", "attio_act.create_note"],
    ["liste les groupes folk", "folk.list_groups"],
    ["crée une personne dans folk", "folk_act.create_person"],
    ["liste les conversations Crisp", "crisp.list_conversations"],
    ["ajoute une note à la conversation Crisp", "crisp_act.add_conversation_note"],
    ["la transcription d'un call Aircall", "aircall.get_call_transcription"],
    ["liste les profils Klaviyo", "klaviyo.list_profiles"],
    ["liste les flows Klaviyo", "klaviyo.list_flows"],
    ["cherche un site SharePoint", "microsoft.search_sites"],
    ["inspecte une URL dans la Search Console", "google_search_console.inspect_url"],
    ["liste les sitemaps de la Search Console", "google_search_console.list_sitemaps"],
    ["génère une image avec OpenAI", "openai_act.generate_image"],
    ["exporte toutes les pages de l'équipe SAV", "node.export_tree"],
    ["ajoute un commentaire sur la page", "comment.add"],
    ["liste les commentaires de la page", "comment.list"],
    ["importe un CSV dans le tableau", "table.import"],
    ["liste les membres de l'organisation", "member.list"],
    ["rends la page publique par un lien", "node.public_link"],
  ]),
  ...written("paraphrase", [
    ["les factures fournisseurs de Qonto", "qonto.list_supplier_invoices"],
    ["les relevés de compte Qonto", "qonto.list_statements"],
    ["déplace la page Notion sous une autre", "notion_act.move_page"],
    ["mets le message Gmail à la corbeille", "gmail_act.trash_message"],
    ["les rendez-vous de mon agenda Google", "google_calendar.list_events"],
    ["partage le fichier Google Drive avec un collègue", "google_drive_act.share_file"],
    ["ajoute des lignes à la feuille Google Sheets", "google_sheets_act.append_rows"],
    ["ajoute un signataire à la demande Yousign", "yousign.add_signer"],
    ["trouve l'adresse email d'une personne avec Hunter", "hunter_act.email_finder"],
    ["démarre la campagne lemlist", "lemlist_act.start_campaign"],
    ["les factures clients de Pennylane", "pennylane.list_customer_invoices"],
    ["marque la tâche folk comme faite", "folk_act.mark_task_done"],
    ["le résumé d'un appel Aircall", "aircall.get_call_summary"],
    ["les réponses au formulaire Typeform", "typeform.list_responses"],
    ["compte les lignes du tableau par statut", "table.aggregate"],
    ["crée une équipe", "team.create"],
    ["déplace la page dans un autre dossier", "node.move"],
  ]),
  ...written("negative", [
    ["rédige le compte rendu de la réunion d'hier", null],
    ["résume cette page en trois points", null],
    ["bonjour, comment vas-tu ?", null],
    ["traduis ce texte en anglais", null],
    ["quels sont nos horaires d'ouverture ?", null],
    ["donne-moi la politique de remboursement des frais", null],
    ["corrige les fautes de ce paragraphe", null],
    ["quelle heure est-il à Tokyo ?", null],
    ["raconte-moi une blague", null],
    ["propose un plan pour la présentation de lundi", null],
    ["explique la différence entre un devis et une facture", null],
    ["créer une tâche", null],
  ]),
]
