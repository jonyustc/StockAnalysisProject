/**
 * node-postgres type parser overrides. Import this before opening any
 * connection — from the app's client and from every script.
 */

import { types } from 'pg'

/**
 * A Postgres DATE has no time and no timezone. By default node-postgres parses
 * it into a JS Date at LOCAL midnight, so '2025-04-01' comes back as
 * 2025-03-31T18:00:00Z in Dhaka (UTC+6) and prints as the wrong day.
 *
 * Every date in this database is a reporting boundary — fiscal period starts
 * and ends, ex-dates, record dates, trade dates — where being off by one day
 * silently misattributes a figure to the wrong period. Keep them as plain
 * 'YYYY-MM-DD' strings, which is also what Drizzle's `date` column type
 * expects.
 */
types.setTypeParser(types.builtins.DATE, (value) => value)

/**
 * NUMERIC is deliberately left as a string. JavaScript numbers are IEEE-754
 * doubles and cannot represent every value a numeric(24,6) can hold; parsing
 * financial figures to float on the way out of the database would lose
 * precision invisibly. Convert explicitly at the point of use instead.
 */
