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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          appointment_date: string
          convenio: boolean
          convenio_file_url: string | null
          created_at: string
          end_time: string
          id: string
          imposto: boolean
          imposto_file_url: string | null
          patient_id: string
          payment_status: string
          psychologist_id: string
          start_time: string
          status: string
          tipo: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          appointment_date: string
          convenio?: boolean
          convenio_file_url?: string | null
          created_at?: string
          end_time: string
          id?: string
          imposto?: boolean
          imposto_file_url?: string | null
          patient_id: string
          payment_status?: string
          psychologist_id: string
          start_time: string
          status?: string
          tipo?: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          appointment_date?: string
          convenio?: boolean
          convenio_file_url?: string | null
          created_at?: string
          end_time?: string
          id?: string
          imposto?: boolean
          imposto_file_url?: string | null
          patient_id?: string
          payment_status?: string
          psychologist_id?: string
          start_time?: string
          status?: string
          tipo?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean
          psychologist_id: string
          start_time: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_available?: boolean
          psychologist_id: string
          start_time: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean
          psychologist_id?: string
          start_time?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
          created_at: string
          id: string
          next_appointment: string | null
          notes: string | null
          patient_id: string
          payment: Database["public"]["Enums"]["payment_status"]
          psychologist_id: string
          status: Database["public"]["Enums"]["consultation_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          next_appointment?: string | null
          notes?: string | null
          patient_id: string
          payment?: Database["public"]["Enums"]["payment_status"]
          psychologist_id: string
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          next_appointment?: string | null
          notes?: string | null
          patient_id?: string
          payment?: Database["public"]["Enums"]["payment_status"]
          psychologist_id?: string
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_read?: boolean
          receiver_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      patient_profiles: {
        Row: {
          created_at: string
          data_nascimento: string | null
          estado_civil: string | null
          expectativas: string | null
          genero: string | null
          historico_familiar: string | null
          id: string
          medicamentos: string | null
          profissao: string | null
          queixa_principal: string | null
          tratamentos_anteriores: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_nascimento?: string | null
          estado_civil?: string | null
          expectativas?: string | null
          genero?: string | null
          historico_familiar?: string | null
          id?: string
          medicamentos?: string | null
          profissao?: string | null
          queixa_principal?: string | null
          tratamentos_anteriores?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data_nascimento?: string | null
          estado_civil?: string | null
          expectativas?: string | null
          genero?: string | null
          historico_familiar?: string | null
          id?: string
          medicamentos?: string | null
          profissao?: string | null
          queixa_principal?: string | null
          tratamentos_anteriores?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome_completo: string | null
          onboarding_completed: boolean
          role: Database["public"]["Enums"]["user_role"] | null
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          nome_completo?: string | null
          onboarding_completed?: boolean
          role?: Database["public"]["Enums"]["user_role"] | null
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome_completo?: string | null
          onboarding_completed?: boolean
          role?: Database["public"]["Enums"]["user_role"] | null
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      psychologist_patients: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          psychologist_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_id: string
          psychologist_id: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          psychologist_id?: string
        }
        Relationships: []
      }
      psychologist_profiles: {
        Row: {
          created_at: string
          crp: string
          especializacoes: string[] | null
          id: string
          trajetoria_profissional: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          crp: string
          especializacoes?: string[] | null
          id?: string
          trajetoria_profissional?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          crp?: string
          especializacoes?: string[] | null
          id?: string
          trajetoria_profissional?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      psychologist_directory: {
        Row: {
          crp: string | null
          especializacoes: string[] | null
          nome_completo: string | null
          trajetoria_profissional: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_psychologist_busy_slots: {
        Args: { p_psych_id: string }
        Returns: {
          appointment_date: string
          end_time: string
          is_unavailable: boolean
          start_time: string
        }[]
      }
      get_psychologist_crp: { Args: { p_psych_id: string }; Returns: string }
      get_psychologist_directory: {
        Args: never
        Returns: {
          especializacoes: string[]
          trajetoria_profissional: string
          user_id: string
        }[]
      }
    }
    Enums: {
      consultation_status: "em_andamento" | "finalizado" | "cancelado"
      payment_status: "pendente" | "pago" | "nao_pago"
      user_role: "paciente" | "psicologo"
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
      consultation_status: ["em_andamento", "finalizado", "cancelado"],
      payment_status: ["pendente", "pago", "nao_pago"],
      user_role: ["paciente", "psicologo"],
    },
  },
} as const
