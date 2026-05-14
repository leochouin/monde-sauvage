-- get_chalets_nearby reads chalets + Etablissement (Stripe flags). With default
-- SECURITY INVOKER, anon RLS on "Etablissement" can hide stripe_charges_enabled
-- and force COALESCE(..., FALSE) → clients never open Stripe checkout.
-- Run as definer so the catalog RPC returns real payment readiness.

ALTER FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ,
  TIMESTAMPTZ
) SECURITY DEFINER
SET search_path = public, extensions;

COMMENT ON FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ,
  TIMESTAMPTZ
) IS
  'Nearby chalets + availability; Stripe readiness from Etablissement (SECURITY DEFINER so anon sees correct flags).';
