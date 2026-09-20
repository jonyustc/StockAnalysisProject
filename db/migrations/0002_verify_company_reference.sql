-- =============================================================================
-- Corrections after verifying every company against dsebd.org and its
-- published financial statements.
--
-- Fiscal year ends: all seven seeded guesses turned out correct, so this only
-- replaces the "to verify" notes with what was confirmed and where.
--
--   SQURPHARMA  Jul - Jun   FYE 30 Jun
--   MARICO      Apr - Mar   FYE 31 Mar
--   BERGERPBL   Apr - Mar   FYE 31 Mar
--   RENATA      Jul - Jun   FYE 30 Jun
--   OLYMPIC     Jul - Jun   FYE 30 Jun
--   BSRMSTEEL   Jul - Jun   FYE 30 Jun
--   LHB         Jan - Dec   FYE 31 Dec
--
-- The one real error: LafargeHolcim was seeded as LHBL. DSE's trading code is
-- LHB — dsebd.org returns "No company found" for LHBL. This matters beyond
-- cosmetics, because the daily price job looks companies up by DSE symbol.
--
-- BSRM Ltd (BSRMLTD, Bangladesh Steel Re-Rolling Mills) is added by the seed
-- file rather than here, so a fresh database and an existing one converge on
-- the same reference data.
-- =============================================================================

UPDATE companies
SET dse_symbol  = 'LHB',
    alt_symbols = ARRAY['LHBL'],
    notes       = 'FYE 31 December (Jan-Dec), confirmed. DSE trading code is LHB; LHBL returns no company on dsebd.org.'
WHERE dse_symbol = 'LHBL';

UPDATE companies
SET notes = 'FYE 30 June (Jul-Jun), confirmed against published financial statements.'
WHERE dse_symbol IN ('SQURPHARMA', 'RENATA', 'OLYMPIC', 'BSRMSTEEL');

UPDATE companies
SET notes = 'FYE 31 March (Apr-Mar), confirmed against published financial statements.'
WHERE dse_symbol IN ('MARICO', 'BERGERPBL');
