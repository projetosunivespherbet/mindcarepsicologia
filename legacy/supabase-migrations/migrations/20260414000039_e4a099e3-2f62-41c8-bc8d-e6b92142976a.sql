-- Availability slots: recurring weekly slots set by psychologists
CREATE TABLE public.availability_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  psychologist_id UUID NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Psychologists can manage their slots"
ON public.availability_slots FOR ALL
TO authenticated
USING (auth.uid() = psychologist_id)
WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "Patients can view available slots"
ON public.availability_slots FOR SELECT
TO authenticated
USING (is_available = true);

-- Appointments: specific date+time bookings
CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  psychologist_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado', 'confirmado', 'cancelado', 'concluido')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Psychologists can view their appointments"
ON public.appointments FOR SELECT
TO authenticated
USING (auth.uid() = psychologist_id);

CREATE POLICY "Patients can view their appointments"
ON public.appointments FOR SELECT
TO authenticated
USING (auth.uid() = patient_id);

CREATE POLICY "Patients can create appointments"
ON public.appointments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = patient_id);

CREATE POLICY "Psychologists can update appointments"
ON public.appointments FOR UPDATE
TO authenticated
USING (auth.uid() = psychologist_id);

CREATE TRIGGER update_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();