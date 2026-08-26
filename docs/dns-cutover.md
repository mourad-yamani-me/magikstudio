# Cloudflare setup & DNS cutover

Moving `indiecore.net` from Blogger to Cloudflare Pages **without interrupting Zoho email**.

## The one thing to understand first

Your domain has two independent sets of records:

| Purpose | Record types | Touched during this migration? |
| --- | --- | --- |
| **Email (Zoho)** | `MX`, `TXT` (SPF, DKIM) | **No. Never.** |
| **Website** | `A`, `CNAME` | Yes — these are what we change |

Mail servers only ever read `MX` and `TXT`. Browsers only ever read `A`/`CNAME`.
Changing where the website points **cannot** affect email delivery.

The only way to break email is to delete the wrong record by hand. So: **edit individual
records, never use a bulk "delete all" action.**

### Records that must survive — verified live on your domain

```
MX    indiecore.net           10  mx.zoho.eu
MX    indiecore.net           20  mx2.zoho.eu
MX    indiecore.net           50  mx3.zoho.eu
TXT   indiecore.net           "v=spf1 include:zohomail.eu ~all"
TXT   zmail._domainkey        "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3..."
TXT   indiecore.net           "google-site-verification=2z9a0AelrPqRBzmrzouXeGumXQ6eeX5XlDxuW0gJz0Y"
TXT   indiecore.net           "google-site-verification=6Op7HNbxo1JsRLQo4JYqEMxXzabAp6cZVERwk7CMQjM"
```

You are on **Zoho EU** (`.eu`, not `.com`). If any guide tells you to use `mx.zoho.com`,
it is the wrong region — ignore it.

### Records that get replaced

```
A      indiecore.net      →  Blogger IPs (216.239.32.21 / .34.21 / .36.21 / .38.21)
CNAME  www                →  ghs.google.com
CNAME  <random-string>    →  gv-....dv.googlehosted.com   (Blogger domain verification)
```

---

## Step 1 — Back up DNS (2 min)

Cloudflare dashboard → `indiecore.net` → **DNS → Records** → **Export records**.
Save the file. This is your rollback.

Also screenshot the record list. Do not skip this.

## Step 2 — Create the Pages project (5 min)

**Workers & Pages → Create → Pages → Direct Upload**, name it exactly:

```
indie-core-dev
```

Choose *Direct Upload* — **not** "Connect to Git". This repo deploys with Wrangler from
GitHub Actions, which gives us the build/verify/Lighthouse gates before anything ships.

Upload anything to create the project (drag the `dist` folder in). CI replaces it on the
first real deploy.

## Step 3 — Create a scoped API token (3 min)

**My Profile → API Tokens → Create Token → Create Custom Token**

| Setting | Value |
| --- | --- |
| Token name | `github-actions-pages-deploy` |
| Permissions | `Account` · `Cloudflare Pages` · **Edit** |
| Account Resources | Include → *your account* |
| TTL | set an expiry, e.g. 1 year |

That single permission is all it needs. **Do not use the Global API Key** — it has full
control of your account, including DNS and email records, and cannot be scoped.

Copy the token now; it is shown once.

Grab your **Account ID** too: Workers & Pages → right sidebar, or from the dashboard URL.

## Step 4 — GitHub secrets and environments (3 min)

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |

Then **Settings → Environments** → create `production` and `preview`.
On `production` → *Deployment branches* → **Selected branches** → `main`.

## Step 5 — First deploy, on a throwaway URL (5 min)

```bash
git push -u origin main
```

Watch **Actions**. Expect: Build & verify → Lighthouse budget → Deploy production.

It publishes to:

```
https://indie-core-dev.pages.dev
```

**Your live site is still Blogger. Nothing has changed for visitors yet.**

## Step 6 — Verify everything before touching DNS (10 min)

This is the checkpoint that makes the cutover safe. On `indie-core-dev.pages.dev`:

- [ ] Home page loads, animations run, screenshots appear
- [ ] Each of the 5 game pages loads
- [ ] Each of the 5 privacy policies loads and reads correctly
- [ ] Google Play buttons open the right listings
- [ ] Looks right on your phone
- [ ] 404 page works: `/nonsense`

Do not continue until all of these pass.

## Step 7 — Point the domain at Pages (5 min)

Pages project → **Custom domains → Set up a custom domain**.

Add **`www.indiecore.net`** first. Cloudflare sees the zone in your account and offers to
update DNS for you — accept. It replaces the `www` record with a proxied `CNAME` to
`indie-core-dev.pages.dev`.

