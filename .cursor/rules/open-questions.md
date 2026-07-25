# Open Questions

These are genuinely undecided — don't treat anything here as settled, and
don't let an agent quietly pick one without flagging it back to you.

- **Wikidata SPARQL pagination strategy for the cron job.** The public
  endpoint has a ~60s timeout. Need a concrete batching approach (by QID
  range? by offset? by language subsets run separately?) before the full
  ingestion script can be written.

- **UX/presentation design of the cognate graph view.** react-flow is
  chosen as the library, but the actual layout/interaction design (force
  graph? tree layout? how deep does a "family tree" go before it's
  unreadable?) is unsettled.

- **ETL scheduling mechanism.** Options not yet compared: Vercel Cron,
  GitHub Actions on a schedule, Supabase scheduled functions. No strong
  reason yet to prefer one — worth a quick comparison before committing.

- **Versioning/diffing between cron runs.** If the cron job re-pulls
  Wikidata/Behind the Name periodically, what happens to rows that changed
  or disappeared upstream? Naive overwrite risks clobbering anything
  manually corrected later. Not designed yet.

- **Non-Western tradition expansion (post-MVP).** Deliberately out of
  scope for now (see `.cursor/rules/02-cultural-scope.mdc`), but when it's
  picked up, it needs its own data-model design session — don't assume the
  current schema extends cleanly without rethinking it.
