/**
 * The one query behind every winnable-keywords issue, kept in its own module
 * because it is the report's argument, not plumbing — every clause below is a
 * claim about what "winnable" means, and it belongs somewhere it can be read
 * and disagreed with.
 *
 * It runs against the ideaminer analytics database, read-only, and is never
 * run by CI: see the header of scripts/aso.mjs for why the snapshot is
 * committed instead.
 */

/** Tokens shorter than this are skipped by the brand filter — "go", "2p", "3d". */
export const BRAND_MIN_LEN = 3;
/** A token carried by fewer app names than this is a product name, not vocabulary. */
export const BRAND_MIN_DF = 50;
/** Demand floor. Below it the phrase is not worth a row whatever else is true. */
export const DEMAND_FLOOR = 0.5;
/** How much of the top 10 a big developer may hold before it stops being winnable. */
export const MAX_BIG_DEV_SLOTS = 3;
/** Exact-title matches allowed. Two or more and the term is somebody's name. */
export const MAX_TITLE_MATCHES = 1;

export const HARVEST_SQL = `
with params as (
  select :'cat'::text category, :'country'::text country, :'lang'::text language,
         -- Exclusive upper bound: the first instant after the month this issue
         -- reports on. Without it the query read every row ever recorded, so an
         -- issue labelled August was built partly from September — the caption,
         -- the JSON-LD temporalCoverage and the data all disagreed, and next
         -- month's issue would have been assembled from the same rows.
         --
         -- Only the rank tables can be bounded. keyword_judgment and
         -- keyword_ceiling are current-state rollups with no history, so the
         -- scores are necessarily as-of build time; that is why the page says
         -- "as of" rather than claiming the month is the sample.
         (:'month_end')::timestamp as until
),

-- A keyword carries no category of its own, so it borrows the one the apps
-- holding its top 10 belong to. Verified against the data: this attributes
-- 52k keywords to game_puzzle alone, which is depth enough to pick from.
cat as (
  select krc.keyword
  from keyword_rank_changes krc
  join apps a on a.app_id = krc.app_id
  join params p on true
  where krc.country = p.country and krc.rank <= 10 and a.category = p.category
    and krc.captured_at < p.until
  group by 1
),

base as (
  select kj.keyword, kj.demand_final, kj.title_matches, kj.big_dev_slots,
         kj.churn_events, kj.ranked_apps, kj.verdict, kj.ceiling_verdict, kj.words,
         kc.mature_leaders, kc.leaders, kc.oldest_leader_days
  from keyword_judgment kj
  join cat using (keyword)
  join params p on true
  join keyword_ceiling kc
    on kc.keyword = kj.keyword and kc.country = kj.country and kc.language = kj.language
  where kj.country = p.country and kj.language = p.language
    and kj.demand_final is not null
),

-- How many distinct app names carry each word. This is the brand detector, and
-- it is built from the corpus rather than from a list somebody maintains: a
-- word one studio uses is a product, a word five thousand studios use is the
-- market's vocabulary. Empirically: wtools 2, arrowscapes 4, bfdi 10, paypal
-- 11 — against block 4013, offline 5420, puzzle 13805.
tok_df as materialized (
  select tok, count(*) df from (
    select distinct a.app_id, lower(t) tok
    from apps a, regexp_split_to_table(lower(a.name), '[^a-z0-9]+') t
    where length(t) >= 2
  ) x group by 1
),

-- The demand gate: Google Play's own autocomplete has to have offered the
-- phrase. Without it the top of the list is text scraped out of app
-- descriptions — "their respective owners", "trademarks belong" — which score
-- well on every other axis and which nobody has ever typed into Play.
suggested as (
  select distinct ks.suggestion keyword
  from keyword_suggestions ks join params p on true
  where ks.country = p.country
),

-- The most recent rank-1 app for each keyword: who is standing there now.
-- app_id comes along so the report can link the claim to the listing it is
-- about. A row asserting who holds a keyword is worth more when the reader can
-- go and look.
leader as (
  select distinct on (krc.keyword) krc.keyword, krc.app_id, a.name app_name, a.installs app_installs
  from keyword_rank_changes krc
  join apps a on a.app_id = krc.app_id
  join params p on true
  where krc.country = p.country and krc.rank = 1
    and krc.captured_at < p.until
    and krc.keyword in (select keyword from base)
  order by krc.keyword, krc.captured_at desc
),

winnable as (
  select b.*, l.app_id, l.app_name, l.app_installs
  from base b
  join suggested s using (keyword)
  left join leader l using (keyword)
  where b.demand_final > ${DEMAND_FLOOR}
    and b.big_dev_slots <= ${MAX_BIG_DEV_SLOTS}
    and b.title_matches <= ${MAX_TITLE_MATCHES}
    -- Single words are never winnable in practice and read as noise on the
    -- page: "puzzles" is held by a 100M-install app and always will be.
    and b.words >= 2
    -- A phrase that IS somebody's app or studio name is a brand, not a market.
    and not exists (select 1 from developers dv where lower(dv.name) = lower(b.keyword))
    and not exists (select 1 from apps ap where lower(ap.name) = lower(b.keyword))
    -- ...and so is a phrase with somebody's brand buried inside it. Without
    -- this clause the list carries "arrowscapes no ads" and "wtools injector".
    and not exists (
      select 1 from regexp_split_to_table(lower(b.keyword), '[^a-z0-9]+') t
      where length(t) >= ${BRAND_MIN_LEN}
        and coalesce((select df from tok_df where tok = t), 0) < ${BRAND_MIN_DF})
  order by b.demand_final desc
  limit 120
),

-- The other half of the report. A list that shows only upside reads like an ad,
-- so every issue also prints the demand in this category that is NOT available
-- and names the app sitting on it.
wall as (
  select b.*, l.app_id, l.app_name, l.app_installs
  from base b
  join suggested s using (keyword)
  join leader l using (keyword)
  where b.big_dev_slots >= 6
  order by b.demand_final desc
  limit 8
),

span as (
  select min(captured_at) lo, max(captured_at) hi
  from keyword_rank_changes krc join params p on true
  where krc.country = p.country and krc.captured_at < p.until
)

select json_build_object(
  'category', (select category from params),
  'country',  (select country  from params),
  'language', (select language from params),
  'window',   (select json_build_object('from', lo::date, 'to', hi::date) from span),
  'counts',   json_build_object(
     'keywords_in_category', (select count(*) from cat),
     'with_demand',          (select count(*) from base),
     'winnable',             (select count(*) from winnable)),
  'winnable', (select coalesce(json_agg(row_to_json(w) order by w.demand_final desc), '[]'::json) from winnable w),
  'wall',     (select coalesce(json_agg(row_to_json(w) order by w.demand_final desc), '[]'::json) from wall w)
);
`;
