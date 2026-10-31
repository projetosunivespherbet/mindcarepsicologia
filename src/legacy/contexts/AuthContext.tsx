import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  user_id: string;
  nome_completo: string | null;
  email: string | null;
  telefone: string | null;
  role: "paciente" | "psicologo" | null;
  onboarding_completed: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signUp: (email: string, password: string, metadata?: Record<string, unknown>) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const getMetadataString = (metadata: Record<string, unknown>, key: string, maxLength: number) => {
    const value = metadata[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    return trimmed;
  };

  const recoverProfile = async (authUser: User, existingProfile: Profile | null) => {
    const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const metadataRole = metadata.role === "psicologo" ? metadata.role : null;
    const metadataName = getMetadataString(metadata, "nome_completo", 120);
    const metadataPhone = getMetadataString(metadata, "telefone", 30);

    const { data: psychologistRow } = await supabase
      .from("psychologist_profiles")
      .select("user_id")
      .eq("user_id", authUser.id)
      .maybeSingle();

    const inferredRole =
      existingProfile?.role ?? metadataRole ?? (psychologistRow ? "psicologo" : null);

    if (!existingProfile && !inferredRole) {
      return null;
    }

    const recoveredProfile: Profile = {
      id: existingProfile?.id ?? authUser.id,
      user_id: authUser.id,
      nome_completo: existingProfile?.nome_completo ?? metadataName,
      email: existingProfile?.email ?? authUser.email ?? null,
      telefone: existingProfile?.telefone ?? metadataPhone,
      role: inferredRole,
      onboarding_completed:
        existingProfile?.onboarding_completed ?? Boolean(psychologistRow),
    };

    const shouldPersist =
      !existingProfile ||
      existingProfile.role !== recoveredProfile.role ||
      existingProfile.onboarding_completed !== recoveredProfile.onboarding_completed ||
      existingProfile.email !== recoveredProfile.email ||
      existingProfile.nome_completo !== recoveredProfile.nome_completo ||
      existingProfile.telefone !== recoveredProfile.telefone;

    if (shouldPersist) {
      const { data: persistedProfile, error: persistError } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: recoveredProfile.user_id,
            nome_completo: recoveredProfile.nome_completo,
            email: recoveredProfile.email,
            telefone: recoveredProfile.telefone,
            role: recoveredProfile.role,
            onboarding_completed: recoveredProfile.onboarding_completed,
          },
          { onConflict: "user_id" }
        )
        .select("*")
        .single();

      if (persistError) {
        console.error("Error recovering profile:", persistError);
      } else {
        recoveredProfile.id = persistedProfile.id;
        recoveredProfile.nome_completo = persistedProfile.nome_completo;
        recoveredProfile.email = persistedProfile.email;
        recoveredProfile.telefone = persistedProfile.telefone;
        recoveredProfile.role = persistedProfile.role;
        recoveredProfile.onboarding_completed = persistedProfile.onboarding_completed;
      }
    }

    return recoveredProfile;
  };

  const fetchProfile = async (authUser: User) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const resolvedProfile = await recoverProfile(authUser, (data as Profile | null) ?? null);
      setProfile(resolvedProfile);
    } finally {
      setProfileLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Mark profile as loading immediately so consumers wait
          setProfileLoading(true);
          // Fire-and-forget to avoid deadlocks inside the auth callback
          setTimeout(() => {
            fetchProfile(session.user);
          }, 0);
        } else {
          setProfile(null);
          setProfileLoading(false);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setProfileLoading(true);
        fetchProfile(session.user);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assina o estado de auth uma única vez
  }, []);

  const signUp = async (email: string, password: string, metadata?: Record<string, unknown>) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: metadata,
      },
    });
    if (error) throw error;
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, profileLoading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
