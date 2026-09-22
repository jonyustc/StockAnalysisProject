-- =============================================================================
-- Names, year ends and sectors for companies added from a broker ledger.
--
-- A ledger import adds a company it has not seen under its trading code
-- alone, with a placeholder 30 June year end. These three came in that way.
-- Names are as the broker's profit/loss report prints them; year ends and
-- sectors are as published by the companies and DSE, not yet checked here
-- against an annual report — the note says so.
--
-- UPDATE, not INSERT: on a database that never imported that ledger, the
-- companies do not exist and this does nothing.
-- =============================================================================

UPDATE companies c
   SET name = v.name,
       short_name = v.short_name,
       fiscal_year_end_month = v.fye_month,
       fiscal_year_end_day = v.fye_day,
       sector_id = (SELECT id FROM sectors WHERE slug = v.sector_slug),
       notes = 'Added from a broker ledger because you traded it. Name from the broker''s '
            || 'profit/loss report; year end and sector as published, not yet checked '
            || 'against an annual report.'
  FROM (VALUES
      ('GP',         'Grameenphone Ltd.',              'Grameenphone',  12::smallint, 31::smallint, 'telecommunication'),
      ('ITC',        'IT Consultants PLC',             'IT Consultants', 6::smallint, 30::smallint, 'it'),
      ('UNILEVERCL', 'Unilever Consumer Care Limited', 'Unilever CCL',  12::smallint, 31::smallint, 'food-allied')
  ) AS v(symbol, name, short_name, fye_month, fye_day, sector_slug)
 WHERE c.dse_symbol = v.symbol
   AND c.name = c.dse_symbol;   -- only placeholders; never overwrite a name someone entered
