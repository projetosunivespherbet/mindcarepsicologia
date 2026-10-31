
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS convenio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS convenio_file_url text,
  ADD COLUMN IF NOT EXISTS imposto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imposto_file_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('appointment-docs', 'appointment-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Psychologists can view own appointment docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'appointment-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Psychologists can upload own appointment docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'appointment-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Psychologists can update own appointment docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'appointment-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Psychologists can delete own appointment docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'appointment-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
