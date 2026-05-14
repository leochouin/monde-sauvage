-- Carnet clients par établissement (pourvoirie / propriétaire)
-- Accès : propriétaire de la ligne Etablissement (owner_id = auth.uid())

CREATE TABLE IF NOT EXISTS public.establishment_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public."Etablissement"(key) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT establishment_clients_establishment_full_name_not_empty CHECK (length(trim(full_name)) > 0)
);

COMMENT ON TABLE public.establishment_clients IS 'Contacts clients par établissement (distinct des guide_clients).';
COMMENT ON COLUMN public.establishment_clients.establishment_id IS 'Clé de la table Etablissement (key).';

CREATE INDEX IF NOT EXISTS idx_establishment_clients_establishment_id
  ON public.establishment_clients (establishment_id);
CREATE INDEX IF NOT EXISTS idx_establishment_clients_name
  ON public.establishment_clients (establishment_id, full_name);
CREATE INDEX IF NOT EXISTS idx_establishment_clients_email
  ON public.establishment_clients (establishment_id, email)
  WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS update_establishment_clients_updated_at ON public.establishment_clients;
CREATE TRIGGER update_establishment_clients_updated_at
  BEFORE UPDATE ON public.establishment_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.establishment_clients ENABLE ROW LEVEL SECURITY;

-- Propriétaire d'établissement : CRUD complet
CREATE POLICY "Establishment owners select clients"
ON public.establishment_clients
FOR SELECT
TO authenticated
USING (
  establishment_id IN (
    SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
  )
);

CREATE POLICY "Establishment owners insert clients"
ON public.establishment_clients
FOR INSERT
TO authenticated
WITH CHECK (
  establishment_id IN (
    SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
  )
);

CREATE POLICY "Establishment owners update clients"
ON public.establishment_clients
FOR UPDATE
TO authenticated
USING (
  establishment_id IN (
    SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
  )
)
WITH CHECK (
  establishment_id IN (
    SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
  )
);

CREATE POLICY "Establishment owners delete clients"
ON public.establishment_clients
FOR DELETE
TO authenticated
USING (
  establishment_id IN (
    SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
