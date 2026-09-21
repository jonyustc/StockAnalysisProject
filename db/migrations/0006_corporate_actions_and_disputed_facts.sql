-- =============================================================================
-- Resolving the two share-count breaks the import flagged.
--
-- Both were checked against dsebd.org, which publishes each company's paid-up
-- capital, outstanding share count, bonus-issue history and rights-issue
-- history. They turned out to be two different things.
--
-- BERGERPBL — a real corporate action.
--   DSE: "Right Issue: 1R:17, 2025", outstanding 49,105,991.
--   46,377,880 x (1 + 1/17) = 49,105,990, which matches to one share.
--   The FY2025 balance sheet (31 Mar 2025) still shows the pre-issue count,
--   so the issue falls in FY2026 (Apr 2025 - Mar 2026).
--   Adjustment factor, with no confirmed rights price available, is the
--   share-count-only 17/18 = 0.944444444444. That over-adjusts slightly
--   versus a theoretical-ex-rights calculation, but it is far closer than
--   leaving per-share history unadjusted.
--
-- BSRMLTD — NOT a corporate action. The earlier diagnosis was wrong.
--   DSE shows bonus issues only in 2016, 2017 and 2018, no rights issue, and
--   298,584,626 shares outstanding — the count has been unchanged since 2018,
--   right through the years imported.
--   So FY2021's figures are internally inconsistent: net profit of 4,970mn
--   over 298.58mn shares is EPS 16.64, not the 18.96 the source states. Worse,
--   18.96 x 298.58mn = 5,662mn, which would exceed that year's operating
--   profit of 5,230mn — implausible for a company carrying 34,670mn of debt.
--   One of the two figures is wrong at the source.
--   They are marked disputed rather than deleted: the schema has a status for
--   exactly this, and a figure you know to be doubtful is more useful than a
--   hole, provided nothing downstream treats it as settled.
--
-- Incidentally, DSE's dividend history independently confirms every imported
-- dividend_per_share for both companies (Berger 525/525/500/400/400% of a
-- face value of 10; BSRM Ltd 50/35/25/35/50%). That is the one part of the
-- secondary data now corroborated by a primary source.
-- =============================================================================

-- --- Berger: 1-for-17 rights issue, FY2026 -----------------------------------

INSERT INTO corporate_actions (
    company_id, action_type, fiscal_year, ex_date,
    rights_new_shares, rights_per_existing,
    adjustment_factor, verification, notes
)
SELECT c.id, 'rights_issue', 2026, DATE '2025-04-01',
       1, 17,
       17.0 / 18.0, 'unverified',
       'Confirmed from dsebd.org ("Right Issue: 1R:17, 2025") and reconciled against outstanding shares of 49,105,991. '
       'EX-DATE IS A LOWER BOUND, not the confirmed date: it is set to the FY2026 period start because the FY2025 balance '
       'sheet still shows the pre-issue count. Annual per-share adjustment is unaffected by the exact date within the year; '
       'replace it with the real ex-date before using quarterly or daily data. '
       'Factor is share-count-only (17/18) because no rights price is recorded; a theoretical-ex-rights factor would be slightly higher.'
  FROM companies c
 WHERE c.dse_symbol = 'BERGERPBL'
   AND NOT EXISTS (
       SELECT 1 FROM corporate_actions a
        WHERE a.company_id = c.id AND a.action_type = 'rights_issue' AND a.fiscal_year = 2026
   );

-- --- BSRM Ltd: FY2021 EPS and net profit cannot both be right ----------------

-- A subselect rather than UPDATE ... FROM: the target table cannot be
-- referenced inside a FROM-clause join condition.
UPDATE financial_facts
   SET verification = 'disputed',
       note = 'FY2021 EPS and net profit are mutually inconsistent at the source: 4,970mn over the 298.58mn shares DSE '
              'reports gives EPS 16.64, not 18.96, and 18.96 would imply profit above that year''s operating profit. '
              'DSE shows no bonus or rights issue since 2018, so this is not a share-count change. Check the annual report.'
 WHERE id IN (
       SELECT f.id
         FROM financial_facts f
         JOIN fiscal_periods p ON p.id = f.period_id
         JOIN companies c ON c.id = p.company_id
         JOIN line_item_defs l ON l.id = f.line_item_id
        WHERE c.dse_symbol = 'BSRMLTD'
          AND p.fiscal_year = 2021
          AND l.tag IN ('eps_basic', 'net_profit')
 );

-- --- Replace the importer's provisional notes with what was actually found ---

UPDATE companies
   SET notes = 'FYE 31 March (Apr-Mar), confirmed. 1-for-17 rights issue in FY2026 (see corporate_actions); '
               'per-share figures before FY2026 need that adjustment to be comparable.'
 WHERE dse_symbol = 'BERGERPBL';

UPDATE companies
   SET notes = 'FYE 30 June (Jul-Jun), confirmed. Separate listing from BSRMSTEEL; both are tracked. '
               'Share count unchanged at 298,584,626 since the 2018 bonus issue, so the FY2021 EPS/net profit '
               'mismatch is a source data error, not a corporate action — those two facts are marked disputed.'
 WHERE dse_symbol = 'BSRMLTD';
