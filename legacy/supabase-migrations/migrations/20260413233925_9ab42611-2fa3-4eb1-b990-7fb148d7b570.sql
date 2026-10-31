
-- Enum for consultation status
CREATE TYPE public.consultation_status AS ENUM ('em_andamento', 'finalizado', 'cancelado');

-- Enum for payment status
CREATE TYPE public.payment_status AS ENUM ('pendente', 'pago', 'nao_pago');

-- Table linking psychologists to patients
CREATE TABLE public.psychologist_patients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  psychologist_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(psychologist_id, patient_id)
);

ALTER TABLE public.psychologist_patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Psychologists can view their patients"
ON public.psychologist_patients FOR SELECT
USING (auth.uid() = psychologist_id OR auth.uid() = patient_id);

CREATE POLICY "Psychologists can add patients"
ON public.psychologist_patients FOR INSERT
WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "Psychologists can remove patients"
ON public.psychologist_patients FOR DELETE
USING (auth.uid() = psychologist_id);

-- Consultations table
CREATE TABLE public.consultations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  psychologist_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  notes TEXT,
  status consultation_status NOT NULL DEFAULT 'em_andamento',
  next_appointment TIMESTAMP WITH TIME ZONE,
  payment payment_status NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Psychologists can view their consultations"
ON public.consultations FOR SELECT
USING (auth.uid() = psychologist_id);

CREATE POLICY "Patients can view their consultations"
ON public.consultations FOR SELECT
USING (auth.uid() = patient_id);

CREATE POLICY "Psychologists can create consultations"
ON public.consultations FOR INSERT
WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "Psychologists can update their consultations"
ON public.consultations FOR UPDATE
USING (auth.uid() = psychologist_id);

CREATE TRIGGER update_consultations_updated_at
BEFORE UPDATE ON public.consultations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Allow patients to view psychologist profiles (for searching)
CREATE POLICY "Patients can view psychologist profiles"
ON public.psychologist_profiles FOR SELECT
USING (true);

-- Allow psychologists to view patient profiles of their patients
CREATE POLICY "Psychologists can view their patient profiles"
ON public.patient_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.psychologist_patients pp
    WHERE pp.psychologist_id = auth.uid()
    AND pp.patient_id = patient_profiles.user_id
  )
);

-- Allow psychologists to view profiles of their patients
CREATE POLICY "Psychologists can view their patients profiles"
ON public.profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.psychologist_patients pp
    WHERE pp.psychologist_id = auth.uid()
    AND pp.patient_id = profiles.user_id
  )
);
