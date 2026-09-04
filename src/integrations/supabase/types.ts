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
  public: {
    Tables: {
      agent_departments: {
        Row: {
          agent_id: string
          department_id: string
          enabled: boolean
          id: string
        }
        Insert: {
          agent_id: string
          department_id: string
          enabled?: boolean
          id?: string
        }
        Update: {
          agent_id?: string
          department_id?: string
          enabled?: boolean
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          field_type: string
          id: string
          label: string
          options: string[]
          position: number
          required: boolean
        }
        Insert: {
          created_at?: string
          field_type?: string
          id?: string
          label: string
          options?: string[]
          position?: number
          required?: boolean
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          label?: string
          options?: string[]
          position?: number
          required?: boolean
        }
        Relationships: []
      }
      customer_shares: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          guest_email: string
          id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          guest_email: string
          id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          guest_email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_shares_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          csat: number
          domain: string
          id: string
          lifetime_value: number
          name: string
          region: string
          tier: string
        }
        Insert: {
          created_at?: string
          csat?: number
          domain?: string
          id?: string
          lifetime_value?: number
          name: string
          region?: string
          tier?: string
        }
        Update: {
          created_at?: string
          csat?: number
          domain?: string
          id?: string
          lifetime_value?: number
          name?: string
          region?: string
          tier?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      kb_articles: {
        Row: {
          author_id: string | null
          author_name: string
          body: string
          category_id: string | null
          created_at: string
          helpful: number
          id: string
          not_helpful: number
          slug: string
          status: string
          summary: string
          tags: string[]
          title: string
          updated_at: string
          views: number
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          body?: string
          category_id?: string | null
          created_at?: string
          helpful?: number
          id?: string
          not_helpful?: number
          slug: string
          status?: string
          summary?: string
          tags?: string[]
          title: string
          updated_at?: string
          views?: number
        }
        Update: {
          author_id?: string | null
          author_name?: string
          body?: string
          category_id?: string | null
          created_at?: string
          helpful?: number
          id?: string
          not_helpful?: number
          slug?: string
          status?: string
          summary?: string
          tags?: string[]
          title?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "kb_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_categories: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          position: number
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          position?: number
          slug: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      kb_feedback: {
        Row: {
          article_id: string
          created_at: string
          helpful: boolean
          id: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          helpful: boolean
          id?: string
          user_id?: string
        }
        Update: {
          article_id?: string
          created_at?: string
          helpful?: boolean
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_feedback_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      macros: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          set_status: Database["public"]["Enums"]["ticket_status"] | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          name: string
          set_status?: Database["public"]["Enums"]["ticket_status"] | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          set_status?: Database["public"]["Enums"]["ticket_status"] | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_hue: number
          created_at: string
          email: string
          full_name: string
          handle: string
          id: string
        }
        Insert: {
          avatar_hue?: number
          created_at?: string
          email: string
          full_name?: string
          handle?: string
          id: string
        }
        Update: {
          avatar_hue?: number
          created_at?: string
          email?: string
          full_name?: string
          handle?: string
          id?: string
        }
        Relationships: []
      }
      saved_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          owner_id: string
          shared: boolean
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          owner_id: string
          shared?: boolean
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          owner_id?: string
          shared?: boolean
        }
        Relationships: []
      }
      sla_policies: {
        Row: {
          first_response_minutes: number
          priority: Database["public"]["Enums"]["ticket_priority"]
          resolution_minutes: number
          updated_at: string
        }
        Insert: {
          first_response_minutes: number
          priority: Database["public"]["Enums"]["ticket_priority"]
          resolution_minutes: number
          updated_at?: string
        }
        Update: {
          first_response_minutes?: number
          priority?: Database["public"]["Enums"]["ticket_priority"]
          resolution_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      ticket_approvals: {
        Row: {
          approver_email: string
          created_at: string
          decided_at: string | null
          id: string
          reason: string
          requested_by: string | null
          requested_by_name: string
          status: string
          subject: string
          ticket_id: string
        }
        Insert: {
          approver_email?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          reason?: string
          requested_by?: string | null
          requested_by_name?: string
          status?: string
          subject?: string
          ticket_id: string
        }
        Update: {
          approver_email?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          reason?: string
          requested_by?: string | null
          requested_by_name?: string
          status?: string
          subject?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_approvals_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_articles: {
        Row: {
          article_id: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_articles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_articles_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          id: string
          summary: string
          ticket_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          id?: string
          summary: string
          ticket_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          id?: string
          summary?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_id: string | null
          author_name: string
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          body: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_time_entries: {
        Row: {
          agent_id: string | null
          agent_name: string
          billable: boolean
          created_at: string
          id: string
          minutes: number
          note: string
          ticket_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string
          billable?: boolean
          created_at?: string
          id?: string
          minutes?: number
          note?: string
          ticket_id: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          billable?: boolean
          created_at?: string
          id?: string
          minutes?: number
          note?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_time_entries_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          ai_sentiment: string
          ai_summary: string
          assignee_id: string | null
          channel: Database["public"]["Enums"]["ticket_channel"]
          code: string
          created_at: string
          customer_id: string | null
          department_id: string | null
          field_values: Json
          first_response_at: string | null
          id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          requester_email: string
          requester_name: string
          requester_title: string
          resolution: string
          resolution_by: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          ai_sentiment?: string
          ai_summary?: string
          assignee_id?: string | null
          channel?: Database["public"]["Enums"]["ticket_channel"]
          code?: string
          created_at?: string
          customer_id?: string | null
          department_id?: string | null
          field_values?: Json
          first_response_at?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          requester_email?: string
          requester_name?: string
          requester_title?: string
          resolution?: string
          resolution_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          ai_sentiment?: string
          ai_summary?: string
          assignee_id?: string | null
          channel?: Database["public"]["Enums"]["ticket_channel"]
          code?: string
          created_at?: string
          customer_id?: string | null
          department_id?: string | null
          field_values?: Json
          first_response_at?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          requester_email?: string
          requester_name?: string
          requester_title?: string
          resolution?: string
          resolution_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agent_department_ids: { Args: { _agent_id: string }; Returns: string[] }
      can_view_ticket: { Args: { _ticket_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_agent: { Args: never; Returns: boolean }
      kb_view: { Args: { _article_id: string }; Returns: undefined }
      kb_vote: {
        Args: { _article_id: string; _helpful: boolean }
        Returns: undefined
      }
      my_email: { Args: never; Returns: string }
      shared_customer_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "agent" | "guest"
      message_kind: "inbound" | "reply" | "note"
      ticket_channel: "email" | "chat" | "portal" | "phone" | "api"
      ticket_priority: "P1" | "P2" | "P3" | "P4"
      ticket_status: "open" | "pending" | "on_hold" | "resolved" | "closed"
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
  public: {
    Enums: {
      app_role: ["admin", "agent", "guest"],
      message_kind: ["inbound", "reply", "note"],
      ticket_channel: ["email", "chat", "portal", "phone", "api"],
      ticket_priority: ["P1", "P2", "P3", "P4"],
      ticket_status: ["open", "pending", "on_hold", "resolved", "closed"],
    },
  },
} as const
