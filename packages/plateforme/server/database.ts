// Généré par `pnpm db:types` (schéma platform) — ne pas modifier à la main.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  platform: {
    Tables: {
      access_rules: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          id: string
          level: string
          node_id: string | null
          org_id: string
          subject_org: boolean
          subject_team_id: string | null
          subject_user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          level: string
          node_id?: string | null
          org_id: string
          subject_org?: boolean
          subject_team_id?: string | null
          subject_user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string
          node_id?: string | null
          org_id?: string
          subject_org?: boolean
          subject_team_id?: string | null
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_rules_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_rules_subject_team_id_fkey"
            columns: ["subject_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          connector: string
          created_at: string
          health: Json
          id: string
          label: string
          mode: string
          org_id: string
          owner_kind: string
          owner_team_id: string | null
          owner_user_id: string | null
          secret_ciphertext: string | null
          status: string
          updated_at: string
        }
        Insert: {
          connector: string
          created_at?: string
          health?: Json
          id?: string
          label: string
          mode?: string
          org_id: string
          owner_kind: string
          owner_team_id?: string | null
          owner_user_id?: string | null
          secret_ciphertext?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          connector?: string
          created_at?: string
          health?: Json
          id?: string
          label?: string
          mode?: string
          org_id?: string
          owner_kind?: string
          owner_team_id?: string | null
          owner_user_id?: string | null
          secret_ciphertext?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_connector_fkey"
            columns: ["connector"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_team_id_fkey"
            columns: ["owner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_journal: {
        Row: {
          args: Json | null
          args_chars: number | null
          ctx: string | null
          duration_ms: number | null
          error: string | null
          host: string | null
          id: number
          is_error: boolean
          method: string
          op: string | null
          org_id: string | null
          result_chars: number | null
          target: string | null
          tool: string | null
          ts: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          args?: Json | null
          args_chars?: number | null
          ctx?: string | null
          duration_ms?: number | null
          error?: string | null
          host?: string | null
          id?: never
          is_error?: boolean
          method: string
          op?: string | null
          org_id?: string | null
          result_chars?: number | null
          target?: string | null
          tool?: string | null
          ts?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          args?: Json | null
          args_chars?: number | null
          ctx?: string | null
          duration_ms?: number | null
          error?: string | null
          host?: string | null
          id?: never
          is_error?: boolean
          method?: string
          op?: string | null
          org_id?: string | null
          result_chars?: number | null
          target?: string | null
          tool?: string | null
          ts?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_journal_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          claimed_by: string | null
          claimed_by_user: string | null
          created_at: string
          created_by: string | null
          data: Json
          id: string
          key: string | null
          lease_until: string | null
          node_id: string
          org_id: string
          position: number | null
          provenance: Json
          revision: number
          search_tsv: unknown
          state: string
          text: string | null
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          claimed_by?: string | null
          claimed_by_user?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          key?: string | null
          lease_until?: string | null
          node_id: string
          org_id: string
          position?: number | null
          provenance?: Json
          revision?: number
          search_tsv?: unknown
          state: string
          text?: string | null
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          claimed_by?: string | null
          claimed_by_user?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          key?: string | null
          lease_until?: string | null
          node_id?: string
          org_id?: string
          position?: number | null
          provenance?: Json
          revision?: number
          search_tsv?: unknown
          state?: string
          text?: string | null
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocks_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_activations: {
        Row: {
          activated_by: string | null
          connector: string
          created_at: string
          org_id: string
          state: string
          updated_at: string
        }
        Insert: {
          activated_by?: string | null
          connector: string
          created_at?: string
          org_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          activated_by?: string | null
          connector?: string
          created_at?: string
          org_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_activations_connector_fkey"
            columns: ["connector"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "connector_activations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          label: string | null
          name: string
        }
        Insert: {
          label?: string | null
          name: string
        }
        Update: {
          label?: string | null
          name?: string
        }
        Relationships: []
      }
      ctx: {
        Row: {
          code: string
          contexts: Json | null
          created_at: string
          host: string | null
          org_id: string
          rules_version: number
          user_agent: string | null
          user_id: string
        }
        Insert: {
          code: string
          contexts?: Json | null
          created_at?: string
          host?: string | null
          org_id: string
          rules_version: number
          user_agent?: string | null
          user_id: string
        }
        Update: {
          code?: string
          contexts?: Json | null
          created_at?: string
          host?: string | null
          org_id?: string
          rules_version?: number
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ctx_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          ctx: string | null
          handled_at: string | null
          handled_by: string | null
          id: number
          number: number
          org_id: string
          resolution: string | null
          state: string
          target: string | null
          text: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          ctx?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: never
          number: number
          org_id: string
          resolution?: string | null
          state?: string
          target?: string | null
          text: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          ctx?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: never
          number?: number
          org_id?: string
          resolution?: string | null
          state?: string
          target?: string | null
          text?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mime: string
          name: string
          node_id: string
          org_id: string
          size: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mime: string
          name: string
          node_id: string
          org_id: string
          size: number
          status: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mime?: string
          name?: string
          node_id?: string
          org_id?: string
          size?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      identities: {
        Row: {
          created_at: string
          issuer: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          issuer: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          issuer?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          declined_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          revoked_at: string | null
          role: string
          team_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          declined_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          revoked_at?: string | null
          role?: string
          team_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          declined_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      journal: {
        Row: {
          account_id: string | null
          args: Json | null
          args_chars: number | null
          ctx: string | null
          duration_ms: number | null
          error: string | null
          host: string | null
          id: number
          is_error: boolean
          method: string
          org_id: string | null
          result_chars: number | null
          target: string | null
          team_id: string | null
          tool: string | null
          ts: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          args?: Json | null
          args_chars?: number | null
          ctx?: string | null
          duration_ms?: number | null
          error?: string | null
          host?: string | null
          id?: never
          is_error?: boolean
          method: string
          org_id?: string | null
          result_chars?: number | null
          target?: string | null
          team_id?: string | null
          tool?: string | null
          ts?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          args?: Json | null
          args_chars?: number | null
          ctx?: string | null
          duration_ms?: number | null
          error?: string | null
          host?: string | null
          id?: never
          is_error?: boolean
          method?: string
          org_id?: string | null
          result_chars?: number | null
          target?: string | null
          team_id?: string | null
          tool?: string | null
          ts?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      lexicon: {
        Row: {
          created_at: string
          org_id: string
          word: string
        }
        Insert: {
          created_at?: string
          org_id: string
          word: string
        }
        Update: {
          created_at?: string
          org_id?: string
          word?: string
        }
        Relationships: [
          {
            foreignKeyName: "lexicon_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      links: {
        Row: {
          id: number
          org_id: string
          source_block_id: string
          source_node_id: string
          target_key: string | null
          target_node_id: string | null
          target_path: string
        }
        Insert: {
          id?: never
          org_id: string
          source_block_id: string
          source_node_id: string
          target_key?: string | null
          target_node_id?: string | null
          target_path: string
        }
        Update: {
          id?: never
          org_id?: string
          source_block_id?: string
          source_node_id?: string
          target_key?: string | null
          target_node_id?: string | null
          target_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "links_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "links_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      member_exclusions: {
        Row: {
          excluded_at: string
          excluded_by: string | null
          org_id: string
          user_id: string
        }
        Insert: {
          excluded_at?: string
          excluded_by?: string | null
          org_id: string
          user_id: string
        }
        Update: {
          excluded_at?: string
          excluded_by?: string | null
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_exclusions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          default_team_id: string | null
          email: string | null
          last_sign_in_at: string | null
          name: string | null
          org_id: string
          profile: Json
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_team_id?: string | null
          email?: string | null
          last_sign_in_at?: string | null
          name?: string | null
          org_id: string
          profile?: Json
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_team_id?: string | null
          email?: string | null
          last_sign_in_at?: string | null
          name?: string | null
          org_id?: string
          profile?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_default_team_id_fkey"
            columns: ["default_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      node_aliases: {
        Row: {
          created_at: string
          created_by: string | null
          node_id: string
          old_path: string
          org_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          node_id: string
          old_path: string
          org_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          node_id?: string
          old_path?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_aliases_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_aliases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      node_drafts: {
        Row: {
          base_revision: number
          created_at: string
          created_by: string | null
          kind: string | null
          meta: Json | null
          node_id: string
          summary: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_revision: number
          created_at?: string
          created_by?: string | null
          kind?: string | null
          meta?: Json | null
          node_id: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_revision?: number
          created_at?: string
          created_by?: string | null
          kind?: string | null
          meta?: Json | null
          node_id?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_drafts_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_shares: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          include_children: boolean
          node_id: string
          org_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          include_children?: boolean
          node_id: string
          org_id: string
          revoked_at?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          include_children?: boolean
          node_id?: string
          org_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_shares_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_shares_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      node_versions: {
        Row: {
          author: string | null
          blocks: Json
          created_at: string
          kind: string
          meta: Json
          node_id: string
          revision: number
          summary: string
          title: string
        }
        Insert: {
          author?: string | null
          blocks?: Json
          created_at?: string
          kind: string
          meta?: Json
          node_id: string
          revision: number
          summary: string
          title: string
        }
        Update: {
          author?: string | null
          blocks?: Json
          created_at?: string
          kind?: string
          meta?: Json
          node_id?: string
          revision?: number
          summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_versions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_views: {
        Row: {
          day: string
          last_at: string
          node_id: string
          org_id: string
          user_id: string
          views: number
        }
        Insert: {
          day?: string
          last_at?: string
          node_id: string
          org_id: string
          user_id: string
          views?: number
        }
        Update: {
          day?: string
          last_at?: string
          node_id?: string
          org_id?: string
          user_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "node_views_member_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "node_views_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          lpath: unknown
          meta: Json
          org_id: string
          owner_kind: string | null
          owner_team_id: string | null
          owner_user_id: string | null
          parent_id: string | null
          path: string
          position: number | null
          revision: number
          search_tsv: unknown
          status: string
          summary: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          lpath?: unknown
          meta?: Json
          org_id: string
          owner_kind?: string | null
          owner_team_id?: string | null
          owner_user_id?: string | null
          parent_id?: string | null
          path: string
          position?: number | null
          revision?: number
          search_tsv?: unknown
          status?: string
          summary: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          lpath?: unknown
          meta?: Json
          org_id?: string
          owner_kind?: string | null
          owner_team_id?: string | null
          owner_user_id?: string | null
          parent_id?: string | null
          path?: string
          position?: number | null
          revision?: number
          search_tsv?: unknown
          status?: string
          summary?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nodes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_owner_team_id_fkey"
            columns: ["owner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      org_domains: {
        Row: {
          created_at: string
          host: string
          org_id: string
        }
        Insert: {
          created_at?: string
          host: string
          org_id: string
        }
        Update: {
          created_at?: string
          host?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          brand: Json
          created_at: string
          flags: Json
          id: string
          name: string
          prefix: string
          rules_version: number
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          brand?: Json
          created_at?: string
          flags?: Json
          id?: string
          name: string
          prefix: string
          rules_version?: number
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          brand?: Json
          created_at?: string
          flags?: Json
          id?: string
          name?: string
          prefix?: string
          rules_version?: number
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          org_id: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          org_id: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          org_id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_staff: {
        Row: {
          added_at: string
          added_by: string | null
          email: string | null
          name: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          email?: string | null
          name?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          email?: string | null
          name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sim_outbox: {
        Row: {
          account_id: string
          connector: string
          created_at: string
          created_by: string | null
          function: string
          id: string
          org_id: string
          payload: Json
          sent_at: string | null
          sent_by: string | null
          status: string
        }
        Insert: {
          account_id: string
          connector: string
          created_at?: string
          created_by?: string | null
          function: string
          id?: string
          org_id: string
          payload?: Json
          sent_at?: string | null
          sent_by?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          connector?: string
          created_at?: string
          created_by?: string | null
          function?: string
          id?: string
          org_id?: string
          payload?: Json
          sent_at?: string | null
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sim_outbox_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_outbox_connector_fkey"
            columns: ["connector"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "sim_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          lead_user_id: string | null
          name: string
          org_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_user_id?: string | null
          name: string
          org_id: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_user_id?: string | null
          name?: string
          org_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_tickets: {
        Row: {
          base_revision: number | null
          created_at: string
          ctx: string | null
          expires_at: string
          form_token_hash: string
          id: string
          key: string | null
          kind: string
          mode: string
          name: string | null
          org_id: string
          publish: boolean | null
          summary: string | null
          target_path: string
          title: string | null
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          base_revision?: number | null
          created_at?: string
          ctx?: string | null
          expires_at: string
          form_token_hash: string
          id?: string
          key?: string | null
          kind: string
          mode: string
          name?: string | null
          org_id: string
          publish?: boolean | null
          summary?: string | null
          target_path: string
          title?: string | null
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          base_revision?: number | null
          created_at?: string
          ctx?: string | null
          expires_at?: string
          form_token_hash?: string
          id?: string
          key?: string | null
          kind?: string
          mode?: string
          name?: string | null
          org_id?: string
          publish?: boolean | null
          summary?: string | null
          target_path?: string
          title?: string | null
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitations: { Args: never; Returns: Json }
      account_secret: { Args: { p_account: string }; Returns: string }
      applied_migrations: {
        Args: never
        Returns: {
          name: string
          version: string
        }[]
      }
      block_search_text: {
        Args: { p_data: Json; p_key: string; p_text: string; p_type: string }
        Returns: string
      }
      consume_upload_ticket: {
        Args: { p_form: boolean; p_hash: string; p_org: string }
        Returns: Json
      }
      create_org: {
        Args: {
          p_hosts?: string[]
          p_name: string
          p_prefix: string
          p_slug: string
        }
        Returns: string
      }
      discard_draft: {
        Args: { p_draft_stamp: string; p_node: string }
        Returns: number
      }
      duplicate_subtree: {
        Args: {
          p_nodes: string[]
          p_position: number
          p_segment: string
          p_source: string
          p_title: string
        }
        Returns: {
          copied_files: Json
          copy_id: string
          copy_path: string
          source_id: string
        }[]
      }
      ensure_private_space: {
        Args: { p_org: string; p_user: string }
        Returns: undefined
      }
      forget_user: { Args: { p_user: string }; Returns: undefined }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      identity_for_caller: { Args: never; Returns: string }
      is_context_path: {
        Args: { p_org: string; p_path: string }
        Returns: boolean
      }
      is_org_admin: { Args: { org: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      join_org: {
        Args: { p_members_max?: number; p_org: string }
        Returns: string
      }
      level_rank: { Args: { p_level: string }; Returns: number }
      lexicon_fix: { Args: { p_org: string; p_word: string }; Returns: string }
      lexicon_rebuild: { Args: { p_org: string }; Returns: undefined }
      lexicon_words: { Args: { p_text: string }; Returns: string[] }
      member_directory: {
        Args: { p_org: string }
        Returns: {
          default_team_id: string
          email: string
          last_sign_in_at: string
          name: string
          role: string
          user_id: string
        }[]
      }
      member_orgs: { Args: never; Returns: string[] }
      node_level_for: {
        Args: {
          p_lpath: unknown
          p_org: string
          p_owner_kind: string
          p_owner_team: string
          p_owner_user: string
        }
        Returns: number
      }
      node_level_of: {
        Args: {
          p_lpath: unknown
          p_org: string
          p_owner_kind: string
          p_owner_team: string
          p_owner_user: string
          p_user: string
        }
        Returns: number
      }
      node_owner: {
        Args: { p_node: string }
        Returns: {
          owner_kind: string
          owner_node_id: string
          owner_team_id: string
          owner_user_id: string
        }[]
      }
      norm: { Args: { t: string }; Returns: string }
      norm_words: { Args: { t: string }; Returns: string }
      oauth_clients_activity: {
        Args: never
        Returns: {
          client_id: string
          client_name: string
          client_type: string
          created_at: string
          last_activity: string
          registration_type: string
          sessions: number
        }[]
      }
      oauth_pending_resource: {
        Args: { p_authorization_id: string }
        Returns: string
      }
      open_draft: {
        Args: { p_node: string }
        Returns: {
          base_revision: number
          created: boolean
        }[]
      }
      open_entry_admits: { Args: { p_org: string }; Returns: boolean }
      open_entry_gate: {
        Args: { p_email: string; p_org: string; p_user: string }
        Returns: boolean
      }
      org_by_host: {
        Args: { p_host: string }
        Returns: {
          brand: Json
          domains: string
          id: string
          name: string
          prefix: string
          slug: string
        }[]
      }
      org_contact: {
        Args: { p_org: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      org_skeleton: {
        Args: {
          p_author: string
          p_hosts: string[]
          p_name: string
          p_prefix: string
          p_slug: string
        }
        Returns: string
      }
      org_usage: {
        Args: { p_org: string }
        Returns: {
          members: number
          pending_invitations: number
        }[]
      }
      platform_access_directory: {
        Args: { p_org: string }
        Returns: {
          email: string
          name: string
          user_id: string
        }[]
      }
      public_file_by_token: {
        Args: { p_file: string; p_org: string; p_token: string }
        Returns: Json
      }
      public_node_by_token: {
        Args: { p_org: string; p_path?: string; p_token: string }
        Returns: Json
      }
      publish_node:
        | {
            Args: {
              p_base_revision: number
              p_draft_stamp: string
              p_links?: Json
              p_node: string
            }
            Returns: number
          }
        | {
            Args: { p_base_revision: number; p_links?: Json; p_node: string }
            Returns: number
          }
      route_candidates: {
        Args: {
          p_kind?: string
          p_limit?: number
          p_org: string
          p_query: string
        }
        Returns: {
          kind: string
          lexical: number
          lexical_title: number
          node_id: string
          owner_team_id: string
          path: string
          query_lexemes: number
          s_phrase: number
          s_summary: number
          s_title: number
          summary: string
          title: string
        }[]
      }
      search_content: {
        Args: {
          p_kinds?: string[]
          p_limit?: number
          p_org: string
          p_query: string
        }
        Returns: {
          block_id: string
          block_key: string
          block_total: number
          block_type: string
          column_name: string
          kind: string
          match: string
          node_id: string
          path: string
          rank: number
          snippet: string
          summary: string
          title: string
        }[]
      }
      signup_org: {
        Args: {
          p_hosts: string[]
          p_name: string
          p_prefix: string
          p_slug: string
        }
        Returns: string
      }
      staff_directory: {
        Args: never
        Returns: {
          added_at: string
          email: string
          name: string
          user_id: string
        }[]
      }
      unique_handle: {
        Args: { p_email: string; p_org: string }
        Returns: string
      }
      update_my_profile: {
        Args: { p_org: string; p_patch: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  platform: {
    Enums: {},
  },
} as const
