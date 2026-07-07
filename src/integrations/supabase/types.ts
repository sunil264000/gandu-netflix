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
      anomaly_flags: {
        Row: {
          created_at: string
          id: number
          kind: string
          license_id: string
          meta: Json
          resolved: boolean
          severity: string
        }
        Insert: {
          created_at?: string
          id?: number
          kind: string
          license_id: string
          meta?: Json
          resolved?: boolean
          severity?: string
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          license_id?: string
          meta?: Json
          resolved?: boolean
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_flags_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      archives: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime_type: string | null
          note: string | null
          size_bytes: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          mime_type?: string | null
          note?: string | null
          size_bytes: number
          storage_path: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string | null
          note?: string | null
          size_bytes?: number
          storage_path?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          created_at: string
          ext_version: string | null
          fingerprint_hash: string
          first_seen_ip: string | null
          id: string
          last_seen_at: string
          last_seen_ip: string | null
          license_id: string
          revoked: boolean
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          ext_version?: string | null
          fingerprint_hash: string
          first_seen_ip?: string | null
          id?: string
          last_seen_at?: string
          last_seen_ip?: string | null
          license_id: string
          revoked?: boolean
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          ext_version?: string | null
          fingerprint_hash?: string
          first_seen_ip?: string | null
          id?: string
          last_seen_at?: string
          last_seen_ip?: string | null
          license_id?: string
          revoked?: boolean
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      kill_switch: {
        Row: {
          created_at: string
          license_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          license_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          license_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kill_switch_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      licenses: {
        Row: {
          activated_at: string | null
          created_at: string
          credits_remaining: number
          credits_reset_at: string
          duration_seconds: number
          expires_at: string | null
          hmac_secret: string
          id: string
          is_trial: boolean
          key: string
          notes: string | null
          order_id: string | null
          plan_code: string
          status: string
          trial_fp_hash: string | null
          trial_ip: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          credits_remaining?: number
          credits_reset_at?: string
          duration_seconds?: number
          expires_at?: string | null
          hmac_secret: string
          id?: string
          is_trial?: boolean
          key: string
          notes?: string | null
          order_id?: string | null
          plan_code: string
          status?: string
          trial_fp_hash?: string | null
          trial_ip?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          credits_remaining?: number
          credits_reset_at?: string
          duration_seconds?: number
          expires_at?: string | null
          hmac_secret?: string
          id?: string
          is_trial?: boolean
          key?: string
          notes?: string | null
          order_id?: string | null
          plan_code?: string
          status?: string
          trial_fp_hash?: string | null
          trial_ip?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "licenses_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      orders: {
        Row: {
          amount_inr: number
          created_at: string
          gateway: string
          gateway_ref: string | null
          id: string
          license_id: string | null
          paid_at: string | null
          plan_code: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_inr: number
          created_at?: string
          gateway?: string
          gateway_ref?: string | null
          id?: string
          license_id?: string | null
          paid_at?: string | null
          plan_code: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_inr?: number
          created_at?: string
          gateway?: string
          gateway_ref?: string | null
          id?: string
          license_id?: string | null
          paid_at?: string | null
          plan_code?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          duration_seconds: number
          features: Json
          is_public: boolean
          is_trial: boolean
          max_devices: number
          monthly_credits: number
          name: string
          price_inr: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          duration_seconds?: number
          features?: Json
          is_public?: boolean
          is_trial?: boolean
          max_devices?: number
          monthly_credits?: number
          name: string
          price_inr?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          duration_seconds?: number
          features?: Json
          is_public?: boolean
          is_trial?: boolean
          max_devices?: number
          monthly_credits?: number
          name?: string
          price_inr?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          id: string
          jti: string
          license_id: string
          revoked: boolean
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at: string
          id?: string
          jti: string
          license_id: string
          revoked?: boolean
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          jti?: string
          license_id?: string
          revoked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          action: string
          created_at: string
          credits_spent: number
          device_id: string | null
          id: number
          ip: string | null
          license_id: string
          meta: Json
          ua: string | null
        }
        Insert: {
          action: string
          created_at?: string
          credits_spent?: number
          device_id?: string | null
          id?: number
          ip?: string | null
          license_id: string
          meta?: Json
          ua?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          credits_spent?: number
          device_id?: string | null
          id?: number
          ip?: string | null
          license_id?: string
          meta?: Json
          ua?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
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
          role?: Database["public"]["Enums"]["app_role"]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "user"],
    },
  },
} as const