Then add **`indiecore.net`** (the apex) the same way.

If it reports a conflicting record, delete **only** the old website record it names:
the Blogger `A` records on the apex, or the `www → ghs.google.com` CNAME.

> **Do not touch any `MX` record. Do not touch any `TXT` record.**

Wait for both domains to show **Active** (usually 1–5 minutes).

## Step 8 — Verify email immediately (5 min) 🔴

Do this straight away, before anything else.

```bash
dig +short MX indiecore.net
# expect: 10 mx.zoho.eu.  /  20 mx2.zoho.eu.  /  50 mx3.zoho.eu.

dig +short TXT indiecore.net | grep spf
# expect: "v=spf1 include:zohomail.eu ~all"

dig +short TXT zmail._domainkey.indiecore.net
# expect: the DKIM key, non-empty
```

Then a real test:

1. Send an email **from** `contact@indiecore.net` to a personal address
2. Reply to it **from** that address back to `contact@indiecore.net`
3. Confirm it arrives in Zoho

If any of that fails, re-add the missing record from your step 1 export. Mail is queued and
retried by senders for a few days — a brief misconfiguration does not lose messages.

## Step 9 — Verify the site and the legacy privacy URLs (5 min)

```bash
curl -sI https://www.indiecore.net/ | head -1
# HTTP/2 200

# the URLs registered in Google Play Console — these must redirect, not 404
curl -sI https://www.indiecore.net/p/privacy-policy-for-word-slot.html | grep -iE 'HTTP|location'
# HTTP/2 301  +  location: /privacy/word-slot/
```

Check all five:

```bash
for u in soda-jam-color-sort gridsmash-block logo-quiz-guess-brand \
         perfectmatch-numbers word-slot; do
  printf '%-34s %s\n' "$u" \
    "$(curl -sI "https://www.indiecore.net/p/privacy-policy-for-$u.html" | head -1)"
done
```

## Step 10 — Apex → www redirect (3 min)

The site's canonical URLs use `www`. Make the bare domain follow.

**Rules → Redirect Rules → Create rule**

| Field | Value |
| --- | --- |
| Name | `apex to www` |
| When incoming requests match | *Custom filter expression* |
| Field / Operator / Value | `Hostname` · `equals` · `indiecore.net` |
| Then | Dynamic redirect |
| Expression | `concat("https://www.indiecore.net", http.request.uri.path)` |
| Status code | `301` |
| Preserve query string | on |

Verify:

```bash
curl -sI https://indiecore.net/games/word-slot/ | grep -iE 'HTTP|location'
# HTTP/2 301  +  location: https://www.indiecore.net/games/word-slot/
```

## Step 11 — Disconnect Blogger (2 min)

**Only after steps 8–10 pass.**

Blogger → **Settings → Publishing → Custom domain → remove**. The blog reverts to its
`.blogspot.com` address; your posts are not deleted.

Then remove the now-dead Blogger verification `CNAME` (the random string pointing at
`gv-....dv.googlehosted.com`).

## Step 12 — Search Console (5 min)

The two `google-site-verification` TXT records are still in place, so your property stays
verified.

1. Open Search Console → your property
2. **Sitemaps** → submit `https://www.indiecore.net/sitemap.xml`
3. **URL Inspection** → test `https://www.indiecore.net/` → *Request indexing*

Old Blogger URLs 301 to the new pages, so ranking signal carries over. Expect a few weeks
for the index to settle.

---

## Rollback

If the site is broken and you need Blogger back immediately:

1. DNS → Records → delete the `www` and apex `CNAME` records pointing at `pages.dev`
2. Re-add from your step 1 export:
   - `A` apex → `216.239.32.21`, `216.239.34.21`, `216.239.36.21`, `216.239.38.21`
   - `CNAME` `www` → `ghs.google.com`
3. Re-add the custom domain in Blogger settings

Email is unaffected by any of this.

---

## Optional: add DMARC

You currently have SPF and DKIM but **no DMARC record**, which weakens protection against
someone spoofing your domain. Safe to add in monitoring-only mode:

| Type | Name | Content |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:contact@indiecore.net` |

`p=none` only reports, it never blocks mail. Leave it for a few weeks, read the reports,
then consider tightening to `p=quarantine`.

---

## After the cutover

Day-to-day changes never touch any of this:

```bash
git switch -c content/update-something
# edit, then:
npm run check
git push -u origin content/update-something
```

Open a PR → preview URL → merge → production deploys itself.
